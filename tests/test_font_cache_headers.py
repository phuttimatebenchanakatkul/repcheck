"""The self-hosted fonts' caching, and the invariant it nearly broke.

Self-hosting the fonts (see static/fonts.css) meant the woff2 had to keep the
1-year immutable header they used to get from fonts.gstatic.com. They cannot
get it the normal way: asset_url() appends a ?v= mtime, but fonts.css
references its faces with RELATIVE url()s, and a stylesheet's query string is
not inherited by them -- so the font requests arrive bare.

The first fix for that widened the header's condition using
`request.path.startswith("/static/fonts/")`. request.path is the path as ASKED
FOR, not the file that gets served, and browsers do not percent-decode %2e
before normalising -- so `/static/fonts/%2e%2e/i18n.js` reached the handler
verbatim, resolved to static/i18n.js, and came back with a year-long
non-revalidating header. One poisoned URL in any shared proxy would pin stale
application JavaScript for a year, and the `?v=` invariant the whole caching
block rests on ("a stale copy can never be served under a live URL, because
the URL changes with the content") was simply gone.

The fix matches on the RESOLVED filename, normalised, and only for .woff2.
This file pins both halves: the fonts do get the header, and nothing reachable
through a traversal alias does.

The second test turns a comment into a mechanism. Immutable-by-filename is
only safe while filenames are content-stable, which the code asserts as a
convention ("a different cut of a face is a different subset or family, and so
a different filename"). Nothing enforced it, so replacing a woff2's bytes
under the same name would leave returning visitors on the old face for up to a
year with no server-side remedy. Now a byte change without a rename fails.
"""

import hashlib
import json
from pathlib import Path

import pytest

import database
from app import app as flask_app

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / "static" / "fonts"
DIGESTS = Path(__file__).resolve().parent / "fixtures" / "font_digests.json"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "repcheck-test.db")
    database.init_db()
    flask_app.config["TESTING"] = True
    return database


def _cache_control(path):
    response = flask_app.test_client().get(path)
    return response.status_code, (response.headers.get("Cache-Control") or "")


# ---------- The fonts keep the header ----------

def test_every_font_file_is_served_immutable_without_a_version_query(db):
    """This is the whole point of the exception. fonts.css asks for these
    bare, so if they are not immutable by filename they revalidate on every
    cold load -- one round trip per face, which is exactly what self-hosting
    was not supposed to cost."""
    faces = sorted(FONT_DIR.glob("*.woff2"))

    assert faces, "no woff2 in static/fonts/ -- did the self-hosting get reverted?"

    for face in faces:
        status, cache_control = _cache_control("/static/fonts/" + face.name)

        assert status == 200, face.name + " is not being served at all"
        assert "immutable" in cache_control, (
            face.name + " is served with " + repr(cache_control) + " -- it "
            "needs the immutable header, because fonts.css references it "
            "without a ?v= and cannot be made to add one"
        )


# ---------- Nothing else does ----------

# Each of these resolves to a real file OUTSIDE static/fonts/ while asking
# through a path that starts with /static/fonts/. %2e is the one that matters:
# a browser sends it verbatim rather than normalising it away first, so it is
# reachable in practice and not just with curl.
TRAVERSAL_ALIASES = [
    "/static/fonts/%2e%2e/style.css",
    "/static/fonts/%2E%2E/i18n.js",
    "/static/fonts/.%2e/pagenav.js",
    "/static/fonts/%2e%2e/auth.css",
]


@pytest.mark.parametrize("path", TRAVERSAL_ALIASES)
def test_a_traversal_alias_never_earns_the_immutable_header(db, path):
    """The regression this file exists for.

    If the alias 404s that is fine -- the point is that it must not come back
    200 with a year-long immutable header, because the file it serves is
    application code that changes on deploys.
    """
    status, cache_control = _cache_control(path)

    if status != 200:
        return  # not served at all; nothing to cache

    assert "immutable" not in cache_control, (
        path + " served a non-font file with " + repr(cache_control) + ".\n"
        "The cache condition is matching the REQUESTED path rather than the "
        "resolved filename. One such URL in a shared proxy pins stale app JS "
        "for a year. Match on request.view_args['filename'], normalised."
    )


def test_the_licence_texts_are_not_served_immutable(db):
    """They live in static/fonts/ but they are not fonts, and a prefix match
    on the directory swept them in too. Harmless in itself, and a useful
    canary: if these come back immutable, the condition is matching the
    directory rather than the file type."""
    for licence in sorted(FONT_DIR.glob("OFL*.txt")):
        status, cache_control = _cache_control("/static/fonts/" + licence.name)

        if status == 200:
            assert "immutable" not in cache_control, (
                licence.name + " is not a font but is served immutable"
            )


def test_a_versioned_asset_still_gets_the_header(db):
    """Control: the original ?v= behaviour must survive the font exception."""
    status, cache_control = _cache_control("/static/style.css?v=12345")

    assert status == 200
    assert "immutable" in cache_control


def test_an_unversioned_ordinary_asset_still_revalidates(db):
    """The other control. If this ever goes immutable, the deploy-staleness
    bug v0.4.9.2 fixed is back."""
    status, cache_control = _cache_control("/static/style.css")

    assert status == 200
    assert "immutable" not in cache_control


# ---------- Immutable-by-filename means filenames must be content-stable ----------

def test_every_font_file_matches_its_recorded_digest():
    """Because the fonts are cached for a year by NAME, changing a face's
    bytes without changing its filename strands returning visitors on the old
    one with no way to push a fix.

    The fixture is the enforcement. Re-subsetting or upgrading a face is
    fine -- give it a new filename (or update this fixture deliberately, in
    the same commit, knowing that everyone holding the old bytes keeps them
    until their cache expires).
    """
    assert DIGESTS.is_file(), (
        "tests/fixtures/font_digests.json is missing -- regenerate it with:\n"
        "  python -c \"import json,hashlib,pathlib; "
        "d=pathlib.Path('static/fonts'); "
        "print(json.dumps({p.name: hashlib.sha256(p.read_bytes()).hexdigest() "
        "for p in sorted(d.glob('*.woff2'))}, indent=2))\""
    )

    recorded = json.loads(DIGESTS.read_text(encoding="utf-8"))
    actual = {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(FONT_DIR.glob("*.woff2"))
    }

    assert actual, "no woff2 found in static/fonts/"

    changed = {
        name: {"recorded": recorded.get(name), "actual": digest}
        for name, digest in actual.items()
        if recorded.get(name) != digest
    }
    removed = sorted(set(recorded) - set(actual))

    assert changed == {}, (
        "these font files changed content without changing name: "
        + repr(sorted(changed))
        + "\nThey are cached immutable for a year by filename, so returning "
        "visitors will keep the old bytes. Rename the file, or update "
        "tests/fixtures/font_digests.json deliberately."
    )
    assert removed == [], (
        "these fonts are recorded but gone: " + repr(removed)
        + " -- if that is intended, remove them from the fixture too"
    )
