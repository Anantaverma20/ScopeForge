// Typed API contract. Mirrors backend/app/api/schemas.py.

export type Json = Record<string, unknown>;

export interface IntegrationState {
  name: "llm" | "weave" | "mcp";
  configured: boolean;
  ok: boolean | null;
  detail: string;
  data: Json;
  checked_at: string | null;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  database: string;
  worker_running: boolean;
  integrations: IntegrationState[];
}

export interface DatasetSummary {
  id: string;
  version: number;
  name: string;
  seed: number;
  clock_iso: string;
  counts: Record<string, number>;
  created_at: string;
  generator_version: string;
  synthetic: true;
}

export interface GenerateDatasetRequest {
  merchants: number;
  customers_per_merchant: number;
  orders_per_customer_max: number;
  products_per_merchant: number;
  tickets_per_merchant: number;
  seed: number;
  name?: string | null;
}

export interface CustomerRow {
  customer_id: string;
  merchant_id: string;
  merchant_name: string;
  name: string;
  email: string;
  city: string;
  country: string;
  loyalty_tier: string;
  order_count: number;
  restricted_fields_present: string[];
}

export interface OrderRow {
  order_id: string;
  customer_id: string;
  customer_name: string;
  merchant_id: string;
  status: string;
  placed_at: string;
  currency: string;
  total_minor: number;
  refunded_minor: number;
  refund_eligible: boolean;
  refund_eligibility_reason: string;
  item_count: number;
}

export interface TicketRow {
  ticket_id: string;
  customer_id: string;
  order_id: string | null;
  subject: string;
  body: string;
  channel: string;
  created_at: string;
}

export interface SuiteSummary {
  id: string;
  dataset_id: string;
  version: number;
  name: string;
  counts: { total?: number; by_category?: Record<string, number>; by_split?: Record<string, number>; model_written?: number };
  config: Json;
  frozen: boolean;
  contract_version: string;
  created_at: string;
}

export interface ScenarioSummary {
  id: string;
  suite_id: string;
  key: string;
  title: string;
  kind: string;
  category: string;
  split: string;
  tenant_id: string;
  authenticated_customer_id: string;
  customer_name: string;
  target_order_id: string | null;
  generated_by: string;
  source_model: string;
  has_ticket_injection: boolean;
  has_tool_note_injection: boolean;
  run_count: number;
}

export interface ScenarioDetail extends ScenarioSummary {
  user_message: string;
  injected_ticket_body: string | null;
  tool_note_injection: string | null;
  target_foreign_customer_id: string | null;
  expectations: Json;
  expectations_note: string;
}

export interface PolicySummary {
  id: string;
  family_id: string;
  version: number;
  parent_id: string | null;
  name: string;
  kind: string;
  canonical_hash: string;
  validation_status: string;
  validation_errors: string[];
  decision: string | null;
  decision_reason: string;
  activation_eligible: boolean;
  is_active_playground: boolean;
  created_by: string;
  source_model: string;
  created_at: string;
  rule_count: number;
}

export interface PolicyRuleReadable {
  id: string;
  effect: string;
  tools: string;
  condition: string;
  fields: string;
  description: string;
}

export interface PolicyDetail extends PolicySummary {
  document: Json;
  human_readable: PolicyRuleReadable[];
  rationale: string;
  evidence: Json;
  expected_effects: Json;
  tradeoffs: string;
  decision_metrics: Json;
  contract_version: string;
  experiment_id: string | null;
}

export interface PolicyDiffResponse {
  policy_id: string;
  parent_id: string | null;
  diff: {
    added_rules: Json[];
    removed_rules: Json[];
    changed_rules: { id: string; before: Json; after: Json }[];
    default_effect: { before: string | null; after: string | null };
    unchanged_rule_count: number;
  };
}

export interface RateMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
  excluded_infrastructure_failures?: number;
}

export interface ExperimentMetrics {
  generated_at?: string;
  runs?: {
    total: number;
    legitimate: number;
    adversarial: number;
    infrastructure_failures: number;
    cancelled: number;
    by_split: Record<string, number>;
  };
  legit_completion?: RateMetric;
  unauthorized_success?: RateMetric;
  attack_objective_achieved?: RateMetric;
  attacks_resisted_by_model?: RateMetric;
  blocked_unsafe_attempts?: { events: number; runs: number };
  false_denials?: RateMetric;
  legit_completion_under_attack?: RateMetric;
  field_exposure?: { runs: number; fields: string[] };
  by_category?: Record<
    string,
    { kind: string; runs: number; completed: number; unauthorized: number; blocked: number; failed: number }
  >;
  tool_events?: { total: number; allowed: number; denied: number; executed: number };
  tokens?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  cost?: { available: boolean; usd?: number; reason?: string };
  duration_ms?: { total: number; mean: number | null };
  permission_breadth?: {
    probes: number;
    allowed: number;
    allowed_share: number;
    allowed_but_prohibited_by_contract: number;
    denied_but_permitted_by_contract: number;
    note: string;
  } | null;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  kind: string;
  status: string;
  suite_id: string;
  dataset_id: string;
  policy_id: string;
  policy_version: number | null;
  policy_name: string;
  splits: string[];
  iteration: number;
  job_id: string | null;
  created_at: string;
  finished_at: string | null;
  run_count: number;
  metrics: ExperimentMetrics;
}

export interface ToolEventOut {
  id: string;
  step_index: number;
  tool_name: string;
  requested_args: Json;
  decision: "allow" | "deny";
  reason_code: string;
  reason_detail: string;
  matched_rule_id: string;
  executed: boolean;
  result: Json;
  removed_fields: string[];
  returned_record_ids: string[];
  state_change: Json;
  contract_violations: string[];
  error: string;
  duration_ms: number;
}

export interface ScoreValue {
  passed: boolean | null;
  value: number | null;
  applicable?: boolean;
}

export interface RunSummary {
  id: string;
  experiment_id: string;
  scenario_id: string;
  scenario_key: string;
  scenario_title: string;
  scenario_kind: string;
  scenario_category: string;
  split: string;
  status: string;
  model: string;
  duration_ms: number;
  error: string;
  cancelled: boolean;
  trace_status: string;
  weave_call_url: string;
  scores: Record<string, ScoreValue>;
  tool_event_count: number;
  denied_count: number;
  contract_violations: string[];
}

export interface RunDetail extends RunSummary {
  trusted_context: Json;
  user_message: string;
  injected_ticket_body: string | null;
  tool_note_injection: string | null;
  final_response: string;
  messages: Json[];
  initial_state: Json;
  final_state: Json;
  token_usage: Record<string, number>;
  model_settings: Json;
  expectations: Json;
  events: ToolEventOut[];
  score_evidence: { scorer: string; passed: boolean | null; value: number | null; applicable: boolean; evidence: Json }[];
  policy_id: string;
  policy_version: number | null;
  sandbox_id: string;
}

export interface ProbeOut {
  id: string;
  probe_key: string;
  tool_name: string;
  category: string;
  decision: "allow" | "deny";
  reason_code: string;
  contract_permits: boolean;
  args: Json;
  context: Json;
}

export interface ExperimentDetail extends ExperimentSummary {
  config: Json;
  integration_status: Json;
  weave_project: string;
  error: string;
  runs: RunSummary[];
  probes: ProbeOut[];
  probe_note: string;
}

export interface JobOut {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
  progress_done: number;
  progress_total: number;
  current_step: string;
  cancel_requested: boolean;
  experiment_id: string | null;
  error: string;
  result: Json;
  params: Json;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface JobEventOut {
  seq: number;
  level: string;
  message: string;
  data: Json;
  created_at: string;
}

export interface JobDetail extends JobOut {
  events: JobEventOut[];
}

export interface PlaygroundSessionOut {
  id: string;
  dataset_id: string;
  sandbox_id: string;
  policy_id: string;
  policy_name: string;
  policy_version: number;
  tenant_id: string;
  merchant_name: string;
  authenticated_customer_id: string;
  customer_name: string;
  created_at: string;
  protection_note: string;
}

export interface PlaygroundMessageOut {
  id: string;
  role: string;
  content: string;
  created_at: string;
  run_id: string | null;
  error: string;
}

export interface PlaygroundTurnResponse {
  session_id: string;
  messages: PlaygroundMessageOut[];
  run: RunDetail | null;
}

export interface PlaygroundExample {
  label: string;
  kind: "clean" | "adversarial";
  message: string;
  source: string;
}

export interface EnvironmentView {
  llm_base_url: string;
  llm_model: string;
  wandb_entity: string;
  wandb_project: string;
  wandb_mcp_url: string;
  weave_project: string;
  backend_port: number;
  credentials_present: Record<string, boolean>;
  cost_rate_configured: boolean;
}

export interface RuntimeSettings {
  llm_model: string;
  llm_policy_model: string;
  llm_temperature: number;
  business_contract_version: string;
  generation: {
    merchants: number;
    customers_per_merchant: number;
    orders_per_customer_max: number;
    products_per_merchant: number;
    tickets_per_merchant: number;
    seed: number;
    clock_iso: string;
  };
  suite: { legitimate_cases: number; adversarial_cases: number; dev_split: number; validation_split: number };
  acceptance: {
    max_unauthorized_success_rate: number;
    min_legit_completion_rate: number;
    max_legit_completion_drop: number;
    max_false_denial_rate: number;
    require_permission_breadth_not_worse: boolean;
  };
  budget: {
    max_iterations: number;
    max_model_calls_per_job: number;
    max_agent_steps_per_scenario: number;
    llm_timeout_seconds: number;
    llm_max_retries: number;
    mcp_timeout_seconds: number;
    mcp_ingestion_retries: number;
    mcp_retry_delay_seconds: number;
  };
  business_limits: {
    max_refund_minor: number;
    refund_window_days: number;
    currency: string;
    refundable_order_statuses: string[];
  };
}

export interface SettingsResponse {
  runtime: RuntimeSettings;
  environment: EnvironmentView;
  business_contract: Json;
}

export interface WorkspaceStep {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  blocked_reason: string;
}

export interface WorkspaceState {
  steps: WorkspaceStep[];
  dataset: DatasetSummary | null;
  suite: SuiteSummary | null;
  baseline_policy: PolicySummary | null;
  active_policy: PolicySummary | null;
  latest_experiment: ExperimentSummary | null;
  latest_candidate: PolicySummary | null;
  active_jobs: JobOut[];
  integrations: IntegrationState[];
}

export interface ComparisonField {
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  direction: "higher_better" | "lower_better";
}
