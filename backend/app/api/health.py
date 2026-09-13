"""Health and integration checks.

Integration state is never assumed: `GET /api/integrations` returns the result of
the last real check performed in this workspace, and `POST /api/integrations/check`
performs live calls now. A missing credential produces setup instructions, never
a connected-looking state.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import schemas
from app.api.serializers import iso
from app.config import get_settings
from app.db import get_session
from app.integrations import llm, wandb_mcp
from app.integrations.weave_tracing import tracer
from app.jobs.queue import worker
from app.models.orm import IntegrationCheck
from app.settings_store import get_runtime_settings

router = APIRouter(prefix="/api", tags=["health"])

VERSION = "0.1.0"

SETUP_HINTS = {
    "llm": "Set WANDB_API_KEY in .env (create one at https://wandb.ai/authorize), then restart the backend.",
    "weave": "Set WANDB_API_KEY, WANDB_ENTITY and WANDB_PROJECT in .env to record traces.",
    "mcp": "Set WANDB_API_KEY and WANDB_MCP_URL in .env to retrieve trace evidence over MCP.",
}


def _latest_checks(session: Session) -> dict[str, IntegrationCheck]:
    out: dict[str, IntegrationCheck] = {}
    for row in session.execute(select(IntegrationCheck).order_by(IntegrationCheck.checked_at)).scalars():
        out[row.name] = row
    return out


def integration_states(session: Session) -> list[schemas.IntegrationState]:
    settings = get_settings()
    checks = _latest_checks(session)
    states: list[schemas.IntegrationState] = []

    configured = {
        "llm": bool(settings.wandb_api_key),
        "weave": bool(settings.wandb_api_key and settings.weave_project),
        "mcp": bool(settings.wandb_api_key and settings.wandb_mcp_url),
    }
    for name in ("llm", "weave", "mcp"):
        row = checks.get(name)
        states.append(
            schemas.IntegrationState(
                name=name,
                configured=configured[name],
                ok=(row.ok if row else None),
                detail=(
                    (row.detail_json or {}).get("detail", "") if row else
                    ("" if configured[name] else SETUP_HINTS[name])
                ),
                data=(row.detail_json or {}) if row else {},
                checked_at=iso(row.checked_at) if row else None,
            )
        )
    return states


@router.get("/health", response_model=schemas.HealthResponse)
def health(session: Session = Depends(get_session)) -> schemas.HealthResponse:
    settings = get_settings()
    return schemas.HealthResponse(
        status="ok",
        version=VERSION,
        database=settings.resolved_database_url.split("/")[-1],
        worker_running=worker._thread is not None and worker._thread.is_alive(),
        integrations=integration_states(session),
    )


@router.get("/integrations", response_model=list[schemas.IntegrationState])
def integrations(session: Session = Depends(get_session)) -> list[schemas.IntegrationState]:
    return integration_states(session)


@router.post("/integrations/check", response_model=list[schemas.IntegrationState])
def check_integrations(session: Session = Depends(get_session)) -> list[schemas.IntegrationState]:
    """Run real connection checks. Whatever comes back is what is reported."""
    runtime = get_runtime_settings(session)

    models = llm.list_models()
    detail: dict = {"models": models.get("models", [])[:50], "base_url": models.get("base_url", "")}
    if models["ok"]:
        tool_check = llm.check_tool_calling(runtime.llm_model)
        detail["tool_calling"] = tool_check
        ok = bool(tool_check.get("ok"))
        text = (
            f"{len(models['models'])} models available; {runtime.llm_model} "
            + ("emitted a tool call" if tool_check.get("supports_tool_calls") else
               f"did NOT emit a tool call. {tool_check.get('note') or tool_check.get('error', '')}")
        )
        if not tool_check.get("supports_tool_calls"):
            ok = False
    else:
        ok, text = False, models.get("error", "unknown error")
    detail["detail"] = text
    session.add(IntegrationCheck(name="llm", ok=ok, detail_json=detail))

    weave_status = tracer.ensure_initialised(force=True)
    session.add(
        IntegrationCheck(
            name="weave",
            ok=weave_status.initialised,
            detail_json={
                **weave_status.as_dict(),
                "detail": (
                    f"tracing to {weave_status.project}"
                    if weave_status.initialised
                    else weave_status.error or SETUP_HINTS["weave"]
                ),
            },
        )
    )

    mcp_status = wandb_mcp.discover()
    session.add(
        IntegrationCheck(
            name="mcp",
            ok=mcp_status.ok,
            detail_json={
                **mcp_status.as_dict(),
                "detail": (
                    f"{len(mcp_status.tools)} tools discovered at {mcp_status.url}"
                    if mcp_status.ok
                    else mcp_status.error or SETUP_HINTS["mcp"]
                ),
            },
        )
    )
    session.commit()
    return integration_states(session)
