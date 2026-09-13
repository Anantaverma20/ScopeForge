"""Settings and the guided workspace state."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas, serializers
from app.api.health import integration_states
from app.config import get_settings, load_business_contract
from app.db import get_session
from app.models.orm import Dataset, Experiment, Job, Policy, Scenario, ScenarioRun, Suite
from app.policies.store import active_policy, ensure_baseline_policy
from app.settings_store import get_runtime_settings, reset_runtime_settings, update_runtime_settings

router = APIRouter(prefix="/api", tags=["workspace"])


def _environment_view() -> schemas.EnvironmentView:
    settings = get_settings()
    return schemas.EnvironmentView(
        llm_base_url=settings.llm_base_url,
        llm_model=settings.llm_model,
        wandb_entity=settings.wandb_entity,
        wandb_project=settings.wandb_project,
        wandb_mcp_url=settings.wandb_mcp_url,
        weave_project=settings.weave_project,
        backend_port=settings.backend_port,
        credentials_present=settings.credential_status(),
        cost_rate_configured=(
            settings.llm_cost_per_mtok_input is not None and settings.llm_cost_per_mtok_output is not None
        ),
    )


@router.get("/settings", response_model=schemas.SettingsResponse)
def read_settings(session: Session = Depends(get_session)) -> schemas.SettingsResponse:
    runtime = get_runtime_settings(session)
    session.commit()
    return schemas.SettingsResponse(
        runtime=runtime.model_dump(mode="json"),
        environment=_environment_view(),
        business_contract=load_business_contract().model_dump(),
    )


class SettingsPatch(BaseModel):
    patch: dict[str, Any]


@router.put("/settings", response_model=schemas.SettingsResponse)
def write_settings(payload: SettingsPatch, session: Session = Depends(get_session)) -> schemas.SettingsResponse:
    try:
        runtime = update_runtime_settings(session, payload.patch)
    except Exception as exc:
        raise HTTPException(400, f"invalid settings: {exc}") from exc
    session.commit()
    return schemas.SettingsResponse(
        runtime=runtime.model_dump(mode="json"),
        environment=_environment_view(),
        business_contract=load_business_contract().model_dump(),
    )


@router.post("/settings/reset", response_model=schemas.SettingsResponse)
def reset_settings(session: Session = Depends(get_session)) -> schemas.SettingsResponse:
    runtime = reset_runtime_settings(session)
    session.commit()
    return schemas.SettingsResponse(
        runtime=runtime.model_dump(mode="json"),
        environment=_environment_view(),
        business_contract=load_business_contract().model_dump(),
    )


@router.get("/workspace", response_model=schemas.WorkspaceState)
def workspace_state(session: Session = Depends(get_session)) -> schemas.WorkspaceState:
    settings = get_settings()
    integrations = integration_states(session)
    dataset = session.execute(select(Dataset).order_by(Dataset.created_at.desc())).scalars().first()
    suite = (
        session.execute(
            select(Suite).where(Suite.dataset_id == dataset.id).order_by(Suite.created_at.desc())
        ).scalars().first()
        if dataset
        else None
    )
    baseline = ensure_baseline_policy(session)
    session.commit()
    active = active_policy(session)
    latest_experiment = session.execute(
        select(Experiment).where(Experiment.kind != "playground").order_by(Experiment.created_at.desc())
    ).scalars().first()
    latest_candidate = session.execute(
        select(Policy).where(Policy.kind == "candidate").order_by(Policy.created_at.desc())
    ).scalars().first()
    active_jobs = list(
        session.execute(
            select(Job).where(Job.status.in_(("queued", "running"))).order_by(Job.created_at.desc())
        ).scalars()
    )

    scenario_count = (
        session.execute(select(Scenario).where(Scenario.suite_id == suite.id)).scalars().all() if suite else []
    )
    baseline_experiment = session.execute(
        select(Experiment).where(Experiment.kind == "baseline").order_by(Experiment.created_at.desc())
    ).scalars().first()
    # a baseline only counts as done when scenarios actually executed, not merely
    # when the job finished with every run failing
    baseline_scored = 0
    baseline_total = 0
    if baseline_experiment is not None:
        baseline_runs = list(
            session.execute(
                select(ScenarioRun).where(ScenarioRun.experiment_id == baseline_experiment.id)
            ).scalars()
        )
        baseline_total = len(baseline_runs)
        baseline_scored = len([r for r in baseline_runs if r.status == "completed"])

    credentials_ok = bool(settings.wandb_api_key)

    steps = [
        schemas.WorkspaceStep(
            key="configure",
            label="Configure the provider and W&B project",
            done=credentials_ok,
            detail=(
                f"{settings.llm_base_url} / {settings.llm_model}"
                + (f" - project {settings.weave_project}" if settings.weave_project else "")
                if credentials_ok
                else "WANDB_API_KEY is not set in .env"
            ),
            blocked_reason="" if credentials_ok else "Add WANDB_API_KEY to .env and restart the backend.",
        ),
        schemas.WorkspaceStep(
            key="dataset",
            label="Generate a synthetic dataset",
            done=dataset is not None,
            detail=(
                f"{dataset.name}: " + ", ".join(f"{v} {k}" for k, v in (dataset.counts_json or {}).items())
                if dataset
                else "No dataset yet"
            ),
        ),
        schemas.WorkspaceStep(
            key="contract",
            label="Review the agent's job and business contract",
            done=dataset is not None,
            detail=f"Contract {load_business_contract().version}: {load_business_contract().title}",
        ),
        schemas.WorkspaceStep(
            key="suite",
            label="Generate a scenario suite",
            done=suite is not None,
            detail=(
                f"{suite.name}: {len(scenario_count)} scenarios"
                if suite
                else "No scenario suite yet"
            ),
            blocked_reason="" if dataset else "Generate a dataset first.",
        ),
        schemas.WorkspaceStep(
            key="baseline",
            label="Run the baseline",
            done=baseline_scored > 0,
            detail=(
                f"{baseline_experiment.name}: {baseline_scored}/{baseline_total} scenario runs completed"
                if baseline_experiment
                else "No baseline run yet"
            ),
            blocked_reason=(
                "" if (suite and credentials_ok)
                else ("Generate a scenario suite first." if not suite else "A model call needs WANDB_API_KEY.")
            ),
        ),
        schemas.WorkspaceStep(
            key="improve",
            label="Start the improvement loop",
            done=latest_candidate is not None,
            detail=(
                f"Latest candidate: {latest_candidate.name} v{latest_candidate.version} "
                f"({latest_candidate.decision or 'not evaluated'})"
                if latest_candidate
                else "No candidate policy yet"
            ),
            blocked_reason=(
                "" if (suite and credentials_ok) else "Needs a scenario suite and WANDB_API_KEY."
            ),
        ),
        schemas.WorkspaceStep(
            key="review",
            label="Review the candidate policy",
            done=latest_candidate is not None and latest_candidate.decision is not None,
            detail=(
                latest_candidate.decision_reason[:200]
                if latest_candidate and latest_candidate.decision
                else "Nothing to review yet"
            ),
        ),
        schemas.WorkspaceStep(
            key="activate",
            label="Activate for the local playground",
            done=active is not None,
            detail=(
                f"{active.name} v{active.version} is active"
                if active
                else "No policy is active in the playground"
            ),
            blocked_reason=(
                "" if (latest_candidate and latest_candidate.activation_eligible) or active
                else "Activation needs a candidate that passed the acceptance gate, or an explicit override."
            ),
        ),
    ]

    return schemas.WorkspaceState(
        steps=steps,
        dataset=serializers.dataset_summary(dataset) if dataset else None,
        suite=serializers.suite_summary(suite) if suite else None,
        baseline_policy=serializers.policy_summary(baseline),
        active_policy=serializers.policy_summary(active) if active else None,
        latest_experiment=(
            serializers.experiment_summary(session, latest_experiment) if latest_experiment else None
        ),
        latest_candidate=serializers.policy_summary(latest_candidate) if latest_candidate else None,
        active_jobs=[serializers.job_out(j) for j in active_jobs],
        integrations=integrations,
    )
