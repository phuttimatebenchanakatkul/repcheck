"""A data-i18n element's inline text must match its English i18n string.

result.html ships English copy inside the element AND a data-i18n key on
it. The inline text is what renders on first paint; i18n.js overwrites it
with the table's value once RepCheckI18n runs. So the two are the same
string written twice, in two files, and nothing until now checked that
they agree.

When they drift, an English reader sees one sentence flash and a
different one settle -- a flicker that reads as a rendering bug, only
appears on a cold load, and is invisible to anyone editing just one of
the files. The verdict lines are the live example: shortening the copy
means editing static/i18n.js and templates/result.html by hand, and
updating one of them is the easy mistake.

Thai is not checked here: it has no inline fallback to drift from, and
test_i18n_key_parity.py already proves every English key has a Thai one.
"""

import html
import re
from pathlib import Path

import pytest

I18N_PATH = Path("static/i18n.js")
RESULT_PATH = Path("templates/result.html")

# Matches an element carrying a data-i18n key with literal text inside it,
# e.g. <span data-i18n="analyze.fullReport">Full report</span>. Elements
# whose content is a Jinja expression or nested markup don't match the
# [^<]* body and are skipped -- there is no static string to compare.
INLINE_I18N = re.compile(r'data-i18n="([\w.]+)"[^>]*>([^<]*)<')


def _english_strings():
    """The `en:` table from static/i18n.js as a plain dict.

    Parsed rather than executed, the same way test_i18n_key_parity.py
    reads it: the tables are flat "key": "value" literals, so a regex is
    enough and pulling in a JS runtime is not.
    """
    source = I18N_PATH.read_text(encoding="utf-8")
    markers = [(m.group(1), m.start()) for m in re.finditer(r"^\s{4}(\w+):\s*\{", source, re.M)]
    assert markers, "could not find any locale tables in static/i18n.js"
    blocks = {}
    for i, (name, start) in enumerate(markers):
        end = markers[i + 1][1] if i + 1 < len(markers) else len(source)
        blocks[name] = source[start:end]
    assert "en" in blocks, "English table missing from static/i18n.js"
    return dict(re.findall(r'"([\w.]+)":\s*"((?:[^"\\]|\\.)*)"', blocks["en"]))


@pytest.fixture(scope="module")
def english():
    return _english_strings()


@pytest.fixture(scope="module")
def inline_pairs():
    tpl = RESULT_PATH.read_text(encoding="utf-8")
    # html.unescape because the template writes &amp; where the i18n table
    # holds a bare "&" (see analyze.overallFormTechnique).
    return [(key, html.unescape(text).strip()) for key, text in INLINE_I18N.findall(tpl)]


def test_the_template_actually_has_inline_fallbacks(inline_pairs):
    # Guards the test itself: a regex that stops matching would make every
    # assertion below vacuously pass.
    assert inline_pairs, "no inline data-i18n elements found in templates/result.html"


def test_every_inline_key_exists_in_english(english, inline_pairs):
    """A key with no table entry renders the raw key once i18n runs."""
    for key, _ in inline_pairs:
        assert key in english, (
            f"result.html uses data-i18n={key!r} but static/i18n.js has no such "
            "English string -- the page would render the raw key after hydration"
        )


def test_inline_fallback_matches_the_english_string(english, inline_pairs):
    """The flash-then-settle bug, asserted directly."""
    for key, inline in inline_pairs:
        assert english[key] == inline, (
            f"{key}: templates/result.html renders {inline!r} before i18n.js runs, "
            f"then swaps it for {english[key]!r}. Update both files together."
        )
