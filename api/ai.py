"""What the AI routes share: reserving and releasing a use of a metered feature, usage counters, and the backends that
actually call Gemini.

The backends are plain callables, handed to the app so tests can replace them (no Gemini call, no cost, no flakiness).
The defaults import the website's pure-logic modules lazily, on first use, so a process that never calls the AI does not
pay for the Gemini client or OpenCV.

Each backend reports `failed: True` in its result when the model could not be reached or gave nothing usable (those
modules swallow errors and answer with a fallback). The routes use it to refund the use: a failed call never burns one of
a person's scarce messages. The website recorded the use whatever happened.
"""

import importlib
import logging
import os
from dataclasses import dataclass
from typing import Callable

from . import limits

log = logging.getLogger(__name__)


def reserve(svc, identity, feature):
    """Spend one use of `feature` for this person (nothing for an exempt account). See limits.reserve."""
    if limits.is_exempt(svc.settings, identity):
        return limits.EXEMPT
    with svc.db.connection() as conn:
        return limits.reserve(conn, identity.id, feature)


def release(svc, user_id, feature, reservation):
    """Give a reserved use back. Never raises: a failed refund must not mask the failure that caused it."""
    try:
        with svc.db.connection() as conn:
            limits.refund(conn, user_id, feature, reservation)
    except Exception:                                    # noqa: BLE001
        log.exception("could not refund a %s use for %s", feature, user_id)


def track(svc, user_id, event):
    """Lifetime counter for the admin view. Best-effort: losing a counter must not fail a request that succeeded."""
    try:
        with svc.db.connection() as conn:
            limits.track_usage(conn, user_id, "feature:" + event)
    except Exception:                                    # noqa: BLE001
        log.exception("could not count %s for %s", event, user_id)


# -- the backends --------------------------------------------------------------------------------------------

def _chat_backend(module_name, function_name, takes_context):
    def call(message, history, context):
        module = importlib.import_module(module_name)
        function = getattr(module, function_name)
        result = dict(function(message, history, context) if takes_context else function(message, history))
        result["failed"] = result.get("reply") == module._fallback_reply()
        return result
    return call


_session_shim = None


def _hyrox_backend(race):
    """hyrox_coach keeps a per-session budget in Flask's cookie session, which this cookie-less API does not have (the
    per-account limit replaces it). A throwaway request context gives it an empty session each time, so its own budget
    never trips and the module stays byte-for-byte the website's."""
    global _session_shim
    import hyrox_coach
    if _session_shim is None:
        from flask import Flask
        _session_shim = Flask("hyrox-session-shim")
        _session_shim.secret_key = os.urandom(32)
    with _session_shim.test_request_context():
        result = dict(hyrox_coach.get_hyrox_race_analysis(race))
    result["failed"] = (not result.get("limited") and not result.get("overall")
                        and not any(t.get("tip") for t in result.get("tips", [])))
    return result


class AnalysisFailed(Exception):
    """The food-photo model could not analyze the picture (the website's FoodAnalysisError)."""


class ProductNotFound(Exception):
    """No barcode database knows this product: a normal outcome, answered as a 200 so the app can offer to create it."""


class LookupFailed(Exception):
    """A barcode could not be read, or a lookup service failed (the website's BarcodeScanError). The message is safe to show."""


def _analyze_food(image_bytes, mime_type, note):
    from analyze_food_gemini import FoodAnalysisError, analyze_food_photo
    try:
        return analyze_food_photo(image_bytes, mime_type=mime_type, note=note)
    except FoodAnalysisError as exc:
        raise AnalysisFailed(str(exc)) from exc


def _decode_barcode(image_bytes):
    from barcode_scanner import BarcodeScanError, decode_barcode
    try:
        return decode_barcode(image_bytes)
    except BarcodeScanError as exc:
        raise LookupFailed(str(exc)) from exc


def _lookup_barcode(barcode):
    from barcode_scanner import BarcodeScanError, ProductNotFoundError, lookup_by_barcode
    try:
        return lookup_by_barcode(barcode)
    except ProductNotFoundError as exc:               # first: it is a kind of BarcodeScanError
        raise ProductNotFound(str(exc)) from exc
    except BarcodeScanError as exc:
        raise LookupFailed(str(exc)) from exc


def _search_foods(query):
    from barcode_scanner import BarcodeScanError, search_open_food_facts
    try:
        return search_open_food_facts(query, limit=12)
    except BarcodeScanError as exc:
        raise LookupFailed(str(exc)) from exc


def _suggest_split(*args, **kwargs):
    from split_planner import suggest_split_plan
    return suggest_split_plan(*args, **kwargs)


def _build_split(*args, **kwargs):
    from split_planner import generate_split_plan
    return generate_split_plan(*args, **kwargs)


def _checkin(*args, **kwargs):
    from checkin_analyzer import analyze_checkin
    return analyze_checkin(*args, **kwargs)


@dataclass
class Backends:
    coach: Callable              # (message, history, context) -> {reply, sources, failed}
    analysis_chat: Callable
    workout_chat: Callable
    hyrox: Callable              # (race) -> {overall, overall_detail, tips, limited, retry_after_seconds, failed}
    suggest_split: Callable      # (days, goal=, gender=, goal_weight_kg=, current_weight_kg=, location=) -> plan
    build_split: Callable        # (split_type, days, custom_days, goal, custom_days_exercises, location) -> plan
    checkin: Callable            # (profile, targets, weights, calories, baseline, photos) -> {delta, reason}; raises on failure
    analyze_food: Callable       # (image_bytes, mime_type, note) -> result dict; raises AnalysisFailed
    decode_barcode: Callable     # (image_bytes) -> digits; raises LookupFailed
    lookup_barcode: Callable     # (digits) -> result dict; raises ProductNotFound / LookupFailed
    search_foods: Callable       # (query) -> list; raises LookupFailed


def default_backends():
    return Backends(
        coach=_chat_backend("coach_chat", "get_coach_reply", takes_context=False),
        analysis_chat=_chat_backend("analyze_chat", "get_analysis_chat_reply", takes_context=True),
        workout_chat=_chat_backend("workout_chat", "get_workout_chat_reply", takes_context=True),
        hyrox=_hyrox_backend,
        suggest_split=_suggest_split,
        build_split=_build_split,
        checkin=_checkin,
        analyze_food=_analyze_food,
        decode_barcode=_decode_barcode,
        lookup_barcode=_lookup_barcode,
        search_foods=_search_foods,
    )
