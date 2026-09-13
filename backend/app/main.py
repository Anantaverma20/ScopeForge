"""ScopeForge backend - tested permissions for AI agents.

Local prototype. CORS is restricted to the configured local development origins,
secrets stay in this process, and the business sandbox is synthetic.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError

from app.api import datasets, experiments, health, jobs, playground, policies, workspace
from app.config import get_settings
from app.db import init_db, session_scope
from app.jobs import orchestrator  # noqa: F401  (registers job handlers)
from app.jobs.queue import mark_interrupted_jobs, worker
from app.policies.store import backfill_semantic_hashes, ensure_baseline_policy
from app.settings_store import get_runtime_settings

logger = logging.getLogger("scopeforge")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    interrupted = mark_interrupted_jobs()
    if interrupted:
        logger.warning("marked %s interrupted job(s) after restart", interrupted)
    with session_scope() as session:
        ensure_baseline_policy(session)
        get_runtime_settings(session)
        filled = backfill_semantic_hashes(session)
        if filled:
            logger.info("computed semantic hashes for %s existing policy version(s)", filled)
    worker.start()
    yield
    worker.stop()


settings = get_settings()

app = FastAPI(
    title="ScopeForge",
    description="Tested permissions for AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

for module in (health, datasets, policies, experiments, jobs, playground, workspace):
    app.include_router(module.router)


@app.exception_handler(OperationalError)
async def _database_busy(request: Request, exc: OperationalError) -> JSONResponse:
    """SQLite allows one writer at a time.

    A long-running job holding the write lock is a queueing problem, not a crash,
    so it gets a 503 and an actionable message instead of an opaque 500.
    """
    if "database is locked" not in str(exc.orig).lower():
        raise exc
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "The workspace database is busy with a running job and could not accept this "
                "request in time. Wait for the running job to finish, or cancel it, then try again."
            )
        },
    )


@app.get("/")
def root() -> dict:
    return {
        "name": "ScopeForge",
        "tagline": "Tested permissions for AI agents",
        "docs": "/docs",
        "health": "/api/health",
    }
