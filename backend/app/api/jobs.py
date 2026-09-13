"""Job control: start work, poll status, stream events, cancel."""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from app.api import schemas, serializers
from app.db import SessionLocal, get_session
from app.jobs.queue import enqueue, request_cancel
from app.models.orm import Job, JobEvent, Policy, Suite
from app.policies.store import ensure_baseline_policy

router = APIRouter(prefix="/api", tags=["jobs"])


def _resolve_policy(session: Session, policy_id: str | None) -> Policy:
    if policy_id:
        policy = session.get(Policy, policy_id)
        if policy is None:
            raise HTTPException(404, "policy not found")
        return policy
    return ensure_baseline_policy(session)


@router.post("/runs/baseline", response_model=schemas.JobOut, status_code=202, tags=["jobs"])
def start_baseline(
    payload: schemas.StartBaselineRequest, session: Session = Depends(get_session)
) -> schemas.JobOut:
    if session.get(Suite, payload.suite_id) is None:
        raise HTTPException(404, "suite not found")
    policy = _resolve_policy(session, payload.policy_id)
    job, _ = enqueue(
        session,
        kind="experiment_run",
        params={
            "suite_id": payload.suite_id,
            "policy_id": policy.id,
            "splits": payload.splits,
            "kind": "baseline",
            "name": payload.name or f"Baseline run ({policy.name})",
        },
        dedupe_key=f"baseline:{payload.suite_id}:{policy.id}:{','.join(sorted(payload.splits))}",
    )
    session.commit()
    return serializers.job_out(job)


@router.post("/jobs/improvement", response_model=schemas.JobOut, status_code=202)
def start_improvement(
    payload: schemas.StartImprovementRequest, session: Session = Depends(get_session)
) -> schemas.JobOut:
    if session.get(Suite, payload.suite_id) is None:
        raise HTTPException(404, "suite not found")
    policy = _resolve_policy(session, payload.policy_id)
    job, _ = enqueue(
        session,
        kind="improvement",
        params={
            "suite_id": payload.suite_id,
            "policy_id": policy.id,
            "max_iterations": payload.max_iterations,
            "use_mcp": payload.use_mcp,
        },
        dedupe_key=f"improve:{payload.suite_id}:{policy.id}",
    )
    session.commit()
    return serializers.job_out(job)


@router.post("/jobs/adversary", response_model=schemas.JobOut, status_code=202)
def start_adversary(
    payload: schemas.StartAdversaryRequest, session: Session = Depends(get_session)
) -> schemas.JobOut:
    if session.get(Suite, payload.suite_id) is None:
        raise HTTPException(404, "suite not found")
    job, _ = enqueue(
        session,
        kind="adversary_suite",
        params={"suite_id": payload.suite_id, "count": payload.count},
        dedupe_key=f"adversary:{payload.suite_id}",
    )
    session.commit()
    return serializers.job_out(job)


@router.get("/jobs", response_model=list[schemas.JobOut])
def list_jobs(
    active_only: bool = False,
    limit: int = Query(30, ge=1, le=200),
    session: Session = Depends(get_session),
) -> list[schemas.JobOut]:
    query = select(Job).order_by(Job.created_at.desc()).limit(limit)
    if active_only:
        query = query.where(Job.status.in_(("queued", "running")))
    return [serializers.job_out(j) for j in session.execute(query).scalars()]


@router.get("/jobs/{job_id}", response_model=schemas.JobDetail)
def get_job(job_id: str, session: Session = Depends(get_session)) -> schemas.JobDetail:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return serializers.job_detail(session, job)


@router.post("/jobs/{job_id}/cancel", response_model=schemas.JobOut)
def cancel_job(job_id: str, session: Session = Depends(get_session)) -> schemas.JobOut:
    job = request_cancel(session, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    session.commit()
    return serializers.job_out(job)


@router.get("/jobs/{job_id}/stream")
async def stream_job(job_id: str):
    """Server-sent events driven by persisted job rows - never by a timer."""

    async def publisher():
        last_seq = 0
        while True:
            session = SessionLocal()
            try:
                job = session.get(Job, job_id)
                if job is None:
                    yield {"event": "error", "data": json.dumps({"error": "job not found"})}
                    return
                events = list(
                    session.execute(
                        select(JobEvent)
                        .where(JobEvent.job_id == job_id, JobEvent.seq > last_seq)
                        .order_by(JobEvent.seq)
                    ).scalars()
                )
                for event in events:
                    last_seq = event.seq
                    yield {
                        "event": "job_event",
                        "data": json.dumps(
                            {
                                "seq": event.seq,
                                "level": event.level,
                                "message": event.message,
                                "created_at": serializers.iso(event.created_at),
                            }
                        ),
                    }
                yield {"event": "status", "data": json.dumps(serializers.job_out(job).model_dump())}
                finished = job.status not in ("queued", "running")
            finally:
                session.close()
            if finished:
                return
            await asyncio.sleep(1.0)

    return EventSourceResponse(publisher())
