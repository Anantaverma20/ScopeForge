import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, ExternalLink, FlaskConical, GitCompareArrows, Search } from "lucide-react";
import { api, useApiQuery } from "../api/client";
import RunDrawer from "../components/RunDrawer";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Cell,
  Code,
  Disclosure,
  EmptyState,
  ErrorState,
  KeyValue,
  Loading,
  Mono,
  Page,
  PageHeader,
  RateBar,
  Row,
  SectionLabel,
  Skeleton,
  Stat,
  TabPanel,
  Table,
  Tabs,
  cx,
  hasRate,
  inputClass,
  pct,
  rateTone,
  statusTone,
  type Tone,
} from "../components/ui";
import {
  categoryLabel,
  comparableCounterparts,
  configMismatches,
  executionState,
  experimentKindLabel,
  formatDateTime,
  formatDuration,
  humanize,
  kindLabel,
  plural,
  runOutcomes,
  splitsLabel,
} from "../lib/present";
import type { ExperimentDetail, ExperimentMetrics, ExperimentSummary, ProbeOut, RateMetric } from "../types/api";

/* ------------------------------------------------------------------ */
/* Primary measures                                                    */
/* ------------------------------------------------------------------ */
const toneInk: Record<Tone, string> = {
  neutral: "text-ink",
  slate: "text-ink",
  pass: "text-pass",
  warn: "text-warn",
  danger: "text-danger",
  accent: "text-accent-strong",
};

function PrimaryMeasure({
  label,
  explanation,
  value,
  detail,
  tone,
  rate,
}: {
  label: string;
  explanation: string;
  value: string;
  detail: string;
  tone: Tone;
  rate?: number | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <p className="text-[14px] font-medium text-ink">{label}</p>
      <p className={cx("text-[32px] leading-none font-semibold tracking-tight tabular-nums", value === "No data" ? "text-[22px] text-ink-faint" : toneInk[tone])}>
        {value}
      </p>
      {rate !== undefined && <RateBar rate={rate} tone={tone} />}
      <p className="text-[13px] text-ink-muted tabular-nums">{detail}</p>
      <p className="text-[13px] leading-snug text-ink-faint">{explanation}</p>
    </div>
  );
}

function rateDetail(metric: RateMetric | undefined, noun: string) {
  if (!metric) return "Not measured";
  const base = `${metric.numerator} of ${metric.denominator} ${noun}`;
  return metric.excluded_infrastructure_failures ? `${base} · ${metric.excluded_infrastructure_failures} failed run(s) excluded` : base;
}

function exposure(m: ExperimentMetrics) {
  if (!m.field_exposure) return { value: "No data", detail: "Not measured", tone: "neutral" as Tone };
  const count = m.field_exposure.fields.length;
  return {
    value: count === 0 ? "None" : plural(count, "field"),
    detail: count === 0 ? `No prohibited field reached the agent in ${plural(m.runs?.total ?? 0, "run")}` : `in ${plural(m.field_exposure.runs, "run")}: ${m.field_exposure.fields.join(", ")}`,
    tone: (count === 0 ? "pass" : "danger") as Tone,
  };
}

function PrimaryMeasures({ metrics: m }: { metrics: ExperimentMetrics }) {
  const fields = exposure(m);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <PrimaryMeasure
        label="Legitimate tasks completed"
        explanation="Normal requests verified complete from business state or checkable response content, never from the agent saying it is done."
        value={hasRate(m.legit_completion) ? pct(m.legit_completion.rate) : "No data"}
        rate={hasRate(m.legit_completion) ? m.legit_completion.rate : null}
        detail={rateDetail(m.legit_completion, "normal requests")}
        tone={rateTone(m.legit_completion)}
      />
      <PrimaryMeasure
        label="Unauthorized actions succeeded"
        explanation="Attack tests in which a tool call both executed and violated the business contract."
        value={hasRate(m.unauthorized_success) ? pct(m.unauthorized_success.rate) : "No data"}
        rate={hasRate(m.unauthorized_success) ? m.unauthorized_success.rate : null}
        detail={rateDetail(m.unauthorized_success, "attack tests")}
        tone={rateTone(m.unauthorized_success, true)}
      />
      <PrimaryMeasure
        label="Prohibited fields exposed"
        explanation="Distinct fields the contract prohibits that reached the agent in any run of this experiment."
        value={fields.value}
        detail={fields.detail}
        tone={fields.tone}
      />
    </div>
  );
}

function MoreMetrics({ metrics: m }: { metrics: ExperimentMetrics }) {
  const tokens = m.tokens?.total_tokens ?? 0;
  const resisted = m.attacks_resisted_by_model;
  return (
    <Disclosure summary="More metrics" variant="boxed" meta="False denials, gateway blocks, cost and more">
      <div className="flex flex-col gap-4">
        <div>
          <SectionLabel className="mb-2">Enforcement and model behaviour - reported separately</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Gateway blocks"
              hint="Tool calls the policy denied that would have violated the business contract. This is enforcement, not model behaviour."
              value={`${m.blocked_unsafe_attempts?.events ?? 0} calls`}
              sub={`in ${plural(m.blocked_unsafe_attempts?.runs ?? 0, "run")}`}
            />
            <Stat
              label="Attacks resisted by the model"
              hint="Attack tests where the agent never attempted a contract-violating call, so no gateway block was needed. This is model behaviour, not enforcement."
              value={hasRate(resisted) ? `${resisted.numerator} / ${resisted.denominator}` : "No data"}
              sub={hasRate(resisted) ? pct(resisted.rate) : undefined}
            />
            <Stat
              label="False denials"
              hint="Authorised tool calls the policy refused, over all authorised tool-call attempts."
              value={hasRate(m.false_denials) ? pct(m.false_denials.rate) : "No data"}
              tone={rateTone(m.false_denials, true)}
              sub={m.false_denials ? `${m.false_denials.numerator} / ${m.false_denials.denominator} calls` : undefined}
            />
            <Stat
              label="Legitimate work under attack"
              hint="Attack tests that also carry a genuine sub-task, and whether that sub-task was completed."
              value={hasRate(m.legit_completion_under_attack) ? pct(m.legit_completion_under_attack.rate) : "No data"}
              sub={
                m.legit_completion_under_attack
                  ? `${m.legit_completion_under_attack.numerator} / ${m.legit_completion_under_attack.denominator} sub-tasks`
                  : undefined
              }
            />
          </div>
        </div>
        <div>
          <SectionLabel className="mb-2">Execution</SectionLabel>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Tool calls"
              value={m.tool_events ? `${m.tool_events.total}` : "No data"}
              sub={m.tool_events ? `${m.tool_events.allowed} allowed · ${m.tool_events.denied} denied · ${m.tool_events.executed} executed` : undefined}
            />
            <Stat
              label="Tokens"
              value={tokens ? tokens.toLocaleString() : "Not reported"}
              sub={m.tokens && tokens ? `${m.tokens.prompt_tokens.toLocaleString()} prompt · ${m.tokens.completion_tokens.toLocaleString()} completion` : undefined}
            />
            <Stat
              label="Cost"
              value={m.cost?.available ? `$${m.cost.usd}` : "Cost unavailable"}
              sub={m.cost?.available ? undefined : m.cost?.reason ?? "No verified price configured for this model"}
            />
            <Stat
              label="Duration"
              value={m.duration_ms?.mean ? `${formatDuration(m.duration_ms.mean)} mean` : "No data"}
              sub={m.duration_ms?.total ? `${formatDuration(m.duration_ms.total)} total` : undefined}
            />
            <Stat
              label="Other failures"
              hint="Runs that failed for reasons other than the policy, for example a model or provider error. They are excluded from rates."
              value={m.runs?.infrastructure_failures ?? 0}
              tone={(m.runs?.infrastructure_failures ?? 0) > 0 ? "warn" : "neutral"}
              sub={m.runs?.cancelled ? `${m.runs.cancelled} cancelled` : undefined}
            />
            {hasRate(m.attack_objective_achieved) && (
              <Stat
                label="Attack objective achieved"
                hint="Attack tests whose named objective was reached, as scored from executed calls and state."
                value={pct(m.attack_objective_achieved.rate)}
                tone={rateTone(m.attack_objective_achieved, true)}
                sub={`${m.attack_objective_achieved.numerator} / ${m.attack_objective_achieved.denominator}`}
              />
            )}
            {m.permission_breadth && (
              <Stat
                label="Probes allowed"
                hint={m.permission_breadth.note}
                value={`${m.permission_breadth.allowed} / ${m.permission_breadth.probes}`}
                sub={`${m.permission_breadth.allowed_but_prohibited_by_contract} allowed but prohibited by contract`}
                tone={m.permission_breadth.allowed_but_prohibited_by_contract > 0 ? "danger" : "neutral"}
              />
            )}
          </div>
        </div>
      </div>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------ */
/* Comparison                                                          */
/* ------------------------------------------------------------------ */
function CompareRow({
  label,
  original,
  candidate,
  lowerBetter,
  format,
}: {
  label: string;
  original: number | null;
  candidate: number | null;
  lowerBetter: boolean;
  format: (v: number) => string;
}) {
  const delta = original !== null && candidate !== null ? candidate - original : null;
  const better = delta === null ? null : lowerBetter ? delta < 0 : delta > 0;
  const worse = delta === null ? null : lowerBetter ? delta > 0 : delta < 0;
  return (
    <div className="grid gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
      <p className="text-[14px] font-medium text-ink">{label}</p>
      <p className="text-[14px] text-ink-muted tabular-nums">
        <span className="text-[12px] text-ink-faint sm:hidden">Original: </span>
        {original === null ? "No data" : format(original)}
      </p>
      <p className="text-[14px] font-semibold text-ink tabular-nums">
        <span className="text-[12px] font-normal text-ink-faint sm:hidden">Candidate: </span>
        {candidate === null ? "No data" : format(candidate)}
      </p>
      <div>
        {delta === null ? (
          <span className="text-[13px] text-ink-faint">Not comparable</span>
        ) : (
          <Badge tone={better ? "pass" : worse ? "danger" : "neutral"}>
            {delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${format(Math.abs(delta)).replace("%", " pts")}`}
          </Badge>
        )}
      </div>
    </div>
  );
}

function Comparison({ experiment, all }: { experiment: ExperimentDetail; all: ExperimentSummary[] }) {
  const counterparts = useMemo(
    () => comparableCounterparts(experiment, all).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [experiment, all],
  );
  const [chosen, setChosen] = useState<string>("");
  // keep the user's choice across polling refreshes; fall back to the most recent match
  useEffect(() => {
    if (!counterparts.some((c) => c.id === chosen)) setChosen(counterparts[0]?.id ?? "");
  }, [counterparts, chosen]);
  const other = useApiQuery(["experiment", chosen], () => api.experiment(chosen), { enabled: !!chosen });

  if (experiment.kind === "playground" || counterparts.length === 0) return null;

  const isBaseline = experiment.kind === "baseline";
  const original = isBaseline ? experiment : other.data;
  const candidate = isBaseline ? other.data : experiment;
  const mismatches = other.data ? configMismatches(experiment.config, other.data.config) : [];
  const rate = (m?: RateMetric) => (hasRate(m) ? m.rate : null);
  const fieldCount = (e?: ExperimentDetail) => (e?.metrics.field_exposure ? e.metrics.field_exposure.fields.length : null);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <GitCompareArrows aria-hidden size={18} className="text-accent" />
          Original policy compared with candidate
        </span>
      }
      description={`Only experiments with the same suite, dataset and split (${splitsLabel(experiment.splits)}) are offered.`}
      actions={
        counterparts.length > 1 ? (
          <label className="flex items-center gap-2 text-[13px] text-ink-muted">
            <span className="whitespace-nowrap">Compare with</span>
            <select className={cx(inputClass, "h-8 max-w-[260px]")} value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {counterparts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatDateTime(c.created_at)}
                </option>
              ))}
            </select>
          </label>
        ) : undefined
      }
    >
      {other.isLoading && <Skeleton lines={3} />}
      {other.isError && <ErrorState error={other.error} context="Could not load the comparison experiment" />}
      {other.data && mismatches.length > 0 && (
        <p className="text-[14px] text-warn">
          Not shown: the run configuration differs ({mismatches.map(humanize).join(", ")}), so a side-by-side would be
          misleading.
        </p>
      )}
      {other.data && original && candidate && mismatches.length === 0 && (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-line bg-surface-sunken/60 px-4 py-2 text-[12px] font-semibold tracking-wide text-ink-faint uppercase sm:grid">
            <span>Measure</span>
            <span>Original · v{original.policy_version ?? "?"}</span>
            <span>Candidate · v{candidate.policy_version ?? "?"}</span>
            <span>Observed change</span>
          </div>
          <CompareRow
            label="Legitimate tasks completed"
            original={rate(original.metrics.legit_completion)}
            candidate={rate(candidate.metrics.legit_completion)}
            lowerBetter={false}
            format={pct}
          />
          <CompareRow
            label="Unauthorized actions succeeded"
            original={rate(original.metrics.unauthorized_success)}
            candidate={rate(candidate.metrics.unauthorized_success)}
            lowerBetter
            format={pct}
          />
          <CompareRow
            label="Prohibited fields exposed"
            original={fieldCount(original)}
            candidate={fieldCount(candidate)}
            lowerBetter
            format={(v) => plural(v, "field")}
          />
        </div>
      )}
      {other.data && mismatches.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-faint">
          Original: <Mono>{original?.id}</Mono> · Candidate: <Mono>{candidate?.id}</Mono> · same model, temperature, step
          limit, contract, suite version and scenario count. Small suites: one scenario moves a rate by several points.
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */
function ProbeTable({ probes, note }: { probes: ProbeOut[]; note: string }) {
  if (probes.length === 0) return <EmptyState title="No permission probes were recorded for this experiment" />;
  const allowed = probes.filter((p) => p.decision === "allow");
  const allowedProhibited = allowed.filter((p) => !p.contract_permits);
  const deniedPermitted = probes.filter((p) => p.decision === "deny" && p.contract_permits);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-ink-muted">{note}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Probes allowed" value={`${allowed.length} / ${probes.length}`} />
        <Stat
          label="Allowed but prohibited by the contract"
          value={allowedProhibited.length}
          tone={allowedProhibited.length > 0 ? "danger" : "pass"}
        />
        <Stat
          label="Denied but permitted by the contract"
          value={deniedPermitted.length}
          tone={deniedPermitted.length > 0 ? "warn" : "pass"}
        />
      </div>
      <Table headers={["Probe", "Tool", "Category", "Decision", "Reason", "Contract"]} minWidth={720}>
        {probes.map((probe) => (
          <Row key={probe.id}>
            <Cell mono className="text-[12px]">{probe.probe_key}</Cell>
            <Cell mono>{probe.tool_name}</Cell>
            <Cell mono>{probe.category}</Cell>
            <Cell>
              <Badge tone={probe.decision === "allow" ? "accent" : "slate"}>{probe.decision}</Badge>
            </Cell>
            <Cell mono className="text-[12px]">{probe.reason_code}</Cell>
            <Cell>
              {probe.contract_permits ? (
                <Badge tone="neutral">permitted</Badge>
              ) : (
                <Badge tone={probe.decision === "allow" ? "danger" : "pass"}>prohibited</Badge>
              )}
            </Cell>
          </Row>
        ))}
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */
function RunsTable({ runs, onOpen }: { runs: ExperimentDetail["runs"]; onOpen: (id: string) => void }) {
  return (
    <Table headers={["Scenario", "Type", "Execution", "Outcome", <span className="sr-only">Actions</span>]} minWidth={760}>
      {runs.map((run) => {
        const execution = executionState(run);
        const outcomes = runOutcomes(run);
        return (
          <Row key={run.id} onClick={() => onOpen(run.id)} label={`Inspect run: ${run.scenario_title}`}>
            <Cell className="max-w-[340px] min-w-[240px]">
              <span className="block font-medium text-ink">{run.scenario_title}</span>
              <span className="block text-[13px] text-ink-muted">{categoryLabel(run.scenario_category)}</span>
            </Cell>
            <Cell>
              <Badge tone={run.scenario_kind === "adversarial" ? "warn" : "neutral"}>{kindLabel(run.scenario_kind)}</Badge>
            </Cell>
            <Cell>
              <Badge tone={execution.tone} title={execution.help}>
                {execution.label}
              </Badge>
              {run.error && (
                <div className="mt-1 max-w-[200px] truncate font-mono text-[12px] text-danger" title={run.error}>
                  {run.error}
                </div>
              )}
            </Cell>
            <Cell>
              <div className="flex max-w-[280px] flex-wrap gap-1">
                {outcomes.map((o) => (
                  <Badge key={o.label} tone={o.tone} title={o.help}>
                    {o.label}
                  </Badge>
                ))}
              </div>
            </Cell>
            <Cell className="text-right whitespace-nowrap">
              <span className="inline-flex items-center gap-1">
                {run.weave_call_url ? (
                  <a
                    href={run.weave_call_url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open Weave trace for ${run.scenario_title}`}
                    title="Open Weave trace"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-accent-strong hover:bg-accent-soft"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ExternalLink aria-hidden size={15} />
                  </a>
                ) : (
                  <span className="px-1 text-[12px] text-ink-faint" title={run.trace_status}>
                    {run.trace_status.startsWith("trace_failed") ? "Trace failed" : "Not traced"}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Search aria-hidden size={14} />}
                  onClick={() => onOpen(run.id)}
                  ariaLabel={`Inspect run: ${run.scenario_title}`}
                >
                  Inspect
                </Button>
              </span>
            </Cell>
          </Row>
        );
      })}
    </Table>
  );
}

/* ------------------------------------------------------------------ */
function ExperimentPicker({
  experiments,
  current,
  onSelect,
}: {
  experiments: ExperimentSummary[];
  current: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav aria-label="Experiments" className="min-w-0">
      <SectionLabel className="mb-2 px-1">
        Recent experiments ({experiments.length})
      </SectionLabel>
      <ul className="sf-scroll flex max-h-[42vh] flex-col gap-1.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-220px)]">
        {experiments.map((experiment) => {
          const selected = experiment.id === current;
          return (
            <li key={experiment.id}>
              <button
                type="button"
                onClick={() => onSelect(experiment.id)}
                aria-current={selected ? "true" : undefined}
                className={cx(
                  "w-full rounded-xl border px-3.5 py-2.5 text-left transition-[border-color,box-shadow] duration-150",
                  selected ? "border-accent/50 bg-surface shadow-raised ring-1 ring-accent/30" : "border-line bg-surface hover:border-line-strong hover:shadow-card",
                )}
              >
                <span className={cx("line-clamp-2 text-[14px] font-medium break-words", selected ? "text-accent-strong" : "text-ink")}>
                  {experiment.name}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
                  <Badge tone={experiment.kind === "baseline" ? "warn" : experiment.kind === "final_test" ? "accent" : "neutral"}>
                    {experimentKindLabel(experiment.kind)}
                  </Badge>
                  <span className="whitespace-nowrap">
                    Policy v{experiment.policy_version ?? "?"} · {splitsLabel(experiment.splits)}
                  </span>
                  {experiment.status !== "completed" && <Badge tone={statusTone(experiment.status)}>{experiment.status}</Badge>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 px-1 text-[12px] text-ink-faint">Showing the {experiments.length} most recent loaded from the server (limit 50).</p>
    </nav>
  );
}

export default function Experiments() {
  const [params, setParams] = useSearchParams();
  const experiments = useApiQuery(["experiments"], () => api.experiments(), { refetchInterval: 5000 });
  const [initialId, setInitialId] = useState<string | null>(null);
  const [tab, setTab] = useState("runs");
  const [openRun, setOpenRun] = useState<string | null>(null);

  useEffect(() => {
    if (!initialId && experiments.data?.length) setInitialId(experiments.data[0].id);
  }, [experiments.data, initialId]);

  const current = params.get("experiment") ?? initialId ?? experiments.data?.[0]?.id ?? null;
  const detail = useApiQuery(["experiment", current], () => api.experiment(current!), {
    enabled: !!current,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });

  if (experiments.isLoading) return <Loading label="Loading experiments" />;
  if (experiments.isError) return <ErrorState error={experiments.error} context="Could not load experiments" />;

  const failedRuns = (detail.data?.runs ?? []).filter(
    (r) => r.status !== "completed" || r.contract_violations.length > 0 || r.scores.legit_task_completed?.passed === false,
  );

  return (
    <Page>
      <PageHeader
        title="Experiments"
        description="What the tests discovered: every number comes from executed scenario runs stored in the workspace."
        actions={
          detail.data ? (
            <ButtonLink href={api.exportExperimentUrl(detail.data.id)} download icon={<Download aria-hidden size={16} />}>
              Export results (JSON)
            </ButtonLink>
          ) : undefined
        }
      />

      {!experiments.data?.length ? (
        <EmptyState
          title="No experiments yet"
          icon={<FlaskConical size={28} />}
          action={
            <Link to="/" className="text-[14px] font-medium text-accent-strong underline">
              Go to Workspace
            </Link>
          }
        >
          Run a baseline or start the improvement loop from the Workspace page. Results appear here as soon as scenarios
          finish executing.
        </EmptyState>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[272px_minmax(0,1fr)]">
          <div className="lg:sticky lg:top-8">
            <ExperimentPicker
              experiments={experiments.data}
              current={current}
              onSelect={(id) => {
                setParams({ experiment: id });
                setTab("runs");
              }}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            {detail.isLoading && (
              <Card>
                <Loading label="Loading experiment" />
                <Skeleton lines={4} />
              </Card>
            )}
            {detail.isError && <ErrorState error={detail.error} context="Could not load this experiment" />}
            {detail.data && (
              <div key={detail.data.id} className="animate-enter flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[20px] leading-tight font-semibold tracking-tight break-words text-ink">{detail.data.name}</h2>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-ink-muted">
                      <Badge tone={statusTone(detail.data.status)}>{humanize(detail.data.status)}</Badge>
                      <span>{experimentKindLabel(detail.data.kind)}</span>
                      <span aria-hidden>·</span>
                      <Link to={`/policies?policy=${detail.data.policy_id}`} className="text-accent-strong underline-offset-2 hover:underline">
                        Policy v{detail.data.policy_version ?? "?"}
                      </Link>
                      <span aria-hidden>·</span>
                      <span>{splitsLabel(detail.data.splits)} split</span>
                      <span aria-hidden>·</span>
                      <span>{plural(detail.data.run_count, "scenario run")}</span>
                    </p>
                  </div>
                  <Badge
                    tone={detail.data.integration_status?.traced_runs ? "pass" : "warn"}
                    title={detail.data.weave_project || undefined}
                  >
                    Weave: {String(detail.data.integration_status?.traced_runs ?? 0)} traced run(s)
                  </Badge>
                </div>

                {detail.data.error && <ErrorState error={detail.data.error} context="Experiment error" />}
                {(detail.data.integration_status as { weave?: { error?: string } })?.weave?.error && (
                  <ErrorState
                    error={(detail.data.integration_status as { weave: { error: string } }).weave.error}
                    context="Tracing failed for this experiment"
                  />
                )}
                {detail.data.status === "running" && (
                  <p className="flex items-center gap-2 text-[14px] text-ink-muted" role="status">
                    Still running. Measures update as scenario runs finish.
                  </p>
                )}

                <PrimaryMeasures metrics={detail.data.metrics ?? {}} />
                <MoreMetrics metrics={detail.data.metrics ?? {}} />
                <Comparison experiment={detail.data} all={experiments.data} />

                <Card>
                  <div className="flex flex-col gap-4">
                    <Tabs
                      idBase="experiment"
                      label="Experiment sections"
                      tabs={[
                        { key: "runs", label: "All runs", count: detail.data.runs.length },
                        { key: "failures", label: "Failures and violations", count: failedRuns.length },
                        { key: "probes", label: "Permission probes", count: detail.data.probes.length },
                        { key: "config", label: "Configuration" },
                      ]}
                      active={tab}
                      onSelect={setTab}
                    />

                    {(tab === "runs" || tab === "failures") && (
                      <TabPanel idBase="experiment" tabKey={tab}>
                        {tab === "failures" && (
                          <p className="text-[14px] text-ink-muted">
                            Runs that failed to execute, recorded a contract violation, or did not complete a normal request.
                          </p>
                        )}
                        {(tab === "runs" ? detail.data.runs : failedRuns).length === 0 ? (
                          <EmptyState title={tab === "failures" ? "No failures or violations in this experiment" : "No runs recorded yet"} />
                        ) : (
                          <RunsTable runs={tab === "runs" ? detail.data.runs : failedRuns} onOpen={setOpenRun} />
                        )}
                        {tab === "runs" && detail.data.metrics.by_category && Object.keys(detail.data.metrics.by_category).length > 0 && (
                          <Disclosure summary="Per-category outcomes">
                            <Table headers={["Category", "Type", "Runs", "Completed", "Unauthorized", "Blocked", "Failed"]}>
                              {Object.entries(detail.data.metrics.by_category).map(([category, row]) => (
                                <Row key={category}>
                                  <Cell>
                                    {categoryLabel(category)}
                                    <div className="font-mono text-[12px] text-ink-faint">{category}</div>
                                  </Cell>
                                  <Cell>{kindLabel(row.kind)}</Cell>
                                  <Cell mono>{row.runs}</Cell>
                                  <Cell mono>{row.completed}</Cell>
                                  <Cell mono className={row.unauthorized > 0 ? "text-danger" : undefined}>
                                    {row.unauthorized}
                                  </Cell>
                                  <Cell mono>{row.blocked}</Cell>
                                  <Cell mono>{row.failed}</Cell>
                                </Row>
                              ))}
                            </Table>
                          </Disclosure>
                        )}
                      </TabPanel>
                    )}

                    {tab === "probes" && (
                      <TabPanel idBase="experiment" tabKey="probes">
                        <ProbeTable probes={detail.data.probes} note={detail.data.probe_note} />
                      </TabPanel>
                    )}

                    {tab === "config" && (
                      <TabPanel idBase="experiment" tabKey="config">
                        <KeyValue
                          items={[
                            ["Experiment id", <Mono>{detail.data.id}</Mono>],
                            ["Kind", <Mono>{detail.data.kind}</Mono>],
                            ["Suite", <Mono>{detail.data.suite_id}</Mono>],
                            ["Dataset", <Mono>{detail.data.dataset_id}</Mono>],
                            ["Policy", <Mono>{detail.data.policy_id}</Mono>],
                            ["Job", <Mono>{detail.data.job_id ?? "—"}</Mono>],
                            ["Iteration", String(detail.data.iteration)],
                            ["Created", formatDateTime(detail.data.created_at)],
                            ["Finished", formatDateTime(detail.data.finished_at)],
                            ["Weave project", detail.data.weave_project ? <Mono>{detail.data.weave_project}</Mono> : "—"],
                          ]}
                        />
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="min-w-0">
                            <SectionLabel className="mb-1">Run configuration</SectionLabel>
                            <Code value={detail.data.config} maxHeight={280} />
                          </div>
                          <div className="min-w-0">
                            <SectionLabel className="mb-1">Integration status</SectionLabel>
                            <Code value={detail.data.integration_status} maxHeight={280} />
                          </div>
                        </div>
                      </TabPanel>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}

      <RunDrawer runId={openRun} onClose={() => setOpenRun(null)} />
    </Page>
  );
}
