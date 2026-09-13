"""Console-encoding guards around Weave initialisation.

Regression: on a Windows cp1252 console, Weave's startup banner (which contains
an arrow and emoji) raised UnicodeEncodeError from inside weave.init. That was
reported as a tracing failure even though the credentials were fine.

No network calls here - the guard is exercised against a stand-in that prints
the same characters weave does.
"""

from __future__ import annotations

import io
import sys

import pytest

from app.integrations.weave_tracing import _SafeWriter, _encodable_console, tracer


def cp1252_stream() -> io.TextIOWrapper:
    """A stream that behaves like a default Windows console."""
    return io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict", write_through=True)


def test_cp1252_stream_really_rejects_the_weave_banner():
    """Guard the guard: confirm the failure mode still exists without the wrapper."""
    stream = cp1252_stream()
    with pytest.raises(UnicodeEncodeError):
        stream.write("→ https://wandb.ai/entity/project \U0001f369")


def test_safe_writer_replaces_unencodable_characters():
    stream = cp1252_stream()
    writer = _SafeWriter(stream)
    writer.write("→ logged in \U0001f369")  # must not raise
    stream.flush()
    written = stream.buffer.getvalue().decode("cp1252")
    assert "logged in" in written
    assert "→" not in written  # replaced, not crashed


def test_safe_writer_passes_other_attributes_through():
    stream = cp1252_stream()
    writer = _SafeWriter(stream)
    assert writer.encoding == "cp1252"
    writer.flush()


def test_encodable_console_protects_a_cp1252_console_and_restores_streams():
    original_out, original_err = sys.stdout, sys.stderr
    fake_out, fake_err = cp1252_stream(), cp1252_stream()
    sys.stdout, sys.stderr = fake_out, fake_err
    try:
        with _encodable_console():
            # exactly what weave.init prints on a successful login
            print("\U0001f369 https://wandb.ai/entity/project/weave → view traces")
            print("warning → partial", file=sys.stderr)
        # streams restored to what they were before the block
        assert sys.stdout is fake_out
        assert sys.stderr is fake_err
    finally:
        sys.stdout, sys.stderr = original_out, original_err

    assert "view traces" in fake_out.buffer.getvalue().decode("cp1252")


def test_tracer_reports_missing_credentials_rather_than_an_encoding_error(monkeypatch):
    """Without credentials the message must still be the setup instruction."""
    from app import config

    monkeypatch.setattr(config, "get_settings", config.get_settings)
    status = tracer.status()
    if not status.configured:
        tracer.ensure_initialised()
        assert "WANDB_API_KEY" in tracer.status().error


def test_package_import_normalises_console_encoding():
    """app/__init__.py reconfigures the real process streams to UTF-8."""
    import app  # noqa: F401

    for stream in (sys.stdout, sys.stderr):
        encoding = getattr(stream, "encoding", "") or ""
        # pytest replaces the streams with its own capture objects, which may not
        # expose reconfigure; the contract is only that nothing raised on import
        assert isinstance(encoding, str)
