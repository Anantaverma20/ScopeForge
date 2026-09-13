"""Sandbox containment: per-run mutable copies of business state.

Every scenario run gets its own sandbox. Order state (status, refunded amount)
is materialised per sandbox at creation, so a refund executed in one scenario
can never change another scenario's starting conditions. Customers, products and
tickets are immutable reference data and are read directly from the dataset.

This module is the only place that mutates business state, and every mutation is
restricted to synthetic local rows.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.orm import (
    Customer,
    Dataset,
    Order,
    Sandbox,
    SandboxArtifact,
    SandboxLedgerEntry,
    SandboxOrderState,
    SandboxRefund,
)


class SandboxError(Exception):
    """Raised when a sandbox mutation is intrinsically invalid."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class OrderView:
    """Authoritative, database-resolved order attributes."""

    order_id: str
    merchant_id: str
    customer_id: str
    status: str
    currency: str
    total_minor: int
    refunded_minor: int
    refundable_remaining_minor: int
    refund_eligible: bool
    refund_eligibility_reason: str
    placed_at: str
    delivered_at: str | None
    days_since_placed: int
    days_since_delivered: int | None
    merchant_cost_minor: int
    margin_minor: int
    fraud_score: int
    internal_flags: dict

    def resource_attrs(self) -> dict:
        """Attributes exposed to the policy engine (never model-supplied)."""
        return {
            "kind": "order",
            "resolved": True,
            "order_id": self.order_id,
            "merchant_id": self.merchant_id,
            "customer_id": self.customer_id,
            "status": self.status,
            "currency": self.currency,
            "total_minor": self.total_minor,
            "refunded_minor": self.refunded_minor,
            "refundable_remaining_minor": self.refundable_remaining_minor,
            "refund_eligible": self.refund_eligible,
            "days_since_placed": self.days_since_placed,
            "days_since_delivered": self.days_since_delivered,
        }

    def full_record(self, include_items: list[dict] | None = None) -> dict:
        record = {
            "order_id": self.order_id,
            "merchant_id": self.merchant_id,
            "customer_id": self.customer_id,
            "status": self.status,
            "placed_at": self.placed_at,
            "delivered_at": self.delivered_at,
            "currency": self.currency,
            "total_minor": self.total_minor,
            "refunded_minor": self.refunded_minor,
            "refundable_remaining_minor": self.refundable_remaining_minor,
            "refund_eligible": self.refund_eligible,
            "refund_eligibility_reason": self.refund_eligibility_reason,
            "merchant_cost_minor": self.merchant_cost_minor,
            "margin_minor": self.margin_minor,
            "fraud_score": self.fraud_score,
            "internal_flags": self.internal_flags,
        }
        if include_items is not None:
            record["items"] = include_items
        return record


def create_sandbox(session: Session, dataset_id: str, label: str) -> Sandbox:
    """Materialise a fresh isolated copy of mutable business state."""
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise SandboxError("DATASET_NOT_FOUND", f"dataset {dataset_id} does not exist")

    sandbox = Sandbox(dataset_id=dataset_id, label=label)
    session.add(sandbox)
    session.flush()

    rows = session.execute(
        select(Order.id, Order.status, Order.initial_refunded_minor)
        .where(Order.dataset_id == dataset_id)
        .order_by(Order.id)
    ).all()
    session.bulk_save_objects(
        [
            SandboxOrderState(
                sandbox_id=sandbox.id, order_id=oid, status=status, refunded_minor=refunded
            )
            for oid, status, refunded in rows
        ]
    )
    payload = json.dumps([[r[0], r[1], r[2]] for r in rows], separators=(",", ":"))
    sandbox.snapshot_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    session.flush()
    return sandbox


def _days_between(later_iso: str, earlier_iso: str) -> int:
    return (datetime.fromisoformat(later_iso) - datetime.fromisoformat(earlier_iso)).days


def get_order_view(session: Session, sandbox_id: str, order_id: str) -> OrderView | None:
    order = session.get(Order, order_id)
    if order is None:
        return None
    state = session.get(SandboxOrderState, {"sandbox_id": sandbox_id, "order_id": order_id})
    if state is None:
        return None
    dataset = session.get(Dataset, order.dataset_id)
    clock_iso = dataset.clock_iso if dataset else order.placed_at_iso

    refunded = state.refunded_minor
    return OrderView(
        order_id=order.id,
        merchant_id=order.merchant_id,
        customer_id=order.customer_id,
        status=state.status,
        currency=order.currency,
        total_minor=order.total_minor,
        refunded_minor=refunded,
        refundable_remaining_minor=max(order.total_minor - refunded, 0),
        refund_eligible=order.refund_eligible,
        refund_eligibility_reason=order.refund_eligibility_reason,
        placed_at=order.placed_at_iso,
        delivered_at=order.delivered_at_iso,
        days_since_placed=_days_between(clock_iso, order.placed_at_iso),
        days_since_delivered=(
            _days_between(clock_iso, order.delivered_at_iso) if order.delivered_at_iso else None
        ),
        merchant_cost_minor=order.merchant_cost_minor,
        margin_minor=order.margin_minor,
        fraud_score=order.fraud_score,
        internal_flags=order.internal_flags or {},
    )


def list_order_views(session: Session, sandbox_id: str, customer_id: str) -> list[OrderView]:
    order_ids = session.execute(
        select(Order.id).where(Order.customer_id == customer_id).order_by(Order.placed_at_iso.desc())
    ).scalars().all()
    views = [get_order_view(session, sandbox_id, oid) for oid in order_ids]
    return [v for v in views if v is not None]


def customer_record(customer: Customer) -> dict:
    return {
        "customer_id": customer.id,
        "merchant_id": customer.merchant_id,
        "name": customer.name,
        "email": customer.email,
        "phone": customer.phone,
        "city": customer.city,
        "country": customer.country,
        "loyalty_tier": customer.loyalty_tier,
        "created_at": customer.created_at_iso,
        "ssn_last4": customer.ssn_last4,
        "internal_risk_score": customer.internal_risk_score,
        "lifetime_value_minor": customer.lifetime_value_minor,
        "marketing_segment": customer.marketing_segment,
        "internal_notes": customer.internal_notes,
    }


@dataclass
class RefundResult:
    refund_id: str
    duplicate: bool
    amount_minor: int
    refunded_minor_total: int
    refundable_remaining_minor: int
    currency: str
    created_at: str


def apply_refund(
    session: Session,
    *,
    sandbox_id: str,
    session_key: str,
    order_id: str,
    amount_minor: int,
    reason: str,
    idempotency_key: str,
) -> RefundResult:
    """Execute a refund against sandbox state.

    Enforces intrinsic accounting validity (positive amount, never more than the
    remaining refundable balance) and prevents duplicate execution using an
    idempotency key scoped to (sandbox, session, key). Business *authorization*
    is decided separately by the policy engine before this runs.
    """
    if not isinstance(amount_minor, int) or amount_minor <= 0:
        raise SandboxError("REFUND_NON_POSITIVE", "refund amount must be a positive integer")
    if not idempotency_key:
        raise SandboxError("REFUND_NO_IDEMPOTENCY_KEY", "an idempotency key is required")

    existing = session.execute(
        select(SandboxRefund).where(
            SandboxRefund.sandbox_id == sandbox_id,
            SandboxRefund.session_id == session_key,
            SandboxRefund.idempotency_key == idempotency_key,
        )
    ).scalar_one_or_none()
    if existing is not None:
        view = get_order_view(session, sandbox_id, existing.order_id)
        return RefundResult(
            refund_id=existing.id,
            duplicate=True,
            amount_minor=existing.amount_minor,
            refunded_minor_total=view.refunded_minor if view else existing.amount_minor,
            refundable_remaining_minor=view.refundable_remaining_minor if view else 0,
            currency=existing.currency,
            created_at=existing.created_at.isoformat(),
        )

    state = session.get(
        SandboxOrderState, {"sandbox_id": sandbox_id, "order_id": order_id}, with_for_update=False
    )
    order = session.get(Order, order_id)
    if state is None or order is None:
        raise SandboxError("ORDER_NOT_FOUND", f"order {order_id} is not in this sandbox")

    remaining = order.total_minor - state.refunded_minor
    if amount_minor > remaining:
        raise SandboxError(
            "REFUND_EXCEEDS_REMAINING",
            f"refund of {amount_minor} exceeds the remaining refundable balance of {remaining}",
        )

    refund = SandboxRefund(
        sandbox_id=sandbox_id,
        session_id=session_key,
        idempotency_key=idempotency_key,
        order_id=order_id,
        customer_id=order.customer_id,
        merchant_id=order.merchant_id,
        amount_minor=amount_minor,
        currency=order.currency,
        reason=reason[:400],
    )
    session.add(refund)

    state.refunded_minor += amount_minor
    state.version += 1
    if state.refunded_minor >= order.total_minor:
        state.status = "refunded"

    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise SandboxError("REFUND_DUPLICATE", "duplicate idempotency key") from exc

    session.add(
        SandboxLedgerEntry(
            sandbox_id=sandbox_id,
            order_id=order_id,
            entry_type="refund",
            amount_minor=-amount_minor,
            currency=order.currency,
            ref_id=refund.id,
        )
    )
    session.flush()

    return RefundResult(
        refund_id=refund.id,
        duplicate=False,
        amount_minor=amount_minor,
        refunded_minor_total=state.refunded_minor,
        refundable_remaining_minor=order.total_minor - state.refunded_minor,
        currency=order.currency,
        created_at=refund.created_at.isoformat(),
    )


def record_export_artifact(session: Session, sandbox_id: str, rows: list[dict]) -> SandboxArtifact:
    """Persist a local-only export artifact. Nothing leaves this machine."""
    artifact = SandboxArtifact(
        sandbox_id=sandbox_id,
        kind="customer_export",
        row_count=len(rows),
        content_json={"rows": rows[:200], "truncated": len(rows) > 200, "destination": "local_sandbox_only"},
    )
    session.add(artifact)
    session.flush()
    return artifact


def ledger_for_sandbox(session: Session, sandbox_id: str) -> list[SandboxLedgerEntry]:
    return list(
        session.execute(
            select(SandboxLedgerEntry)
            .where(SandboxLedgerEntry.sandbox_id == sandbox_id)
            .order_by(SandboxLedgerEntry.created_at)
        ).scalars()
    )


def sandbox_state_summary(session: Session, sandbox_id: str, order_ids: list[str]) -> dict:
    """Snapshot of the order rows a run touches, for before/after comparison."""
    out: dict[str, dict] = {}
    for oid in order_ids:
        view = get_order_view(session, sandbox_id, oid)
        if view is not None:
            out[oid] = {
                "status": view.status,
                "refunded_minor": view.refunded_minor,
                "refundable_remaining_minor": view.refundable_remaining_minor,
            }
    return out
