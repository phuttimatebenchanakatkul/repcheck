"""Golden answers for the challenge-clip rep counter (supabase/functions/_shared/challengeClip.ts), from the PYTHON code.

Registered in edge_golden.py. {name: [[input, expected], ...]}:
  parse      the reading of the model's answer (`_parse_response`): the counts, or the message when there is none
  prompts    `build_prompt` for each exercise: a hash and the whole text
  constants  the numbers and words the route shares with Flask
"""

import hashlib
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def replies(rng):
    numbers = ["0", "1", "7", "11", "250", "007", "١٢", "१", "99999", "-3", "4.5", "", "x", "٣٤٥"]
    spacers = [" ", "  ", "", "\t", " ", "\n", "　", "\x85", " "]
    notes = ["Check 1 (full bottom depth) failed most often.", "", "   ", "not a push-up", "line\nbreak", "é \U0001f3cb", "x" * 300, "trailing spaces   ", "\tTabbed"]
    ends = ["\n", "\r\n", "  \n", "", "\n\n", " "]
    out = []
    for _ in range(400):
        lines = []
        if rng.random() < 0.6:
            for i in range(rng.randint(1, 4)):
                lines.append(f"Rep {i + 1} (00:0{i}): Check 1: YES, Check 2: {rng.choice(['YES', 'NO'])}. Verdict: {rng.choice(['VALID', 'REJECTED'])}.")
        if rng.random() < 0.15:
            lines.append(f"Rep 9 mentions REPS: {rng.choice(numbers)} in passing")
        fields = [f"REPS:{rng.choice(spacers)}{rng.choice(numbers)}", f"REJECTED:{rng.choice(spacers)}{rng.choice(numbers)}", f"NOTES:{rng.choice(spacers)}{rng.choice(notes)}"]
        if rng.random() < 0.2:
            fields = fields[:rng.randint(0, 3)]
        if rng.random() < 0.1:
            fields = fields + [f"REPS: {rng.choice(numbers)}"]
        lines += fields
        out.append("".join(line + rng.choice(ends) for line in lines))
    return out


def build_parse():
    import rep_form_analyzer as rfa
    rng = random.Random(1102)
    texts = ["", "REPS: 5", "REPS: 5\nREJECTED: 1\nNOTES: ok", "reps: 5", "no counts", "REPS:\nNOTES: x", "REPS: 12\nREJECTED: 3\nNOTES: Check 2 (straight body line) failed most often.\n"] + replies(rng)
    out = []
    for text in texts:
        try:
            result = ["ok", rfa._parse_response(text)]
        except rfa.RepCountError as e:
            result = ["error", str(e)]
        out.append([text, result])
    return out


def build_prompts():
    import rep_form_analyzer as rfa
    return [[key, [hashlib.sha256(rfa.build_prompt(key).encode("utf-8")).hexdigest(), rfa.build_prompt(key)]] for key in rfa.CHALLENGE_EXERCISES]


def build_constants():
    import rep_form_analyzer as rfa
    from api.routes import social as routes
    from api import analyze
    return [[None, {"labels": {k: v["label"] for k, v in rfa.CHALLENGE_EXERCISES.items()}, "model": rfa.GEMINI_MODEL, "fps": rfa.GEMINI_VIDEO_SAMPLE_FPS,
                    "retries": rfa.MAX_SAFETY_BLOCK_RETRIES, "clip_body_is_upload_plus_a_megabyte": routes.CLIP_BODY_LIMIT == analyze.MAX_UPLOAD_BYTES + 1024 * 1024}]]


def build():
    return {"parse": build_parse(), "prompts": build_prompts(), "constants": build_constants()}
