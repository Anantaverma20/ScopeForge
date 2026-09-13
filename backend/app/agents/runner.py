"""Scenario execution.

One scenario run = one isolated sandbox + one trusted context + one policy +
one real agent execution. Everything observed is persisted locally; Weave
tracing is attached when it is actually working.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.support_agent import AgentResult, run_support_agent
from app.config import RuntimeSettings, load_business_contract
from app.data.sandbox import create_sandbox, sandbox_state_summary
from app.db import utcnow
from app.evaluations.scorers import score_run
from app.gateway.gateway import ToolGateway, TrustedContext
from app.integrations.weave_tracing import tracer
from app.models.orm import (
    Customer,
    Merchant,
    Order,
    Policy,
    Scenario,
    ScenarioRun,
    ScoreRecord,
    ToolEvent,
)
from app.policies.store import engine_for


@dataclass
class RunOutcome:
    run: ScenarioRun
    agent: AgentResult | None
    scores: list


def _relevant_order_ids(session: Session, scenario: Scenario) -> list[str]:
    ids = set(
        session.execute(
            select(Order.id).where(Order.customer_id == scenario.authenticated_customer_id)
        ).scalars()
    )
    if scenario.target_foreign_customer_id:
        ids |= set(
            session.execute(
                select(Order.id).where(Order.customer_id == scenario.target_foreign_customer_id)
            ).scalars()
        )
    if scenario.target_order_id:
        ids.add(scenario.target_order_id)
    return sorted(ids)


def run_scenario(
    session: Session,
    *,
    scenario: Scenario,
    policy: Policy,
    experiment_id: str,
    settings: RuntimeSettings,
    should_stop: Callable[[], bool] | None = None,
) -> RunOutcome:
    """Execute one scenario. Never raises for model failures - they are recorded."""
    started = time.perf_counter()
    customer = session.get(Customer, scenario.authenticated_customer_id)
    merchant = session.get(Merchant, scenario.tenant_id)
    sandbox = create_sandbox(session, scenario.dataset_id, label=f"{experiment_id}:{scenario.key}")
    order_ids = _relevant_order_ids(session, scenario)
    initial_state = sandbox_state_summary(session, sandbox.id, order_ids)

    context = TrustedContext(
        tenant_id=scenario.tenant_id,
        authenticated_customer_id=scenario.authenticated_customer_id,
        session_id=f"sess_{sandbox.id}",
        contract_version=settings.business_contract_version,
    )

    run = ScenarioRun(
        experiment_id=experiment_id,
        scenario_id=scenario.id,
        policy_id=policy.id,
        sandbox_id=sandbox.id,
        dataset_id=scenario.dataset_id,
        suite_id=scenario.suite_id,
        split=scenario.split,
        status="running",
        model=settings.llm_model,
        model_settings_json={
            "model": settings.llm_model,
            "temperature": settings.llm_temperature,
            "max_steps": settings.budget.max_agent_steps_per_scenario,
        },
        trusted_context_json=context.as_dict(),
        initial_state_json=initial_state,
    )
    session.add(run)
    session.flush()
    # release SQLite's write lock before the first model call: the row is durable
    # from here, and the API stays responsive while the agent is thinking
    session.commit()

    engine = engine_for(session, policy.id)
    if engine is None:
        run.status = "failed"
        run.error = (
            f"policy {policy.id} is not valid ({'; '.join(policy.validation_errors_json) or 'unknown error'}); "
            "no tool call can be authorised by an invalid policy"
        )
        run.finished_at = utcnow()
        run.duration_ms = int((time.perf_counter() - started) * 1000)
        session.flush()
        return _finalise(session, run, scenario, None, order_ids, sandbox.id)

    gateway = ToolGateway(
        session,
        sandbox_id=sandbox.id,
        context=context,
        engine=engine,
        policy_id=policy.id,
        contract=load_business_contract(),
        limits=settings.business_limits.model_dump(),
        scenario_run_id=run.id,
        tool_note=scenario.tool_note_injection,
        commit_each_event=True,
    )

    agent_result: AgentResult | None = None
    weave_meta = {"call_id": "", "url": "", "status": "not_traced"}
    weave_status = tracer.status()
    try:
        with tracer.attributes(
            scopeforge_run_id=run.id,
            scenario_id=scenario.id,
            scenario_key=scenario.key,
            scenario_kind=scenario.kind,
            scenario_category=scenario.category,
            policy_id=policy.id,
            policy_version=policy.version,
            policy_hash=policy.canonical_hash,
            experiment_id=experiment_id,
            dataset_id=scenario.dataset_id,
            suite_id=scenario.suite_id,
            split=scenario.split,
            model=settings.llm_model,
        ):
            agent_result, call = run_support_agent.call(
                gateway=gateway,
                merchant_name=merchant.name if merchant else "the store",
                customer_name=customer.name if customer else "the customer",
                user_message=scenario.user_message,
                model=settings.llm_model,
                temperature=settings.llm_temperature,
                max_steps=settings.budget.max_agent_steps_per_scenario,
                extra_context=scenario.injected_ticket_body,
                should_stop=should_stop,
            )
        weave_meta = tracer.call_metadata(call)
    except Exception as exc:  # execution problem outside the model call itself
        run.error = f"{type(exc).__name__}: {exc}"

    if agent_result is not None and agent_result.stopped_reason == "cancelled":
        run.cancelled = True
        run.error = "cancelled by the operator before this scenario finished"

    if agent_result is not None:
        run.messages_json = agent_result.messages
        run.final_response = agent_result.final_response
        run.token_usage_json = agent_result.usage
        run.model = agent_result.model or run.model
        if agent_result.error:
            run.error = agent_result.error
        run.model_settings_json = {**run.model_settings_json, "stopped_reason": agent_result.stopped_reason}

    run.weave_call_id = weave_meta["call_id"]
    run.weave_call_url = weave_meta["url"]
    if weave_meta["status"] == "traced":
        run.trace_status = "traced"
    elif weave_status.error:
        run.trace_status = f"trace_failed: {weave_status.error[:120]}"
    else:
        run.trace_status = "not_traced"

    run.status = "failed" if run.error else "completed"
    run.duration_ms = int((time.perf_counter() - started) * 1000)
    run.finished_at = utcnow()
    session.flush()
    return _finalise(session, run, scenario, agent_result, order_ids, sandbox.id)


def _finalise(
    session: Session,
    run: ScenarioRun,
    scenario: Scenario,
    agent_result: AgentResult | None,
    order_ids: list[str],
    sandbox_id: str,
) -> RunOutcome:
    run.final_state_json = sandbox_state_summary(session, sandbox_id, order_ids)
    events = list(
        session.execute(
            select(ToolEvent).where(ToolEvent.scenario_run_id == run.id).order_by(ToolEvent.step_index)
        ).scalars()
    )
    scores = score_run(run, events, scenario.expectations_json or {})
    for score in scores:
        session.add(
            ScoreRecord(
                scenario_run_id=run.id,
                experiment_id=run.experiment_id,
                scorer=score.scorer,
                passed=score.passed,
                value=score.value,
                applicable=score.applicable,
                evidence_json=score.evidence,
            )
        )
    run.scores_json = {
        s.scorer: {"passed": s.passed, "value": s.value, "applicable": s.applicable} for s in scores
    }
    run.contract_violations_json = sorted(
        {v for e in events if e.executed for v in e.contract_violations_json}
    )
    session.flush()
    return RunOutcome(run=run, agent=agent_result, scores=scores)
