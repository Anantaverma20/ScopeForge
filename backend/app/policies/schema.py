"""The ScopeForge policy language.

A policy is schema-validated JSON built from a small set of primitives. No
model-generated Python, JavaScript, SQL or free-form expression is ever
executed: a condition is a tree of typed comparison nodes over an explicitly
allowed set of context / resource / request field paths and configured business
values.

Evaluation order (documented behaviour, implemented in `engine.py`):

1. Unknown tool                  -> DENY  (UNKNOWN_TOOL)
2. Invalid policy document       -> DENY  (INVALID_POLICY)
3. Missing required context      -> DENY  (MISSING_CONTEXT)
4. Any condition referencing an attribute that is absent from the evaluation
   context -> DENY (MISSING_ATTRIBUTE). Fail closed, whatever the rule effect.
5. Deny rules, in document order -> first match wins
6. Allow rules, in document order -> first match wins; that rule also supplies
   the response-field whitelist applied before results reach the agent
7. Otherwise `default_effect` (deny in every shipped policy) -> DEFAULT_DENY
"""

from __future__ import annotations

import hashlib
import json
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

SCHEMA_VERSION = "1"

# --------------------------------------------------------------------------- #
# Allowed field paths. A policy referencing anything else fails validation.
# --------------------------------------------------------------------------- #
CONTEXT_FIELDS = {
    "context.tenant_id",
    "context.authenticated_customer_id",
    "context.session_id",
    "context.contract_version",
    "context.channel",
}

RESOURCE_FIELDS = {
    "resource.kind",
    "resource.order_id",
    "resource.merchant_id",
    "resource.customer_id",
    "resource.status",
    "resource.currency",
    "resource.total_minor",
    "resource.refunded_minor",
    "resource.refundable_remaining_minor",
    "resource.refund_eligible",
    "resource.days_since_placed",
    "resource.days_since_delivered",
    "resource.requested_customer_id",
    "resource.record_count",
    "resource.resolved",
}

REQUEST_FIELDS = {
    "request.tool",
    "request.amount_minor",
    "request.has_idempotency_key",
    "request.has_reason",
}

CONFIG_FIELDS = {
    "business.max_refund_minor",
    "business.refund_window_days",
    "business.currency",
    "business.refundable_order_statuses",
}

ALLOWED_LEFT_FIELDS = CONTEXT_FIELDS | RESOURCE_FIELDS | REQUEST_FIELDS
ALLOWED_REF_FIELDS = ALLOWED_LEFT_FIELDS | CONFIG_FIELDS

OPERATORS = ("eq", "ne", "in", "not_in", "lt", "lte", "gt", "gte")

# Tools the policy language knows about. Keep in sync with the tool registry;
# `engine.validate_document` rejects a policy naming anything else.
KNOWN_TOOLS = ("get_order", "list_orders", "get_customer", "issue_refund", "export_customers")

# Response fields a policy may whitelist, per tool. A policy naming a field that
# the tool cannot return is rejected (it would silently do nothing).
TOOL_RESPONSE_FIELDS: dict[str, set[str]] = {
    "get_order": {
        "order_id", "merchant_id", "customer_id", "status", "placed_at", "delivered_at",
        "currency", "total_minor", "refunded_minor", "refundable_remaining_minor",
        "refund_eligible", "refund_eligibility_reason", "items",
        "merchant_cost_minor", "margin_minor", "fraud_score", "internal_flags",
    },
    "list_orders": {
        "order_id", "merchant_id", "customer_id", "status", "placed_at", "currency",
        "total_minor", "refunded_minor", "refundable_remaining_minor", "refund_eligible",
        "merchant_cost_minor", "margin_minor", "fraud_score", "internal_flags",
    },
    "get_customer": {
        "customer_id", "merchant_id", "name", "email", "phone", "city", "country",
        "loyalty_tier", "created_at", "ssn_last4", "internal_risk_score",
        "lifetime_value_minor", "marketing_segment", "internal_notes",
    },
    "issue_refund": {
        "refund_id", "order_id", "amount_minor", "currency", "status", "created_at",
        "refunded_minor_total", "refundable_remaining_minor",
    },
    "export_customers": {
        "customer_id", "merchant_id", "name", "email", "phone", "city", "country",
        "loyalty_tier", "created_at", "ssn_last4", "internal_risk_score",
        "lifetime_value_minor", "marketing_segment", "internal_notes",
    },
}


class Comparison(BaseModel):
    """`field op (value | value_ref | config_ref)`"""

    model_config = {"extra": "forbid"}

    field: str
    op: Literal["eq", "ne", "in", "not_in", "lt", "lte", "gt", "gte"]
    value: Any = None
    value_ref: str | None = None
    config_ref: str | None = None

    @field_validator("field")
    @classmethod
    def _known_field(cls, v: str) -> str:
        if v not in ALLOWED_LEFT_FIELDS:
            raise ValueError(f"unknown field path: {v}")
        return v

    @model_validator(mode="after")
    def _exactly_one_operand(self) -> "Comparison":
        provided = [self.value is not None, self.value_ref is not None, self.config_ref is not None]
        if sum(provided) != 1:
            raise ValueError("exactly one of value, value_ref, config_ref is required")
        if self.value_ref is not None and self.value_ref not in ALLOWED_REF_FIELDS:
            raise ValueError(f"unknown value_ref path: {self.value_ref}")
        if self.config_ref is not None and self.config_ref not in CONFIG_FIELDS:
            raise ValueError(f"unknown config_ref path: {self.config_ref}")
        if self.op in ("in", "not_in") and self.value is not None and not isinstance(self.value, list):
            raise ValueError("in / not_in require a list value")
        return self


class AllNode(BaseModel):
    model_config = {"extra": "forbid"}
    all: list["Condition"] = Field(min_length=1, max_length=20)


class AnyNode(BaseModel):
    model_config = {"extra": "forbid"}
    any: list["Condition"] = Field(min_length=1, max_length=20)


Condition = Annotated[Union[AllNode, AnyNode, Comparison], Field(union_mode="left_to_right")]
AllNode.model_rebuild()
AnyNode.model_rebuild()


class Rule(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(pattern=r"^[a-z0-9_\-]{1,60}$")
    description: str = Field(default="", max_length=400)
    effect: Literal["allow", "deny"]
    tools: list[str] = Field(min_length=1, max_length=len(KNOWN_TOOLS))
    when: Condition | None = None
    response_fields: list[str] | None = None
    reason_code: str = Field(default="", pattern=r"^[A-Z0-9_]{0,48}$")

    @field_validator("tools")
    @classmethod
    def _known_tools(cls, v: list[str]) -> list[str]:
        for tool in v:
            if tool not in KNOWN_TOOLS:
                raise ValueError(f"unknown tool: {tool}")
        return v

    @model_validator(mode="after")
    def _response_fields_valid(self) -> "Rule":
        if self.response_fields is None:
            return self
        if self.effect == "deny":
            raise ValueError("response_fields is only meaningful on an allow rule")
        allowed: set[str] = set()
        for tool in self.tools:
            allowed |= TOOL_RESPONSE_FIELDS.get(tool, set())
        unknown = [f for f in self.response_fields if f not in allowed]
        if unknown:
            raise ValueError(f"response_fields not returned by these tools: {sorted(unknown)}")
        return self


class PolicyDocument(BaseModel):
    """The executable restriction set under test."""

    model_config = {"extra": "forbid"}

    schema_version: Literal["1"] = SCHEMA_VERSION
    name: str = Field(min_length=1, max_length=140)
    description: str = Field(default="", max_length=2000)
    default_effect: Literal["allow", "deny"] = "deny"
    rules: list[Rule] = Field(default_factory=list, max_length=60)

    @model_validator(mode="after")
    def _unique_rule_ids(self) -> "PolicyDocument":
        ids = [r.id for r in self.rules]
        if len(ids) != len(set(ids)):
            raise ValueError("rule ids must be unique")
        return self

    def canonical_json(self) -> str:
        return json.dumps(self.model_dump(mode="json", exclude_none=True), sort_keys=True, separators=(",", ":"))

    def canonical_hash(self) -> str:
        """Hash of the exact document, as written. Provenance identity."""
        return hashlib.sha256(self.canonical_json().encode("utf-8")).hexdigest()

    def semantic_json(self) -> str:
        """Normalised form: two documents that decide identically hash identically.

        Normalised away, because they cannot change a decision:
          * prose - policy name/description and per-rule description
          * the order of conditions inside an `all` / `any` node (pure AND / OR)
          * the order of a rule's `tools`, its `response_fields`, and the operand
            list of an `in` / `not_in` comparison - all membership tests

        Deliberately NOT normalised, because they do change decisions:
          * the order of `rules` - deny rules then allow rules, first match wins
          * `reason_code` - it is machine-readable output carried on the decision
        """
        return json.dumps(
            {
                "schema_version": self.schema_version,
                "default_effect": self.default_effect,
                "rules": [_normalise_rule(rule) for rule in self.rules],
            },
            sort_keys=True,
            separators=(",", ":"),
        )

    def semantic_hash(self) -> str:
        return hashlib.sha256(self.semantic_json().encode("utf-8")).hexdigest()

    def human_readable(self) -> list[dict[str, str]]:
        """Plain-language rendering of each rule for the UI."""
        out: list[dict[str, str]] = []
        for rule in self.rules:
            out.append(
                {
                    "id": rule.id,
                    "effect": rule.effect,
                    "tools": ", ".join(rule.tools),
                    "condition": describe_condition(rule.when),
                    "fields": (
                        "all fields"
                        if rule.response_fields is None
                        else ", ".join(rule.response_fields) or "no fields"
                    ),
                    "description": rule.description,
                }
            )
        return out


def _sortable(value: Any) -> Any:
    """Sort a literal list where the members allow it; otherwise leave it alone."""
    if not isinstance(value, list):
        return value
    try:
        return sorted(value, key=lambda item: (type(item).__name__, item))
    except TypeError:
        return value


def _normalise_condition(node: Condition | None) -> Any:
    """Order-insensitive form of a condition tree."""
    if node is None:
        return None
    if isinstance(node, AllNode):
        children = [_normalise_condition(child) for child in node.all]
        return {"all": sorted(children, key=lambda c: json.dumps(c, sort_keys=True))}
    if isinstance(node, AnyNode):
        children = [_normalise_condition(child) for child in node.any]
        return {"any": sorted(children, key=lambda c: json.dumps(c, sort_keys=True))}
    out: dict[str, Any] = {"field": node.field, "op": node.op}
    if node.value is not None:
        out["value"] = _sortable(node.value)
    elif node.value_ref is not None:
        out["value_ref"] = node.value_ref
    elif node.config_ref is not None:
        out["config_ref"] = node.config_ref
    return out


def _normalise_rule(rule: Rule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "effect": rule.effect,
        "tools": sorted(rule.tools),
        "when": _normalise_condition(rule.when),
        "response_fields": (None if rule.response_fields is None else sorted(rule.response_fields)),
        "reason_code": rule.reason_code,
    }


def describe_condition(node: Condition | None) -> str:
    if node is None:
        return "always"
    if isinstance(node, AllNode):
        return " AND ".join(f"({describe_condition(c)})" for c in node.all)
    if isinstance(node, AnyNode):
        return " OR ".join(f"({describe_condition(c)})" for c in node.any)
    op_text = {
        "eq": "is", "ne": "is not", "in": "is one of", "not_in": "is not one of",
        "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
    }[node.op]
    if node.value_ref is not None:
        right = node.value_ref
    elif node.config_ref is not None:
        right = f"configured {node.config_ref}"
    else:
        right = json.dumps(node.value)
    return f"{node.field} {op_text} {right}"


class PolicyValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    document: PolicyDocument | None = None


def validate_document(raw: dict | str) -> PolicyValidationResult:
    """Validate an untrusted policy document (for example from the designer)."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        return PolicyValidationResult(valid=False, errors=[f"not valid JSON: {exc}"])
    if not isinstance(data, dict):
        return PolicyValidationResult(valid=False, errors=["policy must be a JSON object"])
    try:
        doc = PolicyDocument.model_validate(data)
    except ValidationError as exc:
        errors = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        return PolicyValidationResult(valid=False, errors=errors)
    return PolicyValidationResult(valid=True, document=doc)


def policy_json_schema() -> dict:
    """JSON Schema handed to the policy designer so it emits valid documents."""
    return PolicyDocument.model_json_schema()
