"""Every live camera preview must be told to play, not left to the attribute.

`<video autoplay playsinline muted>` is ALLOWED to autoplay; it is not
guaranteed to. WebKit decides from what is actually rendered at the moment the
source is attached, so a stream attached to an element that is still
`display: none`, or attached during a swap, can sit on a black frame forever.
The element also reports `videoWidth === 0` until `loadedmetadata`, and the
capture paths bail on that -- which is how the food-photo viewfinder shipped
with a shutter that silently did nothing (fixed in v0.12.4.0).

Two sites already knew this: templates/index.html's analyze viewfinder and
nutrition.html's barcode scanner both call play() right after attaching. This
pins the rule for all of them, so the next camera added to the app cannot
quietly skip it.

Source-level, like tests/test_ipad_layout.py, and for the same reason: these
are inline page scripts with no module boundary, and the thing at risk is one
statement's presence and position rather than a value a harness can read back.
Mutation-checked: drop the play() after any attachment below and the case for
that file fails.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

# Files that attach a MediaStream to a <video>.
CAMERA_SOURCES = [
    Path("templates/index.html"),      # analyze viewfinder + review player
    Path("templates/nutrition.html"),  # food photo + barcode scanner
    Path("templates/challenges.html"), # challenge recorder
]

# `x.srcObject = null` is teardown, not an attachment -- nothing to play.
ATTACH = re.compile(r"^\s*(?:const\s+|let\s+|var\s+)?([\w.$\[\]\"']+)\.srcObject\s*=\s*(?!null)(\S.*?);\s*$")

# How far after the attachment a play() still counts as "right after". Wide
# enough for a comment or an intervening style write, tight enough that a
# play() belonging to some later function cannot satisfy it.
WINDOW_LINES = 6


def _attachments(path):
    lines = (ROOT / path).read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        match = ATTACH.match(line)
        if match:
            yield i + 1, match.group(1), lines[i : i + WINDOW_LINES]


@pytest.mark.parametrize("path", CAMERA_SOURCES, ids=lambda p: p.name)
def test_every_attached_stream_is_played(path):
    attachments = list(_attachments(path))
    assert attachments, (
        f"no `*.srcObject = ...` attachment found in {path} -- either the camera "
        "moved out of this file (drop it from CAMERA_SOURCES) or the assignment "
        "was reshaped and this test has stopped looking at anything."
    )
    for lineno, target, window in attachments:
        played = any(re.search(r"\.play\s*\(", following) for following in window[1:])
        assert played, (
            f"{path}:{lineno} attaches a stream to `{target}` but nothing calls "
            f".play() within {WINDOW_LINES} lines. A muted playsinline video is "
            "allowed to autoplay, not guaranteed to -- call play() explicitly "
            "(.catch(() => {}) is fine; a refused autoplay is not a failure)."
        )


def test_the_challenge_recorder_shows_its_preview_before_attaching():
    """Unhide first, attach second.

    WebKit judges autoplay from what is rendered when the source is attached,
    and this wrap was still `display: none` at that moment -- the worst possible
    time to ask. Recording reads the stream rather than the element, so the
    symptom was a black preview for the whole 10s countdown, not a lost clip.
    """
    source = (ROOT / "templates/challenges.html").read_text(encoding="utf-8")
    unhide = source.find('document.getElementById("ch-preview-wrap").style.display = "block"')
    attach = source.find("video.srcObject = recordingStream")
    assert unhide != -1, "the challenge recorder no longer unhides #ch-preview-wrap by that name"
    assert attach != -1, "the challenge recorder no longer attaches recordingStream by that name"
    assert unhide < attach, (
        "the challenge recorder attaches the camera stream while #ch-preview-wrap is "
        "still display:none, then unhides it. Unhide first -- WebKit decides autoplay "
        "from what is rendered at attach time."
    )
