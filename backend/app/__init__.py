"""ScopeForge backend package.

Console encoding is normalised here, at the earliest possible import, because
several dependencies (Weave among them) print non-ASCII characters - arrows,
emoji - in their startup banners. On Windows the default console encoding is
cp1252, which cannot encode them, and the resulting UnicodeEncodeError surfaces
as a tracing failure that has nothing to do with credentials.
"""

from __future__ import annotations

import sys


def _use_utf8_console() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            # a stream that cannot be reconfigured (already detached, or a
            # replacement object) is left alone; weave_tracing guards the
            # actual init call as well
            pass


_use_utf8_console()
