"""Playground turns: the production-style local environment.

The playground runs the same agent, the same gateway and the same enforcement
path as an evaluation run, against the policy the operator activated. The server
establishes the session identity before the model runs; nothing typed into the
conversation can change it.

Protection here is limited to the implemented tools and the conditions that were
actually tested. It is not a general security guarantee.
"""

from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.support_agent import run_support_agent
from app.config import RuntimeSettings, load_business_contract
from app.data.sandbox import sandbox_state_summary
from app.db import utcnow
from app.evaluations.scorers import score_run
from app.gateway.gateway import ToolGateway, TrustedContext
from app.integrations.weave_tracing import tracer
from app.models.orm import (
    Customer,
    Merchant,
    Order,
    PlaygroundSession,
    Policy,
    ScenarioRun,
    ScoreRecord,
    ToolEvent,
)
from app.policies.store import engine_for


def run_playground_turn(
    session: Session,
    *,
    pg_session: PlaygroundSession,
    experiment_id: str,
    message: str,
    settings: RuntimeSettings,
) -> ScenarioRun:
    started = time.perf_counter()
    policy = session.get(Policy, pg_session.policy_id)
    customer = session.get(Customer, pg_session.authenticated_customer_id)
    merchant = session.get(Merchant, pg_session.tenant_id)

    order_ids = sorted(
        session.execute(select(Order.id).where(Order.customer_id == pg_session.authenticated_customer_id))
        .scalars()
        .all()
    )
    initial_state = sandbox_state_summary(session, pg_session.sandbox_id, order_ids)

    context = TrustedContext(
        tenant_id=pg_session.tenant_id,
        authenticated_customer_id=pg_session.authenticated_customer_id,
        session_id=pg_session.id,
        contract_version=pg_session.contract_version,
        channel="playground",
    )

    run = ScenarioRun(
        experiment_id=experiment_id,
        scenario_id="playground",
        policy_id=pg_session.policy_id,
        sandbox_id=pg_session.sandbox_id,
        dataset_id=pg_session.dataset_id,
        suite_id="",
        split="",
        status="running",
        model=settings.llm_model,
        model_settings_json={"model": settings.llm_model, "temperature": settings.llm_temperature},
        trusted_context_json=context.as_dict(),
        initial_state_json=initial_state,
    )
    session.add(run)
    session.flush()

    engine = engine_for(session, pg_session.policy_id)
    if engine is None:
        run.status = "failed"
        run.error = "the active policy is not valid; no tool call can be authorised"
        run.finished_at = utcnow()
        session.flush()
        return run

    gateway = ToolGateway(
        session,
        sandbox_id=pg_session.sandbox_id,
        context=context,
        engine=engine,
        policy_id=pg_session.policy_id,
        contract=load_business_contract(),
        limits=settings.business_limits.model_dump(),
        scenario_run_id=run.id,
    )

    try:
        with tracer.attributes(
            scopeforge_run_id=run.id,
            playground_session_id=pg_session.id,
            policy_id=policy.id if policy else "",
            policy_version=policy.version if policy else 0,
            model=settings.llm_model,
            surface="playground",
        ):
            result, call = run_support_agent.call(
                gateway=gateway,
                merchant_name=merchant.name if merchant else "the store",
                customer_name=customer.name if customer else "the customer",
                user_message=message,
                model=settings.llm_model,
                temperature=settings.llm_temperature,
                max_steps=settings.budget.max_agent_steps_per_scenario,
            )
        meta = tracer.call_metadata(call)
        run.weave_call_id, run.weave_call_url = meta["call_id"], meta["url"]
        run.trace_status = meta["status"]
        run.messages_json = result.messages
        run.final_response = result.final_response
        run.token_usage_json = result.usage
        run.model = result.model or run.model
        if result.error:
            run.error = result.error
    except Exception as exc:
        run.error = f"{type(exc).__name__}: {exc}"

    run.status = "failed" if run.error else "completed"
    run.duration_ms = int((time.perf_counter() - started) * 1000)
    run.finished_at = utcnow()
    run.final_state_json = sandbox_state_summary(session, pg_session.sandbox_id, order_ids)

    events = list(
        session.execute(
            select(ToolEvent).where(ToolEvent.scenario_run_id == run.id).order_by(ToolEvent.step_index)
        ).scalars()
    )
    scores = score_run(run, events, {"type": "legitimate"})
    for score in scores:
        session.add(
            ScoreRecord(
                scenario_run_id=run.id,
                experiment_id=experiment_id,
                scorer=score.scorer,
                passed=score.passed,
                value=score.value,
                applicable=score.applicable,
                evidence_json=score.evidence,
            )
        )
    run.scores_json = {s.scorer: {"passed": s.passed, "value": s.value} for s in scores}
    run.contract_violations_json = sorted(
        {v for e in events if e.executed for v in e.contract_violations_json}
    )
    session.flush()
    return run
