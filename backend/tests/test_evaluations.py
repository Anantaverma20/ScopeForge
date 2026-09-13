"""Scenario suites, probes, scoring and metric aggregation.

`test_runner_records_real_evidence` uses a scripted stand-in for the model so the
run/score/metric wiring can be tested offline. It is a TEST DOUBLE and is not
evidence that the live W&B Inference integration works.
"""

from __future__ import annotations

from app.config import load_defaults
from app.evaluations.metrics import compute_metrics
from app.evaluations.probes import run_probes
from app.evaluations.scenarios import generate_suite
from app.integrations import llm
from app.models.orm import Experiment, Scenario
from app.policies.store import create_policy_version, engine_for
from tests.test_gateway import RESTRICTIVE


def test_suite_generation_binds_to_real_records(session, dataset):
    settings = load_defaults()
    suite = generate_suite(session, dataset_id=dataset.id, settings=settings)
    session.flush()
    scenarios = session.query(Scenario).filter(Scenario.suite_id == suite.id).all()
    assert scenarios
    assert suite.counts_json["total"] == len(scenarios)

    for scenario in scenarios:
        assert scenario.tenant_id and scenario.authenticated_customer_id
        assert scenario.expectations_json.get("type") in ("legitimate", "adversarial")
        # hidden metadata must not leak into the text the agent sees
        assert "expectations" not in scenario.user_message.lower()
        assert "adversarial" not in scenario.user_message.lower()

    # entity-level splits: one customer never spans two splits
    by_customer: dict[str, set[str]] = {}
    for scenario in scenarios:
        by_customer.setdefault(scenario.authenticated_customer_id, set()).add(scenario.split)
    assert all(len(splits) == 1 for splits in by_customer.values())


def test_probes_show_narrower_breadth_for_a_restrictive_policy(session, dataset, baseline_engine):
    settings = load_defaults()
    baseline_policy, baseline = baseline_engine
    restrictive = create_policy_version(
        session, raw_document=RESTRICTIVE, kind="candidate", name="probe test policy"
    )
    session.flush()
    restrictive_engine = engine_for(session, restrictive.id)

    experiment = Experiment(
        name="probe test", kind="policy_eval", suite_id="", dataset_id=dataset.id, policy_id=baseline_policy.id
    )
    session.add(experiment)
    session.flush()

    base_rows = run_probes(
        session, experiment_id=experiment.id, policy_id=baseline_policy.id,
        engine=baseline, dataset_id=dataset.id, settings=settings,
    )
    assert base_rows
    assert all(r.decision == "allow" for r in base_rows), "the permissive baseline allows every probe"
    assert any(not r.contract_permits for r in base_rows), "some probes are prohibited by the contract"

    experiment2 = Experiment(
        name="probe test 2", kind="policy_eval", suite_id="", dataset_id=dataset.id, policy_id=restrictive.id
    )
    session.add(experiment2)
    session.flush()
    restricted_rows = run_probes(
        session, experiment_id=experiment2.id, policy_id=restrictive.id,
        engine=restrictive_engine, dataset_id=dataset.id, settings=settings,
    )
    allowed_base = [r for r in base_rows if r.decision == "allow"]
    allowed_restricted = [r for r in restricted_rows if r.decision == "allow"]
    assert len(allowed_restricted) < len(allowed_base)

    # no probe prohibited by the contract is allowed by the restrictive policy
    assert not [r for r in allowed_restricted if not r.contract_permits]


def test_runner_records_real_evidence(session, dataset, baseline_engine, monkeypatch):
    """End-to-end run wiring, with a scripted stand-in for the model."""
    from app.agents import runner

    settings = load_defaults()
    policy, _ = baseline_engine
    suite = generate_suite(session, dataset_id=dataset.id, settings=settings)
    session.flush()
    scenario = (
        session.query(Scenario)
        .filter(Scenario.suite_id == suite.id, Scenario.category == "order_status")
        .first()
    )
    assert scenario is not None

    calls = {"n": 0}

    def scripted_chat(messages, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return llm.LLMResponse(
                content="",
                tool_calls=[
                    llm.ToolCall(id="call_1", name="get_order", arguments={"order_id": scenario.target_order_id})
                ],
                model="test-double",
                usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
                raw_message={"role": "assistant", "content": None, "tool_calls": [
                    {"id": "call_1", "type": "function",
                     "function": {"name": "get_order", "arguments": "{}"}}
                ]},
            )
        return llm.LLMResponse(
            content=f"Your order {scenario.target_order_id} is on its way.",
            model="test-double",
            usage={"prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28},
            raw_message={"role": "assistant", "content": "ok"},
        )

    monkeypatch.setattr("app.agents.support_agent.llm.chat", scripted_chat)

    experiment = Experiment(
        name="runner test", kind="baseline", suite_id=suite.id, dataset_id=dataset.id, policy_id=policy.id
    )
    session.add(experiment)
    session.flush()

    outcome = runner.run_scenario(
        session, scenario=scenario, policy=policy, experiment_id=experiment.id, settings=settings
    )
    session.flush()

    assert outcome.run.status == "completed"
    assert outcome.run.token_usage_json["total_tokens"] == 43
    assert outcome.run.trace_status in ("not_traced",) or outcome.run.trace_status.startswith("trace_failed")
    scores = {s.scorer: s for s in outcome.scores}
    assert scores["legit_task_completed"].passed is True
    # the permissive baseline returns internal order fields on an otherwise
    # legitimate call: that exposure must be recorded, not scored as clean
    assert scores["prohibited_field_exposure"].passed is False
    assert "merchant_cost_minor" in scores["prohibited_field_exposure"].evidence["fields"]
    assert scores["unauthorized_action_succeeded"].passed is False
    assert scores["false_denial"].passed is True

    metrics = compute_metrics(session, experiment.id)
    assert metrics["runs"]["total"] == 1
    assert metrics["legit_completion"] == {
        "numerator": 1, "denominator": 1, "rate": 1.0, "excluded_infrastructure_failures": 0
    }
    assert metrics["unauthorized_success"]["rate"] is None, "no attack scenarios ran: rate must be None"
    assert metrics["tool_events"]["executed"] == 1


def test_model_failure_is_recorded_not_hidden(session, dataset, baseline_engine, monkeypatch):
    from app.agents import runner

    settings = load_defaults()
    policy, _ = baseline_engine
    suite = generate_suite(session, dataset_id=dataset.id, settings=settings)
    session.flush()
    scenario = session.query(Scenario).filter(Scenario.suite_id == suite.id).first()

    def failing_chat(messages, **kwargs):
        raise llm.LLMUnavailable("APIConnectionError: connection refused")

    monkeypatch.setattr("app.agents.support_agent.llm.chat", failing_chat)
    experiment = Experiment(
        name="failure test", kind="baseline", suite_id=suite.id, dataset_id=dataset.id, policy_id=policy.id
    )
    session.add(experiment)
    session.flush()

    outcome = runner.run_scenario(
        session, scenario=scenario, policy=policy, experiment_id=experiment.id, settings=settings
    )
    assert outcome.run.status == "failed"
    assert "connection refused" in outcome.run.error
    metrics = compute_metrics(session, experiment.id)
    assert metrics["runs"]["infrastructure_failures"] == 1
    assert metrics["legit_completion"]["denominator"] == 0
    assert metrics["legit_completion"]["rate"] is None
