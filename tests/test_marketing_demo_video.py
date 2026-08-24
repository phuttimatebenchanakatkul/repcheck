"""Guards the marketing page's phone-demo videos against the two ways they
quietly break.

The clips live under a global `*.mp4` gitignore (test workout videos must
never land in this public repo), so shipped assets only survive via the
`!marketing/*.mp4` negation -- rename or replace a file and git drops it
silently, the local preview keeps working, and production 404s that section.
And playback is deliberately JS-initiated: every `.phone-video` tag carries
`muted` and `playsinline` (without which browsers block programmatic
autoplay, leaving a frozen poster with no error anywhere) but NOT `autoplay`,
so that no-JS and prefers-reduced-motion both degrade to the poster instead
of an unstoppable loop app.js can no longer pause.

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
def video_tags(html):
    tags = re.findall(r"<video\b[^>]*>", html)
    assert tags, "no <video> elements found in marketing/index.html"
    return tags


def _referenced_assets(video_tag):
    return re.findall(r'(?:src|poster)="([^"]+)"', video_tag)


def test_every_video_references_assets_that_exist(video_tags):
    for tag in video_tags:
        refs = _referenced_assets(tag)
        assert refs, f"a <video> tag references no src/poster assets: {tag}"
        for ref in refs:
            path = os.path.join("marketing", ref)
            assert os.path.isfile(path), (
                f"{PAGE} references {ref} but marketing/{ref} does not exist -- "
                "that section 404s in production"
            )


def test_every_video_asset_survives_the_gitignore(video_tags):
    """`*.mp4` is globally ignored; demo clips need the negation to stay
    tracked. `git check-ignore` exits 0 when a path IS ignored."""
    for tag in video_tags:
        for ref in _referenced_assets(tag):
            path = f"marketing/{ref}"
            result = subprocess.run(
                ["git", "check-ignore", "-q", path], capture_output=True
            )
            assert result.returncode != 0, (
                f"{path} is gitignored -- it will silently vanish from the repo "
                "and 404 in production. Keep the !-negation in .gitignore in "
                "sync with the asset's filename."
            )


def test_every_video_can_actually_be_played_by_script(video_tags):
    for tag in video_tags:
        for attr in ("muted", "playsinline"):
            assert re.search(rf"\b{attr}\b", tag), (
                f"a phone-video lost its `{attr}` attribute -- browsers only "
                "allow scripted autoplay for muted, inline video, so it "
                f"degrades to a frozen poster frame with no error: {tag}"
            )


def test_playback_is_js_initiated_so_the_motion_guard_fails_safe(video_tags):
    """styles.css's prefers-reduced-motion block only stops CSS animation, so
    app.js owns playback: it plays for everyone else and pauses for
    reduced-motion users (WCAG 2.2.2). A markup `autoplay` attribute would
    invert the failure mode -- any app.js breakage then leaves an unstoppable
    loop instead of a poster."""
    for tag in video_tags:
        assert not re.search(r"\bautoplay\b", tag), (
            f"a phone-video regained a markup `autoplay` attribute -- the "
            f"reduced-motion guard now fails open whenever app.js doesn't run: {tag}"
        )
    with open("marketing/app.js", encoding="utf-8") as f:
        js = f.read()
    assert "prefers-reduced-motion" in js and ".pause()" in js, (
        "app.js no longer pauses the phone videos under prefers-reduced-motion"
    )
    assert ".play()" in js, (
        "app.js no longer starts the phone videos -- with no markup autoplay, "
        "nothing plays them and every visitor sees a frozen poster"
    )
