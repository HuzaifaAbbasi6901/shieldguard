# Contributing to ShieldGuard

Thanks for helping build a friendlier safety net for non-technical users! 🛡️

## Development setup

Prerequisites: Python 3.10+, Node.js 18.17+ (20 recommended), npm.

```bash
# 1. Clone
git clone https://github.com/YOUR_ORG/shieldguard.git
cd shieldguard

# 2. Agent
cd agent
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt  # macOS/Linux
.venv\Scripts\python -m pytest tests -q

# 3. Dashboard
cd ../web
npm install
npm run lint && npm run build
```

Or simply: `python run.py` from the repo root (installs what it needs and starts both).

## Ground rules

1. **Defensive only.** No malware, no evasion, no offensive tooling — ever. PRs adding
   offensive capability will be rejected and reported.
2. **Privacy is a feature.** Never add telemetry, never read more file content than the
   documented 64 KiB entropy sample + 16-byte header.
3. **Contract first.** The API contract (`CONTRACT.md`) is binding. If you change it,
   update the Python models (`agent/app/models.py`) AND the TS types (`web/lib/types.ts`)
   in the same PR, and say why in the PR description.
4. **Plain language.** User-facing strings must be understandable without technical
   background; technical detail goes behind "Advanced details".
5. **Tests.** New detector logic needs unit tests. PRs must keep `pytest`, `npm run lint`
   and `npm run build` green (CI enforces this).
6. **No secrets.** Never commit `.env`, tokens, or personal paths from your machine.

## Style

- Python: type hints everywhere, docstrings on public functions, `logging` (never `print`).
- TypeScript: strict, no `any`, functional React components, Tailwind utility classes.
- Commits: conventional style (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## Good first issues

Look for issues labelled `good first issue` — typically UI polish, doc clarity, or
additional detection heuristics with tests (e.g., Office-macro-lure file names,
suspicious scheduled tasks).
