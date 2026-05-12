"""Late-binding shim for `server.py`.

Several `routes/*.py` modules need access to runtime state that's defined in
`server.py` (the database handle, the `User` Pydantic model, helpers like
`iso()` / `now_utc()` / `get_current_user`). Importing `server` at module top
creates a circular-import shape that static analyzers flag (server imports
each route module at the bottom of its file).

This module exposes a lazy `__getattr__` so route files can write
`from shared import server` and access attributes like `server.db` exactly as
before, but the actual `server` module is only resolved on first attribute
access — by which point Python's import machinery has finished loading both
sides of the cycle.
"""
from __future__ import annotations

import importlib
import sys
from types import ModuleType


class _LazyServer:
    """Proxy that loads the real `server` module on first attribute access."""

    _mod: ModuleType | None = None

    def _load(self) -> ModuleType:
        if self._mod is None:
            # `server` is already importable when this is first dereferenced —
            # routes/*.py only call `server.db.xxx` inside request handlers,
            # which always run AFTER server.py has finished executing.
            self._mod = sys.modules.get("server") or importlib.import_module("server")
        return self._mod

    def __getattr__(self, name: str):
        return getattr(self._load(), name)


server = _LazyServer()
