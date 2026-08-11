"""Every English string must have a Thai one, and vice versa.

RepCheckI18n.t() falls back to returning the key itself when a lookup
misses, so a missing translation doesn't throw -- it renders
"workouts.wizard.tapDayHint" into the page. That reads as a bug to a Thai
user and is invisible to an English-speaking developer, which is exactly
the kind of failure worth a test rather than a code review.

The locale tables live in static/i18n.js as flat "key": "value" object
literals, so they're parsed out of the source here rather than executed.
"""

import re
from pathlib import Path

import pytest

I18N_PATH = Path("static/i18n.js")


def _locale_blocks(source):
    """Split the file into one text block per locale table.

    Each table opens with `en: {` / `th: {` at a known indent. Splitting
    on those markers avoids depending on a JS parser.
    """
    markers = [(m.group(1), m.start()) for m in re.finditer(r"^\s{4}(\w+):\s*\{", source, re.M)]
    assert markers, "could not find any locale tables in static/i18n.js"
    blocks = {}
    for i, (name, start) in enumerate(markers):
        end = markers[i + 1][1] if i + 1 < len(markers) else len(source)
        blocks[name] = source[start:end]
    return blocks


def _keys(block):
    return set(re.findall(r'"([\w.]+)":\s*"', block))


@pytest.fixture(scope="module")
def locales():
    source = I18N_PATH.read_text(encoding="utf-8")
    blocks = _locale_blocks(source)
    return {name: _keys(block) for name, block in blocks.items()}


def test_the_expected_locales_are_present(locales):
    assert "en" in locales, "English table missing from static/i18n.js"
    assert "th" in locales, "Thai table missing from static/i18n.js"


# Pre-existing gap, predates this file and the split-review redesign: the
# wizard's "Where do you usually train?" step has never had a Thai
# translation. Known and deliberately deferred rather than fixed here.
# Listed explicitly (not swallowed) so this test still catches every
# OTHER key that goes missing, and so the gap can't quietly grow without
# someone noticing this list -- see test_known_missing_thai_list_has_no_stale_entries
# below, which fails the moment any of these keys actually gets translated.
KNOWN_MISSING_THAI = {
    "workouts.wizard.locationTitle",
    "workouts.wizard.stepLocation",
    "workouts.wizard.location.gym.title",
    "workouts.wizard.location.gym.sub",
    "workouts.wizard.location.home.title",
    "workouts.wizard.location.home.sub",
    "workouts.wizard.location.hybrid.title",
    "workouts.wizard.location.hybrid.sub",
}


def test_english_and_thai_define_the_same_keys(locales):
    missing_in_thai = sorted(locales["en"] - locales["th"] - KNOWN_MISSING_THAI)
    missing_in_english = sorted(locales["th"] - locales["en"])
    assert not missing_in_thai, (
        "these keys exist in English but not Thai, so a Thai user sees the raw "
        f"key rendered into the page: {missing_in_thai}"
    )
    assert not missing_in_english, (
        f"these keys exist in Thai but not English: {missing_in_english}"
    )


def test_known_missing_thai_list_has_no_stale_entries(locales):
    """If a key in the allowlist gets translated, take it off the list.

    Otherwise a real fix here is invisible -- the parity test would stay
    green either way, so nothing would tell you the list is now lying.
    """
    still_missing = KNOWN_MISSING_THAI - (locales["en"] - locales["th"])
    assert not still_missing, (
        "these keys in KNOWN_MISSING_THAI now have a Thai translation -- "
        f"remove them from the allowlist: {sorted(still_missing)}"
    )


def test_thai_never_references_a_placeholder_english_does_not():
    """A Thai string can't invent a param the call site never supplies.

    t() does a plain string replace per placeholder in the params object,
    which every call site builds from the English shape (see
    workouts.day.sets: `{n, s}` -- s is "" or "s", supplied at every call
    regardless of active locale). Thai is free to *not use* a supplied
    placeholder (Thai has no plural marker, so it drops {s} and that's
    correct, not a bug -- the value is simply never substituted). What
    Thai must never do is reference a placeholder English doesn't have,
    since nothing will be there to fill it and "{foo}" renders literally
    into the page.
    """
    source = I18N_PATH.read_text(encoding="utf-8")
    blocks = _locale_blocks(source)
    en_pairs = dict(re.findall(r'"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"', blocks["en"]))
    th_pairs = dict(re.findall(r'"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"', blocks["th"]))

    invented = []
    for key, th_value in th_pairs.items():
        if key not in en_pairs:
            continue
        en_slots = set(re.findall(r"\{(\w+)\}", en_pairs[key]))
        th_slots = set(re.findall(r"\{(\w+)\}", th_value))
        extra = th_slots - en_slots
        if extra:
            invented.append((key, sorted(extra)))

    assert not invented, (
        "these Thai translations reference a placeholder the English source "
        f"(and therefore the call site) doesn't supply, which renders literally: {invented}"
    )
