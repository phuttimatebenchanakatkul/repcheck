"""Every rendered page must forbid caching; /static must keep revalidating.

app.py's asset_url() cache-busts every stylesheet and script with the file's
mtime, and its comment is explicit about the symptom it exists to prevent: a
device rendering old CSS "looks exactly like the fix didn't work even though
the server is serving the new file". But the busted URLs only ever exist
INSIDE the HTML, so the whole scheme is only as fresh as the page carrying
them -- and nothing was keeping that page fresh.

A rendered template went out with no Cache-Control, no Expires, no ETag and
no Last-Modified. A response with neither freshness information nor a
validator is the exact case where a cache invents its own heuristic, and
iOS's URL loading system (the NSURLCache behind WKWebView) does. That
matters here specifically because the App Store build is a Capacitor shell
whose webview loads the live site (capacitor.config.json), so this app's
HTTP headers are the ONLY cache policy the shipped iPhone app has.

The resulting failure is nastier than a plain stale page, because every
individual asset behaves correctly: stale HTML carries the OLD ?v= values,
so the device revalidates exactly the files it already has, gets 304s, and
renders a fully self-consistent old version of the app. Observed on
2026-08-29 -- v0.4.7.0's non-scrolling auth screen was live and verified on
the production URL while the TestFlight build kept showing the scrolling
one, with the deploy status reading "live" the whole time.

Both halves are pinned below, because the fix is a split and either side
silently undoes it: HTML must be no-store, and /static must NOT be, or every
asset would refetch in full on every page load instead of 304-ing.
"""

import app as app_module
from app import app as flask_app


def _client():
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def test_rendered_pages_are_not_stored():
    client = _client()
    # Logged out, so these render without any database setup. /login and
    # /signup are the ones that actually bit: they are the first screen the
    # iOS shell shows, so a stale copy there is the whole app for a user who
    # is not signed in yet.
    for path in ("/login", "/signup", "/privacy", "/terms"):
        response = client.get(path)
        assert response.status_code == 200, f"{path} did not render"
        cache_control = response.headers.get("Cache-Control", "")
        assert "no-store" in cache_control, (
            f"{path} must send Cache-Control: no-store. Without it the "
            "response has no freshness information AND no validator, which "
            "lets iOS's NSURLCache serve a stored copy without asking the "
            "server -- and because asset_url()'s ?v= cache-busting lives "
            "inside this HTML, a stale page pins every stylesheet and script "
            f"to its old version too. Got: {cache_control!r}"
        )


def test_the_logged_out_redirect_is_not_stored_either():
    """`/` 302s to /login, and a cached redirect is just as sticky."""
    client = _client()
    response = client.get("/")
    assert response.status_code == 302, "expected the auth gate to redirect"
    assert "no-store" in response.headers.get("Cache-Control", ""), (
        "The redirect that fronts the whole app must not be stored. It is "
        "the first request the iOS shell makes on launch."
    )


def test_static_assets_keep_their_revalidation():
    client = _client()
    response = client.get("/static/auth.css")
    assert response.status_code == 200
    cache_control = response.headers.get("Cache-Control", "")
    assert "no-store" not in cache_control, (
        "/static must NOT be no-store. Flask already serves it with "
        "`no-cache` plus an ETag and Last-Modified, which is correct: the "
        "device revalidates and gets a 304 instead of refetching the file. "
        "Widening the no-store rule to cover static would turn every page "
        "load into a full re-download of every asset. Scope the after_request "
        f"by mimetype, not by path prefix. Got: {cache_control!r}"
    )
    assert response.headers.get("ETag"), (
        "/static must keep its ETag -- it is what makes the 304 possible."
    )


def test_the_rule_is_scoped_by_mimetype_not_by_route():
    """A per-route decorator would miss whatever route is added next.

    The point of hanging this on after_request is that a new page inherits
    the policy without anyone remembering to opt in -- which is exactly the
    kind of thing nobody remembers, since the symptom only shows up on a
    physical phone one deploy later.
    """
    import inspect

    source = inspect.getsource(app_module.never_store_html)
    assert "mimetype" in source and "text/html" in source, (
        "never_store_html must branch on the response mimetype so it covers "
        "every HTML response, including routes that do not exist yet, while "
        "leaving CSS/JS/JSON/image responses alone."
    )
