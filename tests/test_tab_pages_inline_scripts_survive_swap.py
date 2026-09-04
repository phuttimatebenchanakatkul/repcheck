"""Guards every tab page's main inline script against being skipped on a swap.

static/pagenav.js swaps a tab page in without loading a document, so the page's
inline scripts are not executed by the browser -- pagenav re-runs them itself,
through `new Function`. It can only do that for classic JavaScript, so
runInlineScripts() skips any <script> whose `type` is not classic:

    if (type && !/^(text|application)\\/(java|ecma)script$/i.test(type)) continue;

`type="module"` fails that test. A page whose logic lives in a module therefore
does not run AT ALL when reached from the tab bar -- and it fails silently:
nothing throws, so pagenav does not fall back to a real navigation either. The
page just sits there inert.

That is what happened to the analyze page. Its entire 1300-line body was one
`<script type="module">` (it needed a top-level `import` for MediaPipe), so
tapping Analyze in the tab bar produced a dead screen: no camera, no recent
analyses, no exercise picker. Reaching the SAME route through home's "Upload a
set" link worked perfectly, because that is a plain <a> and pagenav only
intercepts tab-bar clicks -- a full page load, where the browser runs the
module itself. The fix was to make it a classic script and pull MediaPipe in
with a dynamic `import()` at the point of use.

A small `type="module"` shim is still fine (nutrition.html has one: six lines
that import pretext.js and hang it on `window` for the classic script below).
What must never happen again is a page's MAIN body being unreachable. So the
invariant pinned here is per-page: the largest inline script -- the one
carrying the page logic -- must be one pagenav can actually run.

Source-level by necessity: the thing at risk is an HTML attribute in a template
matched against a regex in a JS file, which no harness can exercise. The regex
is read out of pagenav.js rather than copied, so the two cannot drift apart.
"""

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

PAGENAV_PATH = Path("static/pagenav.js")

# Every template reachable from the tab bar (see the .mt-item links in
# templates/base.html). These are the pages pagenav swaps.
TAB_TEMPLATES = [
    Path("templates/index.html"),  # analyze
    Path("templates/home.html"),
    Path("templates/workouts.html"),
    Path("templates/nutrition.html"),
    Path("templates/hyrox.html"),
]

INLINE_SCRIPT_RE = re.compile(
    r"<script(?P<attrs>(?:\s[^>]*)?)>(?P<body>.*?)</script>", re.S | re.I
)
TYPE_RE = re.compile(r'\btype\s*=\s*"([^"]*)"', re.I)


def _pagenav_classic_type_re():
    """The exact regex pagenav.js gates inline scripts on, read from source."""
    source = PAGENAV_PATH.read_text(encoding="utf-8")
    # The literal contains an escaped slash (\/), so the scan has to step over
    # backslash escapes rather than stopping at the first slash.
    # Matched on `.test(type)` alone, without the `!` that used to sit in
    # front of it: the gate reads `!type || <regex>.test(type)` now that the
    # scripts are collected on the way out of the parsed page rather than
    # skipped in place, and anchoring on the negation made this test fail for
    # a change that did not touch which types run.
    match = re.search(
        r"(/\^\(text\|application\)(?:\\.|[^/\\])*/i)\.test\(type\)", source
    )
    assert match, (
        "could not find the inline-script type gate in static/pagenav.js -- if it "
        "was rewritten, update this test to read the new form."
    )
    # /^(text|application)\/(java|ecma)script$/i -> a Python pattern.
    literal = match.group(1)
    body = literal[1 : literal.rindex("/")].replace("\\/", "/")
    return re.compile(body, re.I)


# Jinja comments are stripped before the document is ever parsed as HTML, so a
# `<script>` written inside one is prose, not markup. Scanning without removing
# them first is not a nitpick: this test was originally fooled by the very
# comment that explains it, matching from the `<script>` inside the comment all
# the way to the real closing tag -- one giant block with no type attribute,
# which passed while the page was broken.
JINJA_COMMENT_RE = re.compile(r"\{#.*?#\}", re.S)


def _inline_scripts(path):
    """(type, body) for every inline <script> in the template, src ones skipped."""
    out = []
    source = JINJA_COMMENT_RE.sub("", path.read_text(encoding="utf-8"))
    for m in INLINE_SCRIPT_RE.finditer(source):
        attrs = m.group("attrs") or ""
        if re.search(r"\bsrc\s*=", attrs, re.I):
            continue
        t = TYPE_RE.search(attrs)
        out.append((t.group(1) if t else None, m.group("body")))
    return out


def _pagenav_would_run(script_type, classic_re):
    """Mirrors runInlineScripts(): no type runs; otherwise it must be classic."""
    return script_type is None or bool(classic_re.match(script_type))


def test_every_tab_pages_main_inline_script_is_one_pagenav_can_run():
    classic_re = _pagenav_classic_type_re()
    for path in TAB_TEMPLATES:
        scripts = _inline_scripts(path)
        if not scripts:
            continue
        script_type, body = max(scripts, key=lambda s: len(s[1]))
        assert _pagenav_would_run(script_type, classic_re), (
            f"{path}: the page's main inline script ({len(body)} chars) is "
            f'type="{script_type}", which pagenav.js skips. Reaching this page '
            "from the tab bar would run none of it -- silently, with no fallback "
            "to a real navigation. Make it a classic script and pull any ES "
            "module in with a dynamic import() at the point of use."
        )


def test_the_analyze_page_body_has_no_top_level_import():
    """A top-level import is what would force index.html back into a module."""
    scripts = _inline_scripts(Path("templates/index.html"))
    _, body = max(scripts, key=lambda s: len(s[1]))
    offenders = [
        line
        for line in body.splitlines()
        if re.match(r"\s{0,2}(import|export)\s", line)
        and "import(" not in line
    ]
    assert not offenders, (
        "templates/index.html's main script has a top-level import/export, which "
        "only a module can carry -- and a module is exactly what pagenav.js "
        f"cannot run. Use a dynamic import() instead. Found: {offenders}"
    )


def test_mediapipe_is_pulled_in_with_a_dynamic_import_from_an_absolute_url():
    """Dynamic import() under `new Function` has no own base URL to resolve against."""
    source = Path("templates/index.html").read_text(encoding="utf-8")
    match = re.search(r'POSE_VISION_URL\s*=\s*"([^"]+)"', source)
    assert match, "POSE_VISION_URL is gone -- MediaPipe's dynamic import needs it."
    assert match.group(1).startswith("https://"), (
        "POSE_VISION_URL must be absolute: pagenav runs this script through "
        "`new Function`, where a relative specifier has no script base URL to "
        "resolve against."
    )
    assert "await import(POSE_VISION_URL)" in source, (
        "MediaPipe must be loaded with a dynamic import() at the point of use; a "
        "static import would force this script back to type=module."
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
def test_the_analyze_page_body_parses_as_a_classic_script():
    """Module-only syntax must not creep back in.

    The trap is top-level `await`: legal in a module, a SyntaxError in a classic
    script. Adding one would not look like a mistake -- it would simply stop the
    whole page from running under pagenav again, silently, exactly as before.

    Checked with `new Function(src)`, which is literally what runInlineScripts()
    does, rather than `node --check`: modern Node retries a failed CommonJS
    parse as ESM when it spots top-level await, so `--check` ACCEPTS the very
    syntax this test exists to reject (confirmed by mutation). The Function
    constructor has no such fallback -- and it is the real execution path.
    """
    _, body = max(
        _inline_scripts(Path("templates/index.html")), key=lambda s: len(s[1])
    )
    # Jinja expressions render to values before the browser ever sees them;
    # stub them so what is left is parseable JavaScript.
    js = re.sub(r"\{\{.*?\}\}", "JINJA", body, flags=re.S)
    js = re.sub(r"\{%.*?%\}", "", js, flags=re.S)
    tmp = tempfile.NamedTemporaryFile(
        "w", suffix=".js", delete=False, encoding="utf-8"
    )
    try:
        tmp.write(js)
        tmp.close()
        result = subprocess.run(
            [
                "node",
                "-e",
                "new Function(require('fs').readFileSync(process.argv[1],'utf8'))",
                tmp.name,
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, (
            "templates/index.html's main script no longer parses as a classic "
            "script, so pagenav.js could not run it on a tab swap:\n"
            f"{result.stderr[:800]}"
        )
    finally:
        os.unlink(tmp.name)
