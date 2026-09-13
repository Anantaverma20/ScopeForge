"""Typed API contracts. The frontend types in `frontend/src/types/api.ts` mirror these."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
# health / integrations
# --------------------------------------------------------------------------- #
class IntegrationState(BaseModel):
    name: str
    configured: bool
    ok: bool | None = None  # None = never checked in this process
    detail: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    checked_at: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    database: str
    worker_running: bool
    integrations: list[IntegrationState]


# --------------------------------------------------------------------------- #
# datasets
# --------------------------------------------------------------------------- #
class DatasetSummary(BaseModel):
    id: str
    version: int
    name: str
    seed: int
    clock_iso: str
    counts: dict[str, int]
    created_at: str
    generator_version: str
    synthetic: Literal[True] = True


class GenerateDatasetRequest(BaseModel):
    merchants: int = Field(ge=1, le=20)
    customers_per_merchant: int = Field(ge=1, le=200)
    orders_per_customer_max: int = Field(ge=1, le=20)
    products_per_merchant: int = Field(ge=1, le=100)
    tickets_per_merchant: int = Field(ge=0, le=200)
    seed: int
    name: str | None = None


class CustomerRow(BaseModel):
    customer_id: str
    merchant_id: str
    merchant_name: str
    name: str
    email: str
    city: str
    country: str
    loyalty_tier: str
    order_count: int
    restricted_fields_present: list[str]


class OrderRow(BaseModel):
    order_id: str
    customer_id: str
    customer_name: str
    merchant_id: str
    status: str
    placed_at: str
    currency: str
    total_minor: int
    refunded_minor: int
    refund_eligible: bool
    refund_eligibility_reason: str
    item_count: int


class TicketRow(BaseModel):
    ticket_id: str
    customer_id: str
    order_id: str | None
    subject: str
    body: str
    channel: str
    created_at: str


# --------------------------------------------------------------------------- #
# suites and scenarios
# --------------------------------------------------------------------------- #
class SuiteSummary(BaseModel):
    id: str
    dataset_id: str
    version: int
    name: str
    counts: dict[str, Any]
    config: dict[str, Any]
    frozen: bool
    contract_version: str
    created_at: str


class ScenarioSummary(BaseModel):
    id: str
    suite_id: str
    key: str
    title: str
    kind: str
    category: str
    split: str
    tenant_id: str
    authenticated_customer_id: str
    customer_name: str
    target_order_id: str | None
    generated_by: str
    source_model: str
    has_ticket_injection: bool
    has_tool_note_injection: bool
    run_count: int


class ScenarioDetail(ScenarioSummary):
    user_message: str
    injected_ticket_body: str | None
    tool_note_injection: str | None
    target_foreign_customer_id: str | None
    expectations: dict[str, Any]
    expectations_note: str = (
        "Expected outcomes are admin-only. They are never included in the prompt sent to the support agent."
    )


# --------------------------------------------------------------------------- #
# policies
# --------------------------------------------------------------------------- #
class PolicySummary(BaseModel):
    id: str
    family_id: str
    version: int
    parent_id: str | None
    name: str
    kind: str
    canonical_hash: str
    validation_status: str
    validation_errors: list[str]
    decision: str | None
    decision_reason: str
    activation_eligible: bool
    is_active_playground: bool
    created_by: str
    source_model: str
    created_at: str
    rule_count: int


class PolicyDetail(PolicySummary):
    document: dict[str, Any]
    human_readable: list[dict[str, str]]
    rationale: str
    evidence: dict[str, Any]
    expected_effects: dict[str, Any]
    tradeoffs: str
    decision_metrics: dict[str, Any]
    contract_version: str
    experiment_id: str | None


class PolicyDiffResponse(BaseModel):
    policy_id: str
    parent_id: str | None
    diff: dict[str, Any]


class ActivatePolicyRequest(BaseModel):
    override_reason: str = ""


# --------------------------------------------------------------------------- #
# experiments and runs
# --------------------------------------------------------------------------- #
class ExperimentSummary(BaseModel):
    id: str
    name: str
    kind: str
    status: str
    suite_id: str
    dataset_id: str
    policy_id: str
    policy_version: int | None
    policy_name: str
    splits: list[str]
    iteration: int
    job_id: str | None
    created_at: str
    finished_at: str | None
    run_count: int
    metrics: dict[str, Any]


class ToolEventOut(BaseModel):
    id: str
    step_index: int
    tool_name: str
    requested_args: dict[str, Any]
    decision: str
    reason_code: str
    reason_detail: str
    matched_rule_id: str
    executed: bool
    result: dict[str, Any]
    removed_fields: list[str]
    returned_record_ids: list[str]
    state_change: dict[str, Any]
    contract_violations: list[str]
    error: str
    duration_ms: int


class RunSummary(BaseModel):
    id: str
    experiment_id: str
    scenario_id: str
    scenario_key: str
    scenario_title: str
    scenario_kind: str
    scenario_category: str
    split: str
    status: str
    model: str
    duration_ms: int
    error: str
    cancelled: bool
    trace_status: str
    weave_call_url: str
    scores: dict[str, Any]
    tool_event_count: int
    denied_count: int
    contract_violations: list[str]


class RunDetail(RunSummary):
    trusted_context: dict[str, Any]
    user_message: str
    injected_ticket_body: str | None
    tool_note_injection: str | None
    final_response: str
    messages: list[dict[str, Any]]
    initial_state: dict[str, Any]
    final_state: dict[str, Any]
    token_usage: dict[str, int]
    model_settings: dict[str, Any]
    expectations: dict[str, Any]
    events: list[ToolEventOut]
    score_evidence: list[dict[str, Any]]
    policy_id: str
    policy_version: int | None
    sandbox_id: str


class ProbeOut(BaseModel):
    id: str
    probe_key: str
    tool_name: str
    category: str
    decision: str
    reason_code: str
    contract_permits: bool
    args: dict[str, Any]
    context: dict[str, Any]


class ExperimentDetail(ExperimentSummary):
    config: dict[str, Any]
    integration_status: dict[str, Any]
    weave_project: str
    error: str
    runs: list[RunSummary]
    probes: list[ProbeOut]
    probe_note: str = (
        "Permission probes are scripted gateway checks, not attacks discovered by an agent."
    )


# --------------------------------------------------------------------------- #
# jobs
# --------------------------------------------------------------------------- #
class JobEventOut(BaseModel):
    seq: int
    level: str
    message: str
    data: dict[str, Any]
    created_at: str


class JobOut(BaseModel):
    id: str
    kind: str
    status: str
    progress_done: int
    progress_total: int
    current_step: str
    cancel_requested: bool
    experiment_id: str | None
    error: str
    result: dict[str, Any]
    params: dict[str, Any]
    created_at: str
    started_at: str | None
    finished_at: str | None


class JobDetail(JobOut):
    events: list[JobEventOut]


class StartBaselineRequest(BaseModel):
    suite_id: str
    policy_id: str | None = None
    splits: list[str] = Field(default_factory=lambda: ["dev", "validation"])
    name: str | None = None


class StartImprovementRequest(BaseModel):
    suite_id: str
    policy_id: str | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=10)
    use_mcp: bool = True


class StartAdversaryRequest(BaseModel):
    suite_id: str
    count: int | None = Field(default=None, ge=1, le=40)


class EvaluatePolicyRequest(BaseModel):
    suite_id: str
    splits: list[str] = Field(default_factory=lambda: ["validation"])


# --------------------------------------------------------------------------- #
# playground
# --------------------------------------------------------------------------- #
class PlaygroundSessionOut(BaseModel):
    id: str
    dataset_id: str
    sandbox_id: str
    policy_id: str
    policy_name: str
    policy_version: int
    tenant_id: str
    merchant_name: str
    authenticated_customer_id: str
    customer_name: str
    created_at: str
    protection_note: str = (
        "Enforcement here covers the implemented tools and the conditions that were tested. "
        "It is not a general security guarantee."
    )


class CreatePlaygroundSessionRequest(BaseModel):
    customer_id: str
    policy_id: str | None = None


class PlaygroundMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class PlaygroundMessageOut(BaseModel):
    id: str
    role: str
    content: str
    created_at: str
    run_id: str | None
    error: str


class PlaygroundTurnResponse(BaseModel):
    session_id: str
    messages: list[PlaygroundMessageOut]
    run: RunDetail | None


class PlaygroundExample(BaseModel):
    label: str
    kind: str
    message: str
    source: str


# --------------------------------------------------------------------------- #
# settings / workspace
# --------------------------------------------------------------------------- #
class EnvironmentView(BaseModel):
    """Non-secret view of environment configuration. Keys are never returned."""

    llm_base_url: str
    llm_model: str
    wandb_entity: str
    wandb_project: str
    wandb_mcp_url: str
    weave_project: str
    backend_port: int
    credentials_present: dict[str, bool]
    cost_rate_configured: bool


class SettingsResponse(BaseModel):
    runtime: dict[str, Any]
    environment: EnvironmentView
    business_contract: dict[str, Any]


class WorkspaceStep(BaseModel):
    key: str
    label: str
    done: bool
    detail: str
    blocked_reason: str = ""


class WorkspaceState(BaseModel):
    steps: list[WorkspaceStep]
    dataset: DatasetSummary | None
    suite: SuiteSummary | None
    baseline_policy: PolicySummary | None
    active_policy: PolicySummary | None
    latest_experiment: ExperimentSummary | None
    latest_candidate: PolicySummary | None
    active_jobs: list[JobOut]
    integrations: list[IntegrationState]
