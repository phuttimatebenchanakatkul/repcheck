"""Turn Gemini's "## Heading" markdown into the sections a result screen shows.

A port of app.py's split_feedback_sections and its two helpers, which cannot be imported (app.py starts the website as a
side effect). tests/test_api_analyze.py runs both on the same inputs and requires identical output, so the two cannot
drift while both exist. One deliberate difference: no `icon` field. The website put inline SVG there; the native app
draws its own icon from `css_class`.
"""

import html
import re

import markdown as markdown_lib

SECTION_STYLES = {
    "movement summary": "summary",
    "positives": "positives",
    "negatives": "negatives",
    "improvements": "improvements",
    "injury prevention": "injury",
    "how to progress": "progress",
}


def split_summary_and_detail(rendered):
    """(summary_html, detail_html): the first bullet as a plain paragraph that is always shown, and every other bullet
    as a list revealed on expand (None when there is only one). A section that is not a bullet list becomes the summary."""
    items = re.findall(r"<li>.*?</li>", rendered, flags=re.DOTALL)
    if not items:
        return rendered, None
    summary = f"<p>{re.sub(r'</?li>', '', items[0])}</p>"
    if len(items) == 1:
        return summary, None
    return summary, f"<ul>{''.join(items[1:])}</ul>"


def section_emphasis(css_class, overall_score):
    """How prominently to show a section, driven by the overall score. A poor set (<50) confronts the lifter with what
    went wrong and how to avoid injury, so positives and the neutral sections are dropped; a strong set (>=80) leads with
    what they nailed and how to progress; a middling set shows everything evenly. 'featured', 'muted' or 'hidden'."""
    if overall_score is None:
        return "featured"
    if overall_score < 50:
        return "featured" if css_class in ("negatives", "injury") else "hidden"
    if overall_score >= 80:
        return "featured" if css_class in ("positives", "progress") else "muted"
    return "featured"


def split_feedback_sections(feedback_markdown, overall_score=None):
    parts = re.split(r"^##\s+(.+)$", feedback_markdown, flags=re.MULTILINE)
    sections = []
    for heading, body in zip(parts[1::2], parts[2::2]):       # parts[0] is any preamble before the first heading
        css_class = SECTION_STYLES.get(heading.strip().lower(), "improvements")
        emphasis = section_emphasis(css_class, overall_score)
        if emphasis == "hidden":
            continue
        # Markdown passes literal HTML in its source through unescaped, and clients render this as HTML. Escaping first
        # inerts any <, >, &, " or ' in the model's text without touching the markdown syntax (**bold** and "- bullet"
        # use none of those characters).
        rendered = markdown_lib.markdown(html.escape(body.strip()))
        summary_html, detail_html = split_summary_and_detail(rendered)
        sections.append({
            "heading": heading.strip(),
            "css_class": css_class,
            "emphasis": emphasis,
            "title_key": "analyze.section." + css_class,
            "summary_html": summary_html,
            "detail_html": detail_html,
        })
    sections.sort(key=lambda s: 0 if s["emphasis"] == "featured" else 1)      # stable: featured first
    return sections
