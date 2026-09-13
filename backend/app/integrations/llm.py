"""W&B Inference client (OpenAI-compatible).

Base URL, model and credentials are configuration, never hardcoded call sites.
Failures are surfaced verbatim: a model call that fails stays a failed call, and
no part of the system substitutes a canned response.

Docs: https://docs.wandb.ai/inference  |  https://docs.wandb.ai/inference/models
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any

import httpx
from openai import OpenAI

from app.config import get_settings, load_defaults


class LLMUnavailable(Exception):
    """A real model call failed. Never swallowed, never replaced with a fake."""


class _CallCounter:
    """Counts real completion attempts so job budgets are enforced on facts."""

    def __init__(self) -> None:
        self.count = 0

    def increment(self) -> int:
        self.count += 1
        return self.count


CALL_COUNTER = _CallCounter()


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""
    parse_error: str = ""


@dataclass
class LLMResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str = ""
    model: str = ""
    usage: dict[str, int] = field(default_factory=dict)
    latency_ms: int = 0
    raw_message: dict[str, Any] = field(default_factory=dict)


def _timeout() -> httpx.Timeout:
    """Cap a hung response read without punishing a slow-but-alive connection."""
    budget = load_defaults().budget
    return httpx.Timeout(
        connect=10.0,
        read=float(budget.llm_timeout_seconds),
        write=20.0,
        pool=10.0,
    )


def _client() -> OpenAI:
    settings = get_settings()
    if not settings.wandb_api_key:
        raise LLMUnavailable(
            "WANDB_API_KEY is not set. Add it to .env (create one at https://wandb.ai/authorize) "
            "and restart the backend."
        )
    kwargs: dict[str, Any] = {
        "base_url": settings.llm_base_url,
        "api_key": settings.wandb_api_key,
        "timeout": _timeout(),
        "max_retries": 0,  # retries are handled here so each attempt is recorded
    }
    # The docs show an optional `project="team/project"` argument for usage
    # attribution. Against this deployment it makes /chat/completions return
    # 401 invalid_api_key (while /models with the same key returns 200), so it
    # is off by default and gated behind an explicit opt-in.
    if settings.llm_send_project_header and settings.weave_project:
        kwargs["project"] = settings.weave_project
    return OpenAI(**kwargs)


def chat(
    messages: list[dict],
    *,
    model: str | None = None,
    tools: list[dict] | None = None,
    temperature: float | None = None,
    max_retries: int | None = None,
    max_tokens: int | None = None,
) -> LLMResponse:
    """One chat completion against W&B Inference.

    `max_tokens` is always sent. Without it a reasoning model asked to "paste the
    whole customer table" will generate until it exhausts its context, which
    blocks the single worker for minutes and is indistinguishable from a hang.
    """
    defaults = load_defaults()
    model = model or defaults.llm_model
    temperature = defaults.llm_temperature if temperature is None else temperature
    attempts = (max_retries if max_retries is not None else defaults.budget.llm_max_retries) + 1
    max_tokens = max_tokens or defaults.budget.llm_max_tokens

    client = _client()
    last_error: Exception | None = None
    for attempt in range(attempts):
        started = time.perf_counter()
        CALL_COUNTER.increment()
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if tools:
                kwargs["tools"] = tools
                kwargs["tool_choice"] = "auto"
            completion = client.chat.completions.create(**kwargs)
        except Exception as exc:
            last_error = exc
            if attempt == attempts - 1:
                break
            time.sleep(min(2**attempt, 8))
            continue

        latency_ms = int((time.perf_counter() - started) * 1000)
        choice = completion.choices[0]
        message = choice.message
        tool_calls: list[ToolCall] = []
        for tc in message.tool_calls or []:
            raw = tc.function.arguments or "{}"
            try:
                parsed = json.loads(raw) if raw.strip() else {}
                parse_error = ""
                if not isinstance(parsed, dict):
                    parsed, parse_error = {}, "tool arguments were not a JSON object"
            except json.JSONDecodeError as exc:
                parsed, parse_error = {}, f"malformed tool arguments: {exc}"
            tool_calls.append(
                ToolCall(
                    id=tc.id, name=tc.function.name, arguments=parsed,
                    raw_arguments=raw, parse_error=parse_error,
                )
            )
        usage = {}
        if completion.usage:
            usage = {
                "prompt_tokens": completion.usage.prompt_tokens or 0,
                "completion_tokens": completion.usage.completion_tokens or 0,
                "total_tokens": completion.usage.total_tokens or 0,
            }
        return LLMResponse(
            content=message.content or "",
            tool_calls=tool_calls,
            finish_reason=choice.finish_reason or "",
            model=completion.model or model,
            usage=usage,
            latency_ms=latency_ms,
            raw_message={
                "role": "assistant",
                "content": message.content,
                "tool_calls": [
                    {"id": tc.id, "type": "function",
                     "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                    for tc in (message.tool_calls or [])
                ],
            },
        )

    raise LLMUnavailable(f"{type(last_error).__name__}: {last_error}")


# --------------------------------------------------------------------------- #
# connection checks - real network calls, honestly reported
# --------------------------------------------------------------------------- #
def list_models() -> dict[str, Any]:
    settings = get_settings()
    if not settings.wandb_api_key:
        return {"ok": False, "error": "WANDB_API_KEY is not set", "models": []}
    try:
        response = httpx.get(
            f"{settings.llm_base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {settings.wandb_api_key}"},
            timeout=load_defaults().budget.llm_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        models = sorted(m.get("id", "") for m in payload.get("data", []))
        return {"ok": True, "models": models, "base_url": settings.llm_base_url}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "models": []}


PROBE_TOOL = [
    {
        "type": "function",
        "function": {
            "name": "lookup_order_status",
            "description": "Look up the delivery status of an order by id.",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string"}},
                "required": ["order_id"],
                "additionalProperties": False,
            },
        },
    }
]


def check_tool_calling(model: str | None = None) -> dict[str, Any]:
    """Verify the configured model actually emits tool calls.

    This is a real request. The result is whatever the provider returned.
    """
    model = model or load_defaults().llm_model
    try:
        response = chat(
            [
                {"role": "system", "content": "You look up orders. Always use the provided tool."},
                {"role": "user", "content": "What is the status of order ORD-42?"},
            ],
            model=model,
            tools=PROBE_TOOL,
            temperature=0,
            max_retries=0,
        )
    except LLMUnavailable as exc:
        return {"ok": False, "model": model, "supports_tool_calls": False, "error": str(exc)}
    return {
        "ok": True,
        "model": response.model,
        "supports_tool_calls": bool(response.tool_calls),
        "tool_call_names": [tc.name for tc in response.tool_calls],
        "finish_reason": response.finish_reason,
        "latency_ms": response.latency_ms,
        "usage": response.usage,
        "note": (
            ""
            if response.tool_calls
            else "The model answered without calling the tool. Scenario runs need tool calling; pick another model."
        ),
    }


def cost_for_usage(usage: dict[str, int]) -> dict[str, Any]:
    """Only report dollars when a verified rate is configured for this model."""
    settings = get_settings()
    if settings.llm_cost_per_mtok_input is None or settings.llm_cost_per_mtok_output is None:
        return {"available": False, "reason": "No verified price configured for this model"}
    prompt = usage.get("prompt_tokens", 0) / 1_000_000 * settings.llm_cost_per_mtok_input
    completion = usage.get("completion_tokens", 0) / 1_000_000 * settings.llm_cost_per_mtok_output
    return {"available": True, "usd": round(prompt + completion, 6)}
