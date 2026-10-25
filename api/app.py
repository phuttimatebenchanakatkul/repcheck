"""The native app's API. `create_app()` builds the Flask app; gunicorn runs `api.app:create_app()`.

Every route answers JSON, `{"ok": true, ...}` or `{"ok": false, "error": "..."}`, and every route but the health
check needs a Supabase access token (see auth.py). Nothing here renders a page.
"""

import logging
import threading
import time
from dataclasses import dataclass

from flask import Flask, jsonify

from . import accounts
from .auth import Verifier
from .db import Database
from .settings import from_env
from .supabase_admin import AuthAdmin, Storage

log = logging.getLogger(__name__)

SWEEP_INTERVAL_SECONDS = 3600
DEFAULT_MAX_BODY = 1 * 1024 * 1024        # JSON bodies; routes that take files raise it for themselves


@dataclass
class Services:
    settings: object
    db: Database
    verifier: Verifier
    storage: Storage
    auth_admin: AuthAdmin


def json_error(message, status):
    response = jsonify({"ok": False, "error": message})
    response.status_code = status
    return response


def create_app(settings=None, db=None, verifier=None, storage=None, auth_admin=None, sweep=True):
    """Every collaborator can be handed in (tests do); by default they are built from the environment.
    `sweep=False` keeps tests from purging real accounts that happen to be past their grace period."""
    settings = settings or from_env()
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = DEFAULT_MAX_BODY
    app.extensions["api"] = Services(
        settings=settings,
        db=db or Database(settings.db_url),
        verifier=verifier or Verifier(settings),
        storage=storage or Storage(settings),
        auth_admin=auth_admin or AuthAdmin(settings),
    )

    from .routes import account, health
    for module in (health, account):
        app.register_blueprint(module.bp)

    @app.after_request
    def no_store(response):
        # Per-user JSON: never cached by a browser, proxy or the app's HTTP cache.
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.errorhandler(404)
    def not_found(_e):
        return json_error("Not found.", 404)

    @app.errorhandler(405)
    def wrong_method(_e):
        return json_error("Method not allowed.", 405)

    @app.errorhandler(413)
    def too_large(_e):
        return json_error("That request is too large.", 413)

    @app.errorhandler(Exception)
    def unexpected(exc):
        # Never leak a driver message, a query or a path to the client.
        if hasattr(exc, "code") and isinstance(exc.code, int) and 400 <= exc.code < 500:
            return json_error(getattr(exc, "description", "Bad request."), exc.code)
        log.exception("unhandled error")
        return json_error("Something went wrong. Please try again.", 500)

    if sweep:
        lazy_sweep(app)
    return app


def lazy_sweep(app):
    """Purge accounts past their grace period: once at startup, then at most hourly, triggered by a request (there is
    no scheduler). Runs on a background thread so no caller waits on it, and can never take the app down: a purge
    that cannot run is a purge that happens an hour later."""
    services = app.extensions["api"]
    state = {"last": 0.0, "lock": threading.Lock()}

    def run():
        try:
            purged, failed = accounts.purge_due(services.db, services.storage, services.auth_admin)
            if purged or failed:
                log.info("account purge: %d purged, %d to retry", len(purged), len(failed))
        except Exception:                   # noqa: BLE001 -- see the docstring
            log.exception("account purge sweep failed")

    def kick():
        with state["lock"]:
            if time.monotonic() - state["last"] < SWEEP_INTERVAL_SECONDS and state["last"]:
                return
            state["last"] = time.monotonic()
        threading.Thread(target=run, name="account-purge", daemon=True).start()

    app.before_request(kick)
    kick()
