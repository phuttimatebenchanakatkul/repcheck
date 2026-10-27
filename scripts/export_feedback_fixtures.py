"""Writes mobile/src/logic/__tests__/fixtures/feedback.json: what the server's `split_feedback_sections` really answers for sample
reports, so the app's HTML-to-text converter is tested against the real markdown library's output, not a guess.

    python scripts/export_feedback_fixtures.py          # rewrite the file
    python scripts/export_feedback_fixtures.py --check  # exit 1 if it is stale

Each case records the report, the score, and the server's sections; and for each section the plain text the HTML stands for
(computed here independently of the app: strip the tags, decode the entities) plus how many bold and italic runs it holds.
"""

import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api.feedback import split_feedback_sections  # noqa: E402

TARGET = ROOT / "mobile" / "src" / "logic" / "__tests__" / "fixtures" / "feedback.json"

REPORT = """## Movement Summary
- You performed 8 controlled **back squats** at a steady tempo.
- Depth was *just* above parallel on reps 3 & 4.
- Bar path stayed over mid-foot.

## Positives
- Excellent bracing & **chest position** throughout.
- Consistent tempo: ~2s down, 1s up.

## Negatives
- Knees caved in on the last two reps (<valgus>).
- Heels lifted slightly at the bottom.

## Improvements
1. Drive the knees out ("spread the floor").
2. Add a 1-second pause at the bottom.

## Injury Prevention
Stop the set if you feel a pinch in the **hip crease**.

## How to Progress
- Add 2.5 kg when all reps hit parallel.
- Film from the side for depth.
"""

CASES = [
    {"name": "a mixed set", "score": 65, "report": REPORT},
    {"name": "a strong set", "score": 91, "report": REPORT},
    {"name": "a poor set", "score": 32, "report": REPORT},
    {"name": "no score", "score": None, "report": REPORT},
    {"name": "a single bullet and a paragraph", "score": 70, "report": "## Positives\n- Only one thing.\n\n## Negatives\nA plain paragraph with `code` and a <script>alert(1)</script> tag.\n"},
    {"name": "an unknown heading", "score": 70, "report": "## Something Else\n- Falls back to improvements.\n- Second.\n"},
    {"name": "text before any heading", "score": 70, "report": "Preamble.\n\n## Positives\n- Kept.\n"},
    {"name": "no headings at all", "score": 70, "report": "Just a sentence."},
]


def plain(fragment):
    if fragment is None:
        return None
    text = re.sub(r"</(p|li)>", "\n", fragment)
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return "\n".join(line.strip() for line in html.unescape(text).splitlines() if line.strip())


def build():
    cases = []
    for case in CASES:
        sections = split_feedback_sections(case["report"], case["score"])
        cases.append({
            **case,
            "sections": [{
                **section,
                "summary_text": plain(section["summary_html"]),
                "detail_text": plain(section["detail_html"]),
                "bold": len(re.findall(r"<strong>", (section["summary_html"] or "") + (section["detail_html"] or ""))),
                "italic": len(re.findall(r"<em>", (section["summary_html"] or "") + (section["detail_html"] or ""))),
            } for section in sections],
        })
    return json.dumps({"cases": cases}, indent=2, ensure_ascii=False) + "\n"


def main():
    text = build()
    if "--check" in sys.argv:
        current = TARGET.read_text(encoding="utf-8").replace("\r\n", "\n") if TARGET.exists() else ""
        if current != text:
            print("mobile feedback fixtures are stale: run python scripts/export_feedback_fixtures.py", file=sys.stderr)
            return 1
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
