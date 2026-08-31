"""The Log-food sheet's screens all speak one row language.

The sheet used to mix two visual systems: gradient-badge tiles (.af-tile,
a 2-col grid with coloured icon chips) on the quick-meal / barcode-landing /
camera-unavailable screens, and plain rounded action rows (.af-action-row)
on the main choice screen. The redesign settled on rows everywhere and
deleted the tile CSS outright.

That deletion is what these tests guard. The markup and its styling live in
two halves of the same file with nothing tying them together, so either half
can be edited alone and the failure is silent:

  * a screen re-added with .af-tile markup renders completely unstyled,
    because no .af-tile rule exists any more;
  * .af-action-row / .af-action-list / .af-scanner-cancel deleted from the
    <style> block strips every screen at once -- including the main choice
    screen, whose rows this file does not own.

Both look fine to a linter and to every existing test. Source-level
assertions are the repo's established answer for this file (see
test_barcode_entry_points.py and CLAUDE.md's note on hand-rolled JS with no
module boundary): templates/nutrition.html is one 6000-line template whose
script is an inline block, so there is no unit to import.

The handler assertions below are the second half. Restyling a screen means
rewriting its innerHTML string, and a button that loses its id -- or keeps
the id while its addEventListener is dropped from the rewritten block --
becomes dead on tap with no error anywhere. These are the screens the
barcode/photo flows fall back to, so they are the ones nobody exercises by
hand before shipping.
"""

import re

import pytest


@pytest.fixture(scope="module")
def nutrition_html():
    with open("templates/nutrition.html", encoding="utf-8") as f:
        return f.read()


def _strip_media_blocks(css):
    """Drop every @media block, brace-matched.

    The phone breakpoint carries overrides like
    `.af-action-row { padding: 15px 14px; }`. Those tune a rule that already
    exists; on their own they leave the row unstyled on every wider screen.
    A base-rule check that counts them passes on exactly the breakage it is
    supposed to catch, so they are removed before searching.
    """
    out = []
    i = 0
    while i < len(css):
        at = css.find("@media", i)
        if at == -1:
            out.append(css[i:])
            break
        out.append(css[i:at])
        brace = css.find("{", at)
        if brace == -1:  # malformed; keep the rest verbatim
            out.append(css[at:])
            break
        depth = 0
        j = brace
        while j < len(css):
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        i = j + 1
    return "".join(out)


@pytest.fixture(scope="module")
def style_block(nutrition_html):
    """The page's own <style> block, minus its @media overrides."""
    match = re.search(r"<style>(.*?)</style>", nutrition_html, re.DOTALL)
    assert match, "could not find the page's <style> block"
    return _strip_media_blocks(match.group(1))


# --- the tile system is gone, in both halves of the file -------------------

def test_no_screen_renders_a_tile(nutrition_html):
    """.af-tile has no CSS behind it any more, so any markup using it is
    an unstyled button."""
    assert "af-tile" not in nutrition_html, (
        "a screen is rendering .af-tile markup, but the tile CSS was deleted "
        "with the redesign -- it will render as an unstyled button. Use "
        ".af-action-row (see renderAfChoice) instead."
    )


# --- the row system the screens depend on ---------------------------------

def _has_base_rule(style_block, selector):
    """Is there a rule for the bare class, on its own?

    Anchored to the start of a line and required to reach `{` with nothing
    between, so a surviving `.af-action-row:hover` or
    `[data-theme="dark"] .af-action-row` does NOT satisfy it. Those carry a
    hover tint and a dark-mode background; neither gives the row its
    padding, radius or layout, so counting them would let the test pass on
    a sheet whose rows had visibly collapsed.
    """
    return re.search(r"(?m)^\s*" + re.escape(selector) + r"\s*\{", style_block)


def test_the_row_classes_the_screens_use_are_styled(style_block):
    """Every action screen in this sheet renders .af-action-row inside
    .af-action-list. Deleting either rule silently strips all of them."""
    for selector in (".af-action-list", ".af-action-row", ".af-action-title",
                     ".af-action-chevron"):
        assert _has_base_rule(style_block, selector), (
            f"{selector} is rendered by the Log-food sheet but has no CSS "
            "rule of its own -- those rows will render unstyled"
        )


def test_every_action_row_has_a_chevron(nutrition_html):
    """The chevron is what makes a row read as 'this goes somewhere'. It is
    per-row markup, so a hand-written new row drops it easily."""
    rows = re.findall(
        r'<button type="button" class="af-action-row"[^>]*>(.*?)</button>',
        nutrition_html,
        re.DOTALL,
    )
    assert rows, "no .af-action-row buttons found -- did the sheet change shape?"
    for row in rows:
        assert "af-action-chevron" in row, (
            "an .af-action-row is missing its chevron:\n"
            f"{row.strip()[:160]}"
        )


def test_the_full_width_cancel_is_styled(style_block, nutrition_html):
    """Both live-camera screens dock a single .af-scanner-cancel. It replaced
    an .af-secondary-btn pill sitting in an .af-actions flex row, so the old
    styling no longer applies to it."""
    assert nutrition_html.count('class="af-scanner-cancel"') == 2, (
        "expected the barcode scanner and the photo viewfinder to each dock "
        "one full-width Cancel"
    )
    assert _has_base_rule(style_block, ".af-scanner-cancel"), (
        ".af-scanner-cancel is rendered but has no CSS rule of its own"
    )


# --- the fallback screens' handlers ----------------------------------------
#
# One test per screen rather than a loop: when this fails, the name has to
# say which screen went dead, since none of them are on a path anyone taps
# by hand.

def _wiring(nutrition_html, button_id):
    """The addEventListener call for a button, if there is one."""
    match = re.search(
        r'getElementById\("%s"\)\s*\.?\s*\n?\s*\.addEventListener\("click",(.*?)\);'
        % re.escape(button_id),
        nutrition_html,
        re.DOTALL,
    )
    return match.group(1) if match else None


def test_barcode_photo_pane_wires_both_of_its_rows(nutrition_html):
    """The scanner's 'Upload photo' mode -- the route that catches a code the
    live loop keeps missing."""
    take = _wiring(nutrition_html, "af-barcode-take-photo-btn")
    choose = _wiring(nutrition_html, "af-barcode-choose-photo-btn")
    assert take and "openBarcodePhotoInput" in take, (
        "the barcode photo pane's 'Take photo' row is not wired"
    )
    assert choose and "openBarcodeUploadInput" in choose, (
        "the barcode photo pane's 'Choose from library' row is not wired"
    )


def test_barcode_camera_unavailable_screen_is_wired(nutrition_html):
    """Shown when getUserMedia is denied or the context is not secure. Its
    one row is the only way out."""
    wiring = _wiring(nutrition_html, "af-barcode-photo-fallback-btn")
    assert wiring and "openBarcodePhotoInput" in wiring, (
        "the barcode camera-unavailable screen's only row is not wired -- "
        "there is no other route out of that screen"
    )


def test_photo_camera_unavailable_screen_is_wired(nutrition_html):
    wiring = _wiring(nutrition_html, "af-photo-fallback-btn")
    assert wiring and "RepCheckNative.openCamera" in wiring, (
        "the photo camera-unavailable screen's only row is not wired"
    )


def test_both_camera_screens_can_be_cancelled(nutrition_html):
    """Cancel is the only control on the barcode scanner and sits beside the
    shutter on the viewfinder. A dead Cancel strands the user on a screen
    holding an open camera stream."""
    scanner = _wiring(nutrition_html, "af-scanner-cancel-btn")
    photo = _wiring(nutrition_html, "af-photo-cancel-btn")
    assert scanner and "cancelBarcodeScan" in scanner, (
        "the barcode scanner's Cancel is not wired -- that screen holds a "
        "getUserMedia stream with no way to release it"
    )
    assert photo and "stopAfPhotoCamera" in photo, (
        "the photo viewfinder's Cancel must stop the camera stream, not just "
        "change screens -- a leaked stream hangs the next getUserMedia on iOS"
    )


# --- recents ---------------------------------------------------------------

def test_recents_still_have_an_empty_state(nutrition_html):
    """First run has no scans. The section renders either a list or this
    line, and the redesign rewrote the surrounding markup.

    Scoped to the function that renders it, not the whole file: the
    .af-recent-empty CSS rule outlives the markup, so a file-wide substring
    check stays green on a sheet that no longer renders the empty state.
    """
    match = re.search(
        r"function afRecentSectionHtml\(recentScans\)\s*\{(.*?)\n  \}",
        nutrition_html,
        re.DOTALL,
    )
    assert match, "afRecentSectionHtml() is missing"
    assert "af-recent-empty" in match.group(1), (
        "the Recent scans section lost its empty state -- a new user sees a "
        "bare heading with nothing under it"
    )
