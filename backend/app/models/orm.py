"""SQLAlchemy ORM models.

Naming convention: business records produced by the data generator live in the
dataset family and are immutable reference data. Mutable per-scenario state
lives in the sandbox family (one sandbox per scenario run) so that one refund
test can never change the starting conditions of another scenario.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db import new_id, utcnow


class Base(DeclarativeBase):
    pass


def _pk(prefix: str):
    return mapped_column(String(40), primary_key=True, default=lambda: new_id(prefix))


def _ts():
    return mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- #
# settings
# --------------------------------------------------------------------------- #
class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = _ts()


# --------------------------------------------------------------------------- #
# synthetic business dataset (immutable reference data)
# --------------------------------------------------------------------------- #
class Dataset(Base):
    __tablename__ = "datasets"
    id: Mapped[str] = _pk("ds")
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(120))
    seed: Mapped[int] = mapped_column(Integer)
    clock_iso: Mapped[str] = mapped_column(String(40))
    config_json: Mapped[dict] = mapped_column(JSON)
    counts_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = _ts()
    generator_version: Mapped[str] = mapped_column(String(20), default="1")


class Merchant(Base):
    __tablename__ = "merchants"
    id: Mapped[str] = _pk("mer")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    country: Mapped[str] = mapped_column(String(4))


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[str] = _pk("cus")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(180))
    phone: Mapped[str] = mapped_column(String(40))
    city: Mapped[str] = mapped_column(String(80))
    country: Mapped[str] = mapped_column(String(4))
    loyalty_tier: Mapped[str] = mapped_column(String(20))
    created_at_iso: Mapped[str] = mapped_column(String(40))
    # restricted fields: present in the database, must never reach the agent
    ssn_last4: Mapped[str] = mapped_column(String(4))
    internal_risk_score: Mapped[int] = mapped_column(Integer)
    lifetime_value_minor: Mapped[int] = mapped_column(Integer)
    marketing_segment: Mapped[str] = mapped_column(String(40))
    internal_notes: Mapped[str] = mapped_column(Text)


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = _pk("prd")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    price_minor: Mapped[int] = mapped_column(Integer)
    merchant_cost_minor: Mapped[int] = mapped_column(Integer)
    category: Mapped[str] = mapped_column(String(60))


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = _pk("ord")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    placed_at_iso: Mapped[str] = mapped_column(String(40))
    delivered_at_iso: Mapped[str | None] = mapped_column(String(40), nullable=True)
    currency: Mapped[str] = mapped_column(String(4))
    total_minor: Mapped[int] = mapped_column(Integer)
    initial_refunded_minor: Mapped[int] = mapped_column(Integer, default=0)
    refund_eligible: Mapped[bool] = mapped_column(Boolean, default=True)
    refund_eligibility_reason: Mapped[str] = mapped_column(String(120), default="")
    # restricted fields
    merchant_cost_minor: Mapped[int] = mapped_column(Integer, default=0)
    margin_minor: Mapped[int] = mapped_column(Integer, default=0)
    fraud_score: Mapped[int] = mapped_column(Integer, default=0)
    internal_flags: Mapped[dict] = mapped_column(JSON, default=dict)

    items: Mapped[list["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[str] = _pk("oit")
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price_minor: Mapped[int] = mapped_column(Integer)

    order: Mapped[Order] = relationship(back_populates="items")


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[str] = _pk("tkt")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("merchants.id", ondelete="CASCADE"))
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    channel: Mapped[str] = mapped_column(String(20))
    created_at_iso: Mapped[str] = mapped_column(String(40))
    is_untrusted_surface: Mapped[bool] = mapped_column(Boolean, default=True)


# --------------------------------------------------------------------------- #
# sandbox: per-run mutable business state
# --------------------------------------------------------------------------- #
class Sandbox(Base):
    __tablename__ = "sandboxes"
    id: Mapped[str] = _pk("sbx")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = _ts()
    snapshot_hash: Mapped[str] = mapped_column(String(64), default="")


class SandboxOrderState(Base):
    __tablename__ = "sandbox_order_states"
    sandbox_id: Mapped[str] = mapped_column(ForeignKey("sandboxes.id", ondelete="CASCADE"), primary_key=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(20))
    refunded_minor: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=0)


class SandboxRefund(Base):
    __tablename__ = "sandbox_refunds"
    __table_args__ = (
        UniqueConstraint("sandbox_id", "session_id", "idempotency_key", name="uq_refund_idem"),
    )
    id: Mapped[str] = _pk("ref")
    sandbox_id: Mapped[str] = mapped_column(ForeignKey("sandboxes.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(String(60))
    idempotency_key: Mapped[str] = mapped_column(String(120))
    order_id: Mapped[str] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    customer_id: Mapped[str] = mapped_column(String(40))
    merchant_id: Mapped[str] = mapped_column(String(40))
    amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(4))
    reason: Mapped[str] = mapped_column(String(400))
    status: Mapped[str] = mapped_column(String(20), default="succeeded")
    created_at: Mapped[datetime] = _ts()


class SandboxLedgerEntry(Base):
    __tablename__ = "sandbox_ledger"
    id: Mapped[str] = _pk("led")
    sandbox_id: Mapped[str] = mapped_column(ForeignKey("sandboxes.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[str] = mapped_column(String(40))
    entry_type: Mapped[str] = mapped_column(String(30))
    amount_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(4))
    ref_id: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = _ts()


class SandboxArtifact(Base):
    """Local-only artifact produced by a tool (for example export_customers)."""

    __tablename__ = "sandbox_artifacts"
    id: Mapped[str] = _pk("art")
    sandbox_id: Mapped[str] = mapped_column(ForeignKey("sandboxes.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = _ts()


# --------------------------------------------------------------------------- #
# policies
# --------------------------------------------------------------------------- #
class Policy(Base):
    __tablename__ = "policies"
    __table_args__ = (UniqueConstraint("family_id", "version", name="uq_policy_family_version"),)
    id: Mapped[str] = _pk("pol")
    family_id: Mapped[str] = mapped_column(String(40), index=True)
    version: Mapped[int] = mapped_column(Integer)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("policies.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(140))
    kind: Mapped[str] = mapped_column(String(30))
    document_json: Mapped[dict] = mapped_column(JSON)
    canonical_hash: Mapped[str] = mapped_column(String(64), index=True)
    # order-insensitive hash: two policies that decide identically share it
    semantic_hash: Mapped[str] = mapped_column(String(64), index=True, default="")
    validation_status: Mapped[str] = mapped_column(String(20))
    validation_errors_json: Mapped[list] = mapped_column(JSON, default=list)
    rationale: Mapped[str] = mapped_column(Text, default="")
    evidence_json: Mapped[dict] = mapped_column(JSON, default=dict)
    expected_effects_json: Mapped[dict] = mapped_column(JSON, default=dict)
    tradeoffs: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()
    created_by: Mapped[str] = mapped_column(String(30), default="system")
    source_model: Mapped[str] = mapped_column(String(80), default="")
    activation_eligible: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active_playground: Mapped[bool] = mapped_column(Boolean, default=False)
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    decision_reason: Mapped[str] = mapped_column(Text, default="")
    decision_metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    contract_version: Mapped[str] = mapped_column(String(10), default="v1")
    experiment_id: Mapped[str | None] = mapped_column(String(40), nullable=True)


# --------------------------------------------------------------------------- #
# scenarios
# --------------------------------------------------------------------------- #
class Suite(Base):
    __tablename__ = "suites"
    id: Mapped[str] = _pk("ste")
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(140))
    config_json: Mapped[dict] = mapped_column(JSON)
    counts_json: Mapped[dict] = mapped_column(JSON, default=dict)
    frozen: Mapped[bool] = mapped_column(Boolean, default=True)
    contract_version: Mapped[str] = mapped_column(String(10), default="v1")
    created_at: Mapped[datetime] = _ts()


class Scenario(Base):
    __tablename__ = "scenarios"
    id: Mapped[str] = _pk("scn")
    suite_id: Mapped[str] = mapped_column(ForeignKey("suites.id", ondelete="CASCADE"), index=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(60))
    split: Mapped[str] = mapped_column(String(12))
    # trusted identity, established server-side
    tenant_id: Mapped[str] = mapped_column(String(40))
    authenticated_customer_id: Mapped[str] = mapped_column(String(40))
    # inputs
    user_message: Mapped[str] = mapped_column(Text)
    injected_ticket_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    injected_ticket_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_note_injection: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_order_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    target_foreign_customer_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # admin-only, never sent to the support agent
    expectations_json: Mapped[dict] = mapped_column(JSON, default=dict)
    generated_by: Mapped[str] = mapped_column(String(30), default="template")
    source_model: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = _ts()


# --------------------------------------------------------------------------- #
# experiments and runs
# --------------------------------------------------------------------------- #
class Experiment(Base):
    __tablename__ = "experiments"
    id: Mapped[str] = _pk("exp")
    name: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(30))
    suite_id: Mapped[str] = mapped_column(String(40), index=True)
    dataset_id: Mapped[str] = mapped_column(String(40))
    policy_id: Mapped[str] = mapped_column(String(40), index=True)
    splits_json: Mapped[list] = mapped_column(JSON, default=list)
    job_id: Mapped[str | None] = mapped_column(String(40), index=True, nullable=True)
    parent_experiment_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    iteration: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    integration_status_json: Mapped[dict] = mapped_column(JSON, default=dict)
    weave_project: Mapped[str] = mapped_column(String(120), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ScenarioRun(Base):
    __tablename__ = "scenario_runs"
    id: Mapped[str] = _pk("run")
    experiment_id: Mapped[str] = mapped_column(ForeignKey("experiments.id", ondelete="CASCADE"), index=True)
    scenario_id: Mapped[str] = mapped_column(String(40), index=True)
    policy_id: Mapped[str] = mapped_column(String(40), index=True)
    sandbox_id: Mapped[str] = mapped_column(String(40))
    dataset_id: Mapped[str] = mapped_column(String(40))
    suite_id: Mapped[str] = mapped_column(String(40))
    split: Mapped[str] = mapped_column(String(12), default="")
    status: Mapped[str] = mapped_column(String(20), default="pending")
    model: Mapped[str] = mapped_column(String(80), default="")
    model_settings_json: Mapped[dict] = mapped_column(JSON, default=dict)
    trusted_context_json: Mapped[dict] = mapped_column(JSON, default=dict)
    initial_state_json: Mapped[dict] = mapped_column(JSON, default=dict)
    final_state_json: Mapped[dict] = mapped_column(JSON, default=dict)
    messages_json: Mapped[list] = mapped_column(JSON, default=list)
    final_response: Mapped[str] = mapped_column(Text, default="")
    token_usage_json: Mapped[dict] = mapped_column(JSON, default=dict)
    scores_json: Mapped[dict] = mapped_column(JSON, default=dict)
    contract_violations_json: Mapped[list] = mapped_column(JSON, default=list)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    weave_call_id: Mapped[str] = mapped_column(String(80), default="")
    weave_call_url: Mapped[str] = mapped_column(String(400), default="")
    trace_status: Mapped[str] = mapped_column(String(30), default="not_traced")
    started_at: Mapped[datetime] = _ts()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ToolEvent(Base):
    __tablename__ = "tool_events"
    id: Mapped[str] = _pk("evt")
    scenario_run_id: Mapped[str] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), index=True)
    step_index: Mapped[int] = mapped_column(Integer)
    tool_name: Mapped[str] = mapped_column(String(60))
    requested_args_json: Mapped[dict] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String(10))
    reason_code: Mapped[str] = mapped_column(String(60))
    reason_detail: Mapped[str] = mapped_column(Text, default="")
    matched_rule_id: Mapped[str] = mapped_column(String(60), default="")
    policy_id: Mapped[str] = mapped_column(String(40))
    executed: Mapped[bool] = mapped_column(Boolean, default=False)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    removed_fields_json: Mapped[list] = mapped_column(JSON, default=list)
    returned_record_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    state_change_json: Mapped[dict] = mapped_column(JSON, default=dict)
    contract_violations_json: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str] = mapped_column(Text, default="")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _ts()


class ScoreRecord(Base):
    __tablename__ = "score_records"
    id: Mapped[str] = _pk("sco")
    scenario_run_id: Mapped[str] = mapped_column(ForeignKey("scenario_runs.id", ondelete="CASCADE"), index=True)
    experiment_id: Mapped[str] = mapped_column(String(40), index=True)
    scorer: Mapped[str] = mapped_column(String(60))
    passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    applicable: Mapped[bool] = mapped_column(Boolean, default=True)
    evidence_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = _ts()


class PermissionProbe(Base):
    """Deterministic gateway probe. Not an LLM-discovered attack."""

    __tablename__ = "permission_probes"
    id: Mapped[str] = _pk("prb")
    experiment_id: Mapped[str] = mapped_column(String(40), index=True)
    policy_id: Mapped[str] = mapped_column(String(40), index=True)
    probe_key: Mapped[str] = mapped_column(String(120))
    tool_name: Mapped[str] = mapped_column(String(60))
    category: Mapped[str] = mapped_column(String(60))
    context_json: Mapped[dict] = mapped_column(JSON, default=dict)
    args_json: Mapped[dict] = mapped_column(JSON, default=dict)
    decision: Mapped[str] = mapped_column(String(10))
    reason_code: Mapped[str] = mapped_column(String(60))
    contract_permits: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = _ts()


# --------------------------------------------------------------------------- #
# jobs
# --------------------------------------------------------------------------- #
class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = _pk("job")
    kind: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    dedupe_key: Mapped[str] = mapped_column(String(200), index=True, default="")
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    progress_done: Mapped[int] = mapped_column(Integer, default=0)
    progress_total: Mapped[int] = mapped_column(Integer, default=0)
    current_step: Mapped[str] = mapped_column(String(200), default="")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    experiment_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    model_calls_used: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _ts()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JobEvent(Base):
    __tablename__ = "job_events"
    id: Mapped[str] = _pk("jev")
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String(10), default="info")
    message: Mapped[str] = mapped_column(Text)
    data_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = _ts()


Index("ix_jobevent_job_seq", JobEvent.job_id, JobEvent.seq)


# --------------------------------------------------------------------------- #
# playground
# --------------------------------------------------------------------------- #
class PlaygroundSession(Base):
    __tablename__ = "playground_sessions"
    id: Mapped[str] = _pk("pgs")
    dataset_id: Mapped[str] = mapped_column(String(40), index=True)
    sandbox_id: Mapped[str] = mapped_column(String(40))
    policy_id: Mapped[str] = mapped_column(String(40))
    tenant_id: Mapped[str] = mapped_column(String(40))
    authenticated_customer_id: Mapped[str] = mapped_column(String(40))
    contract_version: Mapped[str] = mapped_column(String(10), default="v1")
    created_at: Mapped[datetime] = _ts()


class PlaygroundMessage(Base):
    __tablename__ = "playground_messages"
    id: Mapped[str] = _pk("pgm")
    session_id: Mapped[str] = mapped_column(ForeignKey("playground_sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    scenario_run_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = _ts()


class IntegrationCheck(Base):
    __tablename__ = "integration_checks"
    id: Mapped[str] = _pk("chk")
    name: Mapped[str] = mapped_column(String(40), index=True)
    ok: Mapped[bool] = mapped_column(Boolean)
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)
    checked_at: Mapped[datetime] = _ts()
