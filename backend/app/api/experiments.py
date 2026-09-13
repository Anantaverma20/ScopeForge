"""Experiments, scenario runs and exports."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas, serializers
from app.db import get_session
from app.evaluations.metrics import compare_metrics
from app.models.orm import Experiment, PermissionProbe, Policy, ScenarioRun, ScoreRecord, ToolEvent

router = APIRouter(prefix="/api", tags=["experiments"])


@router.get("/experiments", response_model=list[schemas.ExperimentSummary])
def list_experiments(
    limit: int = Query(50, ge=1, le=200),
    kind: str | None = None,
    session: Session = Depends(get_session),
) -> list[schemas.ExperimentSummary]:
    query = select(Experiment).order_by(Experiment.created_at.desc()).limit(limit)
    if kind:
        query = query.where(Experiment.kind == kind)
    else:
        # playground turns are a different surface: they carry no scenario
        # expectations, so scenario metrics do not apply to them. They are
        # inspected from the Playground page instead.
        query = query.where(Experiment.kind != "playground")
    return [serializers.experiment_summary(session, e) for e in session.execute(query).scalars()]


@router.get("/experiments/{experiment_id}", response_model=schemas.ExperimentDetail)
def get_experiment(experiment_id: str, session: Session = Depends(get_session)) -> schemas.ExperimentDetail:
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")
    return serializers.experiment_detail(session, experiment)


@router.get("/experiments/{experiment_id}/compare/{other_id}")
def compare(experiment_id: str, other_id: str, session: Session = Depends(get_session)) -> dict:
    a = session.get(Experiment, experiment_id)
    b = session.get(Experiment, other_id)
    if a is None or b is None:
        raise HTTPException(404, "experiment not found")
    return {
        "baseline": serializers.experiment_summary(session, a).model_dump(),
        "candidate": serializers.experiment_summary(session, b).model_dump(),
        "comparison": compare_metrics(a.metrics_json or {}, b.metrics_json or {}),
    }


@router.get("/experiments/{experiment_id}/export")
def export_experiment(experiment_id: str, session: Session = Depends(get_session)) -> JSONResponse:
    experiment = session.get(Experiment, experiment_id)
    if experiment is None:
        raise HTTPException(404, "experiment not found")
    policy = session.get(Policy, experiment.policy_id)
    runs = list(
        session.execute(select(ScenarioRun).where(ScenarioRun.experiment_id == experiment_id)).scalars()
    )
    events = list(
        session.execute(
            select(ToolEvent).where(ToolEvent.scenario_run_id.in_([r.id for r in runs] or [""]))
        ).scalars()
    )
    scores = list(
        session.execute(select(ScoreRecord).where(ScoreRecord.experiment_id == experiment_id)).scalars()
    )
    probes = list(
        session.execute(select(PermissionProbe).where(PermissionProbe.experiment_id == experiment_id)).scalars()
    )
    payload = {
        "experiment": serializers.experiment_summary(session, experiment).model_dump(),
        "config": experiment.config_json,
        "integration_status": experiment.integration_status_json,
        "policy": serializers.policy_detail(policy).model_dump() if policy else None,
        "runs": [serializers.run_detail(session, r).model_dump() for r in runs],
        "tool_events": [serializers.tool_event_out(e).model_dump() for e in events],
        "scores": [
            {
                "run_id": s.scenario_run_id, "scorer": s.scorer, "passed": s.passed,
                "value": s.value, "applicable": s.applicable, "evidence": s.evidence_json,
            }
            for s in scores
        ],
        "permission_probes": [serializers.probe_out(p).model_dump() for p in probes],
        "metrics": experiment.metrics_json,
        "note": "All records are real executions against a synthetic local sandbox.",
    }
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="scopeforge-experiment-{experiment_id}.json"'},
    )


@router.get("/runs/{run_id}", response_model=schemas.RunDetail)
def get_run(run_id: str, session: Session = Depends(get_session)) -> schemas.RunDetail:
    run = session.get(ScenarioRun, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return serializers.run_detail(session, run)


@router.get("/runs", response_model=list[schemas.RunSummary])
def list_runs(
    experiment_id: str | None = None,
    scenario_id: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> list[schemas.RunSummary]:
    query = select(ScenarioRun).order_by(ScenarioRun.started_at.desc()).limit(limit)
    if experiment_id:
        query = query.where(ScenarioRun.experiment_id == experiment_id)
    if scenario_id:
        query = query.where(ScenarioRun.scenario_id == scenario_id)
    return [serializers.run_summary(session, r) for r in session.execute(query).scalars()]
