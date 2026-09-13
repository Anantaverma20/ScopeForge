"""Test fixtures.

These are engineering tests with isolated local state. They exercise the real
generator, sandbox, policy engine and gateway - but they are NOT evidence of
live LLM or sponsor-integration success. Anything needing a network call is
marked and skipped without credentials.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="scopeforge_tests_"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"

import pytest  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.config import GenerationDefaults, load_business_contract, load_defaults  # noqa: E402
from app.data.generator import generate_dataset  # noqa: E402
from app.data.sandbox import create_sandbox  # noqa: E402
from app.db import SessionLocal, init_db  # noqa: E402
from app.gateway.gateway import ToolGateway, TrustedContext  # noqa: E402
from app.gateway.tools import KNOWN_TOOLS  # noqa: E402
from app.models.orm import Customer, Experiment, Order, ScenarioRun  # noqa: E402
from app.policies.engine import PolicyEngine  # noqa: E402
from app.policies.store import ensure_baseline_policy, engine_for  # noqa: E402

init_db()

SMALL_DATASET = GenerationDefaults(
    merchants=2,
    customers_per_merchant=4,
    orders_per_customer_max=3,
    products_per_merchant=5,
    tickets_per_merchant=4,
    seed=4242,
    clock_iso="2026-03-01T12:00:00+00:00",
)


@pytest.fixture()
def session() -> Session:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    finally:
        s.close()


@pytest.fixture()
def dataset(session: Session):
    ds = generate_dataset(session, SMALL_DATASET, name="test dataset")
    session.commit()
    return ds


@pytest.fixture()
def contract():
    return load_business_contract()


@pytest.fixture()
def limits():
    return load_defaults().business_limits.model_dump()


@pytest.fixture()
def baseline_engine(session: Session):
    policy = ensure_baseline_policy(session)
    session.commit()
    engine = engine_for(session, policy.id)
    assert engine is not None
    return policy, engine


def make_gateway(
    session: Session,
    *,
    dataset_id: str,
    engine: PolicyEngine,
    policy_id: str,
    customer: Customer,
    run_id: str = "run_test",
    session_id: str = "sess_test",
    tool_note: str | None = None,
) -> ToolGateway:
    sandbox = create_sandbox(session, dataset_id, label=f"test:{run_id}")
    experiment = Experiment(
        name="test experiment", kind="baseline", suite_id="", dataset_id=dataset_id, policy_id=policy_id
    )
    session.add(experiment)
    session.flush()
    run = ScenarioRun(
        experiment_id=experiment.id,
        scenario_id="scn_test",
        policy_id=policy_id,
        sandbox_id=sandbox.id,
        dataset_id=dataset_id,
        suite_id="",
    )
    session.add(run)
    session.flush()
    return ToolGateway(
        session,
        sandbox_id=sandbox.id,
        context=TrustedContext(
            tenant_id=customer.merchant_id,
            authenticated_customer_id=customer.id,
            session_id=session_id,
            contract_version=load_defaults().business_contract_version,
        ),
        engine=engine,
        policy_id=policy_id,
        contract=load_business_contract(),
        limits=load_defaults().business_limits.model_dump(),
        scenario_run_id=run.id,
        tool_note=tool_note,
    )


def pick_customers(session: Session, dataset_id: str) -> tuple[Customer, Customer, Customer]:
    """Returns (subject, same-tenant other customer, cross-tenant customer)."""
    customers = list(
        session.query(Customer).filter(Customer.dataset_id == dataset_id).order_by(Customer.id).all()
    )
    # prefer a subject that actually has a refund-eligible order
    with_eligible = [
        c
        for c in customers
        if session.query(Order)
        .filter(Order.customer_id == c.id, Order.refund_eligible.is_(True))
        .first()
        is not None
    ]
    subject = (with_eligible or customers)[0]
    same_tenant = next(c for c in customers if c.merchant_id == subject.merchant_id and c.id != subject.id)
    cross_tenant = next(c for c in customers if c.merchant_id != subject.merchant_id)
    return subject, same_tenant, cross_tenant


def refundable_order(session: Session, customer_id: str) -> Order:
    orders = (
        session.query(Order)
        .filter(Order.customer_id == customer_id, Order.refund_eligible.is_(True))
        .order_by(Order.id)
        .all()
    )
    assert orders, "generator produced no refundable order for this customer"
    return orders[0]


__all__ = ["KNOWN_TOOLS", "make_gateway", "pick_customers", "refundable_order", "SMALL_DATASET"]
