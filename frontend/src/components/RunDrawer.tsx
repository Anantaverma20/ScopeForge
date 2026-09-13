import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, Check, ChevronDown, ExternalLink, TriangleAlert } from "lucide-react";
import { api, useApiQuery } from "../api/client";
import type { RunDetail, ToolEventOut } from "../types/api";
import {
  categoryLabel,
  executionState,
  formatDuration,
  kindLabel,
  runOutcomes,
  splitLabel,
  toolAction,
} from "../lib/present";
import {
  Badge,
  ButtonLink,
  Card,
  Code,
  Disclosure,
  Drawer,
  ErrorState,
  KeyValue,
  Loading,
  Mono,
  SectionLabel,
  Skeleton,
  cx,
} from "./ui";

/** Deny reason codes that mean the request itself was malformed, not that a policy blocked it. */
const REQUEST_ERROR_REASONS = new Set([
  "INVALID_ARGUMENTS",
  "RESOURCE_NOT_FOUND",
  "BUSINESS_RULE_VIOLATION",
  "UNKNOWN_TOOL",
  "EXECUTION_ERROR",
  "DUPLICATE_REQUEST",
]);

export function eventDecision(event: ToolEventOut) {
  if (event.decision === "allow")
    return event.executed
      ? { label: "Allowed", tone: "pass" as const, blockedByPolicy: false }
      : { label: "Allowed · not executed", tone: "warn" as const, blockedByPolicy: false };
  if (REQUEST_ERROR_REASONS.has(event.reason_code))
    return { label: "Rejected · request error", tone: "warn" as const, blockedByPolicy: false };
  return { label: "Blocked by gateway", tone: "danger" as const, blockedByPolicy: true };
}

export function ToolEventRow({ event, defaultOpen = false }: { event: ToolEventOut; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const violations = event.contract_violations ?? [];
  const decision = eventDecision(event);
  const panelId = `event-${event.id}`;
  const allowed = event.decision === "allow";

  return (
    <li className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
            allowed ? "bg-pass-soft text-pass" : decision.blockedByPolicy ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn",
          )}
        >
          {allowed ? <Check size={15} /> : decision.blockedByPolicy ? <Ban size={15} /> : <TriangleAlert size={15} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold text-ink">{toolAction(event.tool_name)}</span>
            <Badge tone={decision.tone}>{decision.label}</Badge>
            {violations.length > 0 && (
              <Badge tone="danger" title={violations.join(", ")}>
                {event.executed ? "Contract violated" : "Would have violated contract"}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block text-[13px] break-words text-ink-muted">
            {event.reason_detail || event.reason_code}
            {event.removed_fields.length > 0 && ` · ${event.removed_fields.length} field(s) withheld`}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-[12px] text-ink-faint tabular-nums">
          #{event.step_index}
          <ChevronDown aria-hidden size={16} className={cx("transition-transform duration-200", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div id={panelId} className="animate-enter flex flex-col gap-3 border-t border-line px-3.5 py-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-faint">Tool</dt>
            <dd><Mono>{event.tool_name}</Mono></dd>
            <dt className="text-ink-faint">Decision</dt>
            <dd><Mono>{event.decision} · {event.reason_code}</Mono></dd>
            {event.matched_rule_id && (
              <>
                <dt className="text-ink-faint">Matched rule</dt>
                <dd><Mono>{event.matched_rule_id}</Mono></dd>
              </>
            )}
            <dt className="text-ink-faint">Executed</dt>
            <dd>{event.executed ? "Yes" : "No"}</dd>
            <dt className="text-ink-faint">Duration</dt>
            <dd className="tabular-nums">{event.duration_ms} ms</dd>
          </dl>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="min-w-0">
              <SectionLabel className="mb-1">Requested arguments</SectionLabel>
              <Code value={event.requested_args} maxHeight={180} />
            </div>
            <div className="min-w-0">
              <SectionLabel className="mb-1">
                Returned to the agent{event.removed_fields.length > 0 ? ` (${event.removed_fields.length} fields removed)` : ""}
              </SectionLabel>
              <Code value={event.result} maxHeight={180} />
            </div>
          </div>
          {event.removed_fields.length > 0 && (
            <p className="text-[13px] text-ink-muted">
              <span className="font-medium text-ink">Filtered out by the policy:</span>{" "}
              <Mono>{event.removed_fields.join(", ")}</Mono>
            </p>
          )}
          {violations.length > 0 && (
            <p className="text-[13px] text-danger">
              <span className="font-medium">Contract evidence:</span> <Mono>{violations.join(", ")}</Mono>
            </p>
          )}
          {Object.keys(event.state_change ?? {}).length > 0 && (
            <Disclosure summary="Business state change">
              <Code value={event.state_change} maxHeight={180} />
            </Disclosure>
          )}
          {event.error && <p className="font-mono text-[12px] break-words text-danger">{event.error}</p>}
        </div>
      )}
    </li>
  );
}

function Quote({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <p
      className={cx(
        "rounded-lg border p-3 text-[14px] leading-relaxed whitespace-pre-wrap",
        tone === "warn" ? "border-warn/25 bg-warn-soft" : "border-line bg-surface-sunken/70",
      )}
    >
      {children}
    </p>
  );
}

export function RunDetailView({ run }: { run: RunDetail }) {
  const violations = run.contract_violations ?? [];
  const execution = executionState(run);
  const outcomes = runOutcomes(run);
  const blocked = run.events.filter((e) => eventDecision(e).blockedByPolicy).length;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <SectionLabel className="mb-1">Execution</SectionLabel>
              <Badge tone={execution.tone} title={execution.help}>
                {execution.label}
              </Badge>
            </div>
            <div className="sm:col-span-2">
              <SectionLabel className="mb-1">Outcome</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {outcomes.map((o) => (
                  <Badge key={o.label} tone={o.tone} title={o.help}>
                    {o.label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-muted">
            <span>{run.events.length} tool call(s)</span>
            <span>{blocked} blocked by gateway</span>
            <span>{violations.length === 0 ? "No contract violations" : `${violations.length} contract violation(s)`}</span>
            <span>{formatDuration(run.duration_ms)}</span>
            <span>{run.token_usage?.total_tokens ? `${run.token_usage.total_tokens.toLocaleString()} tokens` : "Tokens not reported"}</span>
            {run.weave_call_url ? (
              <ButtonLink href={run.weave_call_url} external size="sm" icon={<ExternalLink aria-hidden size={14} />}>
                Open Weave trace
              </ButtonLink>
            ) : (
              <span title={run.trace_status}>{run.trace_status.startsWith("trace_failed") ? "Trace failed" : "Not traced"}</span>
            )}
          </div>
        </div>
      </Card>

      {run.error && (
        <Card title="Run error">
          <p className="font-mono text-[12px] break-words text-danger">{run.error}</p>
        </Card>
      )}

      <Card title="Customer request">
        <div className="flex flex-col gap-3">
          <Quote>{run.user_message || "—"}</Quote>
          {run.injected_ticket_body && (
            <div>
              <SectionLabel className="mb-1 text-warn">Attached ticket (untrusted surface)</SectionLabel>
              <Quote tone="warn">{run.injected_ticket_body}</Quote>
            </div>
          )}
          {run.tool_note_injection && (
            <div>
              <SectionLabel className="mb-1 text-warn">Note injected into tool responses (untrusted surface)</SectionLabel>
              <Quote tone="warn">{run.tool_note_injection}</Quote>
            </div>
          )}
        </div>
      </Card>

      <Card
        title={`Tool activity (${run.events.length})`}
        description="Every call the agent attempted, the decision the policy engine made, and what actually reached the agent."
      >
        {run.events.length === 0 ? (
          <p className="text-[14px] text-ink-muted">The agent made no tool calls in this run.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {run.events.map((event) => (
              <ToolEventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="Agent response">
        <Quote>{run.final_response || <span className="text-ink-muted">No final response was produced.</span>}</Quote>
        {violations.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {violations.map((violation) => (
              <Badge key={violation} tone="danger">
                {violation}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title="Technical details">
        <div className="flex flex-col gap-2">
          <KeyValue
            items={[
              ["Run id", <Mono>{run.id}</Mono>],
              ["Scenario", <Mono>{`${run.scenario_key} · ${run.scenario_category} · ${run.scenario_kind}`}</Mono>],
              ["Split", run.split ? splitLabel(run.split) : "—"],
              ["Execution status", <Mono>{run.status}</Mono>],
              ["Model", run.model ? <Mono>{run.model}</Mono> : "—"],
              ["Policy", <Mono>{`${run.policy_id} (v${run.policy_version ?? "?"})`}</Mono>],
              ["Experiment", <Mono>{run.experiment_id}</Mono>],
              ["Sandbox", <Mono>{run.sandbox_id}</Mono>],
              ["Duration", `${run.duration_ms} ms`],
              ["Trace status", <Mono>{run.trace_status}</Mono>],
            ]}
          />
          <Disclosure summary="Trusted context (server-established, not settable by the agent)" className="mt-2">
            <Code value={run.trusted_context} maxHeight={160} />
          </Disclosure>
          <Disclosure summary="Business state before and after">
            <div className="grid gap-2 lg:grid-cols-2">
              <div className="min-w-0">
                <SectionLabel className="mb-1">Before</SectionLabel>
                <Code value={run.initial_state} maxHeight={200} />
              </div>
              <div className="min-w-0">
                <SectionLabel className="mb-1">After</SectionLabel>
                <Code value={run.final_state} maxHeight={200} />
              </div>
            </div>
          </Disclosure>
          <Disclosure summary="Deterministic scorer evidence" meta={run.score_evidence.length}>
            <ul className="flex flex-col gap-2">
              {run.score_evidence.map((score) => (
                <li key={score.scorer} className="rounded-lg border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mono>{score.scorer}</Mono>
                    {!score.applicable ? (
                      <Badge tone="neutral">not applicable</Badge>
                    ) : score.passed === null ? (
                      <Badge tone="neutral">count: {score.value ?? 0}</Badge>
                    ) : (
                      <Badge tone={score.passed ? "pass" : "danger"}>{score.passed ? "pass" : "fail"}</Badge>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <Code value={score.evidence} maxHeight={140} />
                  </div>
                </li>
              ))}
            </ul>
          </Disclosure>
          {Object.keys(run.expectations ?? {}).length > 0 && (
            <Disclosure summary="Expected outcome (admin-only; never sent to the agent)">
              <Code value={run.expectations} maxHeight={220} />
            </Disclosure>
          )}
          <Disclosure summary="Model settings">
            <Code value={run.model_settings} maxHeight={160} />
          </Disclosure>
          <Disclosure summary="Raw conversation" meta={`${run.messages.length} messages`}>
            <Code value={run.messages} maxHeight={320} />
          </Disclosure>
        </div>
      </Card>
    </>
  );
}

export default function RunDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  // keep the last run visible while the drawer animates closed
  const lastId = useRef<string | null>(runId);
  useEffect(() => {
    if (runId) lastId.current = runId;
  }, [runId]);
  const shownId = runId ?? lastId.current;
  const run = useApiQuery(["run", shownId], () => api.run(shownId!), { enabled: !!shownId });

  return (
    <Drawer
      open={!!runId}
      onClose={onClose}
      title={run.data ? run.data.scenario_title : "Run"}
      subtitle={
        run.data
          ? `${kindLabel(run.data.scenario_kind)} · ${categoryLabel(run.data.scenario_category)}${run.data.split ? ` · ${splitLabel(run.data.split)} split` : ""}`
          : undefined
      }
    >
      {run.isLoading && (
        <Card>
          <Loading label="Loading run evidence" />
          <Skeleton lines={4} />
        </Card>
      )}
      {run.isError && <ErrorState error={run.error} context="Could not load this run" />}
      {run.data && <RunDetailView run={run.data} />}
    </Drawer>
  );
}
