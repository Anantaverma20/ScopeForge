"""ScopeForge policy comparison notebook (marimo).

Reads the experiment results ScopeForge already persisted and compares policies.
It creates no dataset of its own and duplicates no evaluation logic: metrics come
from `app.evaluations.metrics`, the same module the API and the UI use.

    cd backend && .venv/Scripts/python -m pip install -e ".[notebook]"
    cd .. && backend/.venv/Scripts/marimo edit notebooks/policy_comparison.py

Docs: https://docs.marimo.io/guides/apps/
"""

import marimo

__generated_with = "0.9"
app = marimo.App(width="medium")


@app.cell
def _():
    import sys
    from pathlib import Path

    import marimo as mo

    # run against the same backend package and database the app uses
    repo_root = Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(repo_root / "backend"))

    from app.db import SessionLocal
    from app.evaluations.metrics import compare_metrics, compute_metrics
    from app.models.orm import Experiment, Policy, ScenarioRun, ToolEvent

    session = SessionLocal()
    return (
        Experiment,
        Policy,
        ScenarioRun,
        ToolEvent,
        compare_metrics,
        compute_metrics,
        mo,
        session,
    )


@app.cell
def _(mo):
    mo.md(
        """
        # ScopeForge — policy comparison

        Every figure below comes from executions already stored in the workspace database.
        Nothing here re-runs an agent or recomputes a score.
        """
    )
    return


@app.cell
def _(Experiment, mo, session):
    experiments = list(
        session.query(Experiment)
        .filter(Experiment.kind != "playground")
        .order_by(Experiment.created_at.desc())
        .all()
    )
    if not experiments:
        mo.md("**No experiments yet.** Run a baseline from the Workspace page first.")
    options = {
        f"{e.name} · {e.kind} · {e.created_at:%Y-%m-%d %H:%M} · {e.id}": e.id for e in experiments
    }
    baseline_picker = mo.ui.dropdown(options=options, label="Baseline experiment")
    candidate_picker = mo.ui.dropdown(options=options, label="Candidate experiment")
    mo.vstack([baseline_picker, candidate_picker])
    return baseline_picker, candidate_picker, experiments, options


@app.cell
def _(baseline_picker, candidate_picker, compare_metrics, compute_metrics, mo, session):
    def _summary(experiment_id):
        if not experiment_id:
            return None
        return compute_metrics(session, experiment_id)

    baseline_metrics = _summary(baseline_picker.value)
    candidate_metrics = _summary(candidate_picker.value)

    if not (baseline_metrics and candidate_metrics):
        mo.md("Pick a baseline and a candidate experiment above.")
        comparison = None
    else:
        comparison = compare_metrics(baseline_metrics, candidate_metrics)

        def fmt(value):
            return "No data" if value is None else f"{value * 100:.0f}%"

        def delta(value):
            return "—" if value is None else f"{value * 100:+.0f} pts"

        rows = "\n".join(
            f"| {name} | {fmt(field['baseline'])} | {fmt(field['candidate'])} "
            f"| {delta(field['delta'])} | {field['direction'].replace('_', ' ')} |"
            for name, field in comparison.items()
        )
        mo.md(
            "## Measured difference\n\n"
            "| Measure | Baseline | Candidate | Change | Better when |\n"
            "|---|---|---|---|---|\n" + rows
        )
    return baseline_metrics, candidate_metrics, comparison


@app.cell
def _(baseline_metrics, candidate_metrics, mo):
    if baseline_metrics and candidate_metrics:
        def block(title, metrics):
            runs = metrics.get("runs", {})
            breadth = metrics.get("permission_breadth") or {}
            exposure = metrics.get("field_exposure", {})
            return (
                f"**{title}**\n\n"
                f"- scenario runs: {runs.get('total', 0)} "
                f"({runs.get('legitimate', 0)} legitimate, {runs.get('adversarial', 0)} adversarial, "
                f"{runs.get('infrastructure_failures', 0)} failed for other reasons)\n"
                f"- tool calls: {metrics.get('tool_events', {}).get('total', 0)} "
                f"({metrics.get('tool_events', {}).get('denied', 0)} denied)\n"
                f"- probes allowed: {breadth.get('allowed', 0)}/{breadth.get('probes', 0)}"
                f" — {breadth.get('allowed_but_prohibited_by_contract', 0)} of them prohibited by the contract\n"
                f"- prohibited fields exposed: {', '.join(exposure.get('fields', [])) or 'none'}\n"
                f"- tokens: {metrics.get('tokens', {}).get('total_tokens', 0):,}\n"
            )

        mo.md(block("Baseline", baseline_metrics) + "\n" + block("Candidate", candidate_metrics))
    return


@app.cell
def _(ScenarioRun, ToolEvent, baseline_picker, candidate_picker, mo, session):
    def violations(experiment_id):
        if not experiment_id:
            return []
        runs = session.query(ScenarioRun).filter(ScenarioRun.experiment_id == experiment_id).all()
        run_ids = [r.id for r in runs] or [""]
        events = (
            session.query(ToolEvent)
            .filter(ToolEvent.scenario_run_id.in_(run_ids), ToolEvent.executed.is_(True))
            .all()
        )
        return [
            (e.tool_name, ", ".join(e.contract_violations_json))
            for e in events
            if e.contract_violations_json
        ]

    before = violations(baseline_picker.value)
    after = violations(candidate_picker.value)

    def table(title, rows):
        if not rows:
            return f"**{title}:** no executed call violated the contract.\n\n"
        body = "\n".join(f"| `{tool}` | {codes} |" for tool, codes in rows)
        return f"**{title}** ({len(rows)} executed calls)\n\n| Tool | Contract violations |\n|---|---|\n{body}\n\n"

    mo.md(
        "## Unauthorized actions that actually executed\n\n"
        + table("Baseline", before)
        + table("Candidate", after)
    )
    return after, before


@app.cell
def _(Policy, candidate_picker, mo, session):
    from app.models.orm import Experiment as _Experiment

    policy = None
    if candidate_picker.value:
        experiment = session.get(_Experiment, candidate_picker.value)
        if experiment:
            policy = session.get(Policy, experiment.policy_id)

    if policy is None:
        mo.md("Select a candidate experiment to see the policy it enforced.")
    else:
        mo.md(
            f"## Policy enforced by the candidate run\n\n"
            f"**{policy.name}** (v{policy.version}, `{policy.canonical_hash[:16]}`)\n\n"
            f"- validation: `{policy.validation_status}`\n"
            f"- decision: `{policy.decision or 'not evaluated'}`\n"
            f"- rationale: {policy.rationale or '—'}\n\n"
            "A tested candidate within the supported policy language and the scenario coverage that was run. "
            "Not a claim of minimality or of general security."
        )
    return (policy,)


if __name__ == "__main__":
    app.run()
