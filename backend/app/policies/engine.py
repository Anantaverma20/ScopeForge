"""Policy evaluation. Deterministic, fail-closed, no dynamic code execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.policies.schema import (
    AllNode,
    AnyNode,
    Comparison,
    Condition,
    PolicyDocument,
    validate_document,
)


class ReasonCode:
    UNKNOWN_TOOL = "UNKNOWN_TOOL"
    INVALID_POLICY = "INVALID_POLICY"
    INVALID_ARGUMENTS = "INVALID_ARGUMENTS"
    MISSING_CONTEXT = "MISSING_CONTEXT"
    MISSING_ATTRIBUTE = "MISSING_ATTRIBUTE"
    DEFAULT_DENY = "DEFAULT_DENY"
    RULE_DENY = "RULE_DENY"
    RULE_ALLOW = "RULE_ALLOW"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    BUSINESS_RULE_VIOLATION = "BUSINESS_RULE_VIOLATION"
    DUPLICATE_REQUEST = "DUPLICATE_REQUEST"
    EXECUTION_ERROR = "EXECUTION_ERROR"


REQUIRED_CONTEXT_KEYS = ("tenant_id", "authenticated_customer_id", "session_id", "contract_version")


class MissingAttribute(Exception):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        self.path = path


@dataclass(frozen=True)
class Decision:
    allow: bool
    reason_code: str
    reason_detail: str = ""
    matched_rule_id: str = ""
    response_fields: list[str] | None = None
    trace: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "allow": self.allow,
            "reason_code": self.reason_code,
            "reason_detail": self.reason_detail,
            "matched_rule_id": self.matched_rule_id,
            "response_fields": self.response_fields,
            "trace": self.trace,
        }


_SENTINEL = object()


def _lookup(path: str, context: dict, resource: dict, request: dict, limits: dict) -> Any:
    root, _, key = path.partition(".")
    source = {
        "context": context,
        "resource": resource,
        "request": request,
        "business": limits,
    }.get(root)
    if source is None:
        raise MissingAttribute(path)
    value = source.get(key, _SENTINEL)
    if value is _SENTINEL or value is None:
        raise MissingAttribute(path)
    return value


def _compare(node: Comparison, context: dict, resource: dict, request: dict, limits: dict) -> bool:
    left = _lookup(node.field, context, resource, request, limits)
    if node.value_ref is not None:
        right = _lookup(node.value_ref, context, resource, request, limits)
    elif node.config_ref is not None:
        right = _lookup(node.config_ref, context, resource, request, limits)
    else:
        right = node.value

    op = node.op
    try:
        if op == "eq":
            return left == right
        if op == "ne":
            return left != right
        if op == "in":
            return left in right
        if op == "not_in":
            return left not in right
        if op == "lt":
            return left < right
        if op == "lte":
            return left <= right
        if op == "gt":
            return left > right
        if op == "gte":
            return left >= right
    except TypeError:
        # incomparable types: treat as a malformed attribute, fail closed
        raise MissingAttribute(node.field) from None
    raise MissingAttribute(node.field)


def _evaluate(node: Condition | None, context: dict, resource: dict, request: dict, limits: dict) -> bool:
    if node is None:
        return True
    if isinstance(node, AllNode):
        return all(_evaluate(c, context, resource, request, limits) for c in node.all)
    if isinstance(node, AnyNode):
        return any(_evaluate(c, context, resource, request, limits) for c in node.any)
    return _compare(node, context, resource, request, limits)


class PolicyEngine:
    """Evaluates one immutable policy document."""

    def __init__(self, document: PolicyDocument, known_tools: tuple[str, ...], limits: dict) -> None:
        self.document = document
        self.known_tools = known_tools
        self.limits = limits

    @classmethod
    def from_raw(cls, raw: dict, known_tools: tuple[str, ...], limits: dict) -> "PolicyEngine | None":
        result = validate_document(raw)
        if not result.valid or result.document is None:
            return None
        return cls(result.document, known_tools, limits)

    def decide(self, tool_name: str, context: dict, resource: dict, request: dict) -> Decision:
        trace: list[str] = []

        if tool_name not in self.known_tools:
            return Decision(False, ReasonCode.UNKNOWN_TOOL, f"tool {tool_name!r} is not registered", trace=trace)

        missing_ctx = [k for k in REQUIRED_CONTEXT_KEYS if not context.get(k)]
        if missing_ctx:
            return Decision(
                False,
                ReasonCode.MISSING_CONTEXT,
                f"trusted context missing: {', '.join(missing_ctx)}",
                trace=trace,
            )

        applicable = [r for r in self.document.rules if tool_name in r.tools]
        for phase_effect in ("deny", "allow"):
            for rule in applicable:
                if rule.effect != phase_effect:
                    continue
                try:
                    matched = _evaluate(rule.when, context, resource, request, self.limits)
                except MissingAttribute as exc:
                    return Decision(
                        False,
                        ReasonCode.MISSING_ATTRIBUTE,
                        f"rule {rule.id!r} references {exc.path!r}, which is not available for this call",
                        matched_rule_id=rule.id,
                        trace=trace + [f"{rule.id}: missing attribute {exc.path}"],
                    )
                trace.append(f"{rule.id} ({rule.effect}): {'match' if matched else 'no match'}")
                if matched:
                    if rule.effect == "deny":
                        return Decision(
                            False,
                            rule.reason_code or ReasonCode.RULE_DENY,
                            rule.description or f"denied by rule {rule.id}",
                            matched_rule_id=rule.id,
                            trace=trace,
                        )
                    return Decision(
                        True,
                        rule.reason_code or ReasonCode.RULE_ALLOW,
                        rule.description or f"allowed by rule {rule.id}",
                        matched_rule_id=rule.id,
                        response_fields=rule.response_fields,
                        trace=trace,
                    )

        if self.document.default_effect == "allow":
            return Decision(True, "DEFAULT_ALLOW", "no rule matched; policy default is allow", trace=trace)
        return Decision(False, ReasonCode.DEFAULT_DENY, "no rule allowed this call", trace=trace)


def filter_record(record: dict, allowed: list[str] | None) -> tuple[dict, list[str]]:
    """Apply a response-field whitelist. Returns (filtered, removed_field_names)."""
    if allowed is None:
        return dict(record), []
    allowed_set = set(allowed)
    filtered = {k: v for k, v in record.items() if k in allowed_set}
    removed = sorted(k for k in record if k not in allowed_set)
    return filtered, removed
