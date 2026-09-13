"""Business environment: generation, isolation, ledger integrity, idempotency."""

from __future__ import annotations

import pytest

from app.data.sandbox import SandboxError, apply_refund, create_sandbox, get_order_view, ledger_for_sandbox
from app.models.orm import Customer, Order
from tests.conftest import pick_customers, refundable_order


def test_generator_maintains_referential_integrity(session, dataset):
    customers = session.query(Customer).filter(Customer.dataset_id == dataset.id).all()
    orders = session.query(Order).filter(Order.dataset_id == dataset.id).all()
    assert customers and orders
    customer_ids = {c.id for c in customers}
    for order in orders:
        assert order.customer_id in customer_ids
        assert order.merchant_id == next(c.merchant_id for c in customers if c.id == order.customer_id)
        assert order.total_minor == sum(i.unit_price_minor * i.quantity for i in order.items)
        assert isinstance(order.total_minor, int)
    assert dataset.counts_json["orders"] == len(orders)


def test_generation_is_reproducible_from_seed(session):
    from app.data.generator import generate_dataset
    from tests.conftest import SMALL_DATASET

    a = generate_dataset(session, SMALL_DATASET, name="repro a")
    b = generate_dataset(session, SMALL_DATASET, name="repro b")
    session.flush()
    orders_a = [
        (o.total_minor, o.status, o.refund_eligible)
        for o in session.query(Order).filter(Order.dataset_id == a.id).order_by(Order.placed_at_iso, Order.total_minor)
    ]
    orders_b = [
        (o.total_minor, o.status, o.refund_eligible)
        for o in session.query(Order).filter(Order.dataset_id == b.id).order_by(Order.placed_at_iso, Order.total_minor)
    ]
    assert orders_a == orders_b


def test_sandboxes_are_isolated(session, dataset):
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    box_a = create_sandbox(session, dataset.id, "a")
    box_b = create_sandbox(session, dataset.id, "b")
    session.flush()

    before_b = get_order_view(session, box_b.id, order.id)
    apply_refund(
        session,
        sandbox_id=box_a.id,
        session_key="s1",
        order_id=order.id,
        amount_minor=100,
        reason="test",
        idempotency_key="k1",
    )
    session.flush()

    after_a = get_order_view(session, box_a.id, order.id)
    after_b = get_order_view(session, box_b.id, order.id)
    assert after_a.refunded_minor == before_b.refunded_minor + 100
    assert after_b.refunded_minor == before_b.refunded_minor, "sandbox B must be untouched"


def test_refund_is_idempotent_per_session_key(session, dataset):
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    box = create_sandbox(session, dataset.id, "idem")
    session.flush()
    start = get_order_view(session, box.id, order.id).refunded_minor

    first = apply_refund(
        session, sandbox_id=box.id, session_key="s1", order_id=order.id,
        amount_minor=250, reason="r", idempotency_key="same-key",
    )
    second = apply_refund(
        session, sandbox_id=box.id, session_key="s1", order_id=order.id,
        amount_minor=250, reason="r", idempotency_key="same-key",
    )
    session.flush()
    assert first.duplicate is False and second.duplicate is True
    assert get_order_view(session, box.id, order.id).refunded_minor == start + 250

    # a different session may use the same key: the scope is (sandbox, session, key)
    third = apply_refund(
        session, sandbox_id=box.id, session_key="s2", order_id=order.id,
        amount_minor=250, reason="r", idempotency_key="same-key",
    )
    session.flush()
    assert third.duplicate is False
    assert get_order_view(session, box.id, order.id).refunded_minor == start + 500


def test_refund_cannot_exceed_remaining_balance(session, dataset):
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    box = create_sandbox(session, dataset.id, "accounting")
    session.flush()
    view = get_order_view(session, box.id, order.id)

    with pytest.raises(SandboxError) as exc:
        apply_refund(
            session, sandbox_id=box.id, session_key="s1", order_id=order.id,
            amount_minor=view.refundable_remaining_minor + 1, reason="too much", idempotency_key="k",
        )
    assert exc.value.code == "REFUND_EXCEEDS_REMAINING"
    session.rollback()

    with pytest.raises(SandboxError):
        apply_refund(
            session, sandbox_id=box.id, session_key="s1", order_id=order.id,
            amount_minor=0, reason="zero", idempotency_key="k2",
        )


def test_full_refund_marks_order_refunded_and_writes_ledger(session, dataset):
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    box = create_sandbox(session, dataset.id, "ledger")
    session.flush()
    view = get_order_view(session, box.id, order.id)

    apply_refund(
        session, sandbox_id=box.id, session_key="s1", order_id=order.id,
        amount_minor=view.refundable_remaining_minor, reason="full", idempotency_key="full-1",
    )
    session.flush()
    after = get_order_view(session, box.id, order.id)
    assert after.refundable_remaining_minor == 0
    assert after.status == "refunded"

    entries = ledger_for_sandbox(session, box.id)
    assert len(entries) == 1
    assert entries[0].amount_minor == -view.refundable_remaining_minor
    assert entries[0].entry_type == "refund"
