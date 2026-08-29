"""The one line that says whether in-place navigation is running on a phone.

static/pagenav.js replaces the tab bar's page loads with an in-place swap, and
every way it can decline -- an unsupported browser, a missing element, a thrown
error -- is silent by design: the tabs stay ordinary links and the app still
works. That is the right behaviour and it is completely untraceable.

It cost three wrong fixes. A screen recording (slop.mp4) showed the iPhone app
still doing a full page load on every tab tap an hour after the swap layer went
live -- correct scripts served on the page, no console on a phone to ask, and
no way from a desk to tell which bail-out had fired or whether pagenav.js had
thrown on that WebKit. So the page now says which, once per load, and the
answer lands in the server log.

Kept deliberately thin: a short string, capped and stripped, with no user id,
no page and no body. The tests below pin the two things that make it usable --
it logs, and it cannot be turned into a way to write arbitrary lines into the
log.
"""

import logging

from app import app as flask_app


def _client():
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def test_the_state_is_logged(caplog):
    client = _client()
    with caplog.at_level(logging.INFO):
        response = client.get("/api/nav-state?s=on")
    assert response.status_code == 204
    assert "NAV_STATE on" in caplog.text, (
        "The state must reach the log -- reading it there, without touching "
        "the phone, is the entire point of this endpoint."
    )


def test_the_line_survives_the_production_log_level():
    """Logged at WARNING, because INFO does not survive to Render's logs.

    Under gunicorn the app logger's effective level leaves INFO on the floor:
    the line is written and dropped, and the logs stay empty -- which reads as
    "the phone never reported", the exact wrong answer for a diagnostic whose
    whole job is to distinguish that from "reported off". Verified against
    production, not assumed: a probe logged at INFO never appeared. Every
    other log call in app.py is a warning for the same reason.
    """
    import inspect

    import app as app_module

    source = inspect.getsource(app_module.api_nav_state)
    assert "logger.warning" in source, (
        "NAV_STATE must be logged at warning level or it will not reach the "
        "production logs, and this endpoint is only useful there."
    )


def test_a_beacon_post_is_accepted(caplog):
    """navigator.sendBeacon sends a POST, and the page sends this with it.

    GET-only answered 405 and the report never arrived -- silence that looks
    exactly like "the phone never reported", which is the one answer this
    endpoint must never give by accident. Found by running it.
    """
    client = _client()
    with caplog.at_level(logging.INFO):
        response = client.post("/api/nav-state?s=on")
    assert response.status_code == 204, (
        f"A beacon POST must be accepted. Got {response.status_code}."
    )
    assert "NAV_STATE on" in caplog.text


def test_a_declined_state_says_why(caplog):
    client = _client()
    with caplog.at_level(logging.INFO):
        client.get("/api/nav-state?s=off:error:undefined is not an object")
    assert "NAV_STATE off:error:undefined is not an object" in caplog.text, (
        "The reason is the diagnostic. 'off' on its own would leave exactly "
        "the guessing this endpoint exists to end."
    )


def test_the_ios_app_is_distinguishable_from_a_browser(caplog):
    client = _client()
    with caplog.at_level(logging.INFO):
        client.get("/api/nav-state?s=on", headers={"User-Agent": "RepCheck/1 (iPhone)"})
        client.get("/api/nav-state?s=on", headers={"User-Agent": "Mozilla/5.0 (Macintosh)"})
    assert "agent=ios-app" in caplog.text and "agent=browser" in caplog.text, (
        "The iPhone app is the case this exists for; a desktop browser "
        "hitting it is noise worth telling apart at a glance."
    )


def test_a_state_cannot_forge_extra_log_lines(caplog):
    """The state string is client-controlled and goes straight into a log.

    A newline in it would let anyone write whatever they liked as a separate,
    convincing-looking log line -- including lines that look like they came
    from the app itself. It is stripped, and capped, so a log line stays one
    log line of bounded length.
    """
    client = _client()
    with caplog.at_level(logging.INFO):
        client.get("/api/nav-state?s=on\nNAV_STATE forged")
        client.get("/api/nav-state?s=" + "x" * 500)
    lines = [line for line in caplog.text.splitlines() if "NAV_STATE" in line]
    assert not any("forged" in line and line.strip().startswith("NAV_STATE forged") for line in lines), (
        "A newline in the state must not be able to start a new log line."
    )
    assert all(len(line) < 400 for line in lines), (
        f"A state string must be capped before it is logged. Got: {lines!r}"
    )


def test_an_empty_state_still_logs_something_useful(caplog):
    client = _client()
    with caplog.at_level(logging.INFO):
        client.get("/api/nav-state")
    assert "NAV_STATE unknown" in caplog.text
