"""SQLite/SQLAlchemy engine and session management."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_settings = get_settings()

engine: Engine = create_engine(
    _settings.resolved_database_url,
    future=True,
    connect_args={"check_same_thread": False, "timeout": _settings.sqlite_busy_timeout_ms / 1000},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record) -> None:  # noqa: ANN001
    cur = dbapi_connection.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute(f"PRAGMA busy_timeout={_settings.sqlite_busy_timeout_ms}")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(UTC)


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope. Commits on success, rolls back on exception."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_session() -> Iterator[Session]:
    """FastAPI dependency."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


# Columns added after the first release. SQLite create_all() will not add a
# column to a table that already exists, so they are applied here. Keyed by
# table -> {column: DDL}. Adding a nullable/defaulted column is safe to re-run.
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "policies": {"semantic_hash": "VARCHAR(64) DEFAULT ''"},
}


def _apply_column_migrations() -> list[str]:
    applied: list[str] = []
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            present = {row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")}
            if not present:
                continue  # table not created yet; create_all will include the column
            for column, ddl in columns.items():
                if column not in present:
                    conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
                    applied.append(f"{table}.{column}")
    return applied


def init_db() -> None:
    from app.models import orm  # noqa: F401  (register mappers)

    orm.Base.metadata.create_all(bind=engine)
    _apply_column_migrations()
