"""The native app's API: Flask on Supabase (Postgres, Auth, Storage).

A separate service from the website. `app.py` still serves the live site and the App Store app from SQLite and
imports nothing from here; this package imports nothing from `app.py` or `database.py` (they run SQL against
SQLite and start side effects at import). It reuses only modules that are pure logic (name_filter, ai_safety,
coaching_engine, the food and exercise libraries, the Gemini wrappers).

Why a package of its own, not an in-place port of app.py: a merge to main auto-deploys to Render, which still
runs the website. An additive package can land on main, be tested there, and be deployed as its own service,
with nothing in production able to import it. See MOBILE_APP_PLAN.md ("The Flask port").

Run:  pip install -r requirements-api.txt   then   gunicorn "api.app:create_app()"
"""
