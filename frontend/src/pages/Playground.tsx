import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Bot, MessagesSquare, Send, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { api, useApiMutation, useApiQuery } from "../api/client";
import { RunDetailView, ToolEventRow, eventDecision } from "../components/RunDrawer";
import {
  Button,
  Callout,
  Card,
  Disclosure,
  Drawer,
  EmphasisText,
  EmptyState,
  ErrorState,
  Field,
  KeyValue,
  Loading,
  Mono,
  Page,
  PageHeader,
  SectionLabel,
  Spinner,
  cx,
  inputClass,
  textareaClass,
} from "../components/ui";
import { formatDateTime, policyDisplayName } from "../lib/present";
import type { PlaygroundExample, RunDetail } from "../types/api";

function ActivityPanel({ run, onOpenAudit }: { run: RunDetail | null; onOpenAudit: () => void }) {
  if (!run)
    return (
      <Card title="Tool activity" description="Observable tool calls from one agent turn.">
        <EmptyState title="No turn selected" icon={<Activity size={24} />}>
          Send a request, or choose <span className="font-medium text-ink">Tool activity</span> on an agent reply. Calls
          appear here once the turn has finished.
        </EmptyState>
      </Card>
    );

  const allowed = run.events.filter((e) => e.decision === "allow").length;
  const blocked = run.events.filter((e) => eventDecision(e).blockedByPolicy).length;
  const withheld = run.events.filter((e) => e.removed_fields.length > 0).length;
  const violations = run.contract_violations.length;

  return (
    <Card
      key={run.id}
      className="animate-highlight"
      title="Tool activity"
      description={`Selected turn · enforced by Policy v${run.policy_version ?? "?"}`}
      actions={
        <Button size="sm" variant="secondary" onClick={onOpenAudit}>
          Full audit
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {[
            ["Tool calls", run.events.length, "text-ink"],
            ["Allowed", allowed, "text-pass"],
            ["Blocked by gateway", blocked, blocked ? "text-danger" : "text-ink"],
            ["Contract violations", violations, violations ? "text-danger" : "text-ink"],
          ].map(([label, value, ink]) => (
            <div key={String(label)} className="rounded-lg bg-surface-sunken/70 px-3 py-2">
              <dt className="text-[12px] text-ink-faint">{label}</dt>
              <dd className={cx("text-[18px] font-semibold tabular-nums", String(ink))}>{value}</dd>
            </div>
          ))}
        </dl>

        {run.error ? (
          <ErrorState error={run.error} context="The turn failed" />
        ) : run.events.length === 0 ? (
          <Callout tone="neutral" icon={<Bot size={18} />}>
            The agent answered without calling any tools. Any refusal in the reply came from the model, not the gateway.
          </Callout>
        ) : blocked > 0 ? (
          <Callout tone="neutral" icon={<ShieldCheck size={18} />}>
            The gateway blocked {blocked} call{blocked > 1 ? "s" : ""} under the policy; those calls did not execute.
          </Callout>
        ) : (
          <Callout tone="neutral" icon={<ShieldCheck size={18} />}>
            The policy allowed every call in this turn
            {withheld ? `, and withheld fields from ${withheld} response${withheld > 1 ? "s" : ""}` : ""}. If the reply
            declines part of the request, that was the model's choice, not a gateway block.
          </Callout>
        )}

        {run.events.length > 0 && (
          <ol className="flex flex-col gap-2" aria-label="Tool calls in order">
            {run.events.map((event) => (
              <ToolEventRow key={event.id} event={event} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function ExampleList({ examples, onPick }: { examples: PlaygroundExample[]; onPick: (message: string) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(["clean", "adversarial"] as const).map((kind) => {
        const items = examples.filter((example) => example.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind} className="min-w-0">
            <SectionLabel className="mb-1.5">{kind === "clean" ? "Normal requests" : "Attack tests"}</SectionLabel>
            <ul className="flex flex-col gap-1.5">
              {items.map((example) => (
                <li key={example.label}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-left transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-card"
                    onClick={() => onPick(example.message)}
                    title={example.message}
                  >
                    <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      {kind === "adversarial" && <TriangleAlert aria-hidden size={13} className="text-warn" />}
                      {example.label}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[12px] text-ink-muted">{example.message}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-faint">{example.source}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function Playground() {
  const workspace = useApiQuery(["workspace"], api.workspace);
  const sessions = useApiQuery(["playground-sessions"], api.playgroundSessions);
  const customers = useApiQuery(["playground-customers"], () => api.playgroundCustomers());

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [message, setMessage] = useState("");
  const [lastRun, setLastRun] = useState<RunDetail | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [runLoadError, setRunLoadError] = useState<unknown>(null);

  const activeSession = sessionId ?? sessions.data?.[0]?.id ?? null;
  const messages = useApiQuery(["playground-messages", activeSession], () => api.playgroundMessages(activeSession!), {
    enabled: !!activeSession,
  });
  const examples = useApiQuery(["playground-examples", activeSession], () => api.playgroundExamples(activeSession!), {
    enabled: !!activeSession,
  });

  const createSession = useApiMutation((id: string) => api.createPlaygroundSession({ customer_id: id }));
  const send = useApiMutation((args: { id: string; message: string }) => api.sendPlaygroundMessage(args.id, args.message));

  useEffect(() => {
    if (!customerId && customers.data?.length) setCustomerId(customers.data[0].customer_id);
  }, [customers.data, customerId]);

  // highlight messages that arrive after the conversation first loaded; scroll to the newest
  const seen = useRef<Set<string> | null>(null);
  const seenSession = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!messages.data) return;
    if (seenSession.current !== activeSession || !seen.current) {
      seen.current = new Set(messages.data.map((m) => m.id));
      seenSession.current = activeSession;
      setFresh(new Set());
    } else {
      const arrived = messages.data.filter((m) => !seen.current!.has(m.id)).map((m) => m.id);
      arrived.forEach((id) => seen.current!.add(id));
      if (arrived.length) setFresh(new Set(arrived));
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.data, activeSession]);

  useEffect(() => {
    if (send.isPending) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [send.isPending]);

  const activePolicy = workspace.data?.active_policy;
  const session = sessions.data?.find((s) => s.id === activeSession);

  if (workspace.isLoading) return <Loading label="Loading playground" />;
  if (workspace.isError) return <ErrorState error={workspace.error} context="Could not load the workspace state" />;

  const submit = () => {
    if (!message.trim() || !activeSession) return;
    send.mutate(
      { id: activeSession, message },
      {
        onSuccess: (turn) => {
          setMessage("");
          if (turn.run) setLastRun(turn.run);
        },
      },
    );
  };

  const history = messages.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Playground"
        description="Talk to the support agent as a signed-in customer. Every tool call passes through the gateway and the active policy."
      />

      {!activePolicy ? (
        <EmptyState title="No policy is active" icon={<ShieldCheck size={28} />}>
          The playground runs only against an approved policy. Review a candidate on the{" "}
          <Link className="text-accent-strong underline" to="/policies">
            Policies
          </Link>{" "}
          page and activate it.
        </EmptyState>
      ) : (
        <>
          <Card title="Session" headingLevel={2}>
            <div className="flex flex-col gap-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <Field label="Sign in as a generated customer">
                  <select className={inputClass} value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                    {(customers.data ?? []).map((customer) => (
                      <option key={customer.customer_id} value={customer.customer_id}>
                        {customer.name} · {customer.merchant_name} · {customer.order_count} orders
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  onClick={() =>
                    createSession.mutate(customerId, {
                      onSuccess: (created) => {
                        setSessionId(created.id);
                        setLastRun(null);
                      },
                    })
                  }
                  disabled={!customerId || createSession.isPending}
                  loading={createSession.isPending}
                >
                  Start session
                </Button>
              </div>
              {customers.isError && <ErrorState error={customers.error} context="Could not load customers" />}
              {createSession.isError && <ErrorState error={createSession.error} context="Could not start a session" />}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/20 bg-accent-soft/60 px-4 py-2.5 text-[14px]">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <ShieldCheck aria-hidden size={16} className="text-accent-strong" />
                  Active policy
                </span>
                <Link
                  to={`/policies?policy=${activePolicy.id}`}
                  className="min-w-0 truncate text-accent-strong underline-offset-2 hover:underline"
                >
                  Policy v{activePolicy.version} · {policyDisplayName(activePolicy)}
                </Link>
                <span className="text-ink-muted">{activePolicy.rule_count} rules</span>
              </div>

              {session && (
                <div className="flex flex-col gap-3 border-t border-line pt-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]">
                    <span className="flex items-center gap-2">
                      <User aria-hidden size={16} className="text-ink-faint" />
                      <span className="text-ink-muted">Signed in as</span>
                      <span className="font-medium text-ink">{session.customer_name}</span>
                    </span>
                    <span>
                      <span className="text-ink-muted">Store </span>
                      <span className="font-medium text-ink">{session.merchant_name}</span>
                    </span>
                    <span>
                      <span className="text-ink-muted">Session policy </span>
                      <span className="font-medium text-ink">
                        v{session.policy_version} · {session.policy_name}
                      </span>
                    </span>
                  </div>
                  {session.policy_id !== activePolicy.id && (
                    <Callout tone="warn" icon={<TriangleAlert size={18} />}>
                      This session was started under Policy v{session.policy_version}. The currently active policy is v
                      {activePolicy.version}. Start a new session to use it.
                    </Callout>
                  )}
                  <p className="text-[13px] text-ink-muted">{session.protection_note}</p>
                  <div className="flex flex-wrap items-end gap-4">
                    {sessions.data && sessions.data.length > 1 && (
                      <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="text-[13px] font-medium text-ink">Switch session</span>
                        <select
                          className={cx(inputClass, "max-w-md")}
                          value={activeSession ?? ""}
                          onChange={(event) => {
                            setSessionId(event.target.value);
                            setLastRun(null);
                          }}
                        >
                          {sessions.data.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.customer_name} · policy v{entry.policy_version} · {formatDateTime(entry.created_at)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <Disclosure summary="Session details">
                    <KeyValue
                      items={[
                        ["Customer", <Mono>{`${session.customer_name} (${session.authenticated_customer_id})`}</Mono>],
                        ["Merchant", <Mono>{`${session.merchant_name} (${session.tenant_id})`}</Mono>],
                        ["Policy", <Mono>{`${session.policy_name} v${session.policy_version} (${session.policy_id})`}</Mono>],
                        ["Sandbox", <Mono>{session.sandbox_id}</Mono>],
                        ["Session", <Mono>{session.id}</Mono>],
                        ["Started", formatDateTime(session.created_at)],
                      ]}
                    />
                  </Disclosure>
                </div>
              )}
            </div>
          </Card>

          {activeSession ? (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
              <Card title="Conversation" bodyClassName="px-0 pb-0">
                <div
                  ref={scroller}
                  className="sf-scroll flex max-h-[56vh] min-h-[260px] flex-col gap-3 overflow-y-auto border-y border-line bg-surface-sunken/40 px-5 py-4"
                  aria-live="polite"
                  aria-label="Conversation messages"
                >
                  {messages.isLoading && <Loading label="Loading messages" />}
                  {messages.isError && <ErrorState error={messages.error} context="Could not load messages" />}
                  {!messages.isLoading && history.length === 0 && !send.isPending && (
                    <p className="m-auto max-w-sm text-center text-[14px] text-ink-muted">
                      No messages yet. Type a support request below or pick an example.
                    </p>
                  )}
                  {history.map((entry) => {
                    const isUser = entry.role === "user";
                    return (
                      <div
                        key={entry.id}
                        className={cx("flex max-w-[88%] flex-col gap-1", isUser ? "self-end items-end" : "self-start items-start")}
                      >
                        <div className="flex items-center gap-2 px-1 text-[12px] text-ink-faint">
                          {isUser ? <User aria-hidden size={13} /> : <Bot aria-hidden size={13} />}
                          <span className="font-medium text-ink-muted">{isUser ? "Customer" : "Support agent"}</span>
                          <span>{new Date(entry.created_at).toLocaleTimeString()}</span>
                        </div>
                        <div
                          className={cx(
                            "rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap",
                            isUser ? "rounded-br-md bg-nav text-nav-ink" : "rounded-bl-md border border-line bg-surface text-ink shadow-card",
                            fresh.has(entry.id) && "animate-enter",
                          )}
                        >
                          {entry.content ? (
                            isUser ? entry.content : <EmphasisText text={entry.content} />
                          ) : (
                            <span className="text-danger">{entry.error || "The agent produced no response."}</span>
                          )}
                          {entry.error && entry.content && <p className="mt-1 font-mono text-[12px] text-danger">{entry.error}</p>}
                        </div>
                        {entry.run_id && (
                          <button
                            type="button"
                            className={cx(
                              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent-strong hover:bg-accent-soft",
                              lastRun?.id === entry.run_id && "bg-accent-soft",
                            )}
                            aria-pressed={lastRun?.id === entry.run_id}
                            onClick={async () => {
                              setLoadingRunId(entry.run_id);
                              setRunLoadError(null);
                              try {
                                const run = await api.run(entry.run_id!);
                                setLastRun(run);
                              } catch (error) {
                                setRunLoadError(error);
                              } finally {
                                setLoadingRunId(null);
                              }
                            }}
                          >
                            {loadingRunId === entry.run_id ? <Spinner size={12} /> : <Activity aria-hidden size={12} />}
                            Tool activity
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {send.isPending && (
                    <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-2.5 text-[14px] text-ink-muted" role="status">
                      <Spinner size={14} className="text-accent" />
                      Running the agent… tool activity appears when the turn finishes.
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 px-5 py-4">
                  {runLoadError !== null && <ErrorState error={runLoadError} context="Could not load that turn's tool activity" />}
                  {send.isError && <ErrorState error={send.error} context="The request failed" />}
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submit();
                    }}
                  >
                    <textarea
                      className={cx(textareaClass, "min-h-[84px] resize-y")}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          submit();
                        }
                      }}
                      placeholder="Type a support request…"
                      aria-label="Support request"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[12px] text-ink-faint">Ctrl + Enter to send</span>
                      <Button
                        type="submit"
                        disabled={!message.trim() || send.isPending}
                        loading={send.isPending}
                        icon={<Send aria-hidden size={15} />}
                      >
                        {send.isPending ? "Running the agent…" : "Send"}
                      </Button>
                    </div>
                  </form>
                  <Disclosure
                    summary="Example requests"
                    meta="from this session's own records"
                    defaultOpen={history.length === 0}
                  >
                    {examples.isLoading ? (
                      <Loading />
                    ) : examples.isError ? (
                      <ErrorState error={examples.error} context="Could not load examples" />
                    ) : (
                      <ExampleList examples={examples.data ?? []} onPick={setMessage} />
                    )}
                  </Disclosure>
                </div>
              </Card>

              <div className="lg:sticky lg:top-8">
                <ActivityPanel run={lastRun} onOpenAudit={() => setShowEvidence(true)} />
              </div>
            </div>
          ) : (
            <EmptyState title="No session yet" icon={<MessagesSquare size={28} />}>
              Choose a generated customer above and start a session. The server fixes the identity before the model runs;
              nothing typed in the conversation can change it.
            </EmptyState>
          )}
        </>
      )}

      <Drawer
        open={showEvidence && !!lastRun}
        onClose={() => setShowEvidence(false)}
        title="Tool-call audit"
        subtitle={lastRun ? `run ${lastRun.id} · policy v${lastRun.policy_version}` : ""}
      >
        {lastRun && <RunDetailView run={lastRun} />}
      </Drawer>
    </Page>
  );
}
