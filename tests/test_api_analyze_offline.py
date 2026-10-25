"""The analyze slice's pure parts: feedback sections, the rules it shares with the website, and its input checks.
No network, no database. Where a rule exists in app.py too, the two are compared directly so they cannot drift."""

import dataclasses
import re
from pathlib import Path

import pytest

import app as website
from api import analyze, consent, feedback, limits
from api.settings import Settings, from_env
from importer_loader import imp

FAKE_DB_URL = "postgresql://" + "user:pw" + "@host:6543/postgres"
SETTINGS = Settings(supabase_url="https://abc.supabase.co", service_key="k", db_url=FAKE_DB_URL)

SAMPLES = [
    "## Movement Summary\n- Good depth\n- Knees tracked well\n\n## Positives\n- Strong brace\n\n## Negatives\n- Chest dropped\n- Hips shot up\n"
    "\n## Improvements\n- Slow the descent\n\n## Injury Prevention\n- Watch the lower back\n\n## How to Progress\n- Add 2.5 kg\n",
    "preamble before any heading\n\n## Positives\n- Only one bullet\n",
    "## Negatives\nNo bullets here, just a paragraph with **bold** text.\n",
    "## Positives\n- <script>alert(1)</script> & \"quotes\" 'single'\n- second <b>bold</b>\n",
    "## Some Unknown Heading\n- falls back to improvements\n",
    "",
    "no headings at all",
    "## Movement Summary\n- a\n## Movement Summary\n- b\n",
]


@pytest.mark.parametrize("sample", SAMPLES)
@pytest.mark.parametrize("score", [None, 0, 49, 50, 79, 80, 100])
def test_the_sections_are_exactly_the_websites_apart_from_the_inline_icon(sample, score):
    ours = feedback.split_feedback_sections(sample, score)
    theirs = [{k: v for k, v in s.items() if k != "icon"} for s in website.split_feedback_sections(sample, score)]
    assert ours == theirs
    assert all("icon" not in s for s in ours)


def test_model_text_cannot_inject_html_into_a_section():
    (section,) = feedback.split_feedback_sections("## Positives\n- <script>alert(1)</script>\n", 70)
    assert "<script>" not in section["summary_html"] and "&lt;script&gt;" in section["summary_html"]


@pytest.mark.parametrize("css,score", [(c, s) for c in ("positives", "negatives", "injury", "progress", "summary", "improvements")
                                       for s in (None, 10, 49, 50, 79, 80, 99)])
def test_emphasis_is_the_websites(css, score):
    assert feedback.section_emphasis(css, score) == website.section_emphasis(css, score)


def test_rate_limits_are_the_websites_plus_the_one_it_never_had():
    assert {k: v for k, v in limits.RATE_LIMITS.items() if k in website.RATE_LIMITS} == website.RATE_LIMITS
    assert set(limits.RATE_LIMITS) - set(website.RATE_LIMITS) == {"checkin_analysis"}
    assert limits.RATE_LIMITS["checkin_analysis"] == (5, 24 * 60 * 60)


@pytest.mark.parametrize("seconds", [1, 59, 60, 89, 90, 3599, 3600, 5400, 7199, 7200, 86399, 86400, 90000])
def test_the_wait_wording_is_the_websites(seconds):
    assert limits.friendly_wait(seconds) == website._friendly_wait(seconds)


def test_the_analysis_limit_message_reads_as_it_does_on_the_website():
    assert limits.limit_message("workout_analysis", 86000) == "You've used your 1 workout analysis for now — try again in about 24 hours."
    source = (Path(website.__file__)).read_text(encoding="utf-8")
    assert "You've used your {limit} workout {plural} for now — try again in {_friendly_wait(retry)}." in source


def test_the_consent_message_is_the_websites():
    assert consent.CONSENT_ERROR == website.AI_CONSENT_ERROR


def test_the_upload_rules_are_the_websites():
    assert analyze.ALLOWED_EXTENSIONS == website.ALLOWED_EXTENSIONS and analyze.RECORDED_EXTENSIONS == website.RECORDED_EXTENSIONS
    assert analyze.HISTORY_KEEP == website.ANALYZE_HISTORY_KEEP and analyze.MAX_UPLOAD_BYTES == website.MAX_CONTENT_LENGTH


def test_the_stored_clip_types_are_what_the_bucket_and_the_importer_allow():
    bucket = imp.BUCKETS["analyze-videos"]
    assert analyze.CONTENT_TYPES == bucket["types"]
    assert analyze.MAX_CLIP_BYTES == bucket["limit"]
    assert set(analyze.CONTENT_TYPES) == analyze.ALLOWED_EXTENSIONS | analyze.RECORDED_EXTENSIONS


# -- input checks --------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [("Squat", "Squat"), ("  Barbell Row  ", "Barbell Row"), ("x" * 100, "x" * 100)])
def test_a_reasonable_exercise_name_is_kept_trimmed(raw, expected):
    assert analyze.clean_exercise(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   ", 5, ["Squat"], "bad\x00name", "line\nbreak", "tab\there", "bell\x07"])
def test_a_missing_or_unprintable_exercise_is_refused(raw):
    with pytest.raises(analyze.AnalyzeRejected, match="Please choose an exercise."):
        analyze.clean_exercise(raw)


def test_a_very_long_exercise_name_is_refused():
    with pytest.raises(analyze.AnalyzeRejected, match="too long"):
        analyze.clean_exercise("x" * 101)


@pytest.mark.parametrize("name,suffix", [("set.mp4", ".mp4"), ("SET.MOV", ".mov"), ("a.b.c.webm", ".webm"), ("x.M4V", ".m4v"),
                                         ("x.avi", ".avi"), ("x.mkv", ".mkv")])
def test_every_allowed_extension_is_accepted_in_any_case(name, suffix):
    assert analyze.check_suffix(name) == suffix


@pytest.mark.parametrize("name", ["set.txt", "set", "", None, "set.mp4.exe", ".mp4", "set.mp5", "set.", "set.MP4 ", "set.jpg"])
def test_other_files_are_refused(name):
    # ".mp4" alone has no suffix (it is a hidden file name); "set.MP4 " has a trailing space.
    with pytest.raises(analyze.AnalyzeRejected, match="Unsupported file type"):
        analyze.check_suffix(name)


def test_the_refusal_names_the_allowed_types_but_not_webm_and_never_echoes_long_or_unprintable_input():
    with pytest.raises(analyze.AnalyzeRejected) as exc:
        analyze.check_suffix("set.txt")
    assert str(exc.value) == "Unsupported file type '.txt'. Allowed: .avi, .m4v, .mkv, .mov, .mp4"
    with pytest.raises(analyze.AnalyzeRejected) as exc:
        analyze.check_suffix("set." + "x" * 5000 + "\x01‮")
    assert len(str(exc.value)) < 120 and "‮" not in str(exc.value)


def test_clip_names_are_unique_and_safe_for_a_storage_key():
    names = {analyze.new_clip_name(".mp4") for _ in range(50)}
    assert len(names) == 50 and all(re.fullmatch(r"[0-9a-f]{32}\.mp4", n) for n in names)
    assert analyze.clip_key("u-1", "a.mp4") == "u-1/a.mp4"


# -- exemption -----------------------------------------------------------------------------------------

class Who:
    def __init__(self, email):
        self.email = email


def test_exempt_addresses_come_from_the_environment_lower_cased_and_default_to_nobody(tmp_path):
    base = {"SUPABASE_URL": "https://abc.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k", "SUPABASE_DB_URL": FAKE_DB_URL}
    assert from_env(base, env_file=tmp_path / "none").rate_limit_exempt == frozenset()
    s = from_env(dict(base, ADMIN_EMAILS=" Owner@Example.com ", REVIEW_ACCOUNT_EMAILS="'Reviewer@Example.com, other@example.com'"),
                 env_file=tmp_path / "none")
    assert s.rate_limit_exempt == frozenset({"owner@example.com", "reviewer@example.com", "other@example.com"})


def test_exemption_matches_case_insensitively_and_never_an_account_without_an_email():
    s = dataclasses.replace(SETTINGS, rate_limit_exempt=frozenset({"owner@example.com"}))
    assert limits.is_exempt(s, Who("OWNER@example.com")) is True
    assert limits.is_exempt(s, Who("someone@example.com")) is False
    assert limits.is_exempt(s, Who(None)) is False and limits.is_exempt(s, Who("")) is False
    assert limits.is_exempt(SETTINGS, Who("owner@example.com")) is False, "nobody is exempt unless configured"


def test_a_substring_of_an_exempt_address_is_not_exempt():
    s = dataclasses.replace(SETTINGS, rate_limit_exempt=frozenset({"owner@example.com"}))
    for sneaky in ("xowner@example.com", "owner@example.com.evil.test", "owner@example.co"):
        assert limits.is_exempt(s, Who(sneaky)) is False
