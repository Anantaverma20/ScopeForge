# ScopeForge architecture

## The loop

```
run the suite ──► inspect failures ──► propose a policy change ──► enforce it
      ▲                                                                │
      └──────── accept or reject ◄── compare results ◄── rerun the suite ┘
```

What changes between iterations is **the permission policy**. The support agent's prompt, its model, the
scenario suite, the dataset and the business contract are all held constant across a comparison.

## Components

```
┌──────────────── frontend (React + TypeScript + Vite + Tailwind) ────────────────┐
│  Workspace · Scenarios · Experiments · Policies · Playground · Settings         │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │  typed JSON over /api (proxied in dev)
┌───────────────────────────────────▼─────────────────────────────────────────────┐
│ FastAPI backend                                                                 │
│                                                                                 │
│  agents/          support_agent · adversary · policy_designer · runner           │
│  gateway/         tools (5 business tools) · gateway (the enforcement pipeline)  │
│  policies/        schema (policy language) · engine · contract · store           │
│  evaluations/     scenarios · scorers · probes · metrics                         │
│  data/            generator (Faker) · sandbox (per-run isolated state)           │
│  jobs/            queue (1 worker thread) · orchestrator (the improvement loop)  │
│  integrations/    llm (W&B Inference) · weave_tracing · wandb_mcp                │
│                                                                                 │
│  SQLite + SQLAlchemy: datasets, sandboxes, policies, suites, scenarios,          │
│  experiments, scenario runs, tool events, scores, probes, jobs, playground       │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
              W&B Inference (models) · Weave (traces) · W&B MCP (trace evidence)
```

## The enforcement pipeline

Every tool call the tested agent makes passes through `app/gateway/gateway.py`:

1. **Unknown tool** → deny `UNKNOWN_TOOL`.
2. **Argument validation** against a Pydantic model → deny `INVALID_ARGUMENTS`.
3. **Resource resolution from the database.** The agent may name a resource id; ownership, eligibility,
   balances and record counts are always re-read from the database. A missing record → `RESOURCE_NOT_FOUND`.
4. **Policy decision** over the trusted context, the resolved resource and the request.
5. **Transactional execution** inside a savepoint. A refund re-checks current state and rolls back on any
   intrinsic accounting violation.
6. **Response-field filtering** using the winning allow rule's whitelist — applied *before* the result
   reaches the agent.
7. **Contract evidence.** The deterministic verifier records what the call violated (or would have violated
   had it not been denied).
8. **Persisted `ToolEvent`** carrying all of the above.

## Three separate ideas, deliberately not merged

| | What it is | Who may change it |
|---|---|---|
| **Business contract** | The owner's desired authorization rules. The verifier's reference. | Nobody at runtime. `config/business_contract.v1.json`, versioned, read-only to every agent. |
| **Candidate policy** | The executable restrictions under test. | The policy designer proposes; the operator activates. |
| **Sandbox containment** | The boundary keeping experiments on synthetic local rows. | Nobody. Structural: the only mutation path is `app/data/sandbox.py`. |

A **permissive baseline** policy is shipped in `config/policies/permissive_baseline.json`. It intentionally
violates the contract inside the sandbox so exposure can be measured. It can never be activated.

## Trusted identity

Scenario and playground identity — `tenant_id`, `authenticated_customer_id`, `session_id`,
`contract_version` — is constructed server-side before the model runs (`TrustedContext`). It is passed to the
gateway directly, never through the conversation. Message text, ticket bodies and tool-response notes are
treated as untrusted content and cannot alter it.

## The policy language

A policy is schema-validated JSON. **No model-generated Python, JavaScript, SQL or free-form expression is
ever executed.**

```json
{
  "schema_version": "1",
  "name": "…",
  "default_effect": "deny",
  "rules": [
    {
      "id": "own_orders_read",
      "effect": "allow",
      "tools": ["get_order", "list_orders"],
      "when": {"all": [
        {"field": "resource.merchant_id", "op": "eq", "value_ref": "context.tenant_id"},
        {"field": "resource.customer_id", "op": "eq", "value_ref": "context.authenticated_customer_id"}
      ]},
      "response_fields": ["order_id", "status", "total_minor", "refunded_minor"]
    }
  ]
}
```

- Operators: `eq ne in not_in lt lte gt gte`; combinators `all` (AND) and `any` (OR).
- Left operands come from a closed allow-list of `context.*`, `resource.*` and `request.*` paths.
- Right operands are a literal (`value`), another allow-listed path (`value_ref`), or a configured business
  value (`config_ref`, e.g. `business.max_refund_minor`).
- Anything referencing an unknown path fails validation; an invalid policy authorises nothing.

**Precedence:** unknown tool → invalid policy → missing trusted context → missing attribute → deny rules in
order → allow rules in order → `default_effect`. Every one of those fails closed. A condition referencing an
attribute a call cannot supply denies the call regardless of the rule's effect.

## Isolation

Each scenario run creates a **sandbox**: order state (status, refunded amount) is materialised per sandbox at
creation. Refunds, ledger entries and export artifacts are all sandbox-scoped. Customers, products and
tickets are immutable reference data. Two runs of the same scenario therefore start from identical state, and
a refund in one can never move another's starting conditions.

Refund idempotency is scoped to `(sandbox_id, session_id, idempotency_key)` and enforced by a unique
constraint, so a retried refund is recorded once and never charged twice.

## Evaluation

- **Splits are assigned per customer**, so variants of the same entity cannot leak between development,
  validation and test.
- Suites are **frozen**. Adding model-written attacks creates a *new suite version* rather than mutating one
  that a comparison is already using.
- **Deterministic scorers are the authoritative judge** (`app/evaluations/scorers.py`). Task completion comes
  from business state or checkable response content — never from the agent saying it is done.
- **Permission probes** (`app/evaluations/probes.py`) evaluate a generated set of (context, tool, args)
  combinations directly against a policy. They run no model and execute nothing. They measure permission
  breadth over that probe set — labelled measured coverage, not the total attack surface — and are kept
  visually and structurally separate from LLM attack results.
- Rates carry numerator and denominator; a zero denominator yields `null` and the UI shows **No data**.

## The improvement job

`app/jobs/orchestrator.py`, executed by one background worker thread:

1. Baseline on the development split.
2. Collect failure evidence — **development split only**.
3. Retrieve trace evidence through the W&B MCP server (bounded retries for ingestion delay). If MCP is
   unavailable, the run continues against locally stored traces and is labelled `local_evidence`, never
   `mcp_assisted`.
4. Ask the policy designer for a candidate; validate it; one bounded repair attempt on invalid output.
5. Evaluate the candidate on development, then on validation, alongside a baseline validation run.
6. Apply the configured acceptance gates and record accept/reject with the full comparison.
7. Repeat until the iteration limit, the model-call budget, cancellation or a stopping condition.
8. If a candidate was accepted, run the **held-out test split once** as a final assessment.

Rejected proposals are kept with their reasons. Results are not required to improve monotonically.

## Jobs

Job state is persisted: status, progress counters, current step, cancellation flag, events. Progress only
advances on completed work. Repeated clicks reuse the live job via a dedupe key. Cancellation is checked
between steps. On startup, any job still marked `running` is marked `interrupted` — never left looking alive.
