"""Guards the flagged-race message against contradicting what the code does.

`finishRace()` (static/hyrox.js) pushes EVERY finished race into history --
flagged ones included, deliberately, with a comment above the push saying so.
Flagged races are excluded from two other things only: the global leaderboard
(`submitHyroxResult` is gated on `!flagged`) and personal bests
(`getPersonalBest`/`getAllPersonalBests` both skip `r.flagged`).

The finish-screen copy used to say the race was "not saved to your history or
counted toward any leaderboard". The leaderboard half was right; the history
half was wrong, and the user could disprove it in one tap -- the history screen
lists flagged races under a header reading "Saved times", each tagged
"Not counted".

This is a copy/behavior contract, not a rendering detail, so it is pinned at
the source level the way test_hyrox_personal_best_section.py pins that card:
hyrox.js has a vitest harness now (tests-js/support/loadHyroxApp.js), but the
thing at risk here lives in the i18n table, not in a method a harness can call.

Found by /qa on 2026-08-18 (ISSUE-001).
"""

import json
import re
from pathlib import Path

import pytest

I18N_PATH = Path("static/i18n.js")
HYROX_PATH = Path("static/hyrox.js")

# Every locale's copy for the flagged-race banner.
FLAGGED_KEY = "hyrox.flagged"


def _flagged_strings():
    source = I18N_PATH.read_text(encoding="utf-8")
    matches = re.findall(rf'"{re.escape(FLAGGED_KEY)}":\s*"((?:[^"\\]|\\.)*)"', source)
    assert matches, f'no "{FLAGGED_KEY}" entries found in {I18N_PATH}'
    # Two locales ship today (en, th); if a third is added it is covered too.
    assert len(matches) >= 2, f"expected every locale to define {FLAGGED_KEY}, found {len(matches)}"
    return [json.loads(f'"{m}"') for m in matches]


def test_finish_race_still_saves_every_race_including_flagged():
    """The premise of this whole file. If this ever stops being true, the copy
    assertions below are the ones that need rewriting, not the behavior."""
    source = HYROX_PATH.read_text(encoding="utf-8")
    push_idx = source.find("this.history.push(record);")
    assert push_idx != -1, "finishRace no longer pushes the record to history -- re-check the copy"

    # The push must not be wrapped in a `!flagged` guard. Look at the enclosing
    # lines: the nearest preceding `if (` before the push should not gate on it.
    preceding = source[max(0, push_idx - 400):push_idx]
    assert "if (!flagged" not in preceding, (
        "history.push now appears to be gated on !flagged -- if flagged races are no "
        "longer saved, hyrox.flagged's copy should go back to saying so"
    )


@pytest.mark.parametrize("locale_index", [0, 1])
def test_flagged_copy_does_not_claim_the_race_was_dropped_from_history(locale_index):
    """The exact regression: claiming the race wasn't saved when it was."""
    text = _flagged_strings()[locale_index]

    # English phrasing of the old bug.
    lowered = text.lower()
    assert "not</strong> saved" not in lowered, "flagged copy claims the race was not saved"
    assert "not saved to your history" not in lowered, "flagged copy claims the race was not saved"
    # Thai phrasing of the old bug: "ไม่ได้บันทึก" = "did not save".
    assert "ไม่ได้</strong>บันทึก" not in text, "Thai flagged copy claims the race was not saved"
    assert "ไม่ได้บันทึก" not in text, "Thai flagged copy claims the race was not saved"


def test_flagged_copy_still_warns_it_does_not_count():
    """The half that was always true has to survive the fix -- a flagged time
    really is kept out of personal bests and the leaderboard, and the user needs
    to know that or the 'Not counted' badge in history reads as a glitch."""
    en, th = _flagged_strings()[0], _flagged_strings()[1]

    assert "leaderboard" in en.lower()
    assert "personal best" in en.lower()
    assert "กระดานผู้นำ" in th  # leaderboard
    assert "สถิติที่ดีที่สุด" in th  # personal best
