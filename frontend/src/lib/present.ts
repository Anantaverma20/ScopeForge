/**
 * Presentation helpers: readable labels derived from real API data.
 *
 * Nothing here changes a value or invents one. Every translation is a pure function of the
 * data the backend returned, and callers keep the original representation available
 * as technical detail. Where a structure cannot be translated reliably these helpers return
 * `null` so the UI can fall back to the raw expression.
 */
import type { ExperimentSummary, Json, PolicySummary, RunSummary, ScoreValue } from "../types/api";
import type { Tone } from "../components/ui";

/* ------------------------------------------------------------------ */
/* Generic                                                             */
/* ------------------------------------------------------------------ */
export function humanize(key: string) {
  const text = key.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function formatDuration(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "No data";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/* ------------------------------------------------------------------ */
/* Scenarios, splits, tools                                            */
/* ------------------------------------------------------------------ */
export const SPLIT_LABELS: Record<string, string> = {
  dev: "Development",
  validation: "Validation",
  test: "Held-out test",
};

export const SPLIT_HELP: Record<string, string> = {
  dev: "Used to improve policies. The policy designer sees evidence from this split.",
  validation: "Used to assess candidates against the baseline before acceptance.",
  test: "Reserved for final assessment. Never shown to the policy designer.",
};

export function splitLabel(split: string) {
  return SPLIT_LABELS[split] ?? humanize(split || "unassigned");
}

export function splitsLabel(splits: string[]) {
  return splits.length ? splits.map(splitLabel).join(" + ") : "No split";
}

export function kindLabel(kind: string, plural = false) {
  if (kind === "legitimate") return plural ? "Normal requests" : "Normal request";
  if (kind === "adversarial") return plural ? "Attack tests" : "Attack test";
  return humanize(kind);
}

export const CATEGORY_LABELS: Record<string, string> = {
  order_status: "Order status",
  order_history: "Order history",
  profile_check: "Profile check",
  eligible_refund: "Eligible refund",
  ineligible_refund: "Ineligible refund",
  cross_customer_read: "Another customer's records",
  cross_tenant_read: "Another store's records",
  admin_authority_claim: "Fake administrator authority",
  tool_response_injection: "Instruction injected in tool output",
  bulk_export_attempt: "Bulk customer export",
  refund_over_authorization: "Refund beyond authorization",
};

export function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? humanize(category);
}

export const TOOL_ACTIONS: Record<string, string> = {
  get_order: "Look up an order",
  list_orders: "List orders",
  get_customer: "View a customer profile",
  issue_refund: "Issue a refund",
  export_customers: "Export customers",
};

const TOOL_NOUNS: Record<string, string> = {
  get_order: "order lookups",
  list_orders: "order listings",
  get_customer: "profile lookups",
  issue_refund: "refunds",
  export_customers: "customer exports",
};

export function toolAction(tool: string) {
  return TOOL_ACTIONS[tool] ?? humanize(tool);
}

function toolNouns(tools: string[]) {
  const nouns = tools.map((t) => TOOL_NOUNS[t] ?? t);
  if (nouns.length <= 1) return nouns.join("");
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

export function experimentKindLabel(kind: string) {
  switch (kind) {
    case "baseline":
      return "Baseline";
    case "policy_eval":
      return "Candidate evaluation";
    case "final_test":
      return "Final assessment";
    case "playground":
      return "Playground";
    default:
      return humanize(kind);
  }
}

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */
export interface Comparison {
  field: string;
  op: string;
  value?: unknown;
  value_ref?: string | null;
  config_ref?: string | null;
}
export type Condition = Comparison | { all: Condition[] } | { any: Condition[] };

export interface RuleDoc {
  id: string;
  description?: string;
  effect: "allow" | "deny" | string;
  tools: string[];
  when?: Condition | null;
  response_fields?: string[] | null;
  reason_code?: string;
}

/** Rules from a stored document, or null when the document does not have the expected shape. */
export function documentRules(document: Json | null | undefined): RuleDoc[] | null {
  const rules = (document as { rules?: unknown } | undefined)?.rules;
  if (!Array.isArray(rules)) return null;
  const ok = rules.every(
    (r) => r && typeof r === "object" && typeof (r as RuleDoc).id === "string" && Array.isArray((r as RuleDoc).tools),
  );
  return ok ? (rules as RuleDoc[]) : null;
}

export function defaultEffect(document: Json | null | undefined): string | null {
  const value = (document as { default_effect?: unknown } | undefined)?.default_effect;
  return typeof value === "string" ? value : null;
}

/** System version is the primary identifier. Trailing "vN" in a generated name is dropped for display only. */
export function policyDisplayName(policy: Pick<PolicySummary, "name" | "kind">) {
  if (policy.kind === "permissive_baseline") return "Permissive baseline";
  const stripped = policy.name.replace(/\s+v\d+\s*$/i, "").trim();
  return stripped || policy.name;
}

export type PolicyState = { label: string; tone: Tone; help: string };

export function acceptanceState(policy: Pick<PolicySummary, "decision" | "kind" | "validation_status">): PolicyState {
  if (policy.kind === "permissive_baseline")
    return {
      label: "Measurement only",
      tone: "warn",
      help: "The permissive baseline measures what an unscoped agent can reach. It is never eligible for activation.",
    };
  if (policy.decision === "accepted")
    return { label: "Accepted candidate", tone: "pass", help: "Passed every acceptance gate that could be evaluated." };
  if (policy.decision === "rejected")
    return { label: "Rejected", tone: "danger", help: "Did not pass the acceptance gate, or failed validation." };
  return { label: "Not evaluated", tone: "neutral", help: "No acceptance decision has been recorded for this version." };
}

export function syntaxState(policy: Pick<PolicySummary, "validation_status">): PolicyState {
  return policy.validation_status === "valid"
    ? { label: "Valid syntax", tone: "neutral", help: "The document passed policy-language validation." }
    : { label: "Invalid syntax", tone: "danger", help: "The document failed policy-language validation." };
}

const PATH_LABELS: Record<string, string> = {
  "context.tenant_id": "the signed-in customer's store",
  "context.authenticated_customer_id": "the signed-in customer",
  "context.session_id": "the session id",
  "context.contract_version": "the contract version",
  "context.channel": "the support channel",
  "resource.kind": "the record type",
  "resource.order_id": "the order id",
  "resource.merchant_id": "the record's store",
  "resource.customer_id": "the record's owner",
  "resource.status": "the order status",
  "resource.currency": "the order currency",
  "resource.total_minor": "the order total",
  "resource.refunded_minor": "the amount already refunded",
  "resource.refundable_remaining_minor": "the amount still refundable",
  "resource.refund_eligible": "the order's refund eligibility",
  "resource.days_since_placed": "days since the order was placed",
  "resource.days_since_delivered": "days since delivery",
  "resource.requested_customer_id": "the requested customer id",
  "resource.record_count": "the number of records requested",
  "resource.resolved": "whether the record exists",
  "request.tool": "the requested tool",
  "request.amount_minor": "the refund amount",
  "request.has_idempotency_key": "whether the request has an idempotency key",
  "request.has_reason": "whether the request includes a reason",
  "business.max_refund_minor": "the configured refund limit",
  "business.refund_window_days": "the configured refund window (days)",
  "business.currency": "the configured currency",
  "business.refundable_order_statuses": "the configured refundable statuses",
};

const OP_TEXT: Record<string, string> = {
  eq: "is",
  ne: "is not",
  in: "is one of",
  not_in: "is not one of",
  lt: "is less than",
  lte: "is at most",
  gt: "is greater than",
  gte: "is at least",
};

function isComparison(node: Condition): node is Comparison {
  return typeof (node as Comparison).field === "string" && typeof (node as Comparison).op === "string";
}

function sameCmp(node: Comparison, field: string, op: string, ref: string) {
  return node.field === field && node.op === op && (node.value_ref === ref || node.config_ref === ref);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plain-language sentence for one comparison, or null if any part is not recognised. */
export function describeComparison(node: Comparison): string | null {
  // ownership patterns, stated the way a reviewer would say them
  if (sameCmp(node, "context.tenant_id", "eq", "resource.merchant_id")) return "The record belongs to the signed-in customer's store";
  if (sameCmp(node, "context.tenant_id", "ne", "resource.merchant_id")) return "The record belongs to a different store";
  if (sameCmp(node, "context.authenticated_customer_id", "eq", "resource.customer_id"))
    return "The record belongs to the signed-in customer";
  if (sameCmp(node, "context.authenticated_customer_id", "ne", "resource.customer_id"))
    return "The record belongs to a different customer";

  const boolPhrases: Record<string, [string, string]> = {
    "request.has_idempotency_key": ["The request carries an idempotency key", "The request has no idempotency key"],
    "request.has_reason": ["The request includes a reason", "The request includes no reason"],
    "resource.refund_eligible": ["The order is marked refund-eligible", "The order is not marked refund-eligible"],
    "resource.resolved": ["The record exists", "The record does not exist"],
  };
  if (node.field in boolPhrases && typeof node.value === "boolean" && (node.op === "eq" || node.op === "ne")) {
    const truthy = node.op === "eq" ? node.value : !node.value;
    return boolPhrases[node.field][truthy ? 0 : 1];
  }

  const left = PATH_LABELS[node.field];
  const op = OP_TEXT[node.op];
  if (!left || !op) return null;
  let right: string | undefined;
  const ref = node.value_ref ?? node.config_ref;
  if (ref) right = PATH_LABELS[ref];
  else if (node.value !== undefined && node.value !== null) right = JSON.stringify(node.value);
  if (!right) return null;
  return `${cap(left)} ${op} ${right}`;
}

export type ConditionView =
  | { type: "always" }
  | { type: "all" | "any"; items: ConditionView[] }
  | { type: "leaf"; text: string | null; raw: Comparison };

export function conditionView(node: Condition | null | undefined): ConditionView {
  if (!node) return { type: "always" };
  if ("all" in node && Array.isArray(node.all)) return { type: "all", items: node.all.map(conditionView) };
  if ("any" in node && Array.isArray(node.any)) return { type: "any", items: node.any.map(conditionView) };
  if (isComparison(node)) return { type: "leaf", text: describeComparison(node), raw: node };
  return { type: "leaf", text: null, raw: node as unknown as Comparison };
}

/** Top-level comparisons of a condition that is a single comparison or a flat AND. */
function topLevelComparisons(node: Condition | null | undefined): Comparison[] {
  if (!node) return [];
  if (isComparison(node)) return [node];
  if ("all" in node && Array.isArray(node.all)) return node.all.filter(isComparison);
  return [];
}

/** A short, structure-derived title for a rule. */
export function ruleTitle(rule: RuleDoc): string {
  const nouns = toolNouns(rule.tools);
  const cmps = topLevelComparisons(rule.when);
  const single = rule.when && isComparison(rule.when) ? rule.when : null;

  if (rule.effect === "deny") {
    if (!rule.when) return `Block ${nouns}`;
    if (single && sameCmp(single, "context.tenant_id", "ne", "resource.merchant_id")) return "Prevent access across stores";
    if (single && sameCmp(single, "context.authenticated_customer_id", "ne", "resource.customer_id"))
      return "Prevent access to other customers' records";
    return `Block ${nouns} when conditions match`;
  }

  if (rule.effect === "allow") {
    if (!rule.when) return rule.tools.length >= 5 ? "Allow every tool call" : `Allow all ${nouns}`;
    const owned =
      rule.when &&
      "all" in rule.when &&
      cmps.some((c) => sameCmp(c, "context.tenant_id", "eq", "resource.merchant_id")) &&
      cmps.some((c) => sameCmp(c, "context.authenticated_customer_id", "eq", "resource.customer_id"));
    if (owned) {
      if (rule.tools.length === 1) {
        const limited = cmps.some((c) => c.field === "request.amount_minor" && (c.op === "lte" || c.op === "lt"));
        switch (rule.tools[0]) {
          case "get_order":
            return "Read the customer's own orders";
          case "list_orders":
            return "List the customer's own orders";
          case "get_customer":
            return "View the customer's own profile";
          case "issue_refund":
            return limited ? "Refund own orders within limits" : "Refund the customer's own orders";
        }
      }
      return `Allow ${nouns} on the customer's own records`;
    }
    return `Allow ${nouns} when conditions match`;
  }
  return humanize(rule.id);
}

/** Canonical key for a condition node, used to compare rule versions. */
export function conditionKey(node: unknown): string {
  if (Array.isArray(node)) return `[${node.map(conditionKey).join(",")}]`;
  if (node && typeof node === "object") {
    const entries = Object.entries(node as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${conditionKey(v)}`).join(",")}}`;
  }
  return JSON.stringify(node);
}

export interface RuleChange {
  descriptionChanged: boolean;
  effectChanged: boolean;
  toolsAdded: string[];
  toolsRemoved: string[];
  conditions: "same" | "reordered" | "changed";
  conditionsAdded: Condition[];
  conditionsRemoved: Condition[];
  fieldsAdded: string[];
  fieldsRemoved: string[];
  fieldFilteringChanged: boolean;
  reasonCodeChanged: boolean;
}

function flatConditions(node: Condition | null | undefined): { mode: string; items: Condition[] } {
  if (!node) return { mode: "none", items: [] };
  if ("all" in node && Array.isArray(node.all)) return { mode: "all", items: node.all };
  if ("any" in node && Array.isArray(node.any)) return { mode: "any", items: node.any };
  return { mode: "all", items: [node] };
}

export function compareRules(before: RuleDoc, after: RuleDoc): RuleChange {
  const b = flatConditions(before.when);
  const a = flatConditions(after.when);
  const bKeys = b.items.map(conditionKey);
  const aKeys = a.items.map(conditionKey);
  const sameOrder = b.mode === a.mode && bKeys.join("|") === aKeys.join("|");
  const sameSet = b.mode === a.mode && [...bKeys].sort().join("|") === [...aKeys].sort().join("|");
  const bFields = before.response_fields ?? null;
  const aFields = after.response_fields ?? null;
  return {
    descriptionChanged: (before.description ?? "") !== (after.description ?? ""),
    effectChanged: before.effect !== after.effect,
    toolsAdded: after.tools.filter((t) => !before.tools.includes(t)),
    toolsRemoved: before.tools.filter((t) => !after.tools.includes(t)),
    conditions: sameOrder ? "same" : sameSet ? "reordered" : "changed",
    conditionsAdded: a.items.filter((_, i) => !bKeys.includes(aKeys[i])),
    conditionsRemoved: b.items.filter((_, i) => !aKeys.includes(bKeys[i])),
    fieldsAdded: aFields && bFields ? aFields.filter((f) => !bFields.includes(f)) : [],
    fieldsRemoved: aFields && bFields ? bFields.filter((f) => !aFields.includes(f)) : [],
    fieldFilteringChanged: (aFields === null) !== (bFields === null),
    reasonCodeChanged: (before.reason_code ?? "") !== (after.reason_code ?? ""),
  };
}

export const GATE_LABELS: Record<string, string> = {
  unauthorized_success_rate: "Unauthorized actions",
  legit_completion_rate: "Legitimate task completion",
  legit_completion_drop: "Completion drop against baseline",
  false_denial_rate: "False denials",
  permission_breadth: "Permission breadth",
};

export const COMPARISON_LABELS: Record<string, string> = {
  legit_completion: "Legitimate tasks completed",
  unauthorized_success: "Unauthorized actions succeeded",
  attack_objective_achieved: "Attack objective achieved",
  false_denials: "False denials",
  legit_completion_under_attack: "Legitimate work under attack",
  permission_breadth_allowed_share: "Probes allowed (permission breadth)",
};

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */
export type Outcome = { label: string; tone: Tone; help: string };

export function executionState(run: Pick<RunSummary, "status" | "cancelled" | "error">): Outcome {
  if (run.status === "completed" && !run.error)
    return { label: "Completed", tone: "neutral", help: "The run executed to the end. See Outcome for what happened." };
  if (run.cancelled || run.status === "cancelled")
    return { label: "Cancelled", tone: "warn", help: "The run was cancelled before it finished." };
  if (run.status === "running" || run.status === "queued")
    return { label: humanize(run.status), tone: "accent", help: "The run has not finished yet." };
  return { label: run.status === "completed" ? "Completed with error" : "Failed", tone: "danger", help: run.error || "The run itself failed." };
}

const failed = (score?: ScoreValue) => score?.applicable !== false && score?.passed === false;

/** Outcomes derived from the stored deterministic scores. Execution status is reported separately. */
export function runOutcomes(
  run: Pick<RunSummary, "status" | "error" | "scenario_kind" | "scores" | "contract_violations">,
): Outcome[] {
  if (run.status !== "completed" || run.error)
    return [{ label: "Not scored", tone: "warn", help: "The run itself failed, so the task outcome is unknown." }];

  const out: Outcome[] = [];
  const unauthorized = failed(run.scores.unauthorized_action_succeeded);
  const exposed = failed(run.scores.prohibited_field_exposure);
  const blocked = (run.scores.unsafe_attempt_blocked?.value ?? 0) > 0;

  if (run.scenario_kind === "adversarial") {
    if (unauthorized)
      out.push({ label: "Attack succeeded", tone: "danger", help: "A tool call executed that violated the business contract." });
    else if (blocked)
      out.push({
        label: "Blocked by gateway",
        tone: "pass",
        help: "The agent attempted a prohibited call and the policy denied it before execution.",
      });
    else if ((run.contract_violations ?? []).length > 0)
      out.push({
        label: "No unauthorized action",
        tone: "neutral",
        help: "Contract-relevant calls were recorded but none executed an unauthorized action. Inspect the run for detail.",
      });
    else
      out.push({
        label: "Resisted by model",
        tone: "pass",
        help: "The agent made no tool call that would violate the contract. No gateway block was needed.",
      });
    const sub = run.scores.legit_task_completed_under_attack;
    if (sub?.applicable && sub.passed !== null)
      out.push(
        sub.passed
          ? { label: "Genuine sub-task done", tone: "neutral", help: "The legitimate part of this request was completed." }
          : { label: "Genuine sub-task missed", tone: "warn", help: "The legitimate part of this request was not completed." },
      );
  } else {
    const done = run.scores.legit_task_completed;
    if (done?.passed === true)
      out.push({ label: "Task completed", tone: "pass", help: "Verified from business state or checkable response content." });
    else if (done?.passed === false)
      out.push({ label: "Task not completed", tone: "danger", help: "The scorer could not verify the task was completed." });
    else out.push({ label: "Not applicable", tone: "neutral", help: "No task-completion score applies to this run." });
    if (unauthorized)
      out.push({ label: "Contract violated", tone: "danger", help: "A tool call executed that violated the business contract." });
  }
  if (exposed)
    out.push({ label: "Fields exposed", tone: "danger", help: "Prohibited fields reached the agent in this run." });
  return out;
}

/* ------------------------------------------------------------------ */
/* Experiment compatibility                                            */
/* ------------------------------------------------------------------ */
export const COMPARABLE_CONFIG_KEYS = [
  "model",
  "temperature",
  "max_agent_steps",
  "contract_version",
  "suite_version",
  "dataset_id",
  "scenario_count",
] as const;

/** Experiments that ran the same suite, dataset and splits in the opposite role (baseline vs candidate). */
export function comparableCounterparts(target: ExperimentSummary, all: ExperimentSummary[]) {
  const splitsKey = (e: ExperimentSummary) => [...e.splits].sort().join(",");
  const targetIsBaseline = target.kind === "baseline";
  return all.filter(
    (e) =>
      e.id !== target.id &&
      e.kind !== "playground" &&
      target.kind !== "playground" &&
      e.status === "completed" &&
      e.suite_id === target.suite_id &&
      e.dataset_id === target.dataset_id &&
      splitsKey(e) === splitsKey(target) &&
      (e.kind === "baseline") !== targetIsBaseline,
  );
}

export function configMismatches(a: Json, b: Json) {
  return COMPARABLE_CONFIG_KEYS.filter((key) => JSON.stringify(a?.[key] ?? null) !== JSON.stringify(b?.[key] ?? null));
}
