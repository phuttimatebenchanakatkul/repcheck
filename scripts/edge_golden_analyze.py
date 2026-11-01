"""Golden answers for the form grader (supabase/functions/_shared/analyzeForm.ts, analyze.ts, feedback.ts, pyMarkdown.ts), from the PYTHON code.

Registered in edge_golden.py. {name: [[input, expected], ...]}:
  sections    the model's markdown to the sections a result screen shows (api/feedback.py, with the `markdown` package)
  scores      the scores read out of a model reply, and the reply with its score lines removed (analyze_form_gemini.py)
  exercises   which exercise a name is (resolve_exercise)
  prompts     build_prompt for every exercise and a spread of clip lengths: a hash of each, the whole text of every 20th
  names       clean_exercise and check_suffix (api/analyze.py)
  classes     the code points Python's \\s, \\d and \\w match in a text pattern
  constants   the numbers and words the routes and the limits share

The markdown corpus is shaped like what the model is asked to write (short bullet lists with bold and italics) plus the stray marks
real replies carry. Cases where Python-Markdown 3.10 itself writes mis-nested tags (a strong holding an em beside more emphasis in one
paragraph) are left out: there is nothing meaningful to match, and the TypeScript renders what the writer meant.
"""

import hashlib
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

WORDS = ("elbows knees back full range tempo slow rep reps lockout depth bar grip stance hips shoulder blades chest core brace squeeze stretch bottom top lower raise control "
         "drift flare swing momentum wrist neutral").split()
SPECIAL = ["50%", "it's", '"quoted"', "a & b", "x < y", "x > y", "5-10", "3x8", "snake_case_name", "2*3*4", "a_b_c", "e.g.", "(note)", "[bracket]", "1.", "$5", "~tilde~", "a|b", "{x}",
           "100kg", "—", "é", "٣", "\U0001f642"]
HEADS = ["Movement Summary", "Positives", "Negatives", "Improvements", "Injury Prevention", "How to Progress", "Extra Notes", "positives", "  Negatives  ", "HOW TO PROGRESS"]
MISNEST = re.compile(r"<(em|strong)>(?:(?!</\1>).)*<\1>|</(?:em|strong)>\*|\*<(?:em|strong)>", re.S)


def sentence(rng, deco=True):
    parts = []
    for _ in range(rng.randint(1, 9)):
        word = rng.choice(WORDS) if (rng.random() > 0.12 or not parts) else rng.choice(SPECIAL)
        if deco and word != "2*3*4" and rng.random() < 0.18:
            kind = rng.choice(["**", "*", "_", "__", "`", "***", "**", "*"])
            if kind in ("_", "__") and not word.isalpha():
                kind = "**"
            word = f"{kind}{word}{kind}"
        parts.append(word)
    text = " ".join(parts)
    if deco and rng.random() < 0.06:
        text += rng.choice([" * ", " ** ", " \\*", " \\_", " - "]) + rng.choice(WORDS)
    if deco and rng.random() < 0.06:
        text = f"**{sentence(rng, False)}** " + sentence(rng, False)
    if deco and rng.random() < 0.05:
        text = f"*{sentence(rng, False)}* and **{sentence(rng, False)}**"
    if deco and rng.random() < 0.05:
        # a strong holding an em: Python-Markdown mis-nests it when more emphasis follows in the same paragraph, so this one stands alone
        text = (" ".join(rng.choice(WORDS) for _ in range(rng.randint(0, 4))) + f" **{rng.choice(WORDS)} *{rng.choice(WORDS)}* {rng.choice(WORDS)}** "
                + " ".join(rng.choice(WORDS) for _ in range(rng.randint(0, 4)))).strip()
    return text


def body(rng):
    kind = rng.random()
    if kind < 0.12:
        return sentence(rng)
    if kind < 0.18:
        return "\n".join(sentence(rng) for _ in range(rng.randint(1, 3)))
    mark = rng.choice(["-", "-", "-", "*", "+"])
    lines = []
    for _ in range(rng.randint(1, 5)):
        lines.append(f"{mark} {sentence(rng)}")
        r = rng.random()
        if r < 0.10:
            lines.append("  " + sentence(rng))
        elif r < 0.14:
            lines.append(sentence(rng))
        lines.append("" if rng.random() < 0.10 else None)
    text = "\n".join(line for line in lines if line is not None)
    if rng.random() < 0.10:
        text += "\n\n" + sentence(rng)
    if rng.random() < 0.05:
        text = sentence(rng) + "\n" + text
    if rng.random() < 0.05:
        text += "  \n" + sentence(rng)
    return text


def document(rng):
    out = []
    if rng.random() < 0.15:
        out.append(sentence(rng))
    for head in rng.sample(HEADS, rng.randint(1, 6)):
        out.append(f"## {head}")
        out.append(body(rng))
        if rng.random() < 0.3:
            out.append("")
    text = "\n".join(out)
    return text.replace("\n", "\r\n") if rng.random() < 0.1 else text


REAL = """STRETCH_SCORE: 72
SQUEEZE_SCORE: 64
OVERALL_SCORE: 68
FAVORED: stretch
REPS: 9

## Movement Summary
- 9 reps, mostly full range
- Tempo speeds up late in the set; the last 3 reps are shorter.

## Positives
- **Elbows stay pinned** at your sides
- Wrists stay neutral through the middle reps

## Negatives
- Swing creeps in on the last 3 reps
- *Top squeeze* is rushed

## Improvements
- Pause for one beat at the top
- Lower the weight 5% and keep the last reps strict

## Injury Prevention
- Back arching on the last rep is the risk
  Keep your ribs down and glutes tight.

## How to Progress
- Hold the weight and clean up form first
"""


def build_sections():
    from api.feedback import split_feedback_sections
    rng = random.Random(20261101)
    cases = [(REAL, None), (REAL, 20), (REAL, 49), (REAL, 50), (REAL, 79), (REAL, 80), (REAL, 100), ("", None), ("no headings at all, just a sentence", 70),
             ("## Positives", 70), ("## Positives\n", 70), ("##Positives\n- tight heading", 70), ("## Positives\n\n\n- after blanks", 70), ("## \n## Positives\n- x", 70),
             ("preamble\n## Positives\n- x\n## Positives\n- y", 70), ("## Hello <b>x</b> & \"quotes\"\n- <script>alert(1)</script> & 'q'", 70), ("## constructor\n- x", 70),
             ("## Negatives\n- one\n\n- two\n- three\n\n- four\n\nA closing paragraph.", 30), ("## Positives\n1. an ordered item\n2. another", 70), ("## Positives\n- café ٣ \U0001f3cb", 70),
             ("## Positives\r\n- crlf one\r\n- crlf two\r\n", 70), ("## Positives\n- `code & <b>` and \\*escaped\\* stars", 70),
             ("## Positives\n- a\n\tcontinued after a tab\n- b", 70), ("## Positives\n- a\t\tb\n- c", 70)]
    seen = {json.dumps(c) for c in cases}
    out = [[[doc, score], split_feedback_sections(doc, score)] for doc, score in cases]
    skipped = 0
    while len(out) < 2200:
        doc = document(rng)
        score = rng.choice([None, 10, 49, 50, 79, 80, 95])
        expected = split_feedback_sections(doc, score)
        if MISNEST.search(json.dumps(expected, ensure_ascii=False)):
            skipped += 1
            continue
        if json.dumps([doc, score]) in seen:
            continue
        out.append([[doc, score], expected])
    return out


def reply_variants(rng):
    scores = ["STRETCH_SCORE: {a}", "SQUEEZE_SCORE: {b}", "OVERALL_SCORE: {c}", "FAVORED: {f}", "REPS: {r}"]
    favored = ["stretch", "squeeze", "balanced", "Stretch", "SQUEEZE", "Balanced", "stretchy", "none", "ſqueeze", "ſtretch", "balanced.", ""]
    numbers = ["0", "7", "72", "100", "101", "250", "007", "٨٠", "٣", "१२", "99999", "-5", "8.5", "", "x"]
    spacers = [" ", "  ", "", "\t", " ", "\n", "　", "\x1c", "\x85"]
    ends = ["\n", "\r\n", "  \n", " \n", "\n\n", " ", ""]
    out = []
    for _ in range(500):
        fields = {"a": rng.choice(numbers), "b": rng.choice(numbers), "c": rng.choice(numbers), "f": rng.choice(favored), "r": rng.choice(numbers)}
        lines = [s.format(**fields).replace(": ", ":" + rng.choice(spacers), 1) for s in scores]
        rng.shuffle(lines) if rng.random() < 0.2 else None
        if rng.random() < 0.15:
            lines = lines[: rng.randint(0, 4)]
        text = "".join(line + rng.choice(ends) for line in lines)
        if rng.random() < 0.5:
            text += rng.choice(["\n## Positives\n- ok", "\nOVERALL_SCORE: 50 in the prose\n", "\nREPS: 3 reps here\n", "\n", "keep this", "\nSTRETCH_SCORE: 80", "FAVORED: stretch of road\n"])
        if rng.random() < 0.2:
            text = rng.choice(["Intro line\n", "\n\n", "  "]) + text
        out.append(text)
    return out


def build_scores():
    from analyze_form_gemini import parse_scores, strip_score_lines
    rng = random.Random(1101)
    texts = [REAL, "", "OVERALL_SCORE: 80", "nothing here", "UNSCORABLE: black screen", "STRETCH_SCORE:80\nSQUEEZE_SCORE:70\nOVERALL_SCORE:75\nFAVORED:balanced\nREPS:12\n",
             "REPS: 5\nREPS: 6\n", "OVERALL_SCORE: 5\nOVERALL_SCORE: 95\n", "overall_score: 80\nreps: 4", "X OVERALL_SCORE: 80", "XOVERALL_SCORE: 80\n"] + reply_variants(rng)
    return [[t, [list(parse_scores(t)), strip_score_lines(t)]] for t in texts]


def build_exercises():
    import analyze_form_gemini as g
    names = list(g.EXERCISES) + [c["label"] for c in g.EXERCISES.values()]
    names += [n.upper() for n in names[:6]] + [f" {n} " for n in names[:6]] + [f"\t{n}\n" for n in names[6:12]] + ["\x85Bicep Curl\x85", "\x1cBicep Curl\x1d", " Bicep Curl ", "﻿Bicep Curl", "Bicep  Curl",
                                                                                                                      "bicep-curl", "Cable Pullover", "  Cable Pullover  ", "Écart", "BICEP_CURL", "Pull Up", "pull_up", "constructor", "__proto__", "toString", "", "   "]
    out = []
    for name in names:
        cfg = g.resolve_exercise(name)
        out.append([name, [cfg["label"], cfg["secondary_notes"], cfg.get("research_notes")]])
    return out


def build_prompts():
    import analyze_form_gemini as g
    names = list(g.EXERCISES) + ["Cable Pullover", "Hip Thrust", "x" * 100, "Écart \U0001f3cb", "{label} {duration_seconds}"]
    durations = [3.0, 3.1, 7.9, 12.5, 18.5, 23.4, 29.95, 45.0, 59.9, 60.0, 0.1, 1e-05, 1e16, 123456.789]
    out = []
    n = 0
    for name in names:
        for duration in durations:
            text = g.build_prompt(g.resolve_exercise(name), duration)
            out.append([[name, duration], [hashlib.sha256(text.encode("utf-8")).hexdigest(), text if n % 20 == 0 else None]])
            n += 1
    return out


def build_names():
    from api import analyze
    rng = random.Random(77)
    exercises = [None, "", "  ", "Bicep Curl", "  Bicep Curl  ", "a\tb", "a\x00b", "a\x7fb", "a\x1fb", "a\x85b", "\x85", "\x85a\x85", "x" * 100, "x" * 101, "\U0001f3cb" * 100, "\U0001f3cb" * 101, 5, ["x"], True,
                 "line\nbreak", " ", "ok ok", "﻿", "　Press　"]
    files = ["set.mp4", "SET.MOV", "a.M4V", "a.avi", "a.mkv", "a.webm", "a.gif", "a", "", ".mp4", "a.b.mp4", "dir/a.mp4", "dir\\a.mp4", "dir.mp4/a", "a.mp4.exe", "a.möv", "a.\U0001f3cb",
             "a." + "x" * 40, "a.m p4", "a.mp4 ", "a.mp\x004", "a.\x7f", " .mp4", "x.ß", "a.MP4\n"]
    out = []
    for value in exercises:
        try:
            result = ["ok", analyze.clean_exercise(value)]
        except analyze.AnalyzeRejected as e:
            result = ["error", str(e)]
        out.append([["exercise", value], result])
    for value in files:
        try:
            result = ["ok", analyze.check_suffix(value)]
        except analyze.AnalyzeRejected as e:
            result = ["error", str(e)]
        out.append([["file", value], result])
    return out


def ranges_of(pattern):
    compiled = re.compile(pattern)
    out, start = [], None
    for cp in range(0x110000):
        hit = not 0xD800 <= cp <= 0xDFFF and compiled.fullmatch(chr(cp)) is not None   # a lone surrogate is not a character a JavaScript text pattern can see
        if hit and start is None:
            start = cp
        if not hit and start is not None:
            out.append([start, cp - 1])
            start = None
    if start is not None:
        out.append([start, 0x10FFFF])
    return out


def build_classes():
    return [[p, ranges_of(p)] for p in (r"\s", r"\d", r"\w")]


def build_constants():
    from api import analyze, limits
    from api.routes import analyze as routes
    return [[None, {
        "history_keep": analyze.HISTORY_KEEP, "max_exercise": analyze.MAX_EXERCISE_LENGTH, "feature": analyze.FEATURE, "bucket": analyze.BUCKET,
        "allowed": sorted(analyze.ALLOWED_EXTENSIONS), "recorded": sorted(analyze.RECORDED_EXTENSIONS), "content_types": analyze.CONTENT_TYPES,
        "max_clip": analyze.MAX_CLIP_BYTES, "signed_seconds": routes.SIGNED_URL_SECONDS, "limit": list(limits.RATE_LIMITS["workout_analysis"]),
        "messages": [limits.limit_message("workout_analysis", s) for s in (1, 59, 60, 3599, 3600, 86399, 86400)],
    }]]


def build():
    return {"sections": build_sections(), "scores": build_scores(), "exercises": build_exercises(), "prompts": build_prompts(), "names": build_names(),
            "classes": build_classes(), "constants": build_constants()}
