"""AI race analysis for a finished (or past) HYROX race.

Given the per-segment split times of one race, produces a short overall
read plus a one-line, practical improvement tip for each of the 8
functional stations -- "where did your time actually go, and what's the
single highest-leverage thing to work on next."

Separate small module in the same spirit as analyze_chat.py / coach_chat.py:
its only job is turning one race's splits into coaching, so its prompt and
its own session rate limit can evolve without tangling with the other AI
features. Nothing is stored server-side; the client sends the whole race
on each request, exactly like the other two modules re-send their context.
"""

import json
import os
import time

from dotenv import load_dotenv
from flask import session

load_dotenv()

GEMINI_MODEL = "gemini-3.1-flash-lite"

# The 8 functional stations, in race order, with their canonical keys --
# tips are returned keyed by these so the client can line each tip up with
# the station it already rendered. Runs are given to the model as context
# (half the race is running) but aren't individually tipped here.
STATION_KEYS = [
    "skierg", "sledPush", "sledPull", "burpeeBroadJump",
    "row", "farmersCarry", "lunges", "wallBalls",
]
STATION_TITLES = {
    "skierg": "SkiErg",
    "sledPush": "Sled Push",
    "sledPull": "Sled Pull",
    "burpeeBroadJump": "Burpee Broad Jumps",
    "row": "Rowing",
    "farmersCarry": "Farmers Carry",
    "lunges": "Sandbag Lunges",
    "wallBalls": "Wall Balls",
}

VALID_RATINGS = {"strong", "solid", "focus"}

# Independent per-session budget: analyzing races shouldn't share (or be
# blocked by) the Analyze-page or Coach chat limits.
SESSION_ANALYSIS_LIMIT = 8
SESSION_WINDOW_SECONDS = 5 * 60 * 60  # 5 hours


def _format_wait(seconds_left):
    seconds_left = max(seconds_left, 0)
    hours, remainder = divmod(seconds_left, 3600)
    minutes = remainder // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{max(minutes, 1)}m"


def _check_session_limit():
    """Session-cookie rate limit, resets itself once the window elapses.
    Returns (allowed, seconds_until_reset)."""
    now = time.time()
    window_start = session.get("hyrox_analysis_window_start")
    count = session.get("hyrox_analysis_count", 0)

    if window_start is None or now - window_start >= SESSION_WINDOW_SECONDS:
        window_start = now
        count = 0

    if count >= SESSION_ANALYSIS_LIMIT:
        return False, int(SESSION_WINDOW_SECONDS - (now - window_start))

    session["hyrox_analysis_window_start"] = window_start
    session["hyrox_analysis_count"] = count + 1
    return True, 0


def _clock(seconds):
    seconds = max(0, int(round(seconds)))
    m, s = divmod(seconds, 60)
    return f"{m}:{s:02d}"


MAX_DETAIL_BULLETS = 5


def _neutral_tips():
    """Used when Gemini is unreachable -- keeps the same shape the client
    expects so the UI still renders (just without AI-authored copy)."""
    return [
        {"key": key, "rating": "solid", "tip": "", "detail": []}
        for key in STATION_KEYS
    ]


def _build_prompt(race):
    race = race or {}
    category = str(race.get("category") or "open").title()
    fmt = str(race.get("format") or "singles").title()
    gender = str(race.get("gender") or "").title() or "unspecified"
    total = _clock(race.get("total_seconds") or 0)

    segments = race.get("segments") or []
    run_lines = []
    station_lines = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        seconds = seg.get("seconds")
        if not isinstance(seconds, (int, float)):
            continue
        title = str(seg.get("title") or seg.get("key") or "").strip()
        if seg.get("type") == "run":
            run_lines.append(f"- {title}: {_clock(seconds)}")
        else:
            key = str(seg.get("key") or "").strip()
            station_lines.append(f"- {title} (key: {key}): {_clock(seconds)}")

    runs_block = "\n".join(run_lines) if run_lines else "(no run splits recorded)"
    stations_block = "\n".join(station_lines) if station_lines else "(no station splits recorded)"

    keys_csv = ", ".join(STATION_KEYS)

    return (
        f"You are RepCheck's HYROX race coach. A HYROX race is eight 1km runs "
        f"alternating with eight functional stations. Below is one athlete's "
        f"race, broken down by how long each segment took. Analyze where their "
        f"time actually went and give focused, practical coaching to help them "
        f"finish faster next time.\n\n"
        f"Race: {gender} {category} {fmt} · total {total}\n\n"
        f"Runs:\n{runs_block}\n\n"
        f"Stations:\n{stations_block}\n\n"
        f"Return ONLY a JSON object with this exact shape:\n"
        f"{{\n"
        f'  "overall": "ONE short, precise, direct sentence naming the single '
        f'biggest opportunity to save time. No warm-up filler, no fluff -- get '
        f'straight to the point.",\n'
        f'  "overall_detail": [\n'
        f'    "2-5 short bullet points expanding on \\"overall\\": where the '
        f'time actually went (slowest stations, running vs stations), why it '
        f'likely happened, and the priority order to fix it. This is the fuller '
        f'explanation for someone who taps to read more."\n'
        f"  ],\n"
        f'  "tips": [\n'
        f'    {{\n'
        f'      "key": "<station key>",\n'
        f'      "rating": "strong|solid|focus",\n'
        f'      "tip": "ONE short, precise, direct sentence -- the single most '
        f'actionable cue for THIS station. No fluff.",\n'
        f'      "detail": [\n'
        f'        "2-4 short bullet points with deeper coaching for this '
        f'station: technique cues, pacing, common mistakes, strategy -- the '
        f'fuller version for someone who taps to read more."\n'
        f"      ]\n"
        f"    }}\n"
        f"  ]\n"
        f"}}\n\n"
        f"Rules:\n"
        f"- Include exactly one tips entry for EACH of these 8 station keys: {keys_csv}.\n"
        f"- rating: 'strong' = one of their fastest/best stations, 'focus' = one "
        f"of the biggest time-loss opportunities, 'solid' = fine, in between. "
        f"Base this on the actual split times above relative to the rest of "
        f"their race.\n"
        f"- Keep \"overall\" and every \"tip\" SHORT, PRECISE, and DIRECT -- one "
        f"sentence each, no throat-clearing, no repeating what the bullets "
        f"below already say.\n"
        f"- Bullets in \"overall_detail\" and each tip's \"detail\" are short "
        f"phrases or sentences, concrete and doable (a cue, a pacing idea, a "
        f"grip/technique fix, a strategy) -- not generic 'train more'.\n"
        f"- Absolutely no clinical jargon anywhere. Write like an encouraging "
        f"human coach talking to a friend, not a physiologist.\n"
        f"- Do not include any text outside the JSON object."
    )


def _coerce_bullets(raw):
    """Normalizes whatever Gemini put in a "detail"/"overall_detail" field
    into a clean list of short strings, capped and tolerant of junk."""
    if not isinstance(raw, list):
        return []
    bullets = []
    for item in raw:
        text = str(item or "").strip()
        if text:
            bullets.append(text)
        if len(bullets) >= MAX_DETAIL_BULLETS:
            break
    return bullets


def _coerce_result(raw_text):
    """Parse Gemini's JSON and normalize it into the exact shape the client
    expects: a short overall + its detail bullets, and exactly one tip
    (short + detail bullets) per station key, in the canonical station
    order. Tolerant of missing/extra keys."""
    overall = ""
    overall_detail = []
    tips_by_key = {}
    try:
        data = json.loads(raw_text)
        if isinstance(data, dict):
            overall = str(data.get("overall") or "").strip()
            overall_detail = _coerce_bullets(data.get("overall_detail"))
            for entry in data.get("tips") or []:
                if not isinstance(entry, dict):
                    continue
                key = str(entry.get("key") or "").strip()
                if key not in STATION_KEYS:
                    continue
                rating = str(entry.get("rating") or "solid").strip().lower()
                if rating not in VALID_RATINGS:
                    rating = "solid"
                tips_by_key[key] = {
                    "key": key,
                    "rating": rating,
                    "tip": str(entry.get("tip") or "").strip(),
                    "detail": _coerce_bullets(entry.get("detail")),
                }
    except (ValueError, TypeError):
        pass

    tips = [
        tips_by_key.get(key, {"key": key, "rating": "solid", "tip": "", "detail": []})
        for key in STATION_KEYS
    ]
    return overall, overall_detail, tips


def get_hyrox_race_analysis(race):
    allowed, seconds_left = _check_session_limit()
    if not allowed:
        return {
            "overall": (
                f"You've analyzed {SESSION_ANALYSIS_LIMIT} races this session. "
                f"Come back in about {_format_wait(seconds_left)} for more."
            ),
            "overall_detail": [],
            "tips": _neutral_tips(),
            "limited": True,
            "retry_after_seconds": seconds_left,
        }

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {
            "overall": "",
            "overall_detail": [],
            "tips": _neutral_tips(),
            "limited": False,
            "retry_after_seconds": 0,
        }

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=_build_prompt(race),
            config=types.GenerateContentConfig(
                temperature=0.4,
                response_mime_type="application/json",
            ),
        )
        overall, overall_detail, tips = _coerce_result((response.text or "").strip())
    except Exception:
        overall, overall_detail, tips = "", [], _neutral_tips()

    return {
        "overall": overall,
        "overall_detail": overall_detail,
        "tips": tips,
        "limited": False,
        "retry_after_seconds": 0,
    }
