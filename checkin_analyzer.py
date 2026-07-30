"""AI-assisted weekly check-in analysis.

The safe numeric bounds -- the +/-150 kcal/week cap, the per-gender
minimum-calorie floor, and the fat/carb split for the user's diet style --
still come entirely from coaching_engine.py's deterministic
weekly_adjustment(). This module doesn't replace that math; it asks Gemini
to weigh in on the calorie DELTA itself for every check-in, anchored to
the deterministic suggestion as a starting point so the model can't swing
the result to something wild or unsafe. Front/back progress photos are
included when the user provided them, but are optional -- a text-only
check-in still gets the same Gemini review, just without the photo(s).
"""

import json
import os
import re

from dotenv import load_dotenv

load_dotenv()

# Same reasoning as rep_form_analyzer.py's model choice: this needs to
# actually weigh several numeric signals against two photos and stay
# within an explicit bound, which is more than a "flash-lite" tier model
# reliably did in testing for similarly judgment-heavy tasks in this app.
GEMINI_MODEL = "gemini-3.5-flash"

WEEKLY_ADJUSTMENT_LIMIT = 150


class CheckinAnalysisError(Exception):
    pass


def _extract_json(text):
    text = text.strip()
    match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.DOTALL)
    if match:
        text = match.group(1).strip()
    return json.loads(text)


def _build_prompt(profile, week_weight_entries, week_calorie_days, baseline, has_front, has_back):
    weight_lines = "\n".join(f"  - {e['date']}: {e['kg']} kg" for e in week_weight_entries) or "  (none logged)"
    calorie_lines = "\n".join(f"  - {d['date']}: {round(d['calories'])} kcal" for d in week_calorie_days) or "  (none logged)"
    baseline_line = (
        f"A deterministic trend calculation (weight change vs. target rate, calorie adherence) "
        f"already suggests a {baseline['delta']:+d} kcal/day change, reasoning: \"{baseline['reason']}\"."
        if baseline else
        # weekly_adjustment() returns None for two different reasons -- not
        # enough logged data to judge, OR it judged the week as on-track
        # and decided no change is needed. It doesn't distinguish which one
        # happened, so don't claim either specifically here; the raw
        # weight/calorie numbers above are enough for the model to judge
        # for itself either way.
        "The deterministic trend calculation didn't suggest a specific number this week "
        "(either the week looks on-track already, or there wasn't enough logged data to "
        "judge confidently) -- use the raw weigh-ins, calories, and photo(s) above to make "
        "your own call."
    )
    photo_note = {
        (True, True): "The user has also provided front AND back progress photos for today.",
        (True, False): "The user has also provided a front progress photo for today.",
        (False, True): "The user has also provided a back progress photo for today.",
    }.get((has_front, has_back), "")

    return (
        "You are a sports-nutrition coaching assistant inside a fitness app, reviewing a "
        "user's weekly check-in to recommend a small calorie-target adjustment for next week.\n\n"
        f"Goal: {profile.get('aspiration')} weight. Gender: {profile.get('gender')}. "
        f"Current bodyweight: {profile.get('weightKg')} kg.\n\n"
        f"Weigh-ins logged this week:\n{weight_lines}\n\n"
        f"Calories logged this week:\n{calorie_lines}\n\n"
        f"{baseline_line}\n\n"
        f"{photo_note}\n\n"
        + (
            "Look at the photo(s) for visible week-over-week body composition change if this isn't "
            "the user's first check-in with photos (you only have this week's photo(s) to go on, so "
            "judge general leanness/composition, not a before/after comparison) — use it only as a "
            "sanity check alongside the numeric trend, not as the primary signal (a single photo "
            "can't out-weigh a clear multi-day weight trend).\n\n"
            if (has_front or has_back) else ""
        )
        + "Decide a calorie delta for next week: a NEGATIVE number to cut calories (not losing "
        "fast enough while trying to lose, or gaining too fast while trying to gain / maintain), "
        "a POSITIVE number to add calories (losing too fast while trying to lose, gaining too "
        "slowly while trying to gain, or has drifted down while trying to maintain), or 0 if "
        "everything looks on track. You may agree with, or adjust, the deterministic suggestion "
        "above based on the numbers (and photo(s), if provided), but the delta MUST be within "
        f"-{WEEKLY_ADJUSTMENT_LIMIT} to +{WEEKLY_ADJUSTMENT_LIMIT} kcal/day — never outside that "
        "range.\n\n"
        "Respond with ONLY raw JSON (no markdown fences, no commentary) matching exactly this "
        'shape: {"delta": -100, "reason": "One or two plain sentences a non-expert user would '
        'understand, explaining why, mentioning the photo(s) if they influenced the call."}'
    )


def analyze_checkin(profile, week_weight_entries, week_calorie_days, baseline, photo_files):
    """photo_files: list of (bytes, mime_type) tuples -- 0, 1, or 2 items.
    baseline: coaching_engine.weekly_adjustment()'s result dict, or None.
    Returns {"delta": int, "reason": str} with delta clamped to
    +/-WEEKLY_ADJUSTMENT_LIMIT. Raises CheckinAnalysisError on failure --
    callers should fall back to the deterministic baseline instead of
    letting this propagate as a 500.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise CheckinAnalysisError("GEMINI_API_KEY environment variable is not set.")

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        raise CheckinAnalysisError("google-genai package not installed.") from exc

    has_front = len(photo_files) > 0
    has_back = len(photo_files) > 1
    prompt = _build_prompt(profile, week_weight_entries, week_calorie_days, baseline, has_front, has_back)

    try:
        client = genai.Client(api_key=api_key)
        contents = [prompt] + [
            types.Part.from_bytes(data=data, mime_type=mime_type) for data, mime_type in photo_files
        ]
        response = client.models.generate_content(model=GEMINI_MODEL, contents=contents)
        parsed = _extract_json(response.text)
        delta = int(parsed["delta"])
        delta = max(-WEEKLY_ADJUSTMENT_LIMIT, min(WEEKLY_ADJUSTMENT_LIMIT, delta))
        reason = str(parsed.get("reason") or "").strip()[:400]
        if not reason:
            raise CheckinAnalysisError("Empty reason from model.")
        return {"delta": delta, "reason": reason}
    except CheckinAnalysisError:
        raise
    except Exception as exc:
        raise CheckinAnalysisError(f"Couldn't analyze this check-in: {exc}") from exc
