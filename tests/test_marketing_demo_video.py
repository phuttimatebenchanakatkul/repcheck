"""Guards the hero demo video against the two ways it quietly breaks.

The clip lives under a global `*.mp4` gitignore (test workout videos must
never land in this public repo), so the shipped asset only survives via the
`!marketing/demo.mp4` negation -- rename or replace the file and git drops
it silently, the local preview keeps working, and production 404s the hero.
And the clip only autoplays because `muted` (plus `playsinline` on iOS)
accompanies `autoplay`; lose either and every major browser blocks playback,
leaving a frozen poster with no error anywhere.

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


def test_the_video_can_actually_autoplay(video_tag):
    for attr in ("autoplay", "muted", "playsinline"):
        assert re.search(rf"\b{attr}\b", video_tag), (
            f"the hero <video> lost its `{attr}` attribute -- browsers only "
            "allow autoplay for muted, inline video, so the hero degrades to "
            "a frozen poster frame with no error"
        )


def test_reduced_motion_users_get_a_paused_video():
    """styles.css's prefers-reduced-motion block only stops CSS animation; the
    looping video is paused by app.js. If that guard goes, motion-sensitive
    users get an unstoppable 24s loop (WCAG 2.2.2)."""
    with open("marketing/app.js", encoding="utf-8") as f:
        js = f.read()
    assert "prefers-reduced-motion" in js and ".pause()" in js, (
        "app.js no longer pauses the hero video under prefers-reduced-motion"
    )
