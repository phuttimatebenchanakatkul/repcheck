"""Guards the Gemini-feedback-to-HTML trust boundary.

split_feedback_sections() turns Gemini's raw markdown response into
summary_html/detail_html, which is rendered with | safe in result.html and
via raw innerHTML in index.html's AJAX view. Markdown 3.0+ has no safe_mode
left -- it passes literal HTML in its source straight through -- so any
angle bracket in Gemini's own text would otherwise render as live HTML/JS
in the viewing user's browser the next time that stored analysis is opened.

These tests assert the escape-before-convert fix in app.py: html.escape()
runs on the raw section text before it reaches markdown_lib.markdown(),
neutralizing literal HTML while leaving markdown syntax (**bold**, "- "
bullets) untouched, since none of those characters are among the five
html.escape() rewrites.
"""

import pytest

from app import split_feedback_sections


def _first_section_html(markdown_text, overall_score=75):
    sections = split_feedback_sections(markdown_text, overall_score=overall_score)
    assert sections, "no section parsed -- test input needs a valid '## Heading'"
    return sections[0]["summary_html"], sections[0].get("detail_html")


def test_script_tag_in_feedback_is_neutralized():
    poisoned = (
        "## Movement Summary\n"
        "- Great depth, but <script>alert(document.cookie)</script> here.\n"
    )
    summary, _ = _first_section_html(poisoned)
    assert "<script>" not in summary, "raw <script> tag reached the rendered HTML"
    assert "&lt;script&gt;" in summary, "the tag should survive as inert text"


def test_html_attribute_injection_is_neutralized():
    # A bare tag is the obvious case; an attacker-controlled attribute
    # (onerror=, onclick=) on an otherwise-plausible-looking tag is the one
    # that actually executes without needing <script> at all.
    poisoned = (
        '## Movement Summary\n'
        '- Nice set <img src=x onerror="fetch(String.fromCharCode(47,47,101,118,105,108))">.\n'
    )
    summary, _ = _first_section_html(poisoned)
    # The actual security property: no real "<" survives to open a tag.
    # onerror=&quot;...&quot; as inert text is fine and expected -- it's the
    # escaped attribute of a tag that never became a tag.
    assert "<img" not in summary, "a raw <img> tag reached the rendered HTML"
    assert "&lt;img" in summary, "the tag should survive as inert text"


def test_markdown_bold_still_renders():
    # The fix must not turn legitimate markdown into inert text -- only
    # characters actually present in Gemini's raw text get escaped;
    # ** and - are untouched, so the library's own conversion still runs.
    clean = "## Movement Summary\n- Solid set, **great tempo** throughout.\n"
    summary, _ = _first_section_html(clean)
    assert "<strong>great tempo</strong>" in summary, "bold markdown should still convert"


def test_markdown_bullet_list_still_renders():
    clean = (
        "## Your Next Step\n"
        "- Keep the weight the same.\n"
        "- Focus on full depth.\n"
        "- Add a pause at the bottom.\n"
    )
    summary, detail = _first_section_html(clean, overall_score=85)
    assert summary == "<p>Keep the weight the same.</p>", (
        "the first bullet should still become the plain-text headline"
    )
    assert detail is not None and "<ul>" in detail and "<li>" in detail, (
        "the remaining bullets should still become a <ul> in detail_html"
    )


def test_ampersand_in_feedback_is_escaped_not_double_escaped():
    # A literal "&" in Gemini's text (e.g. "back & shoulders") must become
    # exactly one entity, not "&amp;amp;" -- html.escape() runs once, before
    # markdown conversion, and markdown does not touch existing entities.
    clean = "## Movement Summary\n- Good work on back & shoulders today.\n"
    summary, _ = _first_section_html(clean)
    assert "&amp;" in summary
    assert "&amp;amp;" not in summary
