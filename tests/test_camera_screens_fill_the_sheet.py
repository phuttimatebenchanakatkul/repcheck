"""The camera screens have to fill the sheet, and the sheet needs a height.

`.af-modal` is sized by its content -- 92vh is only a *max*. Nothing below
it had a definite height either, so every `height: 100%` down the chain
(`.af-scanner-screen`, then `.af-scanner-video`) fell back to auto and the
camera feed drew at its own aspect ratio, with the black `.af-scanner-wrap`
showing through beneath it. Measured in the pane at 393px wide with a 16:9
stream: video 221px tall (exactly 393 x 9/16) in a wrap that should have
been 554.

`.af-modal.is-camera` is the whole fix -- one definite height at the top
resolves the entire chain. Two halves keep it working and neither one
fails loudly on its own:

  * the CSS rule can lose its `height` (or be "tidied" into the existing
    `max-height`) and the sheet silently goes back to hugging the feed;
  * the JS toggle can be dropped, or moved out of the observer to a render
    function that forgets to clear it -- which strands a *result* screen at
    92dvh with a short card floating in a tall empty sheet.

Source-level assertions, the same tradeoff the rest of this file's tests
make (see test_barcode_entry_points.py, and CLAUDE.md on hand-rolled JS
with no module boundary): there is no unit to import, and the failure is
invisible to every behavioural test because nothing throws.
"""

import re

import pytest


@pytest.fixture(scope="module")
def nutrition_html():
    with open("templates/nutrition.html", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def style_block(nutrition_html):
    match = re.search(r"<style>(.*?)</style>", nutrition_html, re.DOTALL)
    assert match, "could not find the page's <style> block"
    return match.group(1)


def _rule_body(style_block, selector):
    """The declarations inside a rule, or None if the rule is absent."""
    match = re.search(
        r"(?m)^\s*" + re.escape(selector) + r"\s*\{(.*?)\}", style_block, re.DOTALL
    )
    return match.group(1) if match else None


def test_the_camera_sheet_has_a_definite_height(style_block):
    body = _rule_body(style_block, ".af-modal.is-camera")
    assert body is not None, (
        ".af-modal.is-camera is gone -- the camera screens have no height to "
        "fill and the feed will letterbox inside a black wrap again"
    )
    # `height:`, not `max-height:` -- a max alone is exactly the state that
    # caused the bug, and is easy to land on while "consolidating" the two.
    assert re.search(r"(?<!-)\bheight\s*:", body), (
        ".af-modal.is-camera sets no `height` -- a `max-height` alone leaves "
        "the sheet content-sized, which is the original bug"
    )


def test_the_plain_modal_stays_content_sized(style_block):
    """Only the camera variant gets a height. Putting one on `.af-modal`
    itself would stretch every result/choice screen to 92dvh."""
    body = _rule_body(style_block, ".af-modal")
    assert body is not None, ".af-modal rule is missing"
    assert not re.search(r"(?<!-)\bheight\s*:", body), (
        ".af-modal now sets a bare `height` -- that stretches every screen "
        "in this sheet, not just the camera ones. It belongs on "
        ".af-modal.is-camera."
    )


def test_the_camera_class_is_driven_by_what_is_on_screen(nutrition_html):
    """Keyed off `.af-scanner-screen` actually being in the body, so it can
    never disagree with what is rendered."""
    match = re.search(
        r"new MutationObserver\(\(\) => \{(.*?)\n  \}\);", nutrition_html, re.DOTALL
    )
    assert match, "the af-modal-body MutationObserver is missing"
    body = match.group(1)
    assert "is-camera" in body, (
        "the is-camera toggle left the body observer. Anywhere else it has to "
        "be cleared by hand on every non-camera screen, and the one that "
        "forgets strands a short result card in a 92dvh sheet"
    )
    assert "af-scanner-screen" in body, (
        "the is-camera toggle is no longer keyed to .af-scanner-screen being "
        "present, so it can disagree with what is actually rendered"
    )
