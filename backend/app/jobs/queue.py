"""Job queue and the single background worker.

Job state is persisted, so progress survives a page refresh and a restart tells
the truth: jobs that were running when the process died are marked
`interrupted`, never left looking alive. Progress counters only ever advance on
completed work - nothing is driven by a timer.
"""

from __future__ import annotations

import threading
import time
import traceback
from collections.abc import Callable
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal, session_scope, utcnow
from app.models.orm import Job, JobEvent

ACTIVE_STATUSES = ("queued", "running")

HANDLERS: dict[str, Callable[[Session, Job], dict]] = {}


class JobCancelled(Exception):
    """Raised between steps when the operator cancels a job."""


def register(kind: str):
    def wrap(fn: Callable[[Session, Job], dict]):
        HANDLERS[kind] = fn
        return fn

    return wrap


# --------------------------------------------------------------------------- #
# queue operations
# --------------------------------------------------------------------------- #
def enqueue(session: Session, *, kind: str, params: dict, dedupe_key: str = "") -> tuple[Job, bool]:
    """Queue a job. Returns (job, created). A repeated click reuses the live job."""
    if dedupe_key:
        existing = session.execute(
            select(Job)
            .where(Job.dedupe_key == dedupe_key, Job.status.in_(ACTIVE_STATUSES))
            .order_by(Job.created_at.desc())
        ).scalars().first()
        if existing is not None:
            return existing, False

    job = Job(kind=kind, status="queued", params_json=params, dedupe_key=dedupe_key)
    session.add(job)
    session.flush()
    log(session, job.id, f"queued {kind}", data={"params": params})
    return job, True


def log(session: Session, job_id: str, message: str, level: str = "info", data: dict | None = None) -> JobEvent:
    seq = (
        session.execute(select(JobEvent.seq).where(JobEvent.job_id == job_id).order_by(JobEvent.seq.desc()))
        .scalars()
        .first()
        or 0
    ) + 1
    event = JobEvent(job_id=job_id, seq=seq, level=level, message=message[:2000], data_json=data or {})
    session.add(event)
    session.flush()
    return event


def request_cancel(session: Session, job_id: str) -> Job | None:
    job = session.get(Job, job_id)
    if job is None:
        return None
    if job.status in ACTIVE_STATUSES:
        job.cancel_requested = True
        log(session, job.id, "cancellation requested by the operator", level="warn")
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = utcnow()
        session.flush()
    return job


def check_cancelled(session: Session, job: Job) -> None:
    """Call between steps. Raises JobCancelled if the operator asked to stop."""
    session.refresh(job, attribute_names=["cancel_requested"])
    if job.cancel_requested:
        raise JobCancelled()


def set_progress(session: Session, job: Job, *, done: int | None = None, total: int | None = None,
                 step: str | None = None) -> None:
    if done is not None:
        job.progress_done = done
    if total is not None:
        job.progress_total = total
    if step is not None:
        job.current_step = step[:200]
    job.heartbeat_at = utcnow()
    session.flush()


def mark_interrupted_jobs() -> int:
    """On startup: no job can still be running, so say so honestly."""
    with session_scope() as session:
        rows = session.execute(select(Job).where(Job.status == "running")).scalars().all()
        for job in rows:
            job.status = "interrupted"
            job.error = "the backend restarted while this job was running"
            job.finished_at = utcnow()
            log(session, job.id, "marked interrupted: the backend restarted", level="error")
        return len(rows)


# --------------------------------------------------------------------------- #
# worker
# --------------------------------------------------------------------------- #
class Worker:
    """One background worker thread for the local workspace."""

    def __init__(self, poll_seconds: float = 0.5) -> None:
        self.poll_seconds = poll_seconds
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="scopeforge-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _claim(self) -> str | None:
        with session_scope() as session:
            job = session.execute(
                select(Job).where(Job.status == "queued").order_by(Job.created_at)
            ).scalars().first()
            if job is None:
                return None
            if job.cancel_requested:
                job.status = "cancelled"
                job.finished_at = utcnow()
                return None
            job.status = "running"
            job.started_at = utcnow()
            job.heartbeat_at = utcnow()
            log(session, job.id, "started")
            return job.id

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                job_id = self._claim()
            except Exception:
                job_id = None
            if job_id is None:
                time.sleep(self.poll_seconds)
                continue
            self._execute(job_id)

    def _execute(self, job_id: str) -> None:
        session: Session = SessionLocal()
        job = session.get(Job, job_id)
        try:
            handler = HANDLERS.get(job.kind)
            if handler is None:
                raise RuntimeError(f"no handler registered for job kind {job.kind!r}")
            result = handler(session, job)
            job.result_json = result or {}
            job.status = "succeeded"
            log(session, job.id, "finished", data={"result": job.result_json})
        except JobCancelled:
            session.rollback()
            job = session.get(Job, job_id)
            job.status = "cancelled"
            job.error = "cancelled by the operator"
            log(session, job.id, "cancelled", level="warn")
        except Exception as exc:
            session.rollback()
            job = session.get(Job, job_id)
            job.status = "failed"
            job.error = f"{type(exc).__name__}: {exc}"
            log(session, job.id, f"failed: {job.error}", level="error",
                data={"traceback": traceback.format_exc()[-4000:]})
        finally:
            job.finished_at = utcnow()
            job.heartbeat_at = utcnow()
            try:
                session.commit()
            except Exception:
                session.rollback()
            session.close()


worker = Worker()


def job_status(session: Session, job_id: str) -> dict[str, Any] | None:
    job = session.get(Job, job_id)
    if job is None:
        return None
    return {
        "id": job.id,
        "kind": job.kind,
        "status": job.status,
        "progress_done": job.progress_done,
        "progress_total": job.progress_total,
        "current_step": job.current_step,
        "cancel_requested": job.cancel_requested,
        "experiment_id": job.experiment_id,
        "error": job.error,
        "result": job.result_json,
        "model_calls_used": job.model_calls_used,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }
