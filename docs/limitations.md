# Limitations and next steps

## What this prototype is not

- **Not production authentication or authorization.** Trusted identity is constructed server-side for an
  experiment. There is no real auth provider, no session security, no audit retention policy.
- **Not a security certification.** A policy accepted here passed the scenarios that were run, inside the
  policy language that exists. That is all it means.
- **Not a minimality proof.** Nothing here searches the space of policies exhaustively or proves that a
  smaller permission set would still work. "Least privilege" is a direction, not a claim.
- **Not evidence of customer demand.** The customer framing is a design assumption, not a validated finding.
- **No language model is trained.** What improves between iterations is the permission policy.

## Known limitations

**Coverage is bounded by what was tested.**
Enforcement covers the five implemented tools (`get_order`, `list_orders`, `get_customer`, `issue_refund`,
`export_customers`). Permission breadth is measured over a *generated probe set*, which is finite and
labelled as measured coverage — not the total possible attack surface.

**The policy language is deliberately small.**
Equality, membership, numeric comparison, AND and OR over an allow-list of context, resource and request
fields. It cannot express time-of-day rules, rate limits, approval workflows, quotas, or relationships more
than one hop from the resource. Anything a policy cannot express, it cannot restrict.

**The tested agent is not hardened.**
The support agent runs an ordinary support prompt with no prompt-injection defences. That is intentional: the
question under test is what *permission enforcement* does, not what a defensive prompt does. Real deployments
would combine both, and results here should not be read as a measure of model robustness.

**Scenario coverage is small and template-driven.**
Six attack categories and five legitimate task shapes, parameterised over generated entities. Model-written
variants add linguistic diversity within those same categories. Novel attack classes will not appear on their
own.

**Statistical strength is low.**
Suites are tens of scenarios, not thousands. A difference of one or two scenarios moves a rate by several
percentage points. Rates are always shown with their numerator and denominator for exactly this reason. There
is no confidence interval, no repeated-sampling variance estimate, and no multiple-comparison correction
across iterations.

**Non-determinism is not controlled away.**
The agent is a language model at non-zero temperature. Two runs of the same scenario under the same policy can
differ. Sandbox state and inputs are identical; the model's choices are not.

**Single local workspace.**
One SQLite database, one background worker, one user. No multi-user isolation, no authentication on the API,
no horizontal scaling. CORS is restricted to the configured local development origins.

**Scorer scope.**
Task completion is verified from business state where a scenario changes state, and from checkable response
content (for example, the order id appearing in the reply) where it does not. The second is weaker: an agent
could in principle mention an id without genuinely answering. Contract violations, by contrast, are read from
executed tool calls and are not open to that objection.

**Evidence retrieval depends on trace ingestion.**
W&B MCP retrieval uses bounded retries because traces take time to become queryable. If they are not ready,
the loop proceeds on locally stored traces and labels itself `local_evidence` rather than `mcp_assisted`.

**Cost is usually unavailable.**
Dollar cost is reported only when a verified per-token rate is configured for the actual model. Otherwise the
UI shows token usage and "Cost unavailable".

## Next steps, roughly in order of value

1. **Widen the policy language** with obligations (redact rather than deny), rate limits and per-role scoping,
   keeping the same "no executable expressions" rule.
2. **Repeat runs per scenario** and report variance, so a difference between policies can be distinguished
   from model noise.
3. **Grow the attack corpus** beyond six categories, and let the adversary iterate against a *fixed* policy to
   find what that policy actually misses, rather than generating from a category brief.
4. **Real connector shims** (Shopify, Stripe, Zendesk) behind the same gateway, so the same policy language
   governs tools whose responses are not under our control.
5. **Policy search** rather than single-shot proposals: hold the best-so-far and explore neighbours, with the
   acceptance gate as the objective.
6. **Multi-turn conversations** in scenarios; today each scenario is one customer message.
7. **Export to real enforcement targets** — translating an accepted policy into OPA/Rego or a gateway
   configuration, with a conformance test proving the translation preserves decisions.
8. **Regression suite over accepted policies**, so a later candidate cannot silently undo an earlier fix.
