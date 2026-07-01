"""Test-suite bootstrap — ensures `from server import ...` works from /app root.

Backend tests can be run either from /app (`python -m pytest backend/tests/`)
or from /app/backend (`python -m pytest tests/`). This conftest adds the
backend directory to sys.path so imports like `from server import X` resolve
without needing to `cd backend` first.
"""
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
