# Verification checklist

Four states, kept deliberately separate:

- ✅ **Locally verified** — checked by an automated test or an observed local run, no external service needed.
- 🌐 **Verified with live services** — observed against the real W&B Inference, Weave or MCP endpoints.
- ⛔ **Blocked** — needs a credential or service that was not available.
- ⬜ **Not implemented.**

Unit tests are labelled as tests. Where a test substitutes a scripted stand-in for a model call, that is noted
and it is **not** treated as evidence that the live integration works.

---

## Security boundaries

| Check | State | Evidence |
|---|---|---|
| Cross-tenant restriction uses trusted server context | ✅ | `tests/test_gateway.py::test_restrictive_policy_blocks_cross_customer_and_cross_tenant` |
| Cross-customer restriction uses trusted server context | ✅ | same test; ownership re-resolved from the database |
| Message text cannot replace authenticated identity | ✅ | `test_ownership_comes_from_the_database_not_the_arguments` — the agent naming another customer's order id is still denied |
| Missing trusted context fails closed | ✅ | `test_missing_trusted_context_fails_closed` → `MISSING_CONTEXT` |
| Field filtering prevents prohibited data reaching the model | ✅ | `test_response_field_filtering_removes_prohibited_fields` — `ssn_last4`, `internal_risk_score`, `lifetime_value_minor`, `internal_notes` removed before the payload is built |
| Baseline exposure is real, not asserted | ✅ | `test_baseline_exposes_cross_customer_data_and_records_the_violation` |
| Refund authorization (limit, eligibility, remaining balance) | ✅ | `test_refund_above_configured_limit_is_denied`, `test_refund_beyond_remaining_balance_is_denied_by_policy`, `test_refund_within_limits_is_allowed_and_changes_state` |
| Duplicate refunds prevented by scoped idempotency | ✅ | `test_refund_is_idempotent_per_session_key`, `test_duplicate_refund_via_gateway_does_not_double_charge` |
| Accounting validity enforced intrinsically | ✅ | `test_refund_cannot_exceed_remaining_balance`, `test_full_refund_marks_order_refunded_and_writes_ledger` |
| Unknown tools fail closed | ✅ | `test_unknown_tool_is_denied` → `UNKNOWN_TOOL` |
| Invalid policies fail closed | ✅ | `test_invalid_policy_document_is_rejected`; `engine_for` returns `None` and the run is recorded as failed |
| Missing attributes fail closed | ✅ | `test_missing_attribute_fails_closed` → `MISSING_ATTRIBUTE` |
| Invalid arguments rejected before any execution | ✅ | `test_invalid_arguments_are_denied` |
| No model-generated code is executed | ✅ | By construction — `app/policies/engine.py` has no `eval`, `exec`, or expression parser; conditions are typed nodes over an allow-list of paths |
| Sponsor credentials never reach the tested agent or adversary | ✅ | By construction — the agent receives tool schemas and tool results only; the MCP client lives in `app/integrations/` and is called by the orchestrator |

## Isolation and reproducibility

| Check | State | Evidence |
|---|---|---|
| Runs are isolated; one refund cannot move another's start state | ✅ | `test_sandboxes_are_isolated` |
| Comparisons start from equivalent state | ✅ | Same test + per-run sandbox materialisation with a recorded `snapshot_hash` |
| Dataset generation is reproducible from a seed | ✅ | `test_generation_is_reproducible_from_seed` |
| Referential integrity, integer minor units | ✅ | `test_generator_maintains_referential_integrity` |
| Suites are frozen; new attacks create a new suite version | ✅ | `handle_adversary_suite` writes a new `Suite` row; verified live (see below) |
| Splits are entity-separated | ✅ | `test_suite_generation_binds_to_real_records`; browser test re-checks it through the API |

## Improvement loop integrity

| Check | State | Evidence |
|---|---|---|
| Candidate revisions cannot change the business contract | ✅ | By construction — the designer returns only a policy document, validated by `validate_document`; the contract is loaded from `config/` and never written |
| Candidate revisions cannot change the scorers | ✅ | By construction — scorers are code; the proposal schema has no scorer field |
| Final test inputs are not included in improvement prompts | ✅ | `collect_evidence(..., DEV_SPLITS)`; the test split is only touched by the final assessment step |
| Invalid proposals are stored and rejected, not silently dropped | ✅ | `create_policy_version` stores invalid documents with `validation_status="invalid"` |
| Metrics computed correctly from persisted evidence | ✅ | `test_runner_records_real_evidence` asserts stored metrics against known rows |
| Zero denominators report "No data", never 0 % | ✅ | `test_runner_records_real_evidence`, `test_model_failure_is_recorded_not_hidden`; browser test asserts the UI string |
| Model failures stay failures | ✅ | `test_model_failure_is_recorded_not_hidden` |
| Cancellation and restart preserve truthful job status | ✅ | `mark_interrupted_jobs()` on startup; `request_cancel` + `check_cancelled` between steps; observed in the UI job panel |
| Duplicate job submissions are de-duplicated | ✅ | Observed: a second identical baseline POST returned the same job id |

## Live service verification

Performed on 2026-09-12 against entity `anantaverma20-university-of-the-pacific`, project `scopeforge`.

| Check | State | Evidence |
|---|---|---|
| W&B Inference reachable, model list retrieved | 🌐 | `POST /api/integrations/check` → 28 models from `https://api.inference.wandb.ai/v1` |
| Configured model actually emits tool calls | 🌐 | Live probe: `openai/gpt-oss-120b` returned `tool_calls` (`lookup_order_status`), finish_reason `tool_calls`, 206 tokens |
| Real agent runs through the gateway | 🌐 | Live baseline, 8/8 dev scenarios completed, 11 tool calls executed, 23,881 tokens |
| Weave tracing works and run ids are recorded | 🌐 | 8/8 runs `trace_status = traced`, each with a Weave call URL |
| W&B MCP: real client, schemas discovered not assumed | 🌐 | 30 tools discovered from `https://mcp.withwandb.com/mcp`; evidence fetch used `infer_trace_schema_tool` + `query_weave_traces_tool` |
| Policy designer produces a validated candidate from real evidence | 🌐 | Two candidates proposed by `openai/gpt-oss-120b`, both schema-valid and both passing the gates; `evidence_refs` cite real scenario/run/experiment ids. Only v2 was a functional change — v3 reordered ANDed conditions and decides identically (see below) |
| A proposal with no functional change is rejected, not evaluated | ✅ | `find_semantic_duplicate` matched the real v2/v3 pair: different `canonical_hash`, identical `semantic_hash`. Covered by `tests/test_policy_semantics.py` |
| Full improvement loop end to end | 🌐 | `job_96cd752147b6`: 44 scenario runs, 98 model calls, evidence mode `mcp`, unauthorized success 75 % → 0 % with legitimate completion held at 100 % |
| Held-out test split used once, at the end | 🌐 | `exp_2e58d2e85b91` — 100 % legitimate completion, 0 % unauthorized success |
| Activation gated on the acceptance result | 🌐 | v3 activated after passing all five gates; the permissive baseline refuses activation |
| Playground enforcement on a fresh request | 🌐 | clean request allowed with 4 fields filtered out; cross-customer request denied `CONTRACT_CROSS_CUSTOMER` by rule `deny_cross_customer` |
| Cost reporting | ⛔ (by design) | No verified per-token rate configured → UI shows token usage and "Cost unavailable" |

### Integration defects found and fixed during live verification

1. **`OpenAI-Project` header rejected.** Passing `project="entity/project"` to the OpenAI client (as the W&B
   docs example shows) made `/chat/completions` return `401 invalid_api_key`, while `/models` with the same
   key returned `200`. The header is now off by default behind `LLM_SEND_PROJECT_HEADER`.
2. **MCP SDK field naming.** The installed `mcp` SDK exposes `Tool.input_schema` (not `inputSchema`) and
   `streamable_http_client` (not `streamablehttp_client`). Assuming the older names produced an opaque
   `ExceptionGroup`. Fixed, and MCP errors are now flattened so the real cause is visible.
3. **Windows console encoding broke Weave init.** On a cp1252 console, Weave's startup banner (`→`, emoji)
   raised `UnicodeEncodeError` from inside `weave.init`, surfacing as a tracing failure unrelated to
   credentials. Fixed process-wide in `app/__init__.py` plus a guard around the init call; covered by
   `tests/test_tracing_console.py` and verified by running the backend with `python -X utf8=0`.
4. **Relative `DATABASE_URL`.** The shipped example path resolved against the working directory and broke when
   uvicorn was started from `backend/`. Relative SQLite paths now resolve against the repository root.

### Loop-quality fix found while reviewing the live results

**A no-op proposal was accepted as an improvement.** Iteration 2 returned the same eight conditions in a
different order inside `allow_issue_refund`. Because they are ANDed, v3 decides exactly as v2 does — but the
gates passed (an identical policy naturally scores identically) and it was recorded as accepted, which reads
like two improvements when there was one.

Fixed by giving a policy two hashes: `canonical_hash` (the exact document, for provenance) and
`semantic_hash`, which normalises away what cannot change a decision — prose, condition order inside an
`all`/`any`, and the ordering of `tools`, `response_fields` and `in`/`not_in` operand lists. Rule order and
`reason_code` are deliberately *not* normalised, because they do change outcomes. The loop now rejects a
candidate matching any earlier version in its family with `no functional change` and stops, since the
evidence the designer saw is unchanged and re-asking would return the same proposal.

## Browser workflow

All ✅, `frontend/tests/workflow.spec.ts` (9 tests, Chromium):

- the shell loads and integration pills match `/api/health` exactly
- a dataset is generated and its counts match the API
- a suite is generated; no customer spans two splits
- the scenario drawer shows the trusted actor and states that expectations are admin-only
- the permissive baseline is visible and its activation button is disabled
- experiments show real outcomes, including "No data" for zero denominators
- the playground refuses to run without an activated policy
- settings expose no secret material (`credentials_present` carries booleans only)
- keyboard navigation reaches the primary sections

## Not implemented

| Item | State | Note |
|---|---|---|
| ARIA integration | ⬜ | Optional. No API was invented; it can be used manually against the real W&B results. |
| TypeSafe AI integration | ⬜ | Optional. Not integrated — that needs verified documentation and credentials. |
| Shopify / Stripe / Zendesk connectors | ⬜ | Not required. The business sandbox is synthetic and local by design. |
| JSON/CSV dataset import | ⬜ | Generation works; import was listed as a follow-on. |
| Multi-turn scenarios | ⬜ | Each scenario is a single customer message today. |
| Repeated runs per scenario with variance | ⬜ | See `docs/limitations.md`. |
| marimo evaluation notebook | ✅ | `notebooks/policy_comparison.py` — reads persisted results, reuses `app.evaluations.metrics`. |
