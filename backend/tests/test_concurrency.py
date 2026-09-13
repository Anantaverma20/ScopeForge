"""The API must stay usable while the worker is running a job.

SQLite allows a single writer. A scenario run spends most of its wall clock
waiting on model calls, so the runner must not hold the write lock across that
wait - otherwise clicking "Start improvement loop" while a baseline is running
fails with `database is locked`, which is what happened in practice.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import OperationalError

from app.db import SessionLocal
from app.gateway.gateway import ToolGateway, TrustedContext
from app.models.orm import Job, ToolEvent
from app.jobs.queue import enqueue
from tests.conftest import make_gateway, pick_customers


def test_gateway_commits_each_event_when_asked(session, dataset, baseline_engine):
    """With commit_each_event, evidence is durable and the lock is released."""
    policy, engine = baseline_engine
    subject, _, _ = pick_customers(session, dataset.id)
    gateway = make_gateway(
        session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject
    )
    gateway.commit_each_event = True

    result = gateway.call("get_customer", {"customer_id": subject.id})
    assert result.executed is True

    # a second connection sees the event without the first one committing again
    other = SessionLocal()
    try:
        seen = other.execute(
            select(ToolEvent).where(ToolEvent.id == result.event.id)
        ).scalar_one_or_none()
        assert seen is not None, "the tool event should already be committed"
    finally:
        other.close()


def test_gateway_defaults_to_leaving_the_transaction_to_the_caller(session, dataset, baseline_engine):
    """The playground path keeps normal request semantics: one commit, at the end."""
    policy, engine = baseline_engine
    subject, _, _ = pick_customers(session, dataset.id)
    gateway = make_gateway(
        session, dataset_id=dataset.id, engine=engine, policy_id=policy.id, customer=subject
    )
    assert gateway.commit_each_event is False


def test_an_open_write_transaction_blocks_every_other_writer():
    """Guard the guard: the constraint the runner is designed around.

    `busy_timeout` does not rescue this - it waits, and the holder never lets go.
    The only fix is to not hold the lock across a long operation, which is why
    the runner commits before each model call.
    """
    holder = SessionLocal()
    other = SessionLocal()
    try:
        holder.execute(text("CREATE TABLE IF NOT EXISTS _lock_probe (id INTEGER PRIMARY KEY)"))
        holder.commit()

        holder.execute(text("INSERT INTO _lock_probe (id) VALUES (1)"))
        holder.flush()  # write lock taken, transaction still open

        other.execute(text("PRAGMA busy_timeout=200"))  # do not wait the full minute
        with pytest.raises(OperationalError) as caught:
            other.execute(text("INSERT INTO _lock_probe (id) VALUES (2)"))
            other.flush()
        assert "database is locked" in str(caught.value.orig).lower()
    finally:
        other.rollback()
        other.close()
        holder.rollback()
        holder.close()


def test_committing_releases_the_lock_for_the_next_writer():
    """Exactly what `run_scenario` does before it calls the model."""
    first = SessionLocal()
    second = SessionLocal()
    try:
        first.execute(text("CREATE TABLE IF NOT EXISTS _lock_probe (id INTEGER PRIMARY KEY)"))
        first.commit()

        first.execute(text("INSERT INTO _lock_probe (id) VALUES (10)"))
        first.commit()  # the lock is released here

        second.execute(text("PRAGMA busy_timeout=200"))
        second.execute(text("INSERT INTO _lock_probe (id) VALUES (11)"))
        second.commit()  # no wait, no error

        rows = second.execute(text("SELECT COUNT(*) FROM _lock_probe WHERE id IN (10, 11)")).scalar_one()
        assert rows == 2
    finally:
        for s in (first, second):
            s.execute(text("DELETE FROM _lock_probe"))
            s.commit()
            s.close()


def test_duplicate_submissions_reuse_the_live_job(session):
    first, created_first = enqueue(
        session, kind="improvement", params={"suite_id": "ste_dedupe"}, dedupe_key="improve:dedupe"
    )
    session.commit()
    second, created_second = enqueue(
        session, kind="improvement", params={"suite_id": "ste_dedupe"}, dedupe_key="improve:dedupe"
    )
    session.commit()

    assert created_first is True
    assert created_second is False
    assert second.id == first.id
    assert (
        session.execute(select(Job).where(Job.dedupe_key == "improve:dedupe")).scalars().all().__len__() == 1
    )


@pytest.mark.parametrize("status", ["succeeded", "failed", "cancelled"])
def test_a_finished_job_does_not_block_a_new_one(session, status):
    job, _ = enqueue(session, kind="improvement", params={}, dedupe_key=f"improve:{status}")
    job.status = status
    session.commit()

    again, created = enqueue(session, kind="improvement", params={}, dedupe_key=f"improve:{status}")
    session.commit()
    assert created is True
    assert again.id != job.id
