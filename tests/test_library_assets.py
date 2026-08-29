"""The shared food/exercise libraries are served, and cached, separately.

They used to be pasted into every page with `| tojson`. That put ~155 KB of
food library into /nutrition and ~250 KB of exercise libraries into
/workouts -- identical bytes for every user on every request, inside a
document that carries no cache headers and varies by Cookie, so every single
tab switch re-downloaded and re-parsed all of it. On the iOS App Store build
(a WKWebView pointed at the live site) that is a real cellular download per
tap, which is what made moving between pages feel like a refresh.

Two properties have to hold for the split to be safe, and neither is
visible by looking at a page that happens to render:

  * the asset URL must change when the content does, because the response
    is marked immutable for a year -- get that wrong and an edited food
    library never reaches anyone who has already visited;

  * every library a template asks for must exist, because a page's whole
    inline script reads these globals at first render. A typo'd name is not
    a missing icon, it is a blank Nutrition or Workouts page.
"""

import json
import re
from pathlib import Path

import pytest

import app as app_module

TEMPLATES = Path(app_module.__file__).parent / "templates"


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    return app_module.app.test_client()


def test_every_library_serves_a_namespaced_global(client):
    for name in app_module.LIBRARY_ASSETS:
        response = client.get(f"/lib/{name}.js")
        assert response.status_code == 200, name
        body = response.get_data(as_text=True)
        assert "application/javascript" in response.headers["Content-Type"]
        # Namespaced rather than a bare global: index.html and workouts.html
        # both call the same library EXERCISE_LIBRARY, and different pages
        # bind different libraries to that name.
        assert body.startswith("window.RepCheckLib=window.RepCheckLib||{};")
        assert f"window.RepCheckLib[{json.dumps(name)}]=" in body


def test_libraries_are_cached_immutably(client):
    response = client.get("/lib/food_library.js")
    assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"


def test_unknown_library_is_a_404_not_an_empty_script(client):
    # A 200 with an empty body would leave the page's `const X =
    # RepCheckLib.x` as undefined and fail much further downstream.
    assert client.get("/lib/not_a_library.js").status_code == 404


def test_the_url_version_is_a_hash_of_the_content():
    """The cache-busting contract, checked by actually changing content.

    asset_url() can key on mtime because it serves files; these are built
    from Python modules, so the version has to come from the bytes.
    """
    with app_module.app.test_request_context():
        before = app_module.library_url("food_library")

        original = app_module.LIBRARY_ASSETS["food_library"]
        app_module.LIBRARY_ASSETS["food_library"] = lambda: {"changed": True}
        try:
            # The static libraries are serialized once per process, so an
            # edit here is exactly the "restart with new code" case: drop the
            # memo the way a fresh process would.
            app_module._library_cache.pop("food_library", None)
            after = app_module.library_url("food_library")
        finally:
            app_module.LIBRARY_ASSETS["food_library"] = original
            app_module._library_cache.pop("food_library", None)

        assert before != after, "editing a library must produce a new URL"
        assert app_module.library_url("food_library") == before, (
            "and restoring it must produce the old one again"
        )


def test_a_dynamic_library_picks_up_changes_without_a_restart():
    """food_images is a directory listing, so it must not be memoized.

    Newly sorted food photos are expected to appear without restarting the
    server (that is why the route rebuilt the map per request in the first
    place); memoizing it alongside the constant libraries would silently
    take that away.
    """
    assert "food_images" in app_module._DYNAMIC_LIBRARIES

    with app_module.app.test_request_context():
        before = app_module.library_url("food_images")

        original = app_module.LIBRARY_ASSETS["food_images"]
        app_module.LIBRARY_ASSETS["food_images"] = lambda: {"new_photo": "x.png"}
        try:
            # No cache eviction: the point is that this one re-reads.
            assert app_module.library_url("food_images") != before
        finally:
            app_module.LIBRARY_ASSETS["food_images"] = original

        assert app_module.library_url("food_images") == before


def test_every_library_a_template_asks_for_exists():
    requested = set()
    for template in TEMPLATES.glob("*.html"):
        source = template.read_text(encoding="utf-8")
        requested.update(re.findall(r"library_url\(['\"]([a-z_]+)['\"]\)", source))

    assert requested, "no template loads a shared library -- did the tags move?"
    unknown = requested - set(app_module.LIBRARY_ASSETS)
    assert not unknown, f"templates ask for libraries that do not exist: {unknown}"


@pytest.mark.parametrize(
    "template, names",
    [
        ("nutrition.html", ["food_library", "food_images"]),
        (
            "workouts.html",
            [
                "exercise_library",
                "exercise_details",
                "exercise_videos",
                "exercise_categories",
                "exercise_icons",
                "unilateral_exercises",
                "bodyweight_exercises",
            ],
        ),
        (
            "index.html",
            [
                "exercise_library",
                "exercise_icons",
                "exercise_categories",
                "exercise_videos",
            ],
        ),
    ],
)
def test_pages_load_their_libraries_before_the_script_that_reads_them(template, names):
    """Ordering, not just presence.

    These are classic scripts precisely so the globals are in place
    synchronously -- the page logic reads them during its first render and
    did not have to become async. Moving a <script src> below the block that
    consumes it would still render a page, just an empty one.
    """
    source = (TEMPLATES / template).read_text(encoding="utf-8")
    for name in names:
        tag = source.index(f"library_url('{name}')")
        reader = source.index(f"RepCheckLib.{name}")
        assert tag < reader, f"{template} reads {name} before loading it"


def test_no_page_still_inlines_a_shared_library():
    """The whole point: none of this data rides along in the HTML any more."""
    inlined = []
    for template in TEMPLATES.glob("*.html"):
        source = template.read_text(encoding="utf-8")
        for name in ("food_library", "food_images", "exercise_library",
                     "exercise_details", "exercise_videos", "exercise_icons",
                     "exercise_categories", "unilateral_exercises",
                     "bodyweight_exercises"):
            if re.search(rf"\{{\{{\s*{name}\s*\|\s*tojson", source):
                inlined.append(f"{template.name}:{name}")
    assert not inlined, f"still inlined into the page: {inlined}"
