"""Immutable policy version storage and activation."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import CONFIG_DIR, load_defaults
from app.models.orm import Policy
from app.policies.engine import PolicyEngine
from app.policies.schema import PolicyDocument, validate_document
from app.gateway.tools import KNOWN_TOOLS

DEFAULT_FAMILY = "default"
BASELINE_PATH: Path = CONFIG_DIR / "policies" / "permissive_baseline.json"


class PolicyError(Exception):
    pass


def _next_version(session: Session, family_id: str) -> int:
    rows = session.execute(select(Policy.version).where(Policy.family_id == family_id)).scalars().all()
    return (max(rows) + 1) if rows else 1


def create_policy_version(
    session: Session,
    *,
    raw_document: dict,
    kind: str,
    name: str | None = None,
    parent_id: str | None = None,
    family_id: str = DEFAULT_FAMILY,
    rationale: str = "",
    evidence: dict | None = None,
    expected_effects: dict | None = None,
    tradeoffs: str = "",
    created_by: str = "system",
    source_model: str = "",
    experiment_id: str | None = None,
) -> Policy:
    """Validate and persist a new immutable policy version.

    An invalid document is still stored (so a rejected proposal can be inspected)
    but is marked invalid, is never activatable, and fails closed at evaluation.
    """
    result = validate_document(raw_document)
    document = result.document
    defaults = load_defaults()

    policy = Policy(
        family_id=family_id,
        version=_next_version(session, family_id),
        parent_id=parent_id,
        name=name or (document.name if document else "Invalid policy proposal"),
        kind=kind,
        document_json=raw_document,
        canonical_hash=document.canonical_hash() if document else "",
        semantic_hash=document.semantic_hash() if document else "",
        validation_status="valid" if result.valid else "invalid",
        validation_errors_json=result.errors,
        rationale=rationale,
        evidence_json=evidence or {},
        expected_effects_json=expected_effects or {},
        tradeoffs=tradeoffs,
        created_by=created_by,
        source_model=source_model,
        contract_version=defaults.business_contract_version,
        experiment_id=experiment_id,
        activation_eligible=False,
    )
    session.add(policy)
    session.flush()
    return policy


def find_semantic_duplicate(
    session: Session, *, family_id: str, semantic_hash: str, exclude_id: str | None = None
) -> Policy | None:
    """An earlier version of this family that decides identically.

    Catches a proposal that only reordered ANDed conditions or reworded a
    description: a different document, but not a different policy. Also catches a
    loop that cycles back to a policy it already tried.
    """
    if not semantic_hash:
        return None
    query = select(Policy).where(
        Policy.family_id == family_id,
        Policy.semantic_hash == semantic_hash,
        Policy.validation_status == "valid",
    )
    if exclude_id:
        query = query.where(Policy.id != exclude_id)
    return session.execute(query.order_by(Policy.version)).scalars().first()


def backfill_semantic_hashes(session: Session) -> int:
    """Fill in semantic hashes for policies stored before the column existed."""
    filled = 0
    for policy in session.execute(select(Policy).where(Policy.semantic_hash == "")).scalars():
        result = validate_document(policy.document_json)
        if result.valid and result.document is not None:
            policy.semantic_hash = result.document.semantic_hash()
            filled += 1
    if filled:
        session.flush()
    return filled


def ensure_baseline_policy(session: Session) -> Policy:
    """Load the labelled permissive baseline from config if not already stored."""
    existing = session.execute(
        select(Policy).where(Policy.kind == "permissive_baseline").order_by(Policy.version)
    ).scalars().first()
    if existing is not None:
        return existing
    raw = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    return create_policy_version(
        session,
        raw_document=raw,
        kind="permissive_baseline",
        rationale=(
            "Shipped measurement baseline. Intentionally unrestricted so that the exposure of an "
            "unscoped agent can be measured inside the synthetic sandbox. Not eligible for activation."
        ),
        created_by="system",
    )


def engine_for(session: Session, policy_id: str) -> PolicyEngine | None:
    """Build an evaluation engine. Returns None for an invalid policy (fail closed)."""
    policy = session.get(Policy, policy_id)
    if policy is None or policy.validation_status != "valid":
        return None
    limits = load_defaults().business_limits.model_dump()
    return PolicyEngine.from_raw(policy.document_json, KNOWN_TOOLS, limits)


def set_decision(
    session: Session, policy_id: str, decision: str, reason: str, metrics: dict | None = None
) -> Policy:
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise PolicyError("policy not found")
    policy.decision = decision
    policy.decision_reason = reason
    policy.decision_metrics_json = metrics or {}
    policy.activation_eligible = (
        decision == "accepted"
        and policy.validation_status == "valid"
        and policy.kind != "permissive_baseline"
    )
    session.flush()
    return policy


def activate_policy(session: Session, policy_id: str, override_reason: str = "") -> Policy:
    """Activate a policy for the local playground. Never called automatically."""
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise PolicyError("policy not found")
    if policy.validation_status != "valid":
        raise PolicyError("an invalid policy can never be activated")
    if policy.kind == "permissive_baseline":
        raise PolicyError(
            "the permissive baseline exists only to measure exposure and is not eligible for activation"
        )
    if not policy.activation_eligible and not override_reason:
        raise PolicyError(
            "this candidate did not pass the configured acceptance gate; "
            "activation requires an explicit recorded override"
        )

    for other in session.execute(select(Policy).where(Policy.is_active_playground.is_(True))).scalars():
        other.is_active_playground = False
    policy.is_active_playground = True
    if override_reason:
        policy.decision_reason = (
            f"{policy.decision_reason}\n[operator override] activated despite the acceptance gate: {override_reason}"
        ).strip()
    session.flush()
    return policy


def active_policy(session: Session) -> Policy | None:
    return session.execute(
        select(Policy).where(Policy.is_active_playground.is_(True))
    ).scalars().first()


def diff_documents(parent: dict | None, child: dict) -> dict:
    """Structural diff between two policy documents, by rule id."""
    child_doc = validate_document(child).document
    parent_doc = validate_document(parent).document if parent else None

    def rule_map(doc: PolicyDocument | None) -> dict[str, dict]:
        if doc is None:
            return {}
        return {r.id: r.model_dump(mode="json", exclude_none=True) for r in doc.rules}

    p, c = rule_map(parent_doc), rule_map(child_doc)
    added = [c[k] for k in c if k not in p]
    removed = [p[k] for k in p if k not in c]
    changed = [{"id": k, "before": p[k], "after": c[k]} for k in c if k in p and p[k] != c[k]]
    return {
        "added_rules": added,
        "removed_rules": removed,
        "changed_rules": changed,
        "default_effect": {
            "before": parent_doc.default_effect if parent_doc else None,
            "after": child_doc.default_effect if child_doc else None,
        },
        "unchanged_rule_count": len([k for k in c if k in p and p[k] == c[k]]),
    }
