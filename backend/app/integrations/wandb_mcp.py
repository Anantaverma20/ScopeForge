"""W&B MCP client.

A real MCP client against the hosted W&B MCP server. Tool schemas are
*discovered* from the server and arguments are built from the discovered schema
rather than assumed. Only read-only trace tools are used.

Server: https://github.com/wandb/wandb-mcp-server
Hosted endpoint (configurable): https://mcp.withwandb.com/mcp

Sponsor credentials stay in the backend. Neither the tested support agent nor
the adversary ever receives them or an MCP handle.

If MCP is unavailable, the improvement loop falls back to locally stored traces
and the run is labelled `local_evidence`, never `mcp_assisted`.
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

from app.config import get_settings, load_defaults

READ_ONLY_TOOL_HINTS = ("schema", "query", "count", "list", "search", "get")
WRITE_TOOL_HINTS = ("create", "log", "delete", "update", "add")


@dataclass
class McpStatus:
    configured: bool
    ok: bool
    url: str
    tools: list[str] = field(default_factory=list)
    error: str = ""
    checked_at: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "ok": self.ok,
            "url": self.url,
            "tools": self.tools,
            "error": self.error,
        }


def _headers() -> dict[str, str]:
    settings = get_settings()
    return {
        "Authorization": f"Bearer {settings.wandb_api_key}",
        "Accept": "application/json, text/event-stream",
    }


async def _with_session(fn):
    """Open one authenticated MCP session over streamable HTTP.

    The transport takes its headers from the httpx client it is given, so the
    W&B bearer token is attached there and never leaves the backend.
    """
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    settings = get_settings()
    timeout = load_defaults().budget.mcp_timeout_seconds
    async with httpx2.AsyncClient(headers=_headers(), timeout=timeout) as http_client:
        async with streamable_http_client(settings.wandb_mcp_url, http_client=http_client) as streams:
            read_stream, write_stream = streams[0], streams[1]
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                return await fn(session)


def _run(coro_fn) -> Any:
    return asyncio.run(_with_session(coro_fn))


def discover() -> McpStatus:
    """List the server's tools and their input schemas."""
    settings = get_settings()
    status = McpStatus(
        configured=bool(settings.wandb_api_key and settings.wandb_mcp_url),
        ok=False,
        url=settings.wandb_mcp_url,
        checked_at=time.time(),
    )
    if not status.configured:
        status.error = "WANDB_API_KEY and WANDB_MCP_URL are required"
        return status
    try:
        async def _list(session):
            result = await session.list_tools()
            return [
                {"name": t.name, "description": t.description or "", "schema": _tool_schema(t)}
                for t in result.tools
            ]

        tools = _run(_list)
        status.ok = True
        status.tools = [t["name"] for t in tools]
        _TOOL_CACHE.clear()
        _TOOL_CACHE.update({t["name"]: t for t in tools})
    except BaseException as exc:
        status.error = _describe(exc)
    return status


_TOOL_CACHE: dict[str, dict] = {}


def _pick_tool(*keywords: str) -> dict | None:
    """Find a discovered read-only tool whose name matches all keywords."""
    for name, tool in _TOOL_CACHE.items():
        lowered = name.lower()
        if all(k in lowered for k in keywords) and not any(w in lowered for w in WRITE_TOOL_HINTS):
            return tool
    return None


def _build_args(schema: dict, wanted: dict[str, Any]) -> dict[str, Any]:
    """Fill a discovered input schema with values we actually have."""
    properties = (schema or {}).get("properties", {}) or {}
    required = set((schema or {}).get("required", []) or [])
    args: dict[str, Any] = {}
    for key, value in wanted.items():
        if key in properties and value is not None:
            args[key] = value
    missing = sorted(required - set(args))
    return {"args": args, "unfilled_required": missing, "known_properties": sorted(properties)}


def _tool_schema(tool: Any) -> dict:
    """Read a discovered tool's input schema across MCP SDK field namings."""
    for attribute in ("input_schema", "inputSchema"):
        schema = getattr(tool, attribute, None)
        if schema:
            return schema
    return {}


def _describe(exc: BaseException) -> str:
    """Flatten an ExceptionGroup so a failure is legible, not 'a TaskGroup error'."""
    subs = getattr(exc, "exceptions", None)
    if subs:
        return "; ".join(_describe(sub) for sub in subs)
    cause = getattr(exc, "__cause__", None)
    text = f"{type(exc).__name__}: {exc}"
    if cause is not None and not isinstance(cause, type(exc)):
        text += f" (caused by {type(cause).__name__}: {cause})"
    return text


def _content_to_text(result: Any) -> str:
    parts: list[str] = []
    for item in getattr(result, "content", []) or []:
        text = getattr(item, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts)


def fetch_trace_evidence(
    *,
    filters: dict | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    """Retrieve trace evidence for the configured project through read-only MCP tools.

    Returns a dict with `ok`, the tools actually used, and the raw text the
    server returned. Bounded retries cover trace-ingestion delay.
    """
    settings = get_settings()
    budget = load_defaults().budget
    out: dict[str, Any] = {
        "ok": False,
        "mode": "mcp",
        "url": settings.wandb_mcp_url,
        "entity": settings.wandb_entity,
        "project": settings.wandb_project,
        "tools_used": [],
        "schema": "",
        "traces": "",
        "error": "",
        "attempts": 0,
    }
    if not (settings.wandb_api_key and settings.wandb_entity and settings.wandb_project):
        out["error"] = "WANDB_API_KEY, WANDB_ENTITY and WANDB_PROJECT are required for MCP evidence"
        return out

    if not _TOOL_CACHE:
        status = discover()
        if not status.ok:
            out["error"] = status.error
            return out

    schema_tool = _pick_tool("trace", "schema") or _pick_tool("schema")
    query_tool = _pick_tool("query", "trace") or _pick_tool("query", "weave")
    if query_tool is None:
        out["error"] = f"no read-only trace query tool found; server exposes {sorted(_TOOL_CACHE)}"
        return out

    wanted = {
        "entity_name": settings.wandb_entity,
        "project_name": settings.wandb_project,
        "entity": settings.wandb_entity,
        "project": settings.wandb_project,
        "filters": filters or {},
        "limit": limit,
        "truncate_length": 600,
        "return_full_data": False,
        "metadata_only": False,
        "sort_by": "started_at",
        "sort_direction": "desc",
    }

    for attempt in range(1, budget.mcp_ingestion_retries + 2):
        out["attempts"] = attempt
        try:
            async def _call(session):
                collected: dict[str, str] = {}
                if schema_tool is not None:
                    built = _build_args(schema_tool["schema"], wanted)
                    result = await session.call_tool(schema_tool["name"], built["args"])
                    collected["schema"] = _content_to_text(result)
                    collected["schema_tool"] = schema_tool["name"]
                built = _build_args(query_tool["schema"], wanted)
                result = await session.call_tool(query_tool["name"], built["args"])
                collected["traces"] = _content_to_text(result)
                collected["query_tool"] = query_tool["name"]
                return collected

            collected = _run(_call)
            out["schema"] = collected.get("schema", "")[:8000]
            out["traces"] = collected.get("traces", "")[:20000]
            out["tools_used"] = [
                t for t in (collected.get("schema_tool"), collected.get("query_tool")) if t
            ]
            if out["traces"].strip():
                out["ok"] = True
                return out
            out["error"] = "the server returned no traces yet (ingestion delay)"
        except BaseException as exc:
            out["error"] = _describe(exc)
        if attempt <= budget.mcp_ingestion_retries:
            time.sleep(budget.mcp_retry_delay_seconds)
    return out


def summarise_evidence(evidence: dict[str, Any], max_chars: int = 6000) -> str:
    """Compact text block handed to the policy designer as retrieved evidence."""
    if not evidence.get("ok"):
        return ""
    header = (
        f"Weave trace evidence retrieved through the W&B MCP server "
        f"({', '.join(evidence.get('tools_used', []))}) for project "
        f"{evidence.get('entity')}/{evidence.get('project')}.\n"
    )
    body = ""
    if evidence.get("schema"):
        body += f"\nTrace schema:\n{evidence['schema'][:2000]}\n"
    body += f"\nTraces:\n{evidence.get('traces', '')}"
    return (header + body)[:max_chars]


def local_evidence_mode(reason: str) -> dict[str, Any]:
    return {"ok": False, "mode": "local_evidence", "error": reason, "tools_used": [], "traces": ""}


def json_safe(value: Any) -> str:
    try:
        return json.dumps(value, default=str)
    except Exception:
        return str(value)
