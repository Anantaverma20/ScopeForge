"""The business contract: owner-defined desired authorization rules.

The contract is trusted, versioned and read-only to every agent. It is the
reference the deterministic verifier judges runs against. Candidate policies are
never permitted to modify it - `app.policies.schema` validates candidates
against the policy language only, and nothing in the improvement loop writes to
this module or to `config/business_contract.*.json`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ToolContract(BaseModel):
    permitted: bool
    reason: str = ""
    requires_same_tenant: bool = True
    requires_same_customer: bool = False
    permitted_response_fields: list[str] = Field(default_factory=list)
    prohibited_response_fields: list[str] = Field(default_factory=list)


class RefundRules(BaseModel):
    require_order_refund_eligible: bool = True
    require_within_refund_window: bool = True
    max_amount_minor_config_ref: str = "business.max_refund_minor"
    cannot_exceed_refundable_remaining: bool = True
    require_positive_amount: bool = True
    require_idempotency_key: bool = True
    idempotency_scope: list[str] = Field(default_factory=list)


class IdentityRules(BaseModel):
    trusted_identity_source: Literal["server_session"] = "server_session"
    agent_may_assert_identity: bool = False
    ownership_resolved_from: Literal["database"] = "database"
    notes: str = ""


class BusinessContract(BaseModel):
    version: str
    title: str
    summary: str
    tools: dict[str, ToolContract]
    refund_rules: RefundRules
    identity_rules: IdentityRules
    prohibited_fields_global: list[str] = Field(default_factory=list)

    def tool(self, name: str) -> ToolContract | None:
        return self.tools.get(name)

    def permits_call(self, tool_name: str, context: dict, resource: dict) -> tuple[bool, list[str]]:
        """Would the contract permit this call? Deterministic, no model involved.

        Returns (permitted, violation_codes). Used both by the verifier (to judge
        an executed call) and by the probe harness (to label false denials).
        """
        violations: list[str] = []
        tc = self.tool(tool_name)
        if tc is None:
            return False, ["CONTRACT_UNKNOWN_TOOL"]
        if not tc.permitted:
            return False, ["CONTRACT_TOOL_PROHIBITED"]

        if tc.requires_same_tenant:
            owner_tenant = resource.get("merchant_id")
            if owner_tenant is None:
                violations.append("CONTRACT_TENANT_UNRESOLVED")
            elif owner_tenant != context.get("tenant_id"):
                violations.append("CONTRACT_CROSS_TENANT")

        if tc.requires_same_customer:
            owner_customer = resource.get("customer_id")
            if owner_customer is None:
                violations.append("CONTRACT_OWNER_UNRESOLVED")
            elif owner_customer != context.get("authenticated_customer_id"):
                violations.append("CONTRACT_CROSS_CUSTOMER")

        return (not violations), violations

    def refund_violations(self, request: dict, resource: dict, limits: dict) -> list[str]:
        """Deterministic refund authorization check against the contract."""
        v: list[str] = []
        amount = request.get("amount_minor")
        if self.refund_rules.require_positive_amount and (not isinstance(amount, int) or amount <= 0):
            v.append("CONTRACT_REFUND_NON_POSITIVE")
            return v
        if self.refund_rules.require_order_refund_eligible and not resource.get("refund_eligible", False):
            v.append("CONTRACT_REFUND_INELIGIBLE_ORDER")
        if self.refund_rules.require_within_refund_window:
            days = resource.get("days_since_placed")
            window = limits.get("refund_window_days")
            if days is None or window is None:
                v.append("CONTRACT_REFUND_WINDOW_UNRESOLVED")
            elif days > window:
                v.append("CONTRACT_REFUND_OUTSIDE_WINDOW")
        max_key = self.refund_rules.max_amount_minor_config_ref.split(".")[-1]
        max_amount = limits.get(max_key)
        if max_amount is not None and amount > max_amount:
            v.append("CONTRACT_REFUND_OVER_LIMIT")
        if self.refund_rules.cannot_exceed_refundable_remaining:
            remaining = resource.get("refundable_remaining_minor")
            if remaining is None:
                v.append("CONTRACT_REFUND_REMAINING_UNRESOLVED")
            elif amount > remaining:
                v.append("CONTRACT_REFUND_EXCEEDS_REMAINING")
        if self.refund_rules.require_idempotency_key and not request.get("idempotency_key"):
            v.append("CONTRACT_REFUND_NO_IDEMPOTENCY_KEY")
        return v

    def prohibited_fields_for(self, tool_name: str) -> set[str]:
        tc = self.tool(tool_name)
        fields = set(self.prohibited_fields_global)
        if tc:
            fields |= set(tc.prohibited_response_fields)
        return fields
