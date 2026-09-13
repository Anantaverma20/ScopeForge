"""ORM -> API serialisation. Every field comes from persisted rows."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import schemas
from app.models.orm import (
    Customer,
    Dataset,
    Experiment,
    Job,
    JobEvent,
    Merchant,
    Order,
    PermissionProbe,
    PlaygroundMessage,
    PlaygroundSession,
    Policy,
    Scenario,
    ScenarioRun,
    ScoreRecord,
    Suite,
    Ticket,
    ToolEvent,
)
from app.policies.schema import validate_document

RESTRICTED_CUSTOMER_FIELDS = [
    "ssn_last4", "internal_risk_score", "lifetime_value_minor", "marketing_segment", "internal_notes",
]


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def dataset_summary(dataset: Dataset) -> schemas.DatasetSummary:
    return schemas.DatasetSummary(
        id=dataset.id,
        version=dataset.version,
        name=dataset.name,
        seed=dataset.seed,
        clock_iso=dataset.clock_iso,
        counts=dataset.counts_json or {},
        created_at=iso(dataset.created_at) or "",
        generator_version=dataset.generator_version,
    )


def customer_rows(session: Session, dataset_id: str, limit: int, offset: int) -> list[schemas.CustomerRow]:
    merchants = {m.id: m.name for m in session.execute(select(Merchant).where(Merchant.dataset_id == dataset_id)).scalars()}
    rows = list(
        session.execute(
            select(Customer).where(Customer.dataset_id == dataset_id).order_by(Customer.id).limit(limit).offset(offset)
        ).scalars()
    )
    counts = dict(
        session.execute(
            select(Order.customer_id, func.count(Order.id))
            .where(Order.dataset_id == dataset_id)
            .group_by(Order.customer_id)
        ).all()
    )
    return [
        schemas.CustomerRow(
            customer_id=c.id,
            merchant_id=c.merchant_id,
            merchant_name=merchants.get(c.merchant_id, ""),
            name=c.name,
            email=c.email,
            city=c.city,
            country=c.country,
            loyalty_tier=c.loyalty_tier,
            order_count=int(counts.get(c.id, 0)),
            restricted_fields_present=RESTRICTED_CUSTOMER_FIELDS,
        )
        for c in rows
    ]


def order_rows(session: Session, dataset_id: str, limit: int, offset: int, customer_id: str | None) -> list[schemas.OrderRow]:
    query = select(Order).where(Order.dataset_id == dataset_id)
    if customer_id:
        query = query.where(Order.customer_id == customer_id)
    rows = list(session.execute(query.order_by(Order.placed_at_iso.desc()).limit(limit).offset(offset)).scalars())
    names = {
        c.id: c.name
        for c in session.execute(select(Customer).where(Customer.dataset_id == dataset_id)).scalars()
    }
    return [
        schemas.OrderRow(
            order_id=o.id,
            customer_id=o.customer_id,
            customer_name=names.get(o.customer_id, ""),
            merchant_id=o.merchant_id,
            status=o.status,
            placed_at=o.placed_at_iso,
            currency=o.currency,
            total_minor=o.total_minor,
            refunded_minor=o.initial_refunded_minor,
            refund_eligible=o.refund_eligible,
            refund_eligibility_reason=o.refund_eligibility_reason,
            item_count=len(o.items),
        )
        for o in rows
    ]


def ticket_rows(session: Session, dataset_id: str, limit: int, offset: int) -> list[schemas.TicketRow]:
    rows = list(
        session.execute(
            select(Ticket).where(Ticket.dataset_id == dataset_id).order_by(Ticket.created_at_iso.desc()).limit(limit).offset(offset)
        ).scalars()
    )
    return [
        schemas.TicketRow(
            ticket_id=t.id, customer_id=t.customer_id, order_id=t.order_id, subject=t.subject,
            body=t.body, channel=t.channel, created_at=t.created_at_iso,
        )
        for t in rows
    ]


def suite_summary(suite: Suite) -> schemas.SuiteSummary:
    return schemas.SuiteSummary(
        id=suite.id, dataset_id=suite.dataset_id, version=suite.version, name=suite.name,
        counts=suite.counts_json or {}, config=suite.config_json or {}, frozen=suite.frozen,
        contract_version=suite.contract_version, created_at=iso(suite.created_at) or "",
    )


def scenario_summary(session: Session, scenario: Scenario) -> schemas.ScenarioSummary:
    customer = session.get(Customer, scenario.authenticated_customer_id)
    run_count = session.execute(
        select(func.count(ScenarioRun.id)).where(ScenarioRun.scenario_id == scenario.id)
    ).scalar_one()
    return schemas.ScenarioSummary(
        id=scenario.id, suite_id=scenario.suite_id, key=scenario.key, title=scenario.title,
        kind=scenario.kind, category=scenario.category, split=scenario.split,
        tenant_id=scenario.tenant_id, authenticated_customer_id=scenario.authenticated_customer_id,
        customer_name=customer.name if customer else "",
        target_order_id=scenario.target_order_id, generated_by=scenario.generated_by,
        source_model=scenario.source_model,
        has_ticket_injection=bool(scenario.injected_ticket_body),
        has_tool_note_injection=bool(scenario.tool_note_injection),
        run_count=int(run_count),
    )


def scenario_detail(session: Session, scenario: Scenario) -> schemas.ScenarioDetail:
    base = scenario_summary(session, scenario)
    return schemas.ScenarioDetail(
        **base.model_dump(),
        user_message=scenario.user_message,
        injected_ticket_body=scenario.injected_ticket_body,
        tool_note_injection=scenario.tool_note_injection,
        target_foreign_customer_id=scenario.target_foreign_customer_id,
        expectations=scenario.expectations_json or {},
    )


def policy_summary(policy: Policy) -> schemas.PolicySummary:
    return schemas.PolicySummary(
        id=policy.id, family_id=policy.family_id, version=policy.version, parent_id=policy.parent_id,
        name=policy.name, kind=policy.kind, canonical_hash=policy.canonical_hash,
        validation_status=policy.validation_status, validation_errors=policy.validation_errors_json or [],
        decision=policy.decision, decision_reason=policy.decision_reason,
        activation_eligible=policy.activation_eligible, is_active_playground=policy.is_active_playground,
        created_by=policy.created_by, source_model=policy.source_model,
        created_at=iso(policy.created_at) or "",
        rule_count=len((policy.document_json or {}).get("rules", []) or []),
    )


def policy_detail(policy: Policy) -> schemas.PolicyDetail:
    result = validate_document(policy.document_json)
    human = result.document.human_readable() if result.document else []
    return schemas.PolicyDetail(
        **policy_summary(policy).model_dump(),
        document=policy.document_json,
        human_readable=human,
        rationale=policy.rationale,
        evidence=policy.evidence_json or {},
        expected_effects=policy.expected_effects_json or {},
        tradeoffs=policy.tradeoffs,
        decision_metrics=policy.decision_metrics_json or {},
        contract_version=policy.contract_version,
        experiment_id=policy.experiment_id,
    )


def experiment_summary(session: Session, experiment: Experiment) -> schemas.ExperimentSummary:
    policy = session.get(Policy, experiment.policy_id)
    run_count = session.execute(
        select(func.count(ScenarioRun.id)).where(ScenarioRun.experiment_id == experiment.id)
    ).scalar_one()
    return schemas.ExperimentSummary(
        id=experiment.id, name=experiment.name, kind=experiment.kind, status=experiment.status,
        suite_id=experiment.suite_id, dataset_id=experiment.dataset_id, policy_id=experiment.policy_id,
        policy_version=policy.version if policy else None, policy_name=policy.name if policy else "",
        splits=experiment.splits_json or [], iteration=experiment.iteration, job_id=experiment.job_id,
        created_at=iso(experiment.created_at) or "", finished_at=iso(experiment.finished_at),
        run_count=int(run_count), metrics=experiment.metrics_json or {},
    )


def tool_event_out(event: ToolEvent) -> schemas.ToolEventOut:
    return schemas.ToolEventOut(
        id=event.id, step_index=event.step_index, tool_name=event.tool_name,
        requested_args=event.requested_args_json or {}, decision=event.decision,
        reason_code=event.reason_code, reason_detail=event.reason_detail,
        matched_rule_id=event.matched_rule_id, executed=event.executed,
        result=event.result_json or {}, removed_fields=event.removed_fields_json or [],
        returned_record_ids=event.returned_record_ids_json or [],
        state_change=event.state_change_json or {},
        contract_violations=event.contract_violations_json or [], error=event.error,
        duration_ms=event.duration_ms,
    )


def run_summary(session: Session, run: ScenarioRun, scenario: Scenario | None = None) -> schemas.RunSummary:
    scenario = scenario or (session.get(Scenario, run.scenario_id) if run.scenario_id != "playground" else None)
    events = list(
        session.execute(select(ToolEvent).where(ToolEvent.scenario_run_id == run.id)).scalars()
    )
    return schemas.RunSummary(
        id=run.id, experiment_id=run.experiment_id, scenario_id=run.scenario_id,
        scenario_key=scenario.key if scenario else "playground",
        scenario_title=scenario.title if scenario else "Playground request",
        scenario_kind=scenario.kind if scenario else "playground",
        scenario_category=scenario.category if scenario else "playground",
        split=run.split, status=run.status, model=run.model, duration_ms=run.duration_ms,
        error=run.error, cancelled=run.cancelled, trace_status=run.trace_status,
        weave_call_url=run.weave_call_url, scores=run.scores_json or {},
        tool_event_count=len(events),
        denied_count=len([e for e in events if e.decision == "deny"]),
        contract_violations=run.contract_violations_json or [],
    )


def run_detail(session: Session, run: ScenarioRun) -> schemas.RunDetail:
    scenario = session.get(Scenario, run.scenario_id) if run.scenario_id != "playground" else None
    events = list(
        session.execute(
            select(ToolEvent).where(ToolEvent.scenario_run_id == run.id).order_by(ToolEvent.step_index)
        ).scalars()
    )
    scores = list(
        session.execute(select(ScoreRecord).where(ScoreRecord.scenario_run_id == run.id)).scalars()
    )
    policy = session.get(Policy, run.policy_id)
    user_message = scenario.user_message if scenario else ""
    if not user_message:
        for message in run.messages_json or []:
            if message.get("role") == "user":
                user_message = message.get("content") or ""
    return schemas.RunDetail(
        **run_summary(session, run, scenario).model_dump(),
        trusted_context=run.trusted_context_json or {},
        user_message=user_message,
        injected_ticket_body=scenario.injected_ticket_body if scenario else None,
        tool_note_injection=scenario.tool_note_injection if scenario else None,
        final_response=run.final_response,
        messages=run.messages_json or [],
        initial_state=run.initial_state_json or {},
        final_state=run.final_state_json or {},
        token_usage=run.token_usage_json or {},
        model_settings=run.model_settings_json or {},
        expectations=(scenario.expectations_json if scenario else {}) or {},
        events=[tool_event_out(e) for e in events],
        score_evidence=[
            {"scorer": s.scorer, "passed": s.passed, "value": s.value, "applicable": s.applicable,
             "evidence": s.evidence_json}
            for s in scores
        ],
        policy_id=run.policy_id,
        policy_version=policy.version if policy else None,
        sandbox_id=run.sandbox_id,
    )


def probe_out(probe: PermissionProbe) -> schemas.ProbeOut:
    return schemas.ProbeOut(
        id=probe.id, probe_key=probe.probe_key, tool_name=probe.tool_name, category=probe.category,
        decision=probe.decision, reason_code=probe.reason_code, contract_permits=probe.contract_permits,
        args=probe.args_json or {}, context=probe.context_json or {},
    )


def experiment_detail(session: Session, experiment: Experiment) -> schemas.ExperimentDetail:
    runs = list(
        session.execute(
            select(ScenarioRun).where(ScenarioRun.experiment_id == experiment.id).order_by(ScenarioRun.started_at)
        ).scalars()
    )
    probes = list(
        session.execute(
            select(PermissionProbe).where(PermissionProbe.experiment_id == experiment.id)
        ).scalars()
    )
    return schemas.ExperimentDetail(
        **experiment_summary(session, experiment).model_dump(),
        config=experiment.config_json or {},
        integration_status=experiment.integration_status_json or {},
        weave_project=experiment.weave_project,
        error=experiment.error,
        runs=[run_summary(session, r) for r in runs],
        probes=[probe_out(p) for p in probes],
    )


def job_out(job: Job) -> schemas.JobOut:
    return schemas.JobOut(
        id=job.id, kind=job.kind, status=job.status, progress_done=job.progress_done,
        progress_total=job.progress_total, current_step=job.current_step,
        cancel_requested=job.cancel_requested, experiment_id=job.experiment_id, error=job.error,
        result=job.result_json or {}, params=job.params_json or {},
        created_at=iso(job.created_at) or "", started_at=iso(job.started_at), finished_at=iso(job.finished_at),
    )


def job_detail(session: Session, job: Job) -> schemas.JobDetail:
    events = list(
        session.execute(select(JobEvent).where(JobEvent.job_id == job.id).order_by(JobEvent.seq)).scalars()
    )
    return schemas.JobDetail(
        **job_out(job).model_dump(),
        events=[
            schemas.JobEventOut(
                seq=e.seq, level=e.level, message=e.message, data=e.data_json or {},
                created_at=iso(e.created_at) or "",
            )
            for e in events
        ],
    )


def playground_session_out(session: Session, pg: PlaygroundSession) -> schemas.PlaygroundSessionOut:
    policy = session.get(Policy, pg.policy_id)
    customer = session.get(Customer, pg.authenticated_customer_id)
    merchant = session.get(Merchant, pg.tenant_id)
    return schemas.PlaygroundSessionOut(
        id=pg.id, dataset_id=pg.dataset_id, sandbox_id=pg.sandbox_id, policy_id=pg.policy_id,
        policy_name=policy.name if policy else "", policy_version=policy.version if policy else 0,
        tenant_id=pg.tenant_id, merchant_name=merchant.name if merchant else "",
        authenticated_customer_id=pg.authenticated_customer_id,
        customer_name=customer.name if customer else "", created_at=iso(pg.created_at) or "",
    )


def playground_message_out(message: PlaygroundMessage) -> schemas.PlaygroundMessageOut:
    return schemas.PlaygroundMessageOut(
        id=message.id, role=message.role, content=message.content,
        created_at=iso(message.created_at) or "", run_id=message.scenario_run_id, error=message.error,
    )
