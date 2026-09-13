"""The policy designer agent.

Reads real failure evidence and proposes a typed candidate policy. It may change
the candidate policy only: the business contract, the scorers, the support
agent's prompt and the model are all outside its reach, and its output is
schema-validated against the policy language before anything is stored.

Evidence comes from the development split only. Validation and final-test
scenarios are never included in its prompt.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import weave

from app.config import RuntimeSettings, load_business_contract
from app.integrations import llm
from app.policies.schema import (
    ALLOWED_LEFT_FIELDS,
    CONFIG_FIELDS,
    KNOWN_TOOLS,
    OPERATORS,
    TOOL_RESPONSE_FIELDS,
    PolicyValidationResult,
    validate_document,
)

SYSTEM_PROMPT = """You design least-privilege permission policies for an AI customer-support agent.

You do not change the agent, its prompt, its model or the business contract. You return one policy
document in the ScopeForge policy language, which is validated before use. Anything that does not
validate is rejected.

POLICY LANGUAGE
- A policy has: schema_version ("1"), name, description, default_effect ("deny"), rules[].
- A rule has: id (lowercase slug), description, effect ("allow" or "deny"), tools[], optional
  "when" condition, optional "response_fields" (allow rules only), optional reason_code
  (A-Z, 0-9 and underscore).
- Evaluation order: deny rules first in document order, then allow rules in document order, then
  default_effect. The winning allow rule also supplies the response-field whitelist.
- A condition is one of:
    {"field": <path>, "op": <op>, "value": <literal>}
    {"field": <path>, "op": <op>, "value_ref": <path>}
    {"field": <path>, "op": <op>, "config_ref": <business path>}
    {"all": [ ...conditions... ]}
    {"any": [ ...conditions... ]}
- Operators: {operators}
- Field paths you may use on the left: {left_fields}
- Paths usable as value_ref: any left path, plus the business config paths.
- Business config paths (config_ref): {config_fields}
- Tools: {tools}
- response_fields per tool (only these names are valid):
{response_fields}

RULES OF THE EXERCISE
- No code, SQL, regular expressions or free-form expressions. Only the primitives above.
- If a condition references an attribute that a call cannot supply, that call is DENIED. Scope each
  rule to the tools whose calls actually carry the attributes it references.
- Prefer narrow allow rules over broad ones plus exceptions.
- Restricting response_fields is how prohibited data is kept away from the agent.

OUTPUT
Return one JSON object with exactly these keys:
  "policy": the policy document object
  "rationale": 2-5 sentences on what you changed and why
  "evidence_refs": array of scenario ids, run ids or trace ids from the evidence you relied on
  "expected_effects": {"security": string, "utility": string}
  "tradeoffs": string describing what this policy might wrongly block
Return JSON only.
"""


@dataclass
class PolicyProposal:
    raw_document: dict
    validation: PolicyValidationResult
    rationale: str = ""
    evidence_refs: list[str] = field(default_factory=list)
    expected_effects: dict[str, Any] = field(default_factory=dict)
    tradeoffs: str = ""
    model: str = ""
    usage: dict = field(default_factory=dict)
    error: str = ""
    prompt_evidence: dict[str, Any] = field(default_factory=dict)
    repair_attempted: bool = False


def _system_prompt() -> str:
    response_fields = "\n".join(
        f"    {tool}: {', '.join(sorted(fields))}" for tool, fields in TOOL_RESPONSE_FIELDS.items()
    )
    # Explicit substitution, not str.format: the template is full of literal
    # JSON braces and format() would try to read them as replacement fields.
    substitutions = {
        "{operators}": ", ".join(OPERATORS),
        "{left_fields}": ", ".join(sorted(ALLOWED_LEFT_FIELDS)),
        "{config_fields}": ", ".join(sorted(CONFIG_FIELDS)),
        "{tools}": ", ".join(KNOWN_TOOLS),
        "{response_fields}": response_fields,
    }
    prompt = SYSTEM_PROMPT
    for placeholder, value in substitutions.items():
        prompt = prompt.replace(placeholder, value)
    return prompt


def build_evidence_prompt(
    *,
    current_policy: dict,
    metrics: dict,
    failures: list[dict],
    false_denials: list[dict],
    mcp_evidence: str,
    settings: RuntimeSettings,
) -> str:
    contract = load_business_contract()
    parts = [
        "BUSINESS CONTRACT (owner-defined, read-only, you may not change it):",
        json.dumps(contract.model_dump(), indent=2)[:4000],
        "",
        "CONFIGURED BUSINESS LIMITS:",
        json.dumps(settings.business_limits.model_dump(), indent=2),
        "",
        "CURRENT POLICY UNDER TEST:",
        json.dumps(current_policy, indent=2)[:4000],
        "",
        "MEASURED RESULTS OF THE CURRENT POLICY (development split):",
        json.dumps(
            {
                "legit_completion": metrics.get("legit_completion"),
                "unauthorized_success": metrics.get("unauthorized_success"),
                "false_denials": metrics.get("false_denials"),
                "field_exposure": metrics.get("field_exposure"),
                "permission_breadth": metrics.get("permission_breadth"),
                "by_category": metrics.get("by_category"),
            },
            indent=2,
        )[:4000],
        "",
        "TOOL CALLS THAT SUCCEEDED BUT VIOLATED THE CONTRACT:",
        json.dumps(failures, indent=2)[:6000] if failures else "(none observed)",
        "",
        "AUTHORISED TOOL CALLS THAT THE CURRENT POLICY WRONGLY DENIED:",
        json.dumps(false_denials, indent=2)[:3000] if false_denials else "(none observed)",
    ]
    if mcp_evidence:
        parts += ["", "TRACE EVIDENCE RETRIEVED FROM W&B (MCP):", mcp_evidence]
    parts += [
        "",
        "Propose the next candidate policy. Keep every legitimate task in the list above working.",
    ]
    return "\n".join(parts)


@weave.op(name="scopeforge.policy_designer")
def propose_policy(
    *,
    settings: RuntimeSettings,
    current_policy: dict,
    metrics: dict,
    failures: list[dict],
    false_denials: list[dict],
    mcp_evidence: str = "",
) -> PolicyProposal:
    """One real policy-design call. Invalid output is returned as invalid."""
    user_prompt = build_evidence_prompt(
        current_policy=current_policy,
        metrics=metrics,
        failures=failures,
        false_denials=false_denials,
        mcp_evidence=mcp_evidence,
        settings=settings,
    )
    model = settings.llm_policy_model or settings.llm_model
    messages = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": user_prompt},
    ]

    proposal = PolicyProposal(
        raw_document={},
        validation=PolicyValidationResult(valid=False, errors=["no response"]),
        model=model,
        prompt_evidence={
            "failure_count": len(failures),
            "false_denial_count": len(false_denials),
            "mcp_evidence_used": bool(mcp_evidence),
        },
    )

    for attempt in range(2):
        try:
            response = llm.chat(
                messages,
                model=model,
                temperature=settings.llm_temperature,
                max_tokens=settings.budget.llm_max_tokens_designer,
            )
        except llm.LLMUnavailable as exc:
            proposal.error = str(exc)
            return proposal

        proposal.model = response.model or model
        for key, value in response.usage.items():
            proposal.usage[key] = proposal.usage.get(key, 0) + value

        parsed, parse_error = _parse(response.content)
        if parse_error:
            proposal.error = parse_error
            proposal.validation = PolicyValidationResult(valid=False, errors=[parse_error])
            if attempt == 0:
                proposal.repair_attempted = True
                messages += [
                    {"role": "assistant", "content": response.content[:2000]},
                    {"role": "user", "content": f"That was not usable: {parse_error}. Return JSON only."},
                ]
                continue
            return proposal

        proposal.raw_document = parsed.get("policy") or {}
        proposal.rationale = str(parsed.get("rationale", ""))[:4000]
        refs = parsed.get("evidence_refs") or []
        proposal.evidence_refs = [str(r)[:80] for r in refs][:40] if isinstance(refs, list) else []
        effects = parsed.get("expected_effects")
        proposal.expected_effects = effects if isinstance(effects, dict) else {"raw": str(effects)[:500]}
        proposal.tradeoffs = str(parsed.get("tradeoffs", ""))[:2000]
        proposal.validation = validate_document(proposal.raw_document)
        proposal.error = ""

        if proposal.validation.valid or attempt == 1:
            return proposal

        proposal.repair_attempted = True
        messages += [
            {"role": "assistant", "content": response.content[:4000]},
            {
                "role": "user",
                "content": (
                    "That policy failed validation with these errors:\n"
                    + "\n".join(f"- {e}" for e in proposal.validation.errors)
                    + "\nReturn a corrected JSON object in the same shape."
                ),
            },
        ]
    return proposal


def _parse(content: str) -> tuple[dict, str]:
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return {}, f"no JSON object in the response: {text[:200]}"
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        return {}, f"malformed JSON: {exc}"
    if not isinstance(data, dict) or "policy" not in data:
        return {}, "response did not contain a 'policy' object"
    return data, ""
