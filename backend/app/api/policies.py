"""Policy retrieval, comparison, evaluation and activation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas, serializers
from app.db import get_session
from app.jobs.queue import enqueue
from app.models.orm import Policy, Suite
from app.policies.schema import policy_json_schema
from app.policies.store import PolicyError, activate_policy, diff_documents, ensure_baseline_policy

router = APIRouter(prefix="/api/policies", tags=["policies"])


@router.get("", response_model=list[schemas.PolicySummary])
def list_policies(session: Session = Depends(get_session)) -> list[schemas.PolicySummary]:
    ensure_baseline_policy(session)
    session.commit()
    rows = session.execute(select(Policy).order_by(Policy.created_at.desc())).scalars()
    return [serializers.policy_summary(p) for p in rows]


@router.get("/language")
def policy_language() -> dict:
    """The policy JSON Schema, also used to validate designer output."""
    return {"json_schema": policy_json_schema()}


@router.get("/{policy_id}", response_model=schemas.PolicyDetail)
def get_policy(policy_id: str, session: Session = Depends(get_session)) -> schemas.PolicyDetail:
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise HTTPException(404, "policy not found")
    return serializers.policy_detail(policy)


@router.get("/{policy_id}/diff", response_model=schemas.PolicyDiffResponse)
def policy_diff(policy_id: str, session: Session = Depends(get_session)) -> schemas.PolicyDiffResponse:
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise HTTPException(404, "policy not found")
    parent = session.get(Policy, policy.parent_id) if policy.parent_id else None
    return schemas.PolicyDiffResponse(
        policy_id=policy.id,
        parent_id=parent.id if parent else None,
        diff=diff_documents(parent.document_json if parent else None, policy.document_json),
    )


@router.get("/{policy_id}/export")
def export_policy(policy_id: str, session: Session = Depends(get_session)) -> JSONResponse:
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise HTTPException(404, "policy not found")
    payload = {
        "exported_at": serializers.iso(policy.created_at),
        "policy_id": policy.id,
        "version": policy.version,
        "canonical_hash": policy.canonical_hash,
        "validation_status": policy.validation_status,
        "decision": policy.decision,
        "decision_reason": policy.decision_reason,
        "decision_metrics": policy.decision_metrics_json,
        "rationale": policy.rationale,
        "evidence": policy.evidence_json,
        "expected_effects": policy.expected_effects_json,
        "tradeoffs": policy.tradeoffs,
        "created_by": policy.created_by,
        "source_model": policy.source_model,
        "contract_version": policy.contract_version,
        "document": policy.document_json,
        "scope_note": (
            "A tested candidate within the supported policy language and the scenario coverage that was run. "
            "Not a claim of minimality or of general security."
        ),
    }
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="scopeforge-policy-v{policy.version}.json"'},
    )


@router.post("/{policy_id}/activate", response_model=schemas.PolicySummary)
def activate(
    policy_id: str,
    payload: schemas.ActivatePolicyRequest,
    session: Session = Depends(get_session),
) -> schemas.PolicySummary:
    try:
        policy = activate_policy(session, policy_id, override_reason=payload.override_reason.strip())
    except PolicyError as exc:
        raise HTTPException(400, str(exc)) from exc
    session.commit()
    return serializers.policy_summary(policy)


@router.post("/{policy_id}/evaluate", response_model=schemas.JobOut, status_code=202)
def evaluate(
    policy_id: str,
    payload: schemas.EvaluatePolicyRequest,
    session: Session = Depends(get_session),
) -> schemas.JobOut:
    policy = session.get(Policy, policy_id)
    if policy is None:
        raise HTTPException(404, "policy not found")
    if policy.validation_status != "valid":
        raise HTTPException(400, "this policy failed validation and cannot be evaluated")
    if session.get(Suite, payload.suite_id) is None:
        raise HTTPException(404, "suite not found")

    job, _ = enqueue(
        session,
        kind="experiment_run",
        params={
            "suite_id": payload.suite_id,
            "policy_id": policy_id,
            "splits": payload.splits,
            "kind": "policy_eval",
            "name": f"Evaluation of {policy.name} v{policy.version}",
        },
        dedupe_key=f"eval:{policy_id}:{payload.suite_id}:{','.join(sorted(payload.splits))}",
    )
    session.commit()
    return serializers.job_out(job)
