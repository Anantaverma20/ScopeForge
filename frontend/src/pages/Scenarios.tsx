import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ListChecks, Lock } from "lucide-react";
import { api, useApiQuery } from "../api/client";
import RunDrawer from "../components/RunDrawer";
import {
  Badge,
  Button,
  Card,
  Cell,
  Code,
  Disclosure,
  Drawer,
  EmptyState,
  ErrorState,
  InfoTip,
  KeyValue,
  Loading,
  Mono,
  Page,
  PageHeader,
  Row,
  SectionLabel,
  Segmented,
  Skeleton,
  Table,
  cx,
  inputClass,
  statusTone,
} from "../components/ui";
import { SPLIT_HELP, categoryLabel, kindLabel, splitLabel } from "../lib/present";

const SPLITS = ["dev", "validation", "test"] as const;

export default function Scenarios() {
  const suites = useApiQuery(["suites"], () => api.suites());
  const [suiteId, setSuiteId] = useState<string | null>(null);
  const [split, setSplit] = useState("all");
  const [kind, setKind] = useState("all");
  const [openScenario, setOpenScenario] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);

  // keep the last scenario visible while its drawer animates closed
  const lastScenario = useRef<string | null>(null);
  useEffect(() => {
    if (openScenario) lastScenario.current = openScenario;
  }, [openScenario]);
  const shownScenario = openScenario ?? lastScenario.current;

  const selectedSuite = suiteId ?? suites.data?.[0]?.id ?? null;
  const scenarios = useApiQuery(["scenarios", selectedSuite], () => api.scenarios(selectedSuite!), {
    enabled: !!selectedSuite,
  });
  const detail = useApiQuery(["scenario", shownScenario], () => api.scenario(shownScenario!), {
    enabled: !!shownScenario,
  });
  const runs = useApiQuery(["runs", "scenario", shownScenario], () => api.runs(shownScenario!), {
    enabled: !!shownScenario,
  });

  const rows = scenarios.data ?? [];
  const filtered = useMemo(
    () => rows.filter((s) => (split === "all" || s.split === split) && (kind === "all" || s.kind === kind)),
    [rows, split, kind],
  );
  const countBy = (predicate: (s: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;

  if (suites.isLoading) return <Loading label="Loading suites" />;
  if (suites.isError) return <ErrorState error={suites.error} context="Could not load scenario suites" />;
  if (!suites.data?.length)
    return (
      <Page>
        <PageHeader title="Scenarios" description="A frozen library of normal requests and attack tests." />
        <EmptyState
          title="No scenario suite yet"
          icon={<ListChecks size={28} />}
          action={
            <Link to="/" className="text-[14px] font-medium text-accent-strong underline">
              Go to Workspace
            </Link>
          }
        >
          Generate a dataset and a scenario suite from the Workspace page first.
        </EmptyState>
      </Page>
    );

  const suite = suites.data.find((s) => s.id === selectedSuite);
  const normalCount = countBy((s) => s.kind === "legitimate");
  const attackCount = countBy((s) => s.kind === "adversarial");
  const unrun = countBy((s) => s.run_count === 0);

  return (
    <Page>
      <PageHeader
        title="Scenarios"
        description="The test library: normal requests and attack tests, each bound to real synthetic records and a signed-in customer."
        actions={
          <label className="flex min-w-0 flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-muted">Scenario suite</span>
            <select
              className={cx(inputClass, "max-w-sm")}
              value={selectedSuite ?? ""}
              onChange={(event) => setSuiteId(event.target.value)}
              aria-label="Scenario suite"
            >
              {suites.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (v{s.version}) · {s.counts.total ?? 0} scenarios · {s.id}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {suite && (
        <Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-semibold text-ink">
                  {suite.name}
                  {suite.frozen && (
                    <Badge tone="neutral" icon={<Lock aria-hidden size={11} />} title="Frozen: new attacks create a new suite version">
                      Frozen
                    </Badge>
                  )}
                  {suite.counts.model_written ? <Badge tone="warn">{suite.counts.model_written} model-written</Badge> : null}
                </h2>
                <p className="mt-0.5 text-[14px] text-ink-muted">
                  {suite.counts.total ?? rows.length} scenarios · {normalCount} normal requests · {attackCount} attack tests
                  {scenarios.data && unrun > 0 && <> · {unrun} not run yet</>}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {SPLITS.map((key) => (
                <div key={key} className="rounded-xl border border-line bg-surface-sunken/50 px-4 py-3">
                  <p className="flex items-center gap-1 text-[13px] font-medium text-ink-muted">
                    {splitLabel(key)}
                    <InfoTip label={`${splitLabel(key)} split`}>{SPLIT_HELP[key]}</InfoTip>
                  </p>
                  <p className="text-[22px] font-semibold text-ink tabular-nums">{suite.counts.by_split?.[key] ?? 0}</p>
                  <p className="text-[12px] text-ink-faint">{SPLIT_HELP[key].split(".")[0]}.</p>
                </div>
              ))}
            </div>
            <Disclosure summary="Suite details">
              <KeyValue
                items={[
                  ["Suite id", <Mono>{suite.id}</Mono>],
                  ["Dataset", <Mono>{suite.dataset_id}</Mono>],
                  ["Contract", <Mono>{suite.contract_version}</Mono>],
                  ["Created", new Date(suite.created_at).toLocaleString()],
                  [
                    "By category",
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(suite.counts.by_category ?? {}).map(([key, value]) => (
                        <Badge key={key} tone="neutral" title={key}>
                          {categoryLabel(key)}: {value}
                        </Badge>
                      ))}
                    </span>,
                  ],
                ]}
              />
            </Disclosure>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Scenario type"
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: "All", count: rows.length },
                { value: "legitimate", label: "Normal requests", count: normalCount },
                { value: "adversarial", label: "Attack tests", count: attackCount },
              ]}
            />
            <Segmented
              label="Split"
              value={split}
              onChange={setSplit}
              options={[
                { value: "all", label: "All splits" },
                { value: "dev", label: "Development", count: countBy((s) => s.split === "dev") },
                { value: "validation", label: "Validation", count: countBy((s) => s.split === "validation") },
                { value: "test", label: "Held-out test", count: countBy((s) => s.split === "test") },
              ]}
            />
          </div>
          <p className="text-[13px] text-ink-faint" role="status">
            Showing {filtered.length} of {rows.length} scenarios. Filters apply to every scenario in this suite.
          </p>

          {scenarios.isLoading ? (
            <Skeleton lines={5} />
          ) : scenarios.isError ? (
            <ErrorState error={scenarios.error} context="Could not load scenarios" />
          ) : filtered.length === 0 ? (
            <EmptyState title="No scenarios match these filters">Choose All to see every scenario in the suite.</EmptyState>
          ) : (
            <Table headers={["Scenario", "Type", "Split", "Runs", <span className="sr-only">Actions</span>]} minWidth={640}>
              {filtered.map((scenario) => (
                <Row key={scenario.id} onClick={() => setOpenScenario(scenario.id)} label={`Open scenario: ${scenario.title}`}>
                  <Cell className="min-w-[260px]">
                    <span className="block font-medium text-ink">{scenario.title}</span>
                    <span className="block text-[13px] text-ink-muted">
                      {categoryLabel(scenario.category)} · as {scenario.customer_name}
                    </span>
                  </Cell>
                  <Cell>
                    <Badge tone={scenario.kind === "adversarial" ? "warn" : "neutral"}>{kindLabel(scenario.kind)}</Badge>
                  </Cell>
                  <Cell>
                    <span className="text-[14px] whitespace-nowrap text-ink">{splitLabel(scenario.split)}</span>
                  </Cell>
                  <Cell>
                    {scenario.run_count === 0 ? (
                      <span className="text-[13px] whitespace-nowrap text-ink-faint">Not run yet</span>
                    ) : (
                      <span className="tabular-nums">{scenario.run_count}</span>
                    )}
                  </Cell>
                  <Cell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setOpenScenario(scenario.id)}
                      ariaLabel={`Details for ${scenario.title}`}
                    >
                      Details <ChevronRight aria-hidden size={14} />
                    </Button>
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
      </Card>

      <Drawer
        open={!!openScenario}
        onClose={() => setOpenScenario(null)}
        title={detail.data?.title ?? "Scenario"}
        subtitle={
          detail.data
            ? `${kindLabel(detail.data.kind)} · ${categoryLabel(detail.data.category)} · ${splitLabel(detail.data.split)} split`
            : ""
        }
      >
        {detail.isLoading && (
          <Card>
            <Loading />
            <Skeleton lines={3} />
          </Card>
        )}
        {detail.isError && <ErrorState error={detail.error} />}
        {detail.data && (
          <>
            <Card title="What the agent receives">
              <div className="flex flex-col gap-3">
                <p className="rounded-lg border border-line bg-surface-sunken/70 p-3 text-[14px] leading-relaxed whitespace-pre-wrap">
                  {detail.data.user_message}
                </p>
                {detail.data.injected_ticket_body && (
                  <div>
                    <SectionLabel className="mb-1 text-warn">Attached ticket (untrusted surface)</SectionLabel>
                    <p className="rounded-lg border border-warn/25 bg-warn-soft p-3 text-[14px] whitespace-pre-wrap">
                      {detail.data.injected_ticket_body}
                    </p>
                  </div>
                )}
                {detail.data.tool_note_injection && (
                  <div>
                    <SectionLabel className="mb-1 text-warn">Note attached to tool responses (untrusted surface)</SectionLabel>
                    <p className="rounded-lg border border-warn/25 bg-warn-soft p-3 text-[14px] whitespace-pre-wrap">
                      {detail.data.tool_note_injection}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            <Card title="Trusted actor and target" description="Established by the server, not by the message.">
              <KeyValue
                items={[
                  ["Signed-in customer", detail.data.customer_name],
                  ["Customer id", <Mono>{detail.data.authenticated_customer_id}</Mono>],
                  ["Store (tenant)", <Mono>{detail.data.tenant_id}</Mono>],
                  ["Target order", <Mono>{detail.data.target_order_id ?? "—"}</Mono>],
                  ["Foreign target", <Mono>{detail.data.target_foreign_customer_id ?? "—"}</Mono>],
                ]}
              />
            </Card>

            <Card title={`Executions (${runs.data?.length ?? 0})`}>
              {runs.isLoading ? (
                <Loading />
              ) : runs.isError ? (
                <ErrorState error={runs.error} context="Could not load executions" />
              ) : (runs.data?.length ?? 0) === 0 ? (
                <EmptyState title="This scenario has not been run yet">
                  Start a baseline run or an improvement loop from the Workspace page.
                </EmptyState>
              ) : (
                <Table headers={["Run", "Execution", "Tool calls", "Denied", "Violations", ""]} minWidth={600}>
                  {(runs.data ?? []).map((run) => (
                    <Row key={run.id}>
                      <Cell mono className="text-[12px]">
                        {run.id}
                        <div className="text-ink-faint">{run.experiment_id}</div>
                      </Cell>
                      <Cell>
                        <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                      </Cell>
                      <Cell mono>{run.tool_event_count}</Cell>
                      <Cell mono>{run.denied_count}</Cell>
                      <Cell>
                        {run.contract_violations.length > 0 ? (
                          <Badge tone="danger">{run.contract_violations.length}</Badge>
                        ) : (
                          <span className="text-[13px] text-ink-muted">0</span>
                        )}
                      </Cell>
                      <Cell className="text-right">
                        <Button size="sm" variant="secondary" onClick={() => setOpenRun(run.id)}>
                          Evidence
                        </Button>
                      </Cell>
                    </Row>
                  ))}
                </Table>
              )}
            </Card>

            <Card title="Expected outcome" description={detail.data.expectations_note}>
              <Code value={detail.data.expectations} maxHeight={240} />
            </Card>

            <Card title="Technical details">
              <KeyValue
                items={[
                  ["Scenario id", <Mono>{detail.data.id}</Mono>],
                  ["Key", <Mono>{detail.data.key}</Mono>],
                  ["Kind", <Mono>{detail.data.kind}</Mono>],
                  ["Category", <Mono>{detail.data.category}</Mono>],
                  ["Split", <Mono>{detail.data.split}</Mono>],
                  ["Suite", <Mono>{detail.data.suite_id}</Mono>],
                  ["Generated by", `${detail.data.generated_by}${detail.data.source_model ? ` · ${detail.data.source_model}` : ""}`],
                  ["Ticket injection", detail.data.has_ticket_injection ? "Yes" : "No"],
                  ["Tool-note injection", detail.data.has_tool_note_injection ? "Yes" : "No"],
                ]}
              />
            </Card>
          </>
        )}
      </Drawer>

      <RunDrawer runId={openRun} onClose={() => setOpenRun(null)} />
    </Page>
  );
}
