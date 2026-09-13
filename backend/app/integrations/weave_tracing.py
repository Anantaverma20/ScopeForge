"""W&B Weave tracing.

Weave is initialised lazily and at most once per process. If initialisation
fails - no key, wrong entity, network down - the failure is recorded and
reported as-is. Nothing in ScopeForge claims a run was traced when the
integration did not work: every ScenarioRun carries a `trace_status` that is
only set to "traced" when a real call id came back from Weave.

Authoritative records always live in the local database. Weave is additional
evidence, never the source of truth the UI depends on.
"""

from __future__ import annotations

import sys
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import weave

from app.config import get_settings


class _SafeWriter:
    """Wraps a stream so un-encodable characters never raise.

    Weave prints arrows and emoji in its startup banner. On a cp1252 console
    that raises UnicodeEncodeError from inside weave.init, which would otherwise
    be reported as a tracing failure even though the credentials are fine.
    """

    def __init__(self, stream: Any) -> None:
        self._stream = stream
        encoding = getattr(stream, "encoding", None) or "utf-8"
        self._encoding = encoding

    def write(self, text: str) -> int:
        try:
            return self._stream.write(text)
        except UnicodeEncodeError:
            safe = text.encode(self._encoding, errors="replace").decode(self._encoding, errors="replace")
            return self._stream.write(safe)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


@contextmanager
def _encodable_console():
    """Guarantee stdout/stderr can swallow non-ASCII for the duration of a call."""
    original_out, original_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _SafeWriter(original_out), _SafeWriter(original_err)
    try:
        yield
    finally:
        sys.stdout, sys.stderr = original_out, original_err


@dataclass
class WeaveStatus:
    configured: bool
    initialised: bool
    project: str
    error: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "initialised": self.initialised,
            "project": self.project,
            "error": self.error,
        }


class WeaveTracer:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._attempted = False
        self._client: Any = None
        self._error = ""

    @property
    def project(self) -> str:
        return get_settings().weave_project

    def status(self) -> WeaveStatus:
        settings = get_settings()
        configured = bool(settings.wandb_api_key and settings.weave_project)
        return WeaveStatus(
            configured=configured,
            initialised=self._client is not None,
            project=self.project,
            error=self._error,
        )

    def ensure_initialised(self, force: bool = False) -> WeaveStatus:
        settings = get_settings()
        if not settings.wandb_api_key or not settings.weave_project:
            self._error = "WANDB_API_KEY and WANDB_ENTITY/WANDB_PROJECT are required for tracing"
            return self.status()

        with self._lock:
            if force:
                self._attempted = False
                self._client = None
                self._error = ""
            if self._attempted:
                return self.status()
            self._attempted = True
            try:
                import os

                os.environ.setdefault("WANDB_API_KEY", settings.wandb_api_key)
                with _encodable_console():
                    self._client = weave.init(self.project)
                self._error = ""
            except Exception as exc:  # network / auth / project errors surface verbatim
                self._client = None
                self._error = f"{type(exc).__name__}: {exc}"
        return self.status()

    def call_metadata(self, call: Any) -> dict[str, str]:
        """Extract real trace identifiers. Returns empty values when untraced."""
        call_id = getattr(call, "id", None)
        if not call_id:
            return {"call_id": "", "url": "", "status": "not_traced"}
        url = ""
        try:
            url = call.ui_url or ""
        except Exception:
            entity_project = self.project.replace("/", "/")
            url = f"https://wandb.ai/{entity_project}/weave/calls/{call_id}" if entity_project else ""
        return {"call_id": str(call_id), "url": url, "status": "traced"}

    def attributes(self, **kwargs: Any):
        """Attach run/scenario/policy identifiers to everything traced inside."""
        return weave.attributes({k: v for k, v in kwargs.items() if v is not None})

    def flush(self) -> None:
        if self._client is not None:
            try:
                self._client.flush()
            except Exception:
                pass


tracer = WeaveTracer()
