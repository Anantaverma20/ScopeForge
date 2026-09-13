# ScopeForge — Tested permissions for AI agents

> Working project name. Not a claim of trademark availability.

ScopeForge answers one question for a team deploying an AI agent:

**What permissions does our agent actually need, and can we restrict its access without breaking legitimate work?**

It runs a customer-support agent through legitimate tasks and adversarial scenarios against a synthetic
e-commerce sandbox, records every tool call and permission decision, asks a policy designer for a narrower
permission policy, enforces that policy, re-runs the same frozen suite, and accepts or rejects the candidate
against configured gates.

**What improves is the permission policy.** No language model is trained here.

The prototype covers one complete use case: checking orders, reading the signed-in customer's own
information, issuing eligible refunds, blocking access to another customer's or merchant's records, and
restricting unnecessary capabilities such as bulk export.

---

## Requirements

| Tool | Version used here | Notes |
|---|---|---|
| Python | 3.13 (3.11+ works) | `uv` is used for the environment |
| [uv](https://docs.astral.sh/uv/) | 0.11+ | `pip install uv` if you do not have it |
| Node.js | 22 | npm 11 |

## Setup

```bash
# 1. credentials
cp .env.example .env          # Windows: copy .env.example .env
#    then edit .env and set WANDB_API_KEY (https://wandb.ai/authorize),
#    WANDB_ENTITY (your W&B team) and WANDB_PROJECT.

# 2. backend
cd backend
uv venv --python 3.13
uv pip install -e ".[dev]"

# 3. frontend
cd ../frontend
npm install
```

## Run

Two terminals, from the repository root.

**Backend** (http://127.0.0.1:8787):

```bash
# macOS / Linux
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8787

# Windows (PowerShell or Git Bash)
cd backend; .venv/Scripts/python -m uvicorn app.main:app --reload --port 8787
```

**Frontend** (http://localhost:5273):

```bash
cd frontend && npm run dev
```

Open **http://localhost:5273**. The Vite dev server proxies `/api` to the backend, so only that one URL matters.

Health check: <http://127.0.0.1:8787/api/health> · API docs: <http://127.0.0.1:8787/docs>

## Without credentials

ScopeForge runs without a W&B key, and says so instead of pretending:

| Works offline | Needs `WANDB_API_KEY` |
|---|---|
| Dataset generation and inspection | Agent runs (support agent, baseline, evaluations) |
| Scenario suite generation | Model-written adversarial variants |
| Deterministic permission probes | Policy designer proposals |
| Policy validation, diffing, export | Weave tracing, W&B MCP evidence |

With no key, agent runs are recorded as **failed** with the real provider error, metric rates show **No data**
rather than 0 %, and the integration pills in the sidebar read *not configured*.

## Troubleshooting

**Weave reports `UnicodeEncodeError: 'charmap' codec can't encode character '→'`**

Already fixed — if you hit it, you are running an older copy. Weave prints an arrow and emoji in its
startup banner; the default Windows console encoding (cp1252) cannot encode them, so `weave.init` raised
from inside its own logging and the failure looked like a tracing/credentials problem. `backend/app/__init__.py`
now reconfigures stdout/stderr to UTF-8 at the earliest import, and `weave_tracing` additionally wraps the
`weave.init` call so un-encodable characters are replaced rather than raised. Verified with
`python -X utf8=0`, which forces the legacy cp1252 behaviour.

If you see it from some other dependency, `set PYTHONUTF8=1` (PowerShell: `$env:PYTHONUTF8=1`) before
starting the backend fixes it process-wide.

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest -q        # backend suite
cd frontend && npx playwright test                     # browser workflow checks
cd frontend && npm run typecheck && npm run build      # TypeScript + production build
```

Backend tests use isolated local state and, where a model call is involved, a clearly labelled scripted
stand-in. **They are not evidence that the live W&B integrations work** — that is what
*Settings → Check connections* and a real baseline run are for.

## Where things live

| I want to change… | File |
|---|---|
| The tested agent's prompt and loop | `backend/app/agents/support_agent.py` |
| The adversary's attack briefs | `backend/app/agents/adversary.py` |
| The policy designer's instructions | `backend/app/agents/policy_designer.py` |
| Business rules the verifier judges against | `config/business_contract.v1.json` |
| Refund limits, suite sizes, budgets, gates | `config/defaults.json` (and the Settings page) |
| The business tools themselves | `backend/app/gateway/tools.py` |
| Enforcement pipeline | `backend/app/gateway/gateway.py` |
| Policy language and evaluation | `backend/app/policies/schema.py`, `engine.py` |
| Scenario templates | `backend/app/evaluations/scenarios.py` |
| Scoring rules | `backend/app/evaluations/scorers.py` |
| Metrics | `backend/app/evaluations/metrics.py` |
| Improvement loop and acceptance gates | `backend/app/jobs/orchestrator.py` |
| Models, base URL, project | `.env` |
| Design tokens and visual language | `frontend/src/index.css` |

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit together
- [`docs/limitations.md`](docs/limitations.md) — what this does not do, and what is next
- [`docs/demo-guide.md`](docs/demo-guide.md) — a three-minute walkthrough from real saved executions
- [`docs/verification.md`](docs/verification.md) — what is locally verified, live-verified, blocked, or not implemented

## Honest scope

- The sandbox is **synthetic**. No real customer system is connected, and nothing leaves this machine.
- A policy produced here is a **tested candidate** within the supported policy language and the scenario
  coverage that was run. It is not minimal, not proven, and not a general security guarantee.
- Playground enforcement covers **the five implemented tools** and the conditions that were tested.
- This is a **local prototype**, not production authentication, authorization or a security certification.
