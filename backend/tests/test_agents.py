"""Agent prompt construction and improvement-loop guardrails.

These are offline checks of prompt assembly and evidence selection. They make no
model calls and are not evidence that the live integrations work.
"""

from __future__ import annotations

import json

from app.agents.policy_designer import _system_prompt, build_evidence_prompt
from app.agents.support_agent import SYSTEM_PROMPT as SUPPORT_PROMPT
from app.config import load_defaults
from app.evaluations.scenarios import generate_suite
from app.jobs.orchestrator import evaluate_gates
from app.models.orm import Scenario


def test_designer_system_prompt_renders_without_placeholders():
    """Regression: the template carries literal JSON braces, so str.format() broke it."""
    prompt = _system_prompt()
    for placeholder in ("{operators}", "{left_fields}", "{config_fields}", "{tools}", "{response_fields}"):
        assert placeholder not in prompt
    # the JSON examples must survive intact
    assert '{"field": <path>, "op": <op>, "value": <literal>}' in prompt
    assert '"expected_effects": {"security": string, "utility": string}' in prompt
    # the allow-listed vocabulary is actually present
    assert "context.authenticated_customer_id" in prompt
    assert "business.max_refund_minor" in prompt
    assert "export_customers" in prompt


def test_support_agent_prompt_never_carries_expectations(session, dataset):
    settings = load_defaults()
    suite = generate_suite(session, dataset_id=dataset.id, settings=settings)
    session.flush()
    scenario = session.query(Scenario).filter(Scenario.suite_id == suite.id).first()

    rendered = SUPPORT_PROMPT.format(
        merchant_name="Store", tenant_id=scenario.tenant_id,
        customer_id=scenario.authenticated_customer_id, customer_name="A Customer",
    )
    lowered = rendered.lower()
    for leaked in ("expectation", "adversarial", "attack", "unauthorized_if_executed", "required_executed_tools"):
        assert leaked not in lowered


def test_designer_evidence_excludes_validation_and_test_material():
    """The designer prompt is built only from what the caller passes in."""
    settings = load_defaults()
    dev_failure = {
        "run_id": "run_dev", "scenario_id": "scn_dev", "scenario_category": "cross_customer_read",
        "tool": "get_customer", "arguments": {"customer_id": "cus_other"},
        "contract_violations": ["CONTRACT_CROSS_CUSTOMER"],
    }
    prompt = build_evidence_prompt(
        current_policy={"schema_version": "1", "name": "baseline", "rules": []},
        metrics={"legit_completion": {"numerator": 4, "denominator": 4, "rate": 1.0}},
        failures=[dev_failure],
        false_denials=[],
        mcp_evidence="",
        settings=settings,
    )
    assert "scn_dev" in prompt
    assert "CONTRACT_CROSS_CUSTOMER" in prompt
    # the contract is shown as read-only context
    assert "you may not change it" in prompt
    assert "scn_test" not in prompt and "scn_validation" not in prompt


def test_acceptance_gates_are_configured_not_hardcoded():
    settings = load_defaults()
    baseline = {
        "legit_completion": {"numerator": 4, "denominator": 4, "rate": 1.0},
        "unauthorized_success": {"numerator": 3, "denominator": 4, "rate": 0.75},
        "false_denials": {"numerator": 0, "denominator": 5, "rate": 0.0},
        "permission_breadth": {"allowed_share": 1.0},
    }
    good = {
        "legit_completion": {"numerator": 4, "denominator": 4, "rate": 1.0},
        "unauthorized_success": {"numerator": 0, "denominator": 4, "rate": 0.0},
        "false_denials": {"numerator": 0, "denominator": 5, "rate": 0.0},
        "permission_breadth": {"allowed_share": 0.4},
    }
    result = evaluate_gates(baseline, good, settings)
    assert result["accepted"] is True
    assert all(g["passed"] in (True, None) for g in result["gates"])

    # a candidate that still lets an attack through is rejected
    leaky = {**good, "unauthorized_success": {"numerator": 1, "denominator": 4, "rate": 0.25}}
    rejected = evaluate_gates(baseline, leaky, settings)
    assert rejected["accepted"] is False
    assert "unauthorized_success_rate" in rejected["summary"]

    # a candidate that breaks legitimate work is rejected
    broken = {**good, "legit_completion": {"numerator": 1, "denominator": 4, "rate": 0.25}}
    assert evaluate_gates(baseline, broken, settings)["accepted"] is False


def test_gates_report_unevaluable_rather_than_passing_silently():
    settings = load_defaults()
    empty = {
        "legit_completion": {"numerator": 0, "denominator": 0, "rate": None},
        "unauthorized_success": {"numerator": 0, "denominator": 0, "rate": None},
        "false_denials": {"numerator": 0, "denominator": 0, "rate": None},
        "permission_breadth": None,
    }
    result = evaluate_gates(empty, empty, settings)
    assert result["accepted"] is False
    assert set(result["unevaluable_gates"]) >= {
        "unauthorized_success_rate", "legit_completion_rate", "false_denial_rate"
    }


def test_policy_language_schema_is_exportable():
    from app.policies.schema import policy_json_schema

    schema = json.dumps(policy_json_schema())
    assert "default_effect" in schema and "rules" in schema
