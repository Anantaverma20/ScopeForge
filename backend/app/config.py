"""Validated application configuration.

Two layers, deliberately separated:

* :class:`Settings` - process/environment level (secrets, ports, URLs). Loaded
  once at import from the repo-root ``.env``. Never serialised to the frontend.
* :class:`RuntimeSettings` - operator-tunable values (models, budgets, suite
  sizes, acceptance thresholds, business limits). Seeded from
  ``config/defaults.json`` and then persisted in the database so the UI can edit
  them. Nothing in the codebase may hardcode these values inline.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
CONFIG_DIR = REPO_ROOT / "config"
RUNTIME_DIR = BACKEND_DIR / "data" / "runtime"


class Settings(BaseSettings):
    """Environment-level settings. Secrets live here and stay server-side."""

    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    wandb_api_key: str = ""
    wandb_entity: str = ""
    wandb_project: str = "scopeforge"

    llm_base_url: str = "https://api.inference.wandb.ai/v1"
    llm_model: str = "openai/gpt-oss-120b"
    llm_policy_model: str = ""

    wandb_mcp_url: str = "https://mcp.withwandb.com/mcp"

    # Send the OpenAI-Project header to W&B Inference for usage attribution.
    # Off by default: this deployment rejects it with 401 invalid_api_key.
    llm_send_project_header: bool = False

    database_url: str = ""
    # how long a writer waits for SQLite's single write lock before giving up
    sqlite_busy_timeout_ms: int = 60000
    backend_port: int = 8787
    frontend_port: int = 5273
    cors_origins: str = "http://localhost:5273,http://127.0.0.1:5273"

    llm_cost_per_mtok_input: float | None = None
    llm_cost_per_mtok_output: float | None = None

    @field_validator("llm_cost_per_mtok_input", "llm_cost_per_mtok_output", mode="before")
    @classmethod
    def _empty_to_none(cls, v: object) -> object:
        if v in ("", None):
            return None
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def resolved_database_url(self) -> str:
        """Absolute SQLite URL.

        A relative sqlite path in .env is resolved against the repository root,
        not the working directory, so the backend can be started from anywhere.
        """
        if not self.database_url:
            RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
            return f"sqlite:///{(RUNTIME_DIR / 'scopeforge.db').as_posix()}"
        url = self.database_url
        prefix = "sqlite:///"
        if url.startswith(prefix):
            raw = url[len(prefix):]
            path = Path(raw)
            if not path.is_absolute():
                path = (REPO_ROOT / raw.lstrip("./")).resolve()
            path.parent.mkdir(parents=True, exist_ok=True)
            return f"{prefix}{path.as_posix()}"
        return url

    @property
    def weave_project(self) -> str:
        """Weave project path ``entity/project`` - empty when unconfigured."""
        if not self.wandb_entity or not self.wandb_project:
            return ""
        return f"{self.wandb_entity}/{self.wandb_project}"

    def credential_status(self) -> dict[str, bool]:
        return {
            "wandb_api_key": bool(self.wandb_api_key),
            "wandb_entity": bool(self.wandb_entity),
            "wandb_project": bool(self.wandb_project),
        }


class BusinessLimits(BaseModel):
    """Owner-configured business limits referenced by policy rules via
    ``config_ref``. Policy candidates may reference these but never change them.
    """

    max_refund_minor: int = Field(gt=0)
    refund_window_days: int = Field(gt=0)
    currency: str = "USD"
    refundable_order_statuses: list[str]


class GenerationDefaults(BaseModel):
    merchants: int = Field(ge=1, le=50)
    customers_per_merchant: int = Field(ge=1, le=500)
    orders_per_customer_max: int = Field(ge=1, le=50)
    products_per_merchant: int = Field(ge=1, le=200)
    tickets_per_merchant: int = Field(ge=0, le=500)
    seed: int = 20260101
    clock_iso: str = "2026-03-01T12:00:00+00:00"


class SuiteDefaults(BaseModel):
    legitimate_cases: int = Field(ge=1, le=200)
    adversarial_cases: int = Field(ge=0, le=200)
    dev_split: float = Field(gt=0, lt=1)
    validation_split: float = Field(gt=0, lt=1)
    # test split is the remainder; validated below


class AcceptanceCriteria(BaseModel):
    """Explicit, configured accept/reject gates for a candidate policy."""

    max_unauthorized_success_rate: float = Field(ge=0, le=1)
    min_legit_completion_rate: float = Field(ge=0, le=1)
    max_legit_completion_drop: float = Field(ge=0, le=1)
    max_false_denial_rate: float = Field(ge=0, le=1)
    require_permission_breadth_not_worse: bool = True


class BudgetDefaults(BaseModel):
    max_iterations: int = Field(ge=1, le=20)
    max_model_calls_per_job: int = Field(ge=1, le=2000)
    max_agent_steps_per_scenario: int = Field(ge=1, le=30)
    llm_timeout_seconds: int = Field(ge=5, le=600)
    llm_max_retries: int = Field(ge=0, le=5)
    # Always sent on a completion. Without a cap a reasoning model can generate
    # until it exhausts its context, wedging the single worker for minutes.
    llm_max_tokens: int = Field(default=1200, ge=64, le=32000)
    llm_max_tokens_designer: int = Field(default=6000, ge=256, le=32000)
    mcp_timeout_seconds: int = Field(ge=5, le=300)
    mcp_ingestion_retries: int = Field(ge=0, le=10)
    mcp_retry_delay_seconds: float = Field(ge=0, le=60)


class RuntimeSettings(BaseModel):
    """Operator-tunable settings, persisted in the database."""

    llm_model: str
    llm_policy_model: str = ""
    llm_temperature: float = Field(ge=0, le=2)
    generation: GenerationDefaults
    suite: SuiteDefaults
    acceptance: AcceptanceCriteria
    budget: BudgetDefaults
    business_limits: BusinessLimits
    business_contract_version: str

    @property
    def test_split(self) -> float:
        return round(1.0 - self.suite.dev_split - self.suite.validation_split, 6)

    @field_validator("suite")
    @classmethod
    def _splits_leave_room_for_test(cls, v: SuiteDefaults) -> SuiteDefaults:
        if v.dev_split + v.validation_split >= 1.0:
            raise ValueError("dev_split + validation_split must leave room for a test split")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


@lru_cache(maxsize=1)
def load_defaults() -> RuntimeSettings:
    """Read ``config/defaults.json`` and validate it into RuntimeSettings."""
    raw = json.loads((CONFIG_DIR / "defaults.json").read_text(encoding="utf-8"))
    env = get_settings()
    raw["llm_model"] = env.llm_model or raw["llm_model"]
    raw["llm_policy_model"] = env.llm_policy_model or raw.get("llm_policy_model", "")
    return RuntimeSettings.model_validate(raw)


@lru_cache(maxsize=1)
def load_business_contract() -> "BusinessContract":
    from app.policies.contract import BusinessContract

    version = load_defaults().business_contract_version
    path = CONFIG_DIR / f"business_contract.{version}.json"
    return BusinessContract.model_validate_json(path.read_text(encoding="utf-8"))
