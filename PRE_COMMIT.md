# Pre-commit hooks

This repo runs **ruff** (backend) and **eslint --max-warnings 0** (frontend)
plus **gitleaks** (secret scanner) on every commit via `pre-commit`.

## One-time setup (per dev machine)

```bash
pip install pre-commit          # already in requirements? if not, pip install
pre-commit install              # registers .git/hooks/pre-commit
```

That's it. Every subsequent `git commit` will run the three hooks and abort
the commit if anything fails.

## What it catches

| Hook | Catches |
|------|---------|
| **ruff (backend)** | Undefined names · unused imports · unused locals · syntax errors. Auto-fixes safe issues. |
| **eslint (frontend)** | Missing React hook deps · invalid JSX · accessibility violations · `dangerouslySetInnerHTML`. Zero-warning policy (`--max-warnings 0`). |
| **gitleaks** | Hard-coded API keys / passwords / tokens (Stripe sk_*, AWS keys, GitHub PATs, etc.) |

## Manually running

```bash
pre-commit run --all-files       # run on the entire repo
pre-commit run --files path/to/file.py
```

## Skipping (use sparingly)

```bash
git commit --no-verify           # skips ALL hooks — emergency only
SKIP=eslint-frontend git commit  # skip a specific hook
```

## CI parity

The same `pre-commit run --all-files` invocation should be the first step in
any CI pipeline so that bypassed-local commits still fail the build.
