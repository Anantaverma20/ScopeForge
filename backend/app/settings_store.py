"""Persisted, operator-editable runtime settings.

Seeded from `config/defaults.json` on first use, then stored in the database so
the UI can change models, budgets, suite sizes, acceptance thresholds and
business limits without touching code.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.config import RuntimeSettings, load_defaults
from app.db import utcnow
from app.models.orm import AppSetting

SETTINGS_KEY = "runtime_settings"


def _deep_merge(base: dict, patch: dict) -> dict:
    out = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def get_runtime_settings(session: Session) -> RuntimeSettings:
    row = session.get(AppSetting, SETTINGS_KEY)
    if row is None:
        settings = load_defaults()
        session.add(AppSetting(key=SETTINGS_KEY, value_json=settings.model_dump(mode="json")))
        session.flush()
        return settings
    try:
        return RuntimeSettings.model_validate(row.value_json)
    except Exception:
        # a stored document that no longer validates falls back to defaults
        return load_defaults()


def update_runtime_settings(session: Session, patch: dict[str, Any]) -> RuntimeSettings:
    current = get_runtime_settings(session).model_dump(mode="json")
    merged = _deep_merge(current, patch)
    settings = RuntimeSettings.model_validate(merged)  # raises on invalid input
    row = session.get(AppSetting, SETTINGS_KEY)
    if row is None:
        session.add(AppSetting(key=SETTINGS_KEY, value_json=settings.model_dump(mode="json")))
    else:
        row.value_json = settings.model_dump(mode="json")
        row.updated_at = utcnow()
    session.flush()
    return settings


def reset_runtime_settings(session: Session) -> RuntimeSettings:
    settings = load_defaults()
    row = session.get(AppSetting, SETTINGS_KEY)
    if row is None:
        session.add(AppSetting(key=SETTINGS_KEY, value_json=settings.model_dump(mode="json")))
    else:
        row.value_json = settings.model_dump(mode="json")
        row.updated_at = utcnow()
    session.flush()
    return settings
