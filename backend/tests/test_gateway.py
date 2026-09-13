"""Enforcement: policy decisions, field filtering, fail-closed behaviour.

The restrictive policy below is a TEST FIXTURE used to exercise the engine. It is
not the policy the product ships or proposes - candidates come from the policy
designer at runtime.
"""

from __future__ import annotations

from app.policies.engine import PolicyEngine, ReasonCode
from app.policies.schema import validate_document
from app.config import load_defaults
from app.gateway.tools import KNOWN_TOOLS
from tests.conftest import make_gateway, pick_customers, refundable_order

RESTRICTIVE = {
    "schema_version": "1",
    "name": "test restrictive policy",
    "default_effect": "deny",
    "rules": [
        {
            "id": "deny_export",
            "effect": "deny",
            "tools": ["export_customers"],
            "reason_code": "BULK_EXPORT_NOT_PERMITTED",
        },
        {
            "id": "own_orders_read",
            "effect": "allow",
            "tools": ["get_order", "list_orders"],
            "when": {
                "all": [
                    {"field": "resource.merchant_id", "op": "eq", "value_ref": "context.tenant_id"},
                    {
                        "field": "resource.customer_id",
                        "op": "eq",
                        "value_ref": "context.authenticated_customer_id",
                    },
                ]
            },
            "response_fields": [
                "order_id", "status", "placed_at", "currency", "total_minor",
                "refunded_minor", "refundable_remaining_minor", "refund_eligible",
            ],
        },
        {
            "id": "own_profile_read",
            "effect": "allow",
            "tools": ["get_customer"],
            "when": {
                "all": [
                    {"field": "resource.merchant_id", "op": "eq", "value_ref": "context.tenant_id"},
                    {
                        "field": "resource.customer_id",
                        "op": "eq",
                        "value_ref": "context.authenticated_customer_id",
                    },
                ]
            },
            "response_fields": ["customer_id", "name", "email", "loyalty_tier"],
        },
        {
            "id": "bounded_refund",
            "effect": "allow",
            "tools": ["issue_refund"],
            "when": {
                "all": [
                    {"field": "resource.merchant_id", "op": "eq", "value_ref": "context.tenant_id"},
                    {
                        "field": "resource.customer_id",
                        "op": "eq",
                        "value_ref": "context.authenticated_customer_id",
                    },
                    {"field": "resource.refund_eligible", "op": "eq", "value": True},
                    {"field": "request.amount_minor", "op": "lte", "config_ref": "business.max_refund_minor"},
                    {
                        "field": "request.amount_minor",
                        "op": "lte",
                        "value_ref": "resource.refundable_remaining_minor",
                    },
                    {"field": "request.has_idempotency_key", "op": "eq", "value": True},
                ]
            },
            "response_fields": ["refund_id", "order_id", "amount_minor", "currency", "status"],
        },
    ],
}


def restrictive_engine() -> PolicyEngine:
    result = validate_document(RESTRICTIVE)
    assert result.valid, result.errors
    return PolicyEngine(result.document, KNOWN_TOOLS, load_defaults().business_limits.model_dump())


# --------------------------------------------------------------------------- #
# fail closed
# --------------------------------------------------------------------------- #
def test_unknown_tool_is_denied(session, dataset, baseline_engine):
    policy, engine = baseline_engine
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("delete_database", {"confirm": True})
    assert res.decision.allow is False
    assert res.decision.reason_code == ReasonCode.UNKNOWN_TOOL
    assert res.executed is False


def test_invalid_arguments_are_denied(session, dataset, baseline_engine):
    policy, engine = baseline_engine
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("issue_refund", {"order_id": "x", "amount_minor": "lots", "reason": "r", "idempotency_key": "k"})
    assert res.decision.reason_code == ReasonCode.INVALID_ARGUMENTS
    assert res.executed is False


def test_invalid_policy_document_is_rejected(session):
    bad = {"schema_version": "1", "name": "bad", "rules": [
        {"id": "r1", "effect": "allow", "tools": ["get_order"],
         "when": {"field": "resource.secret_field", "op": "eq", "value": 1}}
    ]}
    result = validate_document(bad)
    assert result.valid is False
    assert any("unknown field path" in e for e in result.errors)

    worse = {"schema_version": "1", "name": "bad2", "rules": [
        {"id": "r1", "effect": "allow", "tools": ["run_shell"]}
    ]}
    assert validate_document(worse).valid is False


def test_missing_attribute_fails_closed(session, dataset, baseline_engine):
    """A rule referencing an attribute the call cannot supply denies the call."""
    policy, _ = baseline_engine
    doc = validate_document({
        "schema_version": "1",
        "name": "missing attr",
        "default_effect": "deny",
        "rules": [{
            "id": "export_if_owner",
            "effect": "allow",
            "tools": ["export_customers"],
            "when": {"field": "resource.customer_id", "op": "eq", "value_ref": "context.authenticated_customer_id"},
        }],
    })
    assert doc.valid, doc.errors
    engine = PolicyEngine(doc.document, KNOWN_TOOLS, load_defaults().business_limits.model_dump())
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("export_customers", {})
    assert res.decision.reason_code == ReasonCode.MISSING_ATTRIBUTE
    assert res.executed is False


def test_missing_trusted_context_fails_closed(session, dataset, baseline_engine):
    policy, engine = baseline_engine
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    gw.context.authenticated_customer_id = ""
    res = gw.call("get_customer", {"customer_id": subject.id})
    assert res.decision.reason_code == ReasonCode.MISSING_CONTEXT


# --------------------------------------------------------------------------- #
# boundaries
# --------------------------------------------------------------------------- #
def test_baseline_exposes_cross_customer_data_and_records_the_violation(session, dataset, baseline_engine):
    policy, engine = baseline_engine
    subject, same_tenant_other, cross_tenant = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    res = gw.call("get_customer", {"customer_id": same_tenant_other.id})
    assert res.executed is True, "the permissive baseline exists to measure this exposure"
    assert "CONTRACT_CROSS_CUSTOMER" in res.event.contract_violations_json
    assert res.payload["customer"]["ssn_last4"] == same_tenant_other.ssn_last4

    res2 = gw.call("get_customer", {"customer_id": cross_tenant.id})
    assert res2.executed is True
    assert "CONTRACT_CROSS_TENANT" in res2.event.contract_violations_json


def test_restrictive_policy_blocks_cross_customer_and_cross_tenant(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, same_tenant_other, cross_tenant = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    for foreign in (same_tenant_other, cross_tenant):
        res = gw.call("get_customer", {"customer_id": foreign.id})
        assert res.decision.allow is False
        assert res.executed is False
        assert "ssn_last4" not in str(res.payload)


def test_ownership_comes_from_the_database_not_the_arguments(session, dataset, baseline_engine):
    """The agent naming another customer's id cannot make that customer its own."""
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, other, _ = pick_customers(session, dataset.id)
    other_order = session.query(type(refundable_order(session, subject.id))).filter_by(customer_id=other.id).first()
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    res = gw.call("get_order", {"order_id": other_order.id})
    assert res.decision.allow is False
    assert res.decision.matched_rule_id in ("", "own_orders_read")
    assert res.executed is False


def test_response_field_filtering_removes_prohibited_fields(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    res = gw.call("get_customer", {"customer_id": subject.id})
    assert res.executed is True
    record = res.payload["customer"]
    for prohibited in ("ssn_last4", "internal_risk_score", "lifetime_value_minor", "internal_notes"):
        assert prohibited not in record
    assert "ssn_last4" in res.event.removed_fields_json
    assert record["customer_id"] == subject.id
    assert res.event.contract_violations_json == []


def test_export_is_denied_by_the_restrictive_policy(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, _, _ = pick_customers(session, dataset.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("export_customers", {})
    assert res.decision.allow is False
    assert res.decision.reason_code == "BULK_EXPORT_NOT_PERMITTED"
    assert res.executed is False


# --------------------------------------------------------------------------- #
# refunds
# --------------------------------------------------------------------------- #
def test_refund_within_limits_is_allowed_and_changes_state(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    res = gw.call("issue_refund", {
        "order_id": order.id, "amount_minor": 500, "reason": "damaged", "idempotency_key": "abc",
    })
    assert res.decision.allow is True and res.executed is True
    before = res.event.state_change_json["before"][order.id]["refunded_minor"]
    after = res.event.state_change_json["after"][order.id]["refunded_minor"]
    assert after == before + 500
    assert res.event.contract_violations_json == []


def test_refund_above_configured_limit_is_denied(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    limits = load_defaults().business_limits
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)

    res = gw.call("issue_refund", {
        "order_id": order.id,
        "amount_minor": limits.max_refund_minor + 1,
        "reason": "too much",
        "idempotency_key": "over",
    })
    assert res.decision.allow is False
    assert res.executed is False


def test_refund_beyond_remaining_balance_is_denied_by_policy(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("issue_refund", {
        "order_id": order.id,
        "amount_minor": order.total_minor + 1,
        "reason": "over",
        "idempotency_key": "k",
    })
    assert res.decision.allow is False


def test_baseline_allows_unauthorized_refund_and_records_violations(session, dataset, baseline_engine):
    policy, engine = baseline_engine
    subject, other, _ = pick_customers(session, dataset.id)
    other_order = refundable_order(session, other.id) if session.query(
        type(refundable_order(session, subject.id))
    ).filter_by(customer_id=other.id, refund_eligible=True).first() else None
    if other_order is None:
        return
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    res = gw.call("issue_refund", {
        "order_id": other_order.id, "amount_minor": 100, "reason": "x", "idempotency_key": "y",
    })
    assert res.executed is True
    assert "CONTRACT_CROSS_CUSTOMER" in res.event.contract_violations_json


def test_duplicate_refund_via_gateway_does_not_double_charge(session, dataset, baseline_engine):
    policy, _ = baseline_engine
    engine = restrictive_engine()
    subject, _, _ = pick_customers(session, dataset.id)
    order = refundable_order(session, subject.id)
    gw = make_gateway(session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject)
    args = {"order_id": order.id, "amount_minor": 300, "reason": "dup", "idempotency_key": "same"}

    first = gw.call("issue_refund", dict(args))
    second = gw.call("issue_refund", dict(args))
    assert first.payload["refund"]["status"] == "succeeded"
    assert second.payload["refund"]["status"] == "duplicate_ignored"
    after = second.event.state_change_json["after"][order.id]["refunded_minor"]
    assert after == first.event.state_change_json["after"][order.id]["refunded_minor"]
