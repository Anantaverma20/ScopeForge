import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Database,
  FlaskConical,
  KeyRound,
  ListChecks,
  MessagesSquare,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, useApiMutation, useApiQuery } from "../api/client";
import { JobPanel } from "../components/JobPanel";
import {
  Badge,
  Button,
  Callout,
  Card,
  Cell,
  Disclosure,
  ErrorState,
  Field,
  Loading,
  Mono,
  NumberInput,
  Page,
  PageHeader,
  Row,
  Table,
  buttonClass,
  cx,
  inputClass,
  statusTone,
} from "../components/ui";
import { acceptanceState, formatDateTime, humanize, policyDisplayName, splitLabel } from "../lib/present";
import type { WorkspaceState, WorkspaceStep } from "../types/api";

type CheckItem = { key: string; label: string; done: boolean; detail: string; blocked?: string };

function checklist(state: WorkspaceState): CheckItem[] {
  const step = (key: string): WorkspaceStep | undefined => state.steps.find((s) => s.key === key);
  const candidate = state.latest_candidate;
  const evaluated = !!candidate?.decision;
  return [
    {
      key: "dataset",
      label: "Dataset available",
      done: !!step("dataset")?.done && !!state.dataset,
      detail: step("dataset")?.detail || "No synthetic dataset yet.",
      blocked: step("dataset")?.blocked_reason,
    },
    {
      key: "suite",
      label: "Scenario suite available",
      done: !!step("suite")?.done && !!state.suite,
      detail: step("suite")?.detail || "No scenario suite yet.",
      blocked: step("suite")?.blocked_reason,
    },
    {
      key: "baseline",
      label: "Baseline completed",
      done: !!step("baseline")?.done,
      detail: step("baseline")?.detail || "The permissive baseline has not been run.",
      blocked: step("baseline")?.blocked_reason,
    },
    {
      key: "candidate",
      label: "Candidate evaluated",
      done: evaluated,
      detail: candidate
        ? `Policy v${candidate.version}: ${evaluated ? acceptanceState(candidate).label.toLowerCase() : "no decision recorded"}${candidate.decision_reason ? ` - ${candidate.decision_reason}` : ""}`
        : step("improve")?.detail || "No candidate policy yet.",
      blocked: step("improve")?.blocked_reason,
    },
    {
      key: "activate",
      label: "Policy activated in playground",
      done: !!state.active_policy,
      detail: state.active_policy
        ? `Policy v${state.active_policy.version} is active`
        : step("activate")?.detail || "Nothing is active. The playground stays disabled until you activate an approved policy.",
      blocked: step("activate")?.blocked_reason,
    },
  ];
}

function ChecklistRow({ item, index, isNext, isLast }: { item: CheckItem; index: number; isNext: boolean; isLast: boolean }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!isLast && <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-line" />}
      <span
        aria-hidden
        className={cx(
          "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold",
          item.done
            ? "border-pass bg-pass text-white"
            : isNext
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-line-strong bg-surface text-ink-faint",
        )}
      >
        {item.done ? <Check size={14} strokeWidth={3} /> : index + 1}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
          {item.label}
          <span className="sr-only">{item.done ? "(complete)" : "(not complete)"}</span>
          {isNext && <Badge tone="accent">Next</Badge>}
        </p>
        <p className="text-[13px] break-words text-ink-muted">{item.detail}</p>
        {item.blocked && <p className="text-[13px] text-warn">{item.blocked}</p>}
      </div>
    </li>
  );
}

function PipelineRow({
  icon,
  title,
  status,
  actions,
  options,
  children,
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  actions: ReactNode;
  options?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted">
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            <div className="text-[13px] break-words text-ink-muted">{status}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {children}
      {options && (
        <Disclosure summary="Options" className="sm:pl-12">
          {options}
        </Disclosure>
      )}
    </div>
  );
}

export default function Workspace() {
  const workspace = useApiQuery(["workspace"], api.workspace, { refetchInterval: 5000 });
  const datasets = useApiQuery(["datasets"], api.datasets);
  const settings = useApiQuery(["settings"], api.settings);

  const [seed, setSeed] = useState(20260101);
  const [merchants, setMerchants] = useState(3);
  const [customers, setCustomers] = useState(10);
  const [legit, setLegit] = useState(8);
  const [attacks, setAttacks] = useState(8);
  const [iterations, setIterations] = useState(2);
  const [useMcp, setUseMcp] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const createDataset = useApiMutation(() =>
    api.createDataset({
      merchants,
      customers_per_merchant: customers,
      orders_per_customer_max: settings.data?.runtime.generation.orders_per_customer_max ?? 4,
      products_per_merchant: settings.data?.runtime.generation.products_per_merchant ?? 12,
      tickets_per_merchant: settings.data?.runtime.generation.tickets_per_merchant ?? 10,
      seed,
    }),
  );
  const createSuite = useApiMutation((datasetId: string) =>
    api.createSuite({ dataset_id: datasetId, legitimate_cases: legit, adversarial_cases: attacks }),
  );
  const startBaseline = useApiMutation((suiteId: string) =>
    api.startBaseline({ suite_id: suiteId, splits: ["dev", "validation"] }),
  );
  const startAdversary = useApiMutation((suiteId: string) => api.startAdversary({ suite_id: suiteId }));
  const startImprovement = useApiMutation((suiteId: string) =>
    api.startImprovement({ suite_id: suiteId, max_iterations: iterations, use_mcp: useMcp }),
  );
  const activate = useApiMutation((policyId: string) => api.activatePolicy(policyId));

  if (workspace.isLoading) return <Loading label="Loading workspace" />;
  if (workspace.isError)
    return <ErrorState error={workspace.error} context="The backend is not reachable. Is it running on port 8787?" />;

  const state = workspace.data!;
  const credentialsMissing = !state.integrations.find((i) => i.name === "llm")?.configured;
  const runningJobs = state.active_jobs;
  const candidate = state.latest_candidate;
  const items = checklist(state);
  const nextIndex = items.findIndex((i) => !i.done);
  const next = nextIndex >= 0 ? items[nextIndex] : null;

  const runDataset = () => createDataset.mutate(undefined as never);
  const runSuite = () => state.dataset && createSuite.mutate(state.dataset.id);
  const runBaseline = () =>
    state.suite && startBaseline.mutate(state.suite.id, { onSuccess: (job) => setActiveJobId(job.id) });
  const runImprovement = () =>
    state.suite && startImprovement.mutate(state.suite.id, { onSuccess: (job) => setActiveJobId(job.id) });
  const runAdversary = () =>
    state.suite && startAdversary.mutate(state.suite.id, { onSuccess: (job) => setActiveJobId(job.id) });

  /* contextual next step - every button calls an existing handler, and only on click */
  let nextAction: { title: string; body: string; action: ReactNode };
  const needsKey = (label: string) => (credentialsMissing ? `${label} needs WANDB_API_KEY` : undefined);
  switch (next?.key) {
    case "dataset":
      nextAction = {
        title: "Generate a synthetic dataset",
        body: "Merchants, customers, orders and tickets, generated locally from a seed. No model calls.",
        action: (
          <Button onClick={runDataset} loading={createDataset.isPending} disabled={createDataset.isPending} icon={<Database aria-hidden size={16} />}>
            Generate dataset
          </Button>
        ),
      };
      break;
    case "suite":
      nextAction = {
        title: "Generate a scenario suite",
        body: "Normal requests and attack tests bound to the dataset, split by customer. No model calls.",
        action: (
          <Button onClick={runSuite} loading={createSuite.isPending} disabled={!state.dataset || createSuite.isPending} icon={<ListChecks aria-hidden size={16} />}>
            Generate suite
          </Button>
        ),
      };
      break;
    case "baseline":
      nextAction = {
        title: "Run the permissive baseline",
        body: "Measures what an unscoped agent can reach. Runs the agent with real model calls on the development and validation splits.",
        action: (
          <Button
            onClick={runBaseline}
            loading={startBaseline.isPending}
            disabled={!state.suite || credentialsMissing || startBaseline.isPending}
            title={needsKey("Agent runs")}
            icon={<Play aria-hidden size={16} />}
          >
            Run baseline
          </Button>
        ),
      };
      break;
    case "candidate":
      nextAction = {
        title: "Start the improvement loop",
        body: "The policy designer reads real failures, proposes a narrower policy, and the candidate is re-evaluated against the acceptance gates.",
        action: (
          <Button
            onClick={runImprovement}
            loading={startImprovement.isPending}
            disabled={!state.suite || credentialsMissing || startImprovement.isPending}
            title={needsKey("The policy designer")}
            icon={<Sparkles aria-hidden size={16} />}
          >
            Start improvement loop
          </Button>
        ),
      };
      break;
    case "activate":
      nextAction = candidate?.activation_eligible
        ? {
            title: `Activate Policy v${candidate.version} in the playground`,
            body: "This candidate passed the configured acceptance gates. Nothing is activated automatically.",
            action: (
              <div className="flex flex-wrap gap-2">
                <Link to={`/policies?policy=${candidate.id}`} className={buttonClass("secondary")}>
                  Review first
                </Link>
                <Button
                  onClick={() => activate.mutate(candidate.id)}
                  loading={activate.isPending}
                  disabled={candidate.is_active_playground || activate.isPending}
                  icon={<Play aria-hidden size={16} />}
                >
                  Activate in playground
                </Button>
              </div>
            ),
          }
        : {
            title: "Review the candidate policy",
            body: "No candidate is eligible for activation. Activating one that did not pass requires a recorded override on the Policies page.",
            action: (
              <Link to={candidate ? `/policies?policy=${candidate.id}` : "/policies"} className={buttonClass("primary")}>
                Open Policies <ArrowRight aria-hidden size={16} />
              </Link>
            ),
          };
      break;
    default:
      nextAction = {
        title: "Everything is in place",
        body: state.active_policy
          ? `Policy v${state.active_policy.version} is active. Try normal requests and attacks in the playground.`
          : "All steps are complete.",
        action: (
          <div className="flex flex-wrap gap-2">
            {state.active_policy && (
              <Link to={`/policies?policy=${state.active_policy.id}`} className={buttonClass("secondary")}>
                Review policy
              </Link>
            )}
            <Link to="/playground" className={buttonClass("primary")}>
              <MessagesSquare aria-hidden size={16} /> Open playground
            </Link>
          </div>
        ),
      };
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <Page>
      <PageHeader
        title="Workspace"
        description="Test a customer-support agent against normal requests and attacks, narrow what it may do, and re-measure."
      />

      {credentialsMissing && (
        <Callout tone="warn" role="alert" icon={<KeyRound size={18} />} title="No W&B credentials configured">
          Dataset generation, scenario suites and the deterministic permission probes work without credentials. Agent runs,
          the adversary and the policy designer all need real model calls: add <code className="font-mono">WANDB_API_KEY</code>{" "}
          to <code className="font-mono">.env</code> and restart the backend. See Settings for the full list.
        </Callout>
      )}

      {runningJobs.map((job) => (
        <JobPanel key={job.id} jobId={job.id} />
      ))}
      {activeJobId && !runningJobs.some((j) => j.id === activeJobId) && (
        <JobPanel jobId={activeJobId} onDismiss={() => setActiveJobId(null)} />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* next step */}
          <section
            aria-labelledby="next-step"
            className="rounded-2xl border border-accent/25 bg-surface p-5 shadow-card"
          >
            <p className="text-[12px] font-semibold tracking-wide text-accent-strong uppercase">
              {next ? `Next step · ${nextIndex + 1} of ${items.length}` : "All steps complete"}
            </p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0 max-w-xl">
                <h2 id="next-step" className="text-[20px] leading-tight font-semibold tracking-tight text-ink">
                  {nextAction.title}
                </h2>
                <p className="mt-1 text-[14px] text-ink-muted">{nextAction.body}</p>
              </div>
              {nextAction.action}
            </div>
            {activate.isError && (
              <div className="mt-3">
                <ErrorState error={activate.error} context="Activation refused" />
              </div>
            )}
          </section>

          {/* current state */}
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: "Dataset",
                icon: <Database aria-hidden size={16} />,
                value: state.dataset ? state.dataset.name : "None yet",
                sub: state.dataset
                  ? `${state.dataset.counts.customers ?? 0} customers · ${state.dataset.counts.orders ?? 0} orders · ${state.dataset.counts.merchants ?? 0} merchants`
                  : "Generate one to begin",
              },
              {
                label: "Scenario suite",
                icon: <ListChecks aria-hidden size={16} />,
                value: state.suite ? `${state.suite.counts.total ?? 0} scenarios` : "None yet",
                sub: state.suite
                  ? Object.entries(state.suite.counts.by_split ?? {})
                      .map(([split, count]) => `${splitLabel(split)} ${count}`)
                      .join(" · ")
                  : "Needs a dataset",
                link: state.suite ? "/scenarios" : undefined,
              },
              {
                label: "Latest experiment",
                icon: <FlaskConical aria-hidden size={16} />,
                value: state.latest_experiment ? state.latest_experiment.name : "None yet",
                sub: state.latest_experiment
                  ? `${humanize(state.latest_experiment.status)} · ${state.latest_experiment.run_count} scenario runs`
                  : "Run the baseline",
                link: state.latest_experiment ? `/experiments?experiment=${state.latest_experiment.id}` : undefined,
              },
              {
                label: "Active in playground",
                icon: <ShieldCheck aria-hidden size={16} />,
                value: state.active_policy ? `Policy v${state.active_policy.version}` : "Nothing active",
                sub: state.active_policy
                  ? `${policyDisplayName(state.active_policy)} · ${state.active_policy.rule_count} rules`
                  : "The playground is disabled until a policy is activated",
                link: state.active_policy ? `/policies?policy=${state.active_policy.id}` : undefined,
              },
            ].map((tile) => {
              const body = (
                <>
                  <p className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
                    {tile.icon}
                    {tile.label}
                  </p>
                  <p className="mt-1 truncate text-[16px] font-semibold text-ink" title={tile.value}>
                    {tile.value}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-muted">{tile.sub}</p>
                </>
              );
              return tile.link ? (
                <Link
                  key={tile.label}
                  to={tile.link}
                  className="block min-w-0 rounded-xl border border-line bg-surface px-4 py-3 shadow-card transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-raised"
                >
                  {body}
                </Link>
              ) : (
                <div key={tile.label} className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
                  {body}
                </div>
              );
            })}
          </div>

          {/* all controls */}
          <Card title="Pipeline controls" description="Every generation and run control. Nothing here runs until you click it.">
            <PipelineRow
              icon={<Database size={18} />}
              title="Synthetic dataset"
              status={
                state.dataset ? (
                  <>
                    Current: <span className="font-medium text-ink">{state.dataset.name}</span> ·{" "}
                    {Object.entries(state.dataset.counts)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(", ")}
                  </>
                ) : (
                  "Merchants, customers, orders, products and support tickets, generated locally from a seed."
                )
              }
              actions={
                <Button
                  variant={next?.key === "dataset" ? "primary" : "secondary"}
                  size="sm"
                  onClick={runDataset}
                  disabled={createDataset.isPending}
                  loading={createDataset.isPending}
                >
                  {createDataset.isPending ? "Generating…" : "Generate dataset"}
                </Button>
              }
              options={
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Merchants (tenants)">
                      <NumberInput value={merchants} onChange={setMerchants} min={2} max={20} />
                    </Field>
                    <Field label="Customers per merchant">
                      <NumberInput value={customers} onChange={setCustomers} min={2} max={200} />
                    </Field>
                    <Field label="Seed" hint="Same seed, same records">
                      <NumberInput value={seed} onChange={setSeed} />
                    </Field>
                  </div>
                  {datasets.data && datasets.data.length > 1 && (
                    <Disclosure summary="Earlier dataset versions" meta={datasets.data.length - 1}>
                      <Table headers={["Version", "Name", "Seed", "Counts", "Created"]}>
                        {datasets.data.slice(1).map((dataset) => (
                          <Row key={dataset.id}>
                            <Cell mono>v{dataset.version}</Cell>
                            <Cell>{dataset.name}</Cell>
                            <Cell mono>{dataset.seed}</Cell>
                            <Cell mono>{dataset.counts.orders ?? 0} orders</Cell>
                            <Cell className="text-[13px] whitespace-nowrap">{formatDateTime(dataset.created_at)}</Cell>
                          </Row>
                        ))}
                      </Table>
                    </Disclosure>
                  )}
                </div>
              }
            >
              {createDataset.isError && <ErrorState error={createDataset.error} context="Dataset generation failed" />}
            </PipelineRow>

            <PipelineRow
              icon={<ListChecks size={18} />}
              title="Scenario suite"
              status={
                state.suite ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span>
                      Current: <span className="font-medium text-ink">{state.suite.name}</span> ·{" "}
                      {state.suite.counts.total ?? 0} scenarios
                    </span>
                    {Object.entries(state.suite.counts.by_split ?? {}).map(([split, count]) => (
                      <Badge key={split} tone="neutral" title={split}>
                        {splitLabel(split)}: {count}
                      </Badge>
                    ))}
                    {state.suite.frozen && <Badge tone="accent">frozen</Badge>}
                  </span>
                ) : (
                  "Normal requests and attack tests bound to the dataset, split by customer into development, validation and test."
                )
              }
              actions={
                <>
                  {state.suite && (
                    <Link to="/scenarios" className={buttonClass("ghost", "sm")}>
                      Inspect
                    </Link>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={runAdversary}
                    disabled={!state.suite || credentialsMissing || startAdversary.isPending}
                    loading={startAdversary.isPending}
                    title={
                      credentialsMissing
                        ? "The adversary writes attack text with a real model call, which needs WANDB_API_KEY"
                        : "Creates a new suite version containing model-written attacks"
                    }
                  >
                    Add model-written attacks
                  </Button>
                  <Button
                    variant={next?.key === "suite" ? "primary" : "secondary"}
                    size="sm"
                    onClick={runSuite}
                    disabled={!state.dataset || createSuite.isPending}
                    loading={createSuite.isPending}
                    title={state.dataset ? undefined : "Generate a dataset first"}
                  >
                    {createSuite.isPending ? "Generating…" : "Generate suite"}
                  </Button>
                </>
              }
              options={
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Legitimate cases">
                    <NumberInput value={legit} onChange={setLegit} min={1} max={60} />
                  </Field>
                  <Field label="Adversarial cases">
                    <NumberInput value={attacks} onChange={setAttacks} min={0} max={60} />
                  </Field>
                </div>
              }
            >
              {createSuite.isError && <ErrorState error={createSuite.error} context="Suite generation failed" />}
              {startAdversary.isError && <ErrorState error={startAdversary.error} context="Could not start the adversary" />}
            </PipelineRow>

            <PipelineRow
              icon={<FlaskConical size={18} />}
              title="Baseline and improvement loop"
              status={
                state.latest_experiment ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    Latest: <span className="font-medium text-ink">{state.latest_experiment.name}</span>
                    <Badge tone={statusTone(state.latest_experiment.status)}>{state.latest_experiment.status}</Badge>
                    <span>{state.latest_experiment.run_count} scenario runs</span>
                  </span>
                ) : (
                  "The baseline is an explicitly labelled permissive policy. It is never eligible for activation."
                )
              }
              actions={
                <>
                  <Button
                    variant={next?.key === "candidate" ? "primary" : "secondary"}
                    size="sm"
                    onClick={runImprovement}
                    disabled={!state.suite || credentialsMissing || startImprovement.isPending}
                    loading={startImprovement.isPending}
                    title={credentialsMissing ? "The policy designer needs WANDB_API_KEY" : undefined}
                  >
                    Start improvement loop
                  </Button>
                  <Button
                    variant={next?.key === "baseline" ? "primary" : "secondary"}
                    size="sm"
                    onClick={runBaseline}
                    disabled={!state.suite || credentialsMissing || startBaseline.isPending}
                    loading={startBaseline.isPending}
                    title={credentialsMissing ? "Agent runs need WANDB_API_KEY" : undefined}
                  >
                    Run baseline
                  </Button>
                </>
              }
              options={
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Maximum iterations">
                    <NumberInput value={iterations} onChange={setIterations} min={1} max={10} />
                  </Field>
                  <Field
                    label="Trace evidence"
                    hint="When MCP is unavailable the loop falls back to locally stored traces and labels the run local_evidence."
                  >
                    <select
                      className={inputClass}
                      value={useMcp ? "mcp" : "local"}
                      onChange={(event) => setUseMcp(event.target.value === "mcp")}
                    >
                      <option value="mcp">Retrieve traces through the W&amp;B MCP server</option>
                      <option value="local">Use locally stored traces only</option>
                    </select>
                  </Field>
                </div>
              }
            >
              {(startBaseline.isError || startImprovement.isError) && (
                <ErrorState error={startBaseline.error ?? startImprovement.error} context="Could not start the job" />
              )}
            </PipelineRow>

            <PipelineRow
              icon={<ShieldCheck size={18} />}
              title="Candidate review"
              status={
                candidate ? (
                  <span className="flex flex-wrap items-center gap-1.5">
                    Latest candidate: <span className="font-medium text-ink">Policy v{candidate.version}</span>
                    <Badge tone={acceptanceState(candidate).tone}>{acceptanceState(candidate).label}</Badge>
                    {candidate.validation_status !== "valid" && <Badge tone="danger">Invalid syntax</Badge>}
                    {candidate.is_active_playground && <Badge tone="accent">Active in playground</Badge>}
                  </span>
                ) : (
                  "No candidate yet. The policy designer proposes one from the baseline's real failures."
                )
              }
              actions={
                candidate ? (
                  <>
                    <Link to={`/policies?policy=${candidate.id}`} className={buttonClass("secondary", "sm")}>
                      Open policy diff and evidence
                    </Link>
                    <Button
                      size="sm"
                      variant={next?.key === "activate" ? "primary" : "secondary"}
                      onClick={() => activate.mutate(candidate.id)}
                      disabled={!candidate.activation_eligible || candidate.is_active_playground || activate.isPending}
                      loading={activate.isPending}
                      title={
                        candidate.is_active_playground
                          ? "Already active in the playground"
                          : candidate.activation_eligible
                            ? undefined
                            : "This candidate did not pass the acceptance gate. Activation from the Policies page requires an explicit recorded override."
                      }
                    >
                      {candidate.is_active_playground ? "Active in playground" : "Activate in playground"}
                    </Button>
                  </>
                ) : null
              }
            >
              {candidate && (
                <Disclosure summary="Candidate details" className="sm:pl-12">
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                    <dt className="text-ink-faint">Stored name</dt>
                    <dd>{candidate.name}</dd>
                    <dt className="text-ink-faint">Proposed by</dt>
                    <dd>
                      {candidate.created_by}
                      {candidate.source_model && <> · <Mono>{candidate.source_model}</Mono></>}
                    </dd>
                    <dt className="text-ink-faint">Validation</dt>
                    <dd><Mono>{candidate.validation_status}</Mono></dd>
                    <dt className="text-ink-faint">Decision</dt>
                    <dd>{candidate.decision ?? "not evaluated yet"}</dd>
                    <dt className="text-ink-faint">Reason</dt>
                    <dd>{candidate.decision_reason || "—"}</dd>
                  </dl>
                </Disclosure>
              )}
            </PipelineRow>
          </Card>
        </div>

        {/* sidebar */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-8">
          <Card
            title="Progress"
            actions={
              <span className="text-[13px] text-ink-muted tabular-nums">
                {doneCount} of {items.length}
              </span>
            }
          >
            <ol className="flex flex-col">
              {items.map((item, index) => (
                <ChecklistRow
                  key={item.key}
                  item={item}
                  index={index}
                  isNext={index === nextIndex}
                  isLast={index === items.length - 1}
                />
              ))}
            </ol>
            <Disclosure summary="All backend setup steps" meta={state.steps.length} className="mt-4">
              <ul className="flex flex-col gap-2">
                {state.steps.map((step) => (
                  <li key={step.key} className="text-[13px]">
                    <p className="flex items-center gap-1.5 font-medium text-ink">
                      {step.done ? <Check aria-hidden size={13} className="text-pass" /> : <span aria-hidden className="inline-block h-3 w-3 rounded-full border border-line-strong" />}
                      {step.label}
                      <span className="sr-only">{step.done ? "(complete)" : "(not complete)"}</span>
                    </p>
                    <p className="pl-5 break-words text-ink-muted">{step.detail}</p>
                    {step.blocked_reason && <p className="pl-5 text-warn">{step.blocked_reason}</p>}
                  </li>
                ))}
              </ul>
            </Disclosure>
          </Card>

          <Card title="What is under test">
            <p className="text-[14px] text-ink-muted">
              The permission policy. The support agent's prompt and model are held constant across every comparison, and no
              language model is trained here.
            </p>
          </Card>
        </aside>
      </div>
    </Page>
  );
}
