"""Dataset generation and inspection, plus scenario suites."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import schemas, serializers
from app.config import GenerationDefaults
from app.data.generator import generate_dataset
from app.db import get_session
from app.evaluations.scenarios import generate_suite
from app.models.orm import Customer, Dataset, Order, Scenario, Suite
from app.settings_store import get_runtime_settings, update_runtime_settings

router = APIRouter(prefix="/api", tags=["data"])


# --------------------------------------------------------------------------- #
# datasets
# --------------------------------------------------------------------------- #
@router.get("/datasets", response_model=list[schemas.DatasetSummary])
def list_datasets(session: Session = Depends(get_session)) -> list[schemas.DatasetSummary]:
    rows = session.execute(select(Dataset).order_by(Dataset.created_at.desc())).scalars()
    return [serializers.dataset_summary(d) for d in rows]


@router.post("/datasets", response_model=schemas.DatasetSummary, status_code=201)
def create_dataset(
    payload: schemas.GenerateDatasetRequest, session: Session = Depends(get_session)
) -> schemas.DatasetSummary:
    runtime = get_runtime_settings(session)
    config = GenerationDefaults(
        merchants=payload.merchants,
        customers_per_merchant=payload.customers_per_merchant,
        orders_per_customer_max=payload.orders_per_customer_max,
        products_per_merchant=payload.products_per_merchant,
        tickets_per_merchant=payload.tickets_per_merchant,
        seed=payload.seed,
        clock_iso=runtime.generation.clock_iso,
    )
    dataset = generate_dataset(session, config, name=payload.name)
    update_runtime_settings(session, {"generation": config.model_dump()})
    session.commit()
    return serializers.dataset_summary(dataset)


@router.get("/datasets/{dataset_id}", response_model=schemas.DatasetSummary)
def get_dataset(dataset_id: str, session: Session = Depends(get_session)) -> schemas.DatasetSummary:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None:
        raise HTTPException(404, "dataset not found")
    return serializers.dataset_summary(dataset)


@router.get("/datasets/{dataset_id}/customers", response_model=list[schemas.CustomerRow])
def dataset_customers(
    dataset_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[schemas.CustomerRow]:
    return serializers.customer_rows(session, dataset_id, limit, offset)


@router.get("/datasets/{dataset_id}/orders", response_model=list[schemas.OrderRow])
def dataset_orders(
    dataset_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    customer_id: str | None = None,
    session: Session = Depends(get_session),
) -> list[schemas.OrderRow]:
    return serializers.order_rows(session, dataset_id, limit, offset, customer_id)


@router.get("/datasets/{dataset_id}/tickets", response_model=list[schemas.TicketRow])
def dataset_tickets(
    dataset_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
) -> list[schemas.TicketRow]:
    return serializers.ticket_rows(session, dataset_id, limit, offset)


# --------------------------------------------------------------------------- #
# suites and scenarios
# --------------------------------------------------------------------------- #
@router.get("/suites", response_model=list[schemas.SuiteSummary])
def list_suites(
    dataset_id: str | None = None, session: Session = Depends(get_session)
) -> list[schemas.SuiteSummary]:
    query = select(Suite).order_by(Suite.created_at.desc())
    if dataset_id:
        query = query.where(Suite.dataset_id == dataset_id)
    return [serializers.suite_summary(s) for s in session.execute(query).scalars()]


class CreateSuiteRequest(schemas.BaseModel):
    dataset_id: str
    legitimate_cases: int | None = None
    adversarial_cases: int | None = None
    name: str | None = None
    seed: int | None = None


@router.post("/suites", response_model=schemas.SuiteSummary, status_code=201)
def create_suite(payload: CreateSuiteRequest, session: Session = Depends(get_session)) -> schemas.SuiteSummary:
    runtime = get_runtime_settings(session)
    patch: dict = {}
    if payload.legitimate_cases is not None:
        patch["legitimate_cases"] = payload.legitimate_cases
    if payload.adversarial_cases is not None:
        patch["adversarial_cases"] = payload.adversarial_cases
    if patch:
        runtime = update_runtime_settings(session, {"suite": patch})
    try:
        suite = generate_suite(
            session, dataset_id=payload.dataset_id, settings=runtime, name=payload.name, seed=payload.seed
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    session.commit()
    return serializers.suite_summary(suite)


@router.get("/suites/{suite_id}", response_model=schemas.SuiteSummary)
def get_suite(suite_id: str, session: Session = Depends(get_session)) -> schemas.SuiteSummary:
    suite = session.get(Suite, suite_id)
    if suite is None:
        raise HTTPException(404, "suite not found")
    return serializers.suite_summary(suite)


@router.get("/suites/{suite_id}/scenarios", response_model=list[schemas.ScenarioSummary])
def suite_scenarios(
    suite_id: str,
    split: str | None = None,
    kind: str | None = None,
    session: Session = Depends(get_session),
) -> list[schemas.ScenarioSummary]:
    query = select(Scenario).where(Scenario.suite_id == suite_id)
    if split:
        query = query.where(Scenario.split == split)
    if kind:
        query = query.where(Scenario.kind == kind)
    rows = session.execute(query.order_by(Scenario.kind, Scenario.key)).scalars()
    return [serializers.scenario_summary(session, s) for s in rows]


@router.get("/scenarios/{scenario_id}", response_model=schemas.ScenarioDetail)
def get_scenario(scenario_id: str, session: Session = Depends(get_session)) -> schemas.ScenarioDetail:
    scenario = session.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(404, "scenario not found")
    return serializers.scenario_detail(session, scenario)


@router.get("/datasets/{dataset_id}/stats")
def dataset_stats(dataset_id: str, session: Session = Depends(get_session)) -> dict:
    """Counts used by the dataset inspector, straight from the database."""
    if session.get(Dataset, dataset_id) is None:
        raise HTTPException(404, "dataset not found")
    by_status = dict(
        session.execute(
            select(Order.status, func.count(Order.id)).where(Order.dataset_id == dataset_id).group_by(Order.status)
        ).all()
    )
    eligible = session.execute(
        select(func.count(Order.id)).where(Order.dataset_id == dataset_id, Order.refund_eligible.is_(True))
    ).scalar_one()
    total_orders = session.execute(
        select(func.count(Order.id)).where(Order.dataset_id == dataset_id)
    ).scalar_one()
    customers = session.execute(
        select(func.count(Customer.id)).where(Customer.dataset_id == dataset_id)
    ).scalar_one()
    return {
        "orders_by_status": by_status,
        "refund_eligible_orders": int(eligible),
        "total_orders": int(total_orders),
        "customers": int(customers),
    }
