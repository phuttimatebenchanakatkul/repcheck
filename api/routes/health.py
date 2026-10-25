from flask import Blueprint, current_app, jsonify

bp = Blueprint("health", __name__)


@bp.get("/api/health")
def health():
    """For Render's health check and for the app to tell 'server down' from 'signed out'. Public, answers nothing
    about the project beyond whether the database answers."""
    try:
        with current_app.extensions["api"].db.connection() as conn:
            conn.execute("select 1").fetchone()
    except Exception:                       # noqa: BLE001 -- any failure here means not healthy
        response = jsonify({"ok": False, "error": "Database unavailable."})
        response.status_code = 503
        return response
    return jsonify({"ok": True})
