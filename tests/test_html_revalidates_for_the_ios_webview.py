"""Every rendered page must revalidate; /static must keep revalidating too.

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

The freshness rule is therefore absolute: the device asks the server before
reusing a page, every single time. WHAT enforces it changed in v0.4.11.1.
It was `no-store`, which also meant every tab tap re-downloaded a ~300 KB
page in full, even one just visited -- turning the smooth tab navigation of
v0.4.9.1 back into something that reads as a refresh. It is now `no-cache`
plus an ETag: same mandatory revalidation, but an unchanged page answers
304 with no body. So the assertions below pin three things, and losing any
one of them silently gives back either the stale-deploy bug or the refresh:

  1. HTML must revalidate on every reuse (no-cache, and never no-store,
     which would cost the download again).
  2. HTML must carry the ETag that lets that revalidation answer 304.
  3. /static must keep its own revalidation, or every asset would refetch
     in full on every page load instead of 304-ing.
"""

import app as app_module
from app import app as flask_app

HTML_PATHS = ("/login", "/signup", "/privacy", "/terms")


def _client():
    flask_app.config["TESTING"] = True
    return flask_app.test_client()


def test_rendered_pages_must_be_revalidated_before_reuse():
    client = _client()
    # Logged out, so these render without any database setup. /login and
    # /signup are the ones that actually bit: they are the first screen the
    # iOS shell shows, so a stale copy there is the whole app for a user who
    # is not signed in yet.
    for path in HTML_PATHS:
        response = client.get(path)
        assert response.status_code == 200, f"{path} did not render"
        cache_control = response.headers.get("Cache-Control", "")
        assert "no-cache" in cache_control, (
            f"{path} must send Cache-Control: no-cache, which means "
            '"cache it, but ask the server before every reuse". Without an '
            "explicit rule the response has no freshness information AND no "
            "validator, which lets iOS's NSURLCache serve a stored copy "
            "without asking at all -- and because asset_url()'s ?v= "
            "cache-busting lives inside this HTML, a stale page pins every "
            f"stylesheet and script to its old version too. Got: {cache_control!r}"
        )
        assert "must-revalidate" in cache_control, (
            f"{path} must send must-revalidate, so a cache cannot fall back "
            "to serving the stored copy when the revalidation itself fails."
        )


def test_rendered_pages_are_not_re_downloaded_when_nothing_changed():
    """The revalidation must be able to answer 304, not just refetch.

    This is the half that was missing while the pages were `no-store`. The
    iPhone app loads these screens over the network on every tap of the tab
    bar, and /nutrition and /workouts are ~300 KB of HTML each, so tapping
    Home -> Workouts -> Home re-downloaded Home in full. The cross-document
    view transition that makes tab switching feel like movement rather than
    a reload can only cross-fade once the next document has arrived, so it
    was waiting on that download every time.
    """
    client = _client()
    for path in HTML_PATHS:
        first = client.get(path)
        etag = first.headers.get("ETag")
        assert etag, (
            f"{path} must carry an ETag. It is the validator that lets an "
            "unchanged page come back as a 304 with no body; without it, "
            "revalidating costs the entire page every time and no-cache is "
            "no cheaper than no-store."
        )
        again = client.get(path, headers={"If-None-Match": etag})
        assert again.status_code == 304, (
            f"{path} must answer 304 when the client already holds the "
            f"current version. Got {again.status_code} with "
            f"{len(again.get_data())} bytes of body."
        )


def test_rendered_pages_are_never_no_store():
    """no-store is the specific regression this file now guards against.

    It is a tempting one-line "make it fresh" answer, it passes every
    freshness test, and its cost is invisible from a desk: it shows up as
    the app feeling like it reloads on every screen change, on a phone, on
    mobile data.
    """
    client = _client()
    for path in HTML_PATHS:
        cache_control = client.get(path).headers.get("Cache-Control", "")
        assert "no-store" not in cache_control, (
            f"{path} must not be no-store. It forbids keeping the page at "
            "all, so every screen change re-downloads it in full and the "
            "page is also disqualified from the back/forward cache -- even "
            "going back re-fetches. no-cache plus the ETag gives the same "
            f"freshness guarantee for a fraction of the bytes. Got: {cache_control!r}"
        )


def test_the_logged_out_redirect_revalidates_too():
    """`/` 302s to /login, and a cached redirect is just as sticky."""
    client = _client()
    response = client.get("/")
    assert response.status_code == 302, "expected the auth gate to redirect"
    cache_control = response.headers.get("Cache-Control", "")
    assert "no-cache" in cache_control and "no-store" not in cache_control, (
        "The redirect that fronts the whole app must be revalidated before "
        "reuse. It is the first request the iOS shell makes on launch. Got: "
        f"{cache_control!r}"
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
        "Widening a no-store rule to cover static would turn every page "
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

    source = inspect.getsource(app_module.revalidate_html)
    assert "mimetype" in source and "text/html" in source, (
        "revalidate_html must branch on the response mimetype so it covers "
        "every HTML response, including routes that do not exist yet, while "
        "leaving CSS/JS/JSON/image responses alone."
    )
