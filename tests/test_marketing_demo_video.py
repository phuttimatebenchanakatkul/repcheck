"""Guards the hero demo video against the two ways it quietly breaks.

The clip lives under a global `*.mp4` gitignore (test workout videos must
never land in this public repo), so the shipped asset only survives via the
`!marketing/demo.mp4` negation -- rename or replace the file and git drops
it silently, the local preview keeps working, and production 404s the hero.
And playback is deliberately JS-initiated: the tag carries `muted` and
`playsinline` (without which browsers block programmatic autoplay, leaving a
frozen poster with no error anywhere) but NOT `autoplay`, so that no-JS and
prefers-reduced-motion both degrade to the poster instead of an unstoppable
loop app.js can no longer pause.

The marketing site is a separate Render Static Site with no build step (see
CLAUDE.md), so nothing else checks this. Source-level regex assertions against
the real files, same tradeoff the rest of this suite makes.
"""

import os
import re
import subprocess

import pytest

PAGE = "marketing/index.html"


@pytest.fixture(scope="module")
def html():
    with open(PAGE, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def video_tag(html):
    match = re.search(r"<video\b[^>]*>", html)
    assert match, "the hero <video> element is gone from marketing/index.html"
    return match.group(0)


def _referenced_assets(video_tag):
    return re.findall(r'(?:src|poster)="([^"]+)"', video_tag)


def test_the_video_references_assets_that_exist(video_tag):
    refs = _referenced_assets(video_tag)
    assert refs, "the <video> tag references no src/poster assets"
    for ref in refs:
        path = os.path.join("marketing", ref)
        assert os.path.isfile(path), (
            f"{PAGE} references {ref} but marketing/{ref} does not exist -- "
            "the hero 404s in production"
        )


def test_the_video_assets_survive_the_gitignore(video_tag):
    """`*.mp4` is globally ignored; the demo clip needs its negation to stay
    tracked. `git check-ignore` exits 0 when a path IS ignored."""
    for ref in _referenced_assets(video_tag):
        path = f"marketing/{ref}"
        result = subprocess.run(
            ["git", "check-ignore", "-q", path], capture_output=True
        )
        assert result.returncode != 0, (
            f"{path} is gitignored -- it will silently vanish from the repo "
            "and 404 in production. Keep the !-negation in .gitignore in "
            "sync with the asset's filename."
        )


def test_the_video_can_actually_be_played_by_script(video_tag):
    for attr in ("muted", "playsinline"):
        assert re.search(rf"\b{attr}\b", video_tag), (
            f"the hero <video> lost its `{attr}` attribute -- browsers only "
            "allow scripted autoplay for muted, inline video, so the hero "
            "degrades to a frozen poster frame with no error"
        )


def test_playback_is_js_initiated_so_the_motion_guard_fails_safe(video_tag):
    """styles.css's prefers-reduced-motion block only stops CSS animation, so
    app.js owns playback: it plays for everyone else and pauses for
    reduced-motion users (WCAG 2.2.2). A markup `autoplay` attribute would
    invert the failure mode -- any app.js breakage then leaves an unstoppable
    24s loop instead of a poster."""
    assert not re.search(r"\bautoplay\b", video_tag), (
        "the hero <video> regained a markup `autoplay` attribute -- the "
        "reduced-motion guard now fails open whenever app.js doesn't run"
    )
    with open("marketing/app.js", encoding="utf-8") as f:
        js = f.read()
    assert "prefers-reduced-motion" in js and ".pause()" in js, (
        "app.js no longer pauses the hero video under prefers-reduced-motion"
    )
    assert ".play()" in js, (
        "app.js no longer starts the hero video -- with no markup autoplay, "
        "nothing plays it and every visitor sees a frozen poster"
    )
