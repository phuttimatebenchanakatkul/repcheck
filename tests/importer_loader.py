"""Loads scripts/migrate_sqlite_to_supabase.py as a module for the importer's tests.

It is a script, not a package, so it is loaded by path. One loader, so both test files
exercise the same module object instead of each executing and registering their own copy.
"""

import importlib.util
import sys
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "migrate_sqlite_to_supabase.py"
_spec = importlib.util.spec_from_file_location("migrate_sqlite_to_supabase", _SCRIPT)
imp = importlib.util.module_from_spec(_spec)
sys.modules["migrate_sqlite_to_supabase"] = imp
_spec.loader.exec_module(imp)
