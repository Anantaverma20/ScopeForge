import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  CircleCheck,
  CircleDot,
  CircleMinus,
  CircleX,
  Download,
  FlaskConical,
  Layers,
  MessagesSquare,
  Play,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { api, useApiMutation, useApiQuery } from "../api/client";
import { JobPanel } from "../components/JobPanel";
import { ComparisonBars, GateList, PermissionList, PolicyDiffView, gatesOf } from "../components/PolicyParts";
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  Cell,
  Code,
  Disclosure,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  Loading,
  Mono,
  Page,
  PageHeader,
  Row,
  SectionLabel,
  Skeleton,
  TabPanel,
  Table,
  Tabs,
  cx,
  inputClass,
  type Tone,
} from "../components/ui";
import {
  acceptanceState,
  documentRules,
  defaultEffect,
  formatDateTime,
  humanize,
  policyDisplayName,
  splitLabel,
  syntaxState,
} from "../lib/present";
import type { Json, PolicyDetail, PolicySummary } from "../types/api";

/* ------------------------------------------------------------------ */
/* Version list                                                        */
/* ------------------------------------------------------------------ */
function VersionList({
  policies,
  selected,
  onSelect,
}: {
  policies: PolicySummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Policy versions" className="min-w-0">
      <SectionLabel className="mb-2 px-1">Versions ({policies.length})</SectionLabel>
      <ul className="sf-scroll flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-220px)]">
        {policies.map((policy) => {
          const isSelected = policy.id === selected;
          const acceptance = acceptanceState(policy);
          return (
            <li key={policy.id}>
              <button
                type="button"
                onClick={() => onSelect(policy.id)}
                aria-current={isSelected ? "true" : undefined}
                className={cx(
                  "w-full rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-150",
                  isSelected
                    ? "border-accent/50 bg-surface shadow-raised ring-1 ring-accent/30"
                    : "border-line bg-surface hover:border-line-strong hover:shadow-card",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={cx("text-[15px] font-semibold", isSelected ? "text-accent-strong" : "text-ink")}>
                    Policy v{policy.version}
                  </span>
                  {policy.is_active_playground && (
                    <Badge tone="accent" icon={<MessagesSquare aria-hidden size={11} />}>
                      Active in playground
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-muted" title={policy.name}>
                  {policyDisplayName(policy)}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={acceptance.tone}>{acceptance.label}</Badge>
                  {policy.validation_status !== "valid" && <Badge tone="danger">Invalid syntax</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Selected policy                                                     */
/* ------------------------------------------------------------------ */
function StateCell({
  label,
  value,
  tone,
  icon,
  help,
}: {
  label: string;
  value: string;
  tone: Tone;
  icon: ReactNode;
  help?: string;
}) {
  const ink: Record<Tone, string> = {
    neutral: "text-ink",
    slate: "text-ink",
    pass: "text-pass",
    warn: "text-warn",
    danger: "text-danger",
    accent: "text-accent-strong",
  };
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-sunken/50 px-3.5 py-2.5" title={help}>
      <p className="text-[12px] font-medium text-ink-faint">{label}</p>
      <p className={cx("mt-0.5 flex items-start gap-1.5 text-[14px] leading-snug font-semibold", ink[tone])}>
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 break-words">{value}</span>
      </p>
    </div>
  );
}

function acceptanceSummary(policy: PolicyDetail) {
  const gates = gatesOf(policy.decision_metrics);
  if (gates.length === 0) return null;
  const passed = gates.filter((g) => g.passed === true).length;
  const failed = gates.filter((g) => g.passed === false).length;
  const unevaluable = gates.filter((g) => g.passed === null).length;
  const parts = [`${passed} of ${gates.length} gates passed`];
  if (failed) parts.push(`${failed} failed`);
  if (unevaluable) parts.push(`${unevaluable} could not be evaluated`);
  return parts.join(" · ");
}

function PolicyOverviewHeader({ policy, all }: { policy: PolicyDetail; all: PolicySummary[] }) {
  const suites = useApiQuery(["suites"], () => api.suites());
  const [suiteId, setSuiteId] = useState<string>("");
  const [split, setSplit] = useState("validation");
  const [override, setOverride] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [showEvaluate, setShowEvaluate] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const activate = useApiMutation((reason: string) => api.activatePolicy(policy.id, reason));
  const evaluate = useApiMutation((args: { suite_id: string; splits: string[] }) => api.evaluatePolicy(policy.id, args));

  useEffect(() => {
    if (!suiteId && suites.data?.length) setSuiteId(suites.data[0].id);
  }, [suites.data, suiteId]);

  const isBaseline = policy.kind === "permissive_baseline";
  const valid = policy.validation_status === "valid";
  const acceptance = acceptanceState(policy);
  const syntax = syntaxState(policy);
  const rules = documentRules(policy.document);
  const effect = defaultEffect(policy.document);
  const summary = acceptanceSummary(policy);
  const needsOverride = !isBaseline && valid && !policy.is_active_playground && !policy.activation_eligible;
  const parent = all.find((p) => p.id === policy.parent_id);

  const activateDisabled =
    isBaseline || !valid || policy.is_active_playground || activate.isPending;
  const activateTitle = isBaseline
    ? "The permissive baseline exists to measure exposure and can never be activated"
    : !valid
      ? "An invalid policy cannot be activated"
      : policy.is_active_playground
        ? "This version is already active in the playground"
        : policy.activation_eligible
          ? "Activate this policy for the local playground"
          : "This candidate did not pass the acceptance gate. An override reason is required.";

  return (
    <Card className="overflow-visible">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink-faint">
              {isBaseline ? "Measurement policy" : "Permission policy"}
              {parent && <> · derived from Policy v{parent.version}</>}
            </p>
            <h2 className="mt-0.5 text-[22px] leading-tight font-semibold tracking-tight text-ink">
              Policy v{policy.version}
            </h2>
            <p className="mt-0.5 text-[15px] break-words text-ink-muted">{policyDisplayName(policy)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink
              href={api.exportPolicyUrl(policy.id)}
              download
              size="sm"
              icon={<Download aria-hidden size={15} />}
            >
              Export JSON
            </ButtonLink>
            <Button
              variant="secondary"
              size="sm"
              icon={<FlaskConical aria-hidden size={15} />}
              onClick={() => setShowEvaluate((v) => !v)}
              ariaExpanded={showEvaluate}
              ariaControls="policy-evaluate-panel"
              disabled={!valid}
              title={!valid ? "An invalid policy cannot be evaluated" : "Run this policy against a scenario split"}
            >
              Evaluate…
            </Button>
            <Button
              size="sm"
              icon={<Play aria-hidden size={15} />}
              loading={activate.isPending}
              disabled={activateDisabled}
              title={activateTitle}
              ariaExpanded={needsOverride ? showOverride : undefined}
              ariaControls={needsOverride ? "policy-override-panel" : undefined}
              onClick={() => {
                if (policy.activation_eligible) activate.mutate("");
                else setShowOverride((v) => !v);
              }}
            >
              {policy.is_active_playground ? "Already active" : "Activate in playground"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StateCell
            label="Syntax"
            value={syntax.label}
            tone={valid ? "neutral" : "danger"}
            help={syntax.help}
            icon={valid ? <CircleCheck aria-hidden size={15} className="text-ink-muted" /> : <CircleX aria-hidden size={15} />}
          />
          <StateCell
            label="Acceptance"
            value={acceptance.label}
            tone={acceptance.tone}
            help={acceptance.help}
            icon={
              acceptance.tone === "pass" ? (
                <ShieldCheck aria-hidden size={15} />
              ) : acceptance.tone === "danger" ? (
                <ShieldAlert aria-hidden size={15} />
              ) : acceptance.tone === "warn" ? (
                <TriangleAlert aria-hidden size={15} />
              ) : (
                <CircleMinus aria-hidden size={15} />
              )
            }
          />
          <StateCell
            label="Playground"
            value={policy.is_active_playground ? "Active" : "Not active"}
            tone={policy.is_active_playground ? "accent" : "neutral"}
            icon={
              <CircleDot aria-hidden size={15} className={policy.is_active_playground ? undefined : "text-ink-faint"} />
            }
          />
          <StateCell
            label="Rules"
            value={`${rules ? rules.length : policy.rule_count} rules · default ${effect ?? "unknown"}`}
            tone="neutral"
            icon={<Layers aria-hidden size={15} className="text-ink-muted" />}
          />
        </div>

        {(policy.decision_reason || summary) && (
          <p className="text-[14px] text-ink-muted">
            <span className="font-medium text-ink">Acceptance result: </span>
            {policy.decision_reason ? humanize(policy.decision_reason) : "No decision recorded"}
            {summary && <span className="text-ink-faint"> ({summary})</span>}
          </p>
        )}
        {isBaseline && (
          <p className="text-[14px] text-ink-muted">
            This policy is <span className="font-medium text-ink">measurement only</span>: it deliberately allows every tool
            so exposure can be measured before any restriction. It can never be activated.
          </p>
        )}

        {policy.validation_errors.length > 0 && (
          <Callout tone="danger" role="alert" icon={<CircleX size={18} />} title="This proposal failed policy-language validation">
            <ul className="mt-1 list-disc pl-5 font-mono text-[12px] text-danger">
              {policy.validation_errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </Callout>
        )}

        {needsOverride && showOverride && (
          <div id="policy-override-panel" className="animate-enter">
            <Callout tone="warn" icon={<TriangleAlert size={18} />} title="This candidate did not pass the acceptance gate">
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Field label="Override reason (required)" hint="The reason is recorded on the policy version.">
                    <input
                      className={inputClass}
                      value={override}
                      onChange={(event) => setOverride(event.target.value)}
                      placeholder="Why are you activating a candidate that did not pass?"
                    />
                  </Field>
                </div>
                <Button
                  onClick={() => activate.mutate(override)}
                  disabled={override.trim().length === 0 || activate.isPending}
                  loading={activate.isPending}
                  className="sm:mb-[22px]"
                >
                  Activate with override
                </Button>
              </div>
            </Callout>
          </div>
        )}
        {activate.isError && <ErrorState error={activate.error} context="Activation refused" />}

        {showEvaluate && (
          <div id="policy-evaluate-panel" className="animate-enter rounded-xl border border-line bg-surface-sunken/50 p-4">
            <p className="text-[14px] font-medium text-ink">Evaluate this policy</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              Starts a job that runs the support agent through the selected split with real model calls.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-end">
              <Field label="Suite to evaluate against">
                <select className={inputClass} value={suiteId} onChange={(event) => setSuiteId(event.target.value)}>
                  {(suites.data ?? []).map((suite) => (
                    <option key={suite.id} value={suite.id}>
                      {suite.name} (v{suite.version}) · {suite.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Split">
                <select className={inputClass} value={split} onChange={(event) => setSplit(event.target.value)}>
                  <option value="dev">Development</option>
                  <option value="validation">Validation</option>
                  <option value="test">Held-out test (final assessment only)</option>
                </select>
              </Field>
              <Button
                onClick={() => evaluate.mutate({ suite_id: suiteId, splits: [split] }, { onSuccess: (job) => setJobId(job.id) })}
                disabled={!suiteId || !valid || evaluate.isPending}
                loading={evaluate.isPending}
                title={!valid ? "An invalid policy cannot be evaluated" : undefined}
              >
                Evaluate
              </Button>
            </div>
            {evaluate.isError && (
              <div className="mt-3">
                <ErrorState error={evaluate.error} context="Could not start the evaluation" />
              </div>
            )}
          </div>
        )}

        {jobId && <JobPanel jobId={jobId} onDismiss={() => setJobId(null)} />}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */
function ExperimentLink({ id, label }: { id: unknown; label: string }) {
  if (typeof id !== "string" || !id) return null;
  return (
    <Link
      to={`/experiments?experiment=${id}`}
      className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-accent-strong underline-offset-2 hover:underline"
    >
      {label}
      <Mono className="text-ink-faint">{id}</Mono>
    </Link>
  );
}

function TextBlock({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-ink">{children}</p>;
}

function EvidenceSummary({ evidence }: { evidence: Json }) {
  const e = evidence as {
    evidence_mode?: string;
    evidence_refs?: unknown;
    mcp?: { ok?: boolean; tools_used?: string[]; error?: string; attempts?: number };
    baseline_experiment_id?: string;
    failure_count?: number;
    false_denial_count?: number;
    splits_used?: string[];
  };
  if (!evidence || Object.keys(evidence).length === 0)
    return <p className="text-[14px] text-ink-muted">No evidence was recorded for this version.</p>;

  const refs = Array.isArray(e.evidence_refs) ? (e.evidence_refs as unknown[]).map(String) : [];
  const items: [string, ReactNode][] = [];
  if (e.evidence_mode)
    items.push([
      "Evidence source",
      e.evidence_mode === "mcp" ? (
        <Badge tone="accent">Retrieved through the W&amp;B MCP server</Badge>
      ) : e.evidence_mode === "local_evidence" || e.evidence_mode === "local" ? (
        <Badge tone="neutral">Locally stored traces</Badge>
      ) : (
        <Mono>{e.evidence_mode}</Mono>
      ),
    ]);
  if (e.mcp?.tools_used?.length) items.push(["MCP tools used", <Mono>{e.mcp.tools_used.join(", ")}</Mono>]);
  if (e.mcp?.error) items.push(["MCP error", <span className="text-danger">{e.mcp.error}</span>]);
  if (e.splits_used?.length) items.push(["Splits read", e.splits_used.map(splitLabel).join(", ")]);
  if (typeof e.failure_count === "number") items.push(["Failures cited", String(e.failure_count)]);
  if (typeof e.false_denial_count === "number") items.push(["False denials cited", String(e.false_denial_count)]);
  if (e.baseline_experiment_id)
    items.push(["Reference experiment", <ExperimentLink id={e.baseline_experiment_id} label="Open" />]);
  if (refs.length)
    items.push([
      "Records cited",
      <span className="flex flex-wrap gap-1">
        {refs.map((ref) =>
          ref.startsWith("exp_") ? (
            <Link key={ref} to={`/experiments?experiment=${ref}`} className="rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] text-accent-strong hover:underline">
              {ref}
            </Link>
          ) : (
            <code key={ref} className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink">
              {ref}
            </code>
          ),
        )}
      </span>,
    ]);

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && <KeyValue items={items} />}
      <Disclosure summary="Raw evidence record">
        <Code value={evidence} maxHeight={280} />
      </Disclosure>
    </div>
  );
}

function ChangesAndEvidence({ policy, all }: { policy: PolicyDetail; all: PolicySummary[] }) {
  const diff = useApiQuery(["policy-diff", policy.id], () => api.policyDiff(policy.id));
  const metrics = policy.decision_metrics ?? {};
  const hasDecision = Object.keys(metrics).length > 0;
  const parent = all.find((p) => p.id === policy.parent_id);
  const effects = policy.expected_effects ?? {};
  const effectEntries = Object.entries(effects);

  return (
    <>
      <section aria-labelledby="changes-heading" className="flex flex-col gap-3">
        <h3 id="changes-heading" className="text-[16px] font-semibold text-ink">
          What changed
        </h3>
        {diff.isLoading && <Skeleton lines={3} />}
        {diff.isError && <ErrorState error={diff.error} context="Could not load the diff" />}
        {diff.data && !diff.data.parent_id && (
          <EmptyState title="This policy has no parent version">
            It is the starting point of its family, so there is nothing to compare against.
          </EmptyState>
        )}
        {diff.data?.parent_id && (
          <PolicyDiffView
            diff={diff.data.diff}
            parentLabel={parent ? `Policy v${parent.version}` : diff.data.parent_id}
          />
        )}
      </section>

      <section aria-labelledby="why-heading" className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 id="why-heading" className="text-[16px] font-semibold text-ink">
          Why it was proposed
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <SectionLabel className="mb-1.5">Rationale</SectionLabel>
            <TextBlock>{policy.rationale || "No rationale recorded."}</TextBlock>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <SectionLabel className="mb-1.5">Expected effects</SectionLabel>
              {effectEntries.length === 0 ? (
                <p className="text-[14px] text-ink-muted">None recorded.</p>
              ) : effectEntries.every(([, v]) => typeof v === "string") ? (
                <dl className="flex flex-col gap-1.5">
                  {effectEntries.map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[13px] font-medium text-ink">{humanize(key)}</dt>
                      <dd className="text-[14px] text-ink-muted">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Code value={effects} maxHeight={160} />
              )}
            </div>
            <div>
              <SectionLabel className="mb-1.5">Trade-offs</SectionLabel>
              <TextBlock>{policy.tradeoffs || "None recorded."}</TextBlock>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="acceptance-heading" className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 id="acceptance-heading" className="text-[16px] font-semibold text-ink">
          Acceptance result
        </h3>
        {!hasDecision ? (
          <EmptyState title="No acceptance record for this version">
            {policy.kind === "permissive_baseline"
              ? "The permissive baseline is the reference that candidates are measured against."
              : "Acceptance gates are recorded by the improvement loop. Use Evaluate to run this version against a split."}
          </EmptyState>
        ) : (
          <>
            <p className="text-[14px] text-ink-muted">
              <span className="font-medium text-ink">{humanize(policy.decision_reason || "No summary recorded")}</span>
              {acceptanceSummary(policy) && <> · {acceptanceSummary(policy)}</>}
            </p>
            <GateList metrics={metrics} />
            {(metrics as { comparison?: unknown }).comparison ? (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] text-ink-muted">
                  {(metrics as { baseline_validation_experiment_id?: string }).baseline_validation_experiment_id
                    ? "Validation split: the baseline run compared with this candidate's run."
                    : "Baseline compared with this candidate."}
                </p>
                <ComparisonBars metrics={metrics} />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <ExperimentLink id={(metrics as Json).validation_experiment_id} label="Candidate validation run" />
              <ExperimentLink id={(metrics as Json).baseline_validation_experiment_id} label="Baseline validation run" />
              <ExperimentLink id={(metrics as Json).dev_experiment_id} label="Candidate development run" />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="evidence-heading" className="flex flex-col gap-3 border-t border-line pt-5">
        <h3 id="evidence-heading" className="text-[16px] font-semibold text-ink">
          Evidence the proposal cited
        </h3>
        <EvidenceSummary evidence={policy.evidence ?? {}} />
        <p className="text-[13px] text-ink-faint">
          This is a tested candidate within the supported policy language and the scenario coverage that was run. It is
          not a claim of minimality or of general security.
        </p>
      </section>
    </>
  );
}

function TechnicalDetails({ policy, all }: { policy: PolicyDetail; all: PolicySummary[] }) {
  const diff = useApiQuery(["policy-diff", policy.id], () => api.policyDiff(policy.id));
  const parent = all.find((p) => p.id === policy.parent_id);
  const description = (policy.document as { description?: string })?.description;
  return (
    <>
      <section aria-labelledby="meta-heading">
        <h3 id="meta-heading" className="mb-3 text-[16px] font-semibold text-ink">
          Metadata
        </h3>
        <KeyValue
          items={[
            ["System version", `v${policy.version}`],
            ["Stored name", policy.name],
            ["Policy id", <Mono>{policy.id}</Mono>],
            ["Kind", <Mono>{policy.kind}</Mono>],
            ["Family", <Mono>{policy.family_id}</Mono>],
            ["Parent", policy.parent_id ? <Mono>{`${policy.parent_id}${parent ? ` (v${parent.version})` : ""}`}</Mono> : "—"],
            ["Created", formatDateTime(policy.created_at)],
            ["Created by", policy.created_by || "—"],
            ["Source model", policy.source_model ? <Mono>{policy.source_model}</Mono> : "—"],
            ["Canonical hash", <Mono>{policy.canonical_hash}</Mono>],
            ["Contract version", policy.contract_version || "—"],
            ["Validation status", <Mono>{policy.validation_status}</Mono>],
            ["Decision", <Mono>{policy.decision ?? "none"}</Mono>],
            ["Activation eligible", policy.activation_eligible ? "Yes" : "No"],
            ["Experiment", policy.experiment_id ? <Mono>{policy.experiment_id}</Mono> : "—"],
            ["Document description", description || "—"],
          ]}
        />
      </section>

      <section aria-labelledby="json-heading" className="flex flex-col gap-2 border-t border-line pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="json-heading" className="text-[16px] font-semibold text-ink">
            Policy JSON
          </h3>
          <ButtonLink href={api.exportPolicyUrl(policy.id)} download size="sm" icon={<Download aria-hidden size={15} />}>
            Export JSON
          </ButtonLink>
        </div>
        <Code value={policy.document} maxHeight={520} />
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-5">
        <Disclosure summary="Rules as rendered by the server" meta={`${policy.human_readable.length} rules`}>
          <Table headers={["Rule", "Effect", "Tools", "Condition", "Fields returned"]} minWidth={760}>
            {policy.human_readable.map((rule) => (
              <Row key={rule.id}>
                <Cell mono className="text-[12px]">
                  {rule.id}
                  {rule.description && <div className="mt-1 font-sans text-[13px] text-ink-muted">{rule.description}</div>}
                </Cell>
                <Cell mono>{rule.effect}</Cell>
                <Cell mono className="text-[12px]">{rule.tools}</Cell>
                <Cell mono className="max-w-[320px] text-[12px] break-words">{rule.condition}</Cell>
                <Cell mono className="max-w-[220px] text-[12px] break-words">{rule.fields}</Cell>
              </Row>
            ))}
          </Table>
        </Disclosure>
        <Disclosure summary="Raw decision record">
          {Object.keys(policy.decision_metrics ?? {}).length ? (
            <Code value={policy.decision_metrics} maxHeight={320} />
          ) : (
            <p className="text-[14px] text-ink-muted">No decision record.</p>
          )}
        </Disclosure>
        <Disclosure summary="Raw diff against parent">
          {diff.isLoading ? <Loading /> : diff.isError ? <ErrorState error={diff.error} /> : <Code value={diff.data} maxHeight={320} />}
        </Disclosure>
      </section>
    </>
  );
}

function PolicyView({ policy, all }: { policy: PolicyDetail; all: PolicySummary[] }) {
  const [tab, setTab] = useState("overview");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PolicyOverviewHeader key={policy.id} policy={policy} all={all} />
      <Card>
        <div className="flex flex-col gap-5">
          <Tabs
            idBase="policy"
            label="Policy sections"
            tabs={[
              { key: "overview", label: "Permissions" },
              { key: "changes", label: "Changes & evidence" },
              { key: "technical", label: "Technical details" },
            ]}
            active={tab}
            onSelect={setTab}
          />
          {tab === "overview" && (
            <TabPanel idBase="policy" tabKey="overview">
              <PermissionList document={policy.document} readable={policy.human_readable} />
            </TabPanel>
          )}
          {tab === "changes" && (
            <TabPanel idBase="policy" tabKey="changes">
              <ChangesAndEvidence policy={policy} all={all} />
            </TabPanel>
          )}
          {tab === "technical" && (
            <TabPanel idBase="policy" tabKey="technical">
              <TechnicalDetails policy={policy} all={all} />
            </TabPanel>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export default function Policies() {
  const [params, setParams] = useSearchParams();
  const policies = useApiQuery(["policies"], api.policies, { refetchInterval: 5000 });
  // Remember the first default so a new version arriving through polling never switches the view silently.
  const [initialId, setInitialId] = useState<string | null>(null);
  useEffect(() => {
    if (!initialId && policies.data?.length) setInitialId(policies.data[0].id);
  }, [policies.data, initialId]);

  const selected = params.get("policy") ?? initialId ?? policies.data?.[0]?.id ?? null;
  const detail = useApiQuery(["policy", selected], () => api.policy(selected!), { enabled: !!selected });

  if (policies.isLoading) return <Loading label="Loading policies" />;
  if (policies.isError) return <ErrorState error={policies.error} context="Could not load policies" />;

  const all = policies.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Policies"
        description="What the agent is allowed to do, what changed between versions, and the evidence behind each decision."
      />

      {all.length === 0 ? (
        <EmptyState title="No policies yet" icon={<ShieldCheck size={28} />}>
          The permissive baseline is created with the first dataset. Candidates appear after the improvement loop runs
          from the <Link to="/" className="text-accent-strong underline">Workspace</Link>.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-8">
            <VersionList policies={all} selected={selected} onSelect={(id) => setParams({ policy: id })} />
          </div>
          <div className="min-w-0">
            {detail.isLoading && (
              <Card>
                <Loading label="Loading policy" />
                <Skeleton lines={4} />
              </Card>
            )}
            {detail.isError && <ErrorState error={detail.error} context="Could not load this policy version" />}
            {detail.data && <PolicyView key={detail.data.id} policy={detail.data} all={all} />}
          </div>
        </div>
      )}
    </Page>
  );
}
