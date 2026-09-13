import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Bot, Plug, RotateCcw, Save, Scale, SlidersHorizontal } from "lucide-react";
import { api, useApiMutation, useApiQuery } from "../api/client";
import {
  Badge,
  Button,
  Card,
  Code,
  Disclosure,
  ErrorState,
  Field,
  KeyValue,
  Loading,
  Mono,
  NumberInput,
  Page,
  PageHeader,
  SectionLabel,
  StatusDot,
  inputClass,
  type Tone,
} from "../components/ui";
import { formatDateTime } from "../lib/present";
import type { IntegrationState, RuntimeSettings } from "../types/api";

function IntegrationCard({ state }: { state: IntegrationState }) {
  const tone: Tone = state.ok === true ? "pass" : state.ok === false ? "danger" : state.configured ? "warn" : "neutral";
  const label =
    state.ok === true ? "working" : state.ok === false ? "failing" : state.configured ? "not checked yet" : "not configured";
  const names: Record<string, string> = {
    llm: "W&B Inference (model calls)",
    weave: "W&B Weave (tracing)",
    mcp: "W&B MCP (trace evidence)",
  };
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot tone={tone} />
        <span className="text-[14px] font-medium text-ink">{names[state.name] ?? state.name}</span>
        <Badge tone={tone}>{label}</Badge>
        {state.checked_at && <span className="text-[12px] text-ink-faint">checked {formatDateTime(state.checked_at)}</span>}
      </div>
      {state.detail && (
        <p className={`mt-1 text-[13px] break-words ${state.ok === false ? "text-danger" : "text-ink-muted"}`}>{state.detail}</p>
      )}
      {Object.keys(state.data ?? {}).length > 0 && (
        <Disclosure summary="Raw check result" className="mt-1">
          <Code value={state.data} maxHeight={220} />
        </Disclosure>
      )}
    </div>
  );
}

function SectionTitle({ icon, title, help }: { icon: ReactNode; title: string; help: string }) {
  return (
    <span className="flex items-start gap-3">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        {icon}
      </span>
      <span>
        <span className="block">{title}</span>
        <span className="block text-[13px] font-normal text-ink-muted">{help}</span>
      </span>
    </span>
  );
}

export default function Settings() {
  const settings = useApiQuery(["settings"], api.settings);
  const integrations = useApiQuery(["integrations"], api.integrations);
  const check = useApiMutation(() => api.checkIntegrations());
  const save = useApiMutation((patch: Record<string, unknown>) => api.updateSettings(patch));
  const reset = useApiMutation(() => api.resetSettings());
  const location = useLocation();

  const [draft, setDraft] = useState<RuntimeSettings | null>(null);
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.runtime);
  }, [settings.data, draft]);

  useEffect(() => {
    if (!location.hash || !draft) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash, draft]);

  // a failed request is shown as a failure, never as endless loading
  if (settings.isError) return <ErrorState error={settings.error} context="Could not load settings" />;
  if (settings.isLoading || !draft) return <Loading label="Loading settings" />;

  const env = settings.data!.environment;
  const models = (integrations.data?.find((i) => i.name === "llm")?.data as { models?: string[] })?.models ?? [];

  const update = (patch: Partial<RuntimeSettings>) => setDraft({ ...draft, ...patch });

  const saveButton = (
    <Button
      onClick={() =>
        save.mutate(draft as unknown as Record<string, unknown>, {
          onSuccess: (response) => setDraft(response.runtime),
        })
      }
      disabled={save.isPending}
      loading={save.isPending}
      icon={<Save aria-hidden size={16} />}
    >
      {save.isPending ? "Saving…" : "Save settings"}
    </Button>
  );

  return (
    <Page width="narrow">
      <PageHeader
        title="Settings"
        description="Operator-tunable values are stored in the workspace database. API keys stay in the backend environment and are never returned here."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => reset.mutate(undefined as never)}
              disabled={reset.isPending}
              loading={reset.isPending}
              icon={<RotateCcw aria-hidden size={16} />}
            >
              Reset to defaults
            </Button>
            {saveButton}
          </>
        }
      />
      {save.isError && <ErrorState error={save.error} context="Settings were rejected" />}
      {reset.isError && <ErrorState error={reset.error} context="Could not reset settings" />}
      {save.isSuccess && !save.isPending && (
        <p role="status" className="-mt-3 text-[13px] text-pass">
          Settings saved.
        </p>
      )}

      {/* 1. model and provider */}
      <Card title={<SectionTitle icon={<Bot size={16} />} title="Model and provider" help="Which model runs the agent, the adversary and the policy designer." />}>
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Model for every agent role" hint="Run a connection check to populate this list from the provider.">
              {models.length > 0 ? (
                <select className={inputClass} value={draft.llm_model} onChange={(event) => update({ llm_model: event.target.value })}>
                  {[draft.llm_model, ...models.filter((m) => m !== draft.llm_model)].map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={inputClass} value={draft.llm_model} onChange={(event) => update({ llm_model: event.target.value })} />
              )}
            </Field>
            <Field label="Policy designer model" hint="Leave empty to use the same model.">
              <input
                className={inputClass}
                value={draft.llm_policy_model}
                onChange={(event) => update({ llm_policy_model: event.target.value })}
                placeholder="same as above"
              />
            </Field>
            <Field label="Temperature" hint="Non-zero temperature means two runs of the same scenario can differ.">
              <NumberInput value={draft.llm_temperature} onChange={(value) => update({ llm_temperature: value })} min={0} max={2} step={0.1} />
            </Field>
          </div>
          <Disclosure summary="Environment (read-only)" meta="set in .env, then restart the backend">
            <KeyValue
              items={[
                ["LLM base URL", <Mono>{env.llm_base_url}</Mono>],
                ["Model (env default)", <Mono>{env.llm_model}</Mono>],
                [
                  "Cost rate",
                  env.cost_rate_configured ? (
                    <Badge tone="pass">configured</Badge>
                  ) : (
                    <span className="text-ink-muted">not configured — token usage is reported and cost is shown as unavailable</span>
                  ),
                ],
                ["Backend port", String(env.backend_port)],
              ]}
            />
          </Disclosure>
        </div>
      </Card>

      {/* 2. integrations */}
      <Card
        id="integrations"
        className="scroll-mt-6"
        title={<SectionTitle icon={<Plug size={16} />} title="W&B integrations" help="Checks make real calls. Whatever comes back is what is shown." />}
        actions={
          <Button variant="secondary" onClick={() => check.mutate(undefined as never)} disabled={check.isPending} loading={check.isPending}>
            {check.isPending ? "Checking…" : "Check connections"}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {integrations.isLoading && <Loading label="Loading integration state" />}
          {integrations.isError && <ErrorState error={integrations.error} context="Could not load integration state" />}
          {(integrations.data ?? []).map((state) => (
            <IntegrationCard key={state.name} state={state} />
          ))}
          {check.isError && <ErrorState error={check.error} context="The check itself failed" />}
          <div className="rounded-xl border border-line bg-surface-sunken/50 px-4 py-3">
            <KeyValue
              items={[
                ["W&B entity", env.wandb_entity || <span className="text-warn">not set</span>],
                ["W&B project", env.wandb_project || <span className="text-warn">not set</span>],
                ["Weave project", env.weave_project || <span className="text-warn">not set</span>],
                ["MCP URL", <Mono>{env.wandb_mcp_url}</Mono>],
                [
                  "Credentials present",
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(env.credentials_present).map(([key, present]) => (
                      <Badge key={key} tone={present ? "pass" : "danger"} title={present ? "present" : "missing"}>
                        {key}: {present ? "present" : "missing"}
                      </Badge>
                    ))}
                  </span>,
                ],
              ]}
            />
          </div>
        </div>
      </Card>

      {/* 3. experiment controls */}
      <Card
        title={
          <SectionTitle
            icon={<SlidersHorizontal size={16} />}
            title="Experiment controls"
            help="Suite sizes and the gates a candidate must pass before it is eligible for activation."
          />
        }
      >
        <div className="flex flex-col gap-5">
          <div>
            <SectionLabel className="mb-2">Suite sizes</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Field label="Legitimate cases">
                <NumberInput value={draft.suite.legitimate_cases} onChange={(value) => update({ suite: { ...draft.suite, legitimate_cases: value } })} min={1} />
              </Field>
              <Field label="Adversarial cases">
                <NumberInput value={draft.suite.adversarial_cases} onChange={(value) => update({ suite: { ...draft.suite, adversarial_cases: value } })} min={0} />
              </Field>
              <Field label="Development split" hint="Share used to improve policies.">
                <NumberInput value={draft.suite.dev_split} onChange={(value) => update({ suite: { ...draft.suite, dev_split: value } })} min={0.1} max={0.8} step={0.05} />
              </Field>
              <Field label="Validation split" hint="The remainder is the held-out test split.">
                <NumberInput value={draft.suite.validation_split} onChange={(value) => update({ suite: { ...draft.suite, validation_split: value } })} min={0.05} max={0.5} step={0.05} />
              </Field>
            </div>
          </div>

          <div>
            <SectionLabel className="mb-2">Acceptance thresholds</SectionLabel>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Field label="Max unauthorized success rate" hint="0 to 1">
                <NumberInput
                  value={draft.acceptance.max_unauthorized_success_rate}
                  onChange={(value) => update({ acceptance: { ...draft.acceptance, max_unauthorized_success_rate: value } })}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </Field>
              <Field label="Min legitimate completion" hint="0 to 1">
                <NumberInput
                  value={draft.acceptance.min_legit_completion_rate}
                  onChange={(value) => update({ acceptance: { ...draft.acceptance, min_legit_completion_rate: value } })}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </Field>
              <Field label="Max completion drop" hint="Against the baseline, 0 to 1">
                <NumberInput
                  value={draft.acceptance.max_legit_completion_drop}
                  onChange={(value) => update({ acceptance: { ...draft.acceptance, max_legit_completion_drop: value } })}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </Field>
              <Field label="Max false-denial rate" hint="0 to 1">
                <NumberInput
                  value={draft.acceptance.max_false_denial_rate}
                  onChange={(value) => update({ acceptance: { ...draft.acceptance, max_false_denial_rate: value } })}
                  min={0}
                  max={1}
                  step={0.05}
                />
              </Field>
            </div>
          </div>

          <Disclosure summary="Run budgets" meta="technical">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              <Field label="Maximum iterations">
                <NumberInput value={draft.budget.max_iterations} onChange={(value) => update({ budget: { ...draft.budget, max_iterations: value } })} min={1} max={20} />
              </Field>
              <Field label="Model calls per job">
                <NumberInput value={draft.budget.max_model_calls_per_job} onChange={(value) => update({ budget: { ...draft.budget, max_model_calls_per_job: value } })} min={1} />
              </Field>
              <Field label="Agent steps per scenario">
                <NumberInput
                  value={draft.budget.max_agent_steps_per_scenario}
                  onChange={(value) => update({ budget: { ...draft.budget, max_agent_steps_per_scenario: value } })}
                  min={1}
                  max={30}
                />
              </Field>
              <Field label="Model timeout (seconds)">
                <NumberInput value={draft.budget.llm_timeout_seconds} onChange={(value) => update({ budget: { ...draft.budget, llm_timeout_seconds: value } })} min={5} max={600} />
              </Field>
            </div>
          </Disclosure>
        </div>
      </Card>

      {/* 4. business rules */}
      <Card
        title={
          <SectionTitle
            icon={<Scale size={16} />}
            title="Business rules"
            help="Limits referenced by policy rules, and the owner-defined contract the verifier judges against."
          />
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Maximum refund (minor units)" hint="For example, cents.">
              <NumberInput
                value={draft.business_limits.max_refund_minor}
                onChange={(value) => update({ business_limits: { ...draft.business_limits, max_refund_minor: value } })}
                min={1}
              />
            </Field>
            <Field label="Refund window (days)">
              <NumberInput
                value={draft.business_limits.refund_window_days}
                onChange={(value) => update({ business_limits: { ...draft.business_limits, refund_window_days: value } })}
                min={1}
              />
            </Field>
            <Field label="Currency">
              <input
                className={inputClass}
                value={draft.business_limits.currency}
                onChange={(event) => update({ business_limits: { ...draft.business_limits, currency: event.target.value } })}
              />
            </Field>
          </div>
          <Disclosure summary="Business contract" meta="read-only">
            <p className="mb-2 text-[13px] text-ink-muted">
              Owner-defined, trusted and read-only. Candidate policies are validated against the policy language and can
              never change this document.
            </p>
            <Code value={settings.data!.business_contract} maxHeight={360} />
          </Disclosure>
        </div>
      </Card>

      <div className="flex justify-end">{saveButton}</div>
    </Page>
  );
}
