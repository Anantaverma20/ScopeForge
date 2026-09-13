import { useState, type ReactNode } from "react";
import { Ban, Check, ChevronDown, CircleCheck, CircleMinus, CircleX, Wrench } from "lucide-react";
import type { ComparisonField, Json, PolicyDiffResponse, PolicyRuleReadable } from "../types/api";
import {
  COMPARISON_LABELS,
  GATE_LABELS,
  compareRules,
  conditionView,
  documentRules,
  ruleTitle,
  toolAction,
  type Condition,
  type ConditionView,
  type RuleDoc,
} from "../lib/present";
import { Badge, Code, Disclosure, Mono, RateBar, SectionLabel, cx, pct } from "./ui";

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */
function ConditionTree({ view, depth = 0 }: { view: ConditionView; depth?: number }) {
  if (view.type === "always") return <p className="text-[14px] text-ink">Always - no conditions.</p>;
  if (view.type === "leaf")
    return view.text ? (
      <span className="text-[14px] text-ink">{view.text}</span>
    ) : (
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] font-medium text-warn">Technical detail - not translated</span>
        <Mono>{JSON.stringify(view.raw)}</Mono>
      </span>
    );
  return (
    <div className={cx(depth > 0 && "mt-1")}>
      <p className="text-[13px] font-medium text-ink-muted">
        {view.type === "all" ? "All of these must be true:" : "At least one of these must be true:"}
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {view.items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
            <div className="min-w-0">
              <ConditionTree view={item} depth={depth + 1} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConditionText({ condition }: { condition: Condition | null | undefined }) {
  return <ConditionTree view={conditionView(condition)} />;
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */
function EffectBadge({ effect }: { effect: string }) {
  if (effect === "deny")
    return (
      <Badge tone="slate" icon={<Ban aria-hidden size={12} />}>
        Blocks
      </Badge>
    );
  if (effect === "allow")
    return (
      <Badge tone="accent" icon={<Check aria-hidden size={12} />}>
        Allows
      </Badge>
    );
  return <Badge>{effect}</Badge>;
}

function RuleItem({ rule, readable }: { rule: RuleDoc; readable?: PolicyRuleReadable }) {
  const [open, setOpen] = useState(false);
  const id = `rule-${rule.id}`;
  const isDeny = rule.effect === "deny";
  const conditionCount = conditionView(rule.when).type === "always" ? 0 : null;
  return (
    <li className="rounded-xl border border-line bg-surface transition-shadow duration-150 hover:shadow-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isDeny ? "bg-surface-sunken text-ink" : "bg-accent-soft text-accent-strong",
          )}
        >
          {isDeny ? <Ban size={16} /> : <Check size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink">{ruleTitle(rule)}</span>
            <EffectBadge effect={rule.effect} />
          </span>
          <span className="mt-0.5 block text-[14px] text-ink-muted">
            {rule.description ||
              (isDeny
                ? `Blocks matching requests to ${rule.tools.map(toolAction).join(", ").toLowerCase()}.`
                : `Allows ${rule.tools.map(toolAction).join(", ").toLowerCase()} when the conditions hold.`)}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {rule.tools.map((tool) => (
              <Badge key={tool} tone="neutral" icon={<Wrench aria-hidden size={11} />}>
                {toolAction(tool)}
              </Badge>
            ))}
            {conditionCount === 0 && <Badge tone="neutral">No conditions</Badge>}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          size={18}
          className={cx("mt-1.5 shrink-0 text-ink-faint transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {open && (
        <div id={id} className="animate-enter border-t border-line px-4 py-3 sm:pl-15">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <SectionLabel className="mb-1.5">When it applies</SectionLabel>
              <ConditionText condition={rule.when} />
            </div>
            <div>
              <SectionLabel className="mb-1.5">{isDeny ? "Result" : "Fields returned to the agent"}</SectionLabel>
              {isDeny ? (
                <p className="text-[14px] text-ink">The matching request is blocked before the tool runs. Nothing is returned.</p>
              ) : rule.response_fields ? (
                rule.response_fields.length ? (
                  <div className="flex flex-wrap gap-1">
                    {rule.response_fields.map((f) => (
                      <code key={f} className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px] text-ink">
                        {f}
                      </code>
                    ))}
                  </div>
                ) : (
                  <p className="text-[14px] text-ink">No fields.</p>
                )
              ) : (
                <p className="text-[14px] text-warn">
                  No field filtering - every field the tool provides is returned, including internal fields.
                </p>
              )}
            </div>
          </div>
          <Disclosure summary="Technical detail" className="mt-3">
            <div className="flex flex-col gap-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                <dt className="text-ink-faint">Rule id</dt>
                <dd><Mono>{rule.id}</Mono></dd>
                <dt className="text-ink-faint">Effect</dt>
                <dd><Mono>{rule.effect}</Mono></dd>
                <dt className="text-ink-faint">Tools</dt>
                <dd><Mono>{rule.tools.join(", ")}</Mono></dd>
                {rule.reason_code && (
                  <>
                    <dt className="text-ink-faint">Reason code</dt>
                    <dd><Mono>{rule.reason_code}</Mono></dd>
                  </>
                )}
                {readable && (
                  <>
                    <dt className="text-ink-faint">Condition</dt>
                    <dd><Mono>{readable.condition}</Mono></dd>
                    <dt className="text-ink-faint">Fields</dt>
                    <dd><Mono>{readable.fields}</Mono></dd>
                  </>
                )}
              </dl>
              <Code value={rule} maxHeight={240} />
            </div>
          </Disclosure>
        </div>
      )}
    </li>
  );
}

export function PermissionList({
  document,
  readable,
}: {
  document: Json;
  readable: PolicyRuleReadable[];
}) {
  const rules = documentRules(document);
  const defaultEffect = (document as { default_effect?: string })?.default_effect;

  if (!rules) {
    // the stored document does not have the expected structure: show the server's rendering verbatim
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[14px] text-warn">This document could not be read as a rule list. Showing the stored rendering.</p>
        <Code value={readable} maxHeight={360} />
      </div>
    );
  }

  const byId = new Map(readable.map((r) => [r.id, r]));
  const deny = rules.filter((r) => r.effect === "deny");
  const allow = rules.filter((r) => r.effect === "allow");
  const other = rules.filter((r) => r.effect !== "deny" && r.effect !== "allow");

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-line bg-surface-sunken/60 px-4 py-3 text-[14px] text-ink-muted">
        <span className="font-medium text-ink">How these rules combine. </span>
        Every block rule is checked first, and any match denies the request. If no block rule matches, the first matching
        allow rule permits it and decides which fields are returned. Anything else gets the default:{" "}
        <span className="font-medium text-ink">{defaultEffect === "allow" ? "allowed" : defaultEffect === "deny" ? "denied" : defaultEffect ?? "unknown"}</span>.
        If a rule being checked needs data that is not available for the call, the request is denied.
      </div>

      {deny.length > 0 && (
        <section aria-label="Block rules">
          <SectionLabel className="mb-2">Blocked · checked first ({deny.length})</SectionLabel>
          <ul className="flex flex-col gap-2">
            {deny.map((rule) => (
              <RuleItem key={rule.id} rule={rule} readable={byId.get(rule.id)} />
            ))}
          </ul>
        </section>
      )}

      {allow.length > 0 && (
        <section aria-label="Allow rules">
          <SectionLabel className="mb-2">Allowed · if nothing above matched ({allow.length})</SectionLabel>
          <ul className="flex flex-col gap-2">
            {allow.map((rule) => (
              <RuleItem key={rule.id} rule={rule} readable={byId.get(rule.id)} />
            ))}
          </ul>
        </section>
      )}

      {other.length > 0 && (
        <section aria-label="Other rules">
          <SectionLabel className="mb-2">Other ({other.length})</SectionLabel>
          <ul className="flex flex-col gap-2">
            {other.map((rule) => (
              <RuleItem key={rule.id} rule={rule} readable={byId.get(rule.id)} />
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-3">
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted">
          <CircleMinus size={16} />
        </span>
        <div className="text-[14px]">
          <p className="font-semibold text-ink">Everything else</p>
          <p className="text-ink-muted">
            Default effect: <span className="font-medium text-ink">{defaultEffect ?? "not set"}</span>
            {defaultEffect === "deny" && " - requests no rule allows are denied."}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */
function RuleSummaryLine({ rule, tone }: { rule: RuleDoc; tone: "added" | "removed" }) {
  return (
    <div
      className={cx(
        "rounded-xl border px-4 py-3",
        tone === "added" ? "border-pass/25 bg-pass-soft/60" : "border-danger/20 bg-danger-soft/60",
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
        <span className={tone === "added" ? "text-pass" : "text-danger"}>{tone === "added" ? "Added" : "Removed"}</span>
        {ruleTitle(rule)}
        <EffectBadge effect={rule.effect} />
      </p>
      {rule.description && <p className="mt-0.5 text-[14px] text-ink-muted">{rule.description}</p>}
      <div className="mt-2">
        <ConditionText condition={rule.when} />
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">
        Tools: <Mono>{rule.tools.join(", ")}</Mono>
      </p>
    </div>
  );
}

function BeforeAfter({ label, before, after }: { label: string; before: ReactNode; after: ReactNode }) {
  return (
    <div>
      <SectionLabel className="mb-1.5">{label}</SectionLabel>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface-sunken/70 px-3 py-2">
          <p className="mb-0.5 text-[12px] font-medium text-ink-faint">Before</p>
          <div className="text-[14px] text-ink-muted">{before}</div>
        </div>
        <div className="rounded-lg border border-accent/25 bg-accent-soft/50 px-3 py-2">
          <p className="mb-0.5 text-[12px] font-medium text-accent-strong">After</p>
          <div className="text-[14px] text-ink">{after}</div>
        </div>
      </div>
    </div>
  );
}

export function PolicyDiffView({ diff, parentLabel }: { diff: PolicyDiffResponse["diff"]; parentLabel: string }) {
  const nothingChanged =
    diff.added_rules.length === 0 &&
    diff.removed_rules.length === 0 &&
    diff.changed_rules.length === 0 &&
    diff.default_effect.before === diff.default_effect.after;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-ink-muted">
        Compared with <span className="font-medium text-ink">{parentLabel}</span>: {diff.added_rules.length} added ·{" "}
        {diff.removed_rules.length} removed · {diff.changed_rules.length} changed · {diff.unchanged_rule_count} unchanged
      </p>

      {nothingChanged && <p className="text-[14px] text-ink">No rule differences were recorded against the parent.</p>}

      {diff.default_effect.before !== diff.default_effect.after && (
        <BeforeAfter
          label="Default effect"
          before={<Mono>{String(diff.default_effect.before)}</Mono>}
          after={<Mono>{String(diff.default_effect.after)}</Mono>}
        />
      )}

      {(diff.added_rules as unknown as RuleDoc[]).map((rule) => (
        <RuleSummaryLine key={`add-${rule.id}`} rule={rule} tone="added" />
      ))}
      {(diff.removed_rules as unknown as RuleDoc[]).map((rule) => (
        <RuleSummaryLine key={`rm-${rule.id}`} rule={rule} tone="removed" />
      ))}

      {diff.changed_rules.map((change) => {
        const before = change.before as unknown as RuleDoc;
        const after = change.after as unknown as RuleDoc;
        const c = compareRules(before, after);
        const onlyCosmetic =
          !c.effectChanged &&
          c.toolsAdded.length === 0 &&
          c.toolsRemoved.length === 0 &&
          c.conditions !== "changed" &&
          c.fieldsAdded.length === 0 &&
          c.fieldsRemoved.length === 0 &&
          !c.fieldFilteringChanged &&
          !c.reasonCodeChanged;
        return (
          <div key={change.id} className="rounded-xl border border-warn/25 bg-surface px-4 py-3">
            <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-ink">
              <span className="text-warn">Changed</span>
              {ruleTitle(after)}
              <EffectBadge effect={after.effect} />
            </p>
            {onlyCosmetic && (
              <p className="mt-1 text-[14px] text-ink-muted">
                Same effect, tools, returned fields and set of conditions
                {c.conditions === "reordered" ? ", listed in a different order" : ""}
                {c.descriptionChanged ? "; the description text changed" : ""}.
              </p>
            )}
            <div className="mt-3 flex flex-col gap-3">
              {c.effectChanged && (
                <BeforeAfter label="Effect" before={<Mono>{before.effect}</Mono>} after={<Mono>{after.effect}</Mono>} />
              )}
              {c.descriptionChanged && (
                <BeforeAfter label="Description" before={before.description || "—"} after={after.description || "—"} />
              )}
              {(c.toolsAdded.length > 0 || c.toolsRemoved.length > 0) && (
                <BeforeAfter
                  label="Tools"
                  before={<Mono>{before.tools.join(", ")}</Mono>}
                  after={<Mono>{after.tools.join(", ")}</Mono>}
                />
              )}
              {c.conditions === "changed" && (
                <div>
                  <SectionLabel className="mb-1.5">Conditions</SectionLabel>
                  <div className="flex flex-col gap-1.5">
                    {c.conditionsRemoved.map((cond, i) => (
                      <div key={`r${i}`} className="flex gap-2 rounded-lg bg-danger-soft/70 px-3 py-1.5">
                        <span className="font-mono text-[13px] font-semibold text-danger" aria-label="Removed">
                          −
                        </span>
                        <ConditionText condition={cond} />
                      </div>
                    ))}
                    {c.conditionsAdded.map((cond, i) => (
                      <div key={`a${i}`} className="flex gap-2 rounded-lg bg-pass-soft/70 px-3 py-1.5">
                        <span className="font-mono text-[13px] font-semibold text-pass" aria-label="Added">
                          +
                        </span>
                        <ConditionText condition={cond} />
                      </div>
                    ))}
                    {c.conditionsAdded.length === 0 && c.conditionsRemoved.length === 0 && (
                      <p className="text-[14px] text-ink-muted">The condition structure changed. See the raw change below.</p>
                    )}
                  </div>
                </div>
              )}
              {(c.fieldsAdded.length > 0 || c.fieldsRemoved.length > 0 || c.fieldFilteringChanged) && (
                <BeforeAfter
                  label="Returned fields"
                  before={<Mono>{before.response_fields ? before.response_fields.join(", ") : "all fields (no filtering)"}</Mono>}
                  after={<Mono>{after.response_fields ? after.response_fields.join(", ") : "all fields (no filtering)"}</Mono>}
                />
              )}
              {c.reasonCodeChanged && (
                <BeforeAfter
                  label="Reason code"
                  before={<Mono>{before.reason_code || "—"}</Mono>}
                  after={<Mono>{after.reason_code || "—"}</Mono>}
                />
              )}
            </div>
            <Disclosure summary="Raw before / after" className="mt-2">
              <div className="grid gap-2 lg:grid-cols-2">
                <Code value={change.before} maxHeight={260} />
                <Code value={change.after} maxHeight={260} />
              </div>
            </Disclosure>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Acceptance                                                          */
/* ------------------------------------------------------------------ */
type Gate = { name: string; passed: boolean | null; detail: string };

export function gatesOf(metrics: Json | null | undefined): Gate[] {
  const gates = (metrics as { gates?: unknown } | undefined)?.gates;
  return Array.isArray(gates) ? (gates as Gate[]) : [];
}

export function GateList({ metrics }: { metrics: Json }) {
  const gates = gatesOf(metrics);
  if (gates.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
      {gates.map((gate) => {
        const state = gate.passed === null ? "not evaluable" : gate.passed ? "passed" : "failed";
        return (
          <li key={gate.name} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
            <span className="mt-0.5 shrink-0">
              {gate.passed === null ? (
                <CircleMinus aria-hidden size={18} className="text-ink-faint" />
              ) : gate.passed ? (
                <CircleCheck aria-hidden size={18} className="text-pass" />
              ) : (
                <CircleX aria-hidden size={18} className="text-danger" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                {GATE_LABELS[gate.name] ?? gate.name}
                <Badge tone={gate.passed === null ? "neutral" : gate.passed ? "pass" : "danger"}>{state}</Badge>
              </p>
              <p className="text-[13px] text-ink-muted">{gate.detail}</p>
            </div>
            <Mono className="text-ink-faint">{gate.name}</Mono>
          </li>
        );
      })}
    </ul>
  );
}

export function ComparisonBars({ metrics }: { metrics: Json }) {
  const comparison = (metrics as { comparison?: Record<string, ComparisonField> }).comparison;
  if (!comparison) return null;
  const entries = Object.entries(comparison);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_110px] gap-4 border-b border-line px-4 py-2 text-[12px] font-semibold tracking-wide text-ink-faint uppercase md:grid">
        <span>Measure</span>
        <span>Baseline</span>
        <span>Candidate</span>
        <span className="text-right">Change</span>
      </div>
      <ul className="divide-y divide-line">
        {entries.map(([name, field]) => {
          const better =
            field.delta === null ? null : field.direction === "lower_better" ? field.delta < 0 : field.delta > 0;
          const worse =
            field.delta === null ? null : field.direction === "lower_better" ? field.delta > 0 : field.delta < 0;
          const candidateTone = better ? "pass" : worse ? "danger" : "accent";
          return (
            <li
              key={name}
              className="grid gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_110px] md:items-center"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">{COMPARISON_LABELS[name] ?? name}</p>
                <p className="text-[12px] text-ink-faint">{field.direction === "lower_better" ? "Lower is better" : "Higher is better"}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[12px] text-ink-faint md:hidden">Baseline</span>
                <span className="w-14 shrink-0 text-[14px] text-ink-muted tabular-nums">
                  {field.baseline === null ? "No data" : pct(field.baseline)}
                </span>
                <RateBar rate={field.baseline} tone="neutral" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[12px] text-ink-faint md:hidden">Candidate</span>
                <span className="w-14 shrink-0 text-[14px] font-semibold text-ink tabular-nums">
                  {field.candidate === null ? "No data" : pct(field.candidate)}
                </span>
                <RateBar rate={field.candidate} tone={candidateTone} />
              </div>
              <div className="md:text-right">
                {field.delta === null ? (
                  <span className="text-[13px] text-ink-faint">Not comparable</span>
                ) : (
                  <Badge tone={better ? "pass" : worse ? "danger" : "neutral"}>
                    {field.delta > 0 ? "+" : field.delta < 0 ? "−" : "±"}
                    {Math.abs(Math.round(field.delta * 100))} pts
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
