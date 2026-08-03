"""Guards the form-scoring contract inside the Gemini prompt.

Why this file exists
--------------------
The analyzer handed out 80-90 scores to bad-form sets. 013f3cb fixed that
by adding calibrated score bands plus HARD RULES to the prompt, and it was
verified working. It then silently regressed.

Nothing reverted the fix. 31c2040 ("shorter AI feedback") added a
presentation rule -- "limit every section to at most 3 bullets" -- to make
the report readable on a phone. But the sub-50 hard rule was written to
trigger when the faults *listed* under Negatives/Injury outweighed the
ones *listed* under Positives. Capping every section to the same handful
of bullets meant a genuinely bad set could no longer list more faults than
strengths, so the trigger stopped firing and scores drifted back up.

Two reasonable edits, in different commits, that combine into a broken
scoring contract. No test caught it because grading only happens inside a
paid API call nobody runs on every commit.

These tests are cheap and offline: build_prompt() is pure, so they assert
the contract the model is given, not the score it returns. They cannot
prove the model obeys the prompt -- only a real clip does that. What they
do prove is that a future copy edit cannot quietly delete the rules or
re-introduce a presentation limit that outranks them.
"""

import pytest

from analyze_form_gemini import EXERCISES, build_prompt


def _prompts():
    """One built prompt per exercise, so a config-specific gap can't hide."""
    return {name: build_prompt(cfg, 20) for name, cfg in EXERCISES.items()}


@pytest.fixture(scope="module")
def prompts():
    return _prompts()


def test_exercises_actually_present():
    # Guards the tests themselves: an empty EXERCISES dict would make every
    # per-exercise assertion below vacuously pass.
    assert EXERCISES, "EXERCISES is empty -- the contract tests would all no-op"


def test_score_bands_are_calibrated(prompts):
    """Without bands, "80" is just the model's default politeness."""
    for name, prompt in prompts.items():
        assert "90-100" in prompt, f"{name}: top score band missing"
        assert "0-29" in prompt, f"{name}: bottom score band missing"


def test_hard_rules_block_present(prompts):
    for name, prompt in prompts.items():
        assert "HARD RULES" in prompt, f"{name}: HARD RULES block missing"


def test_bad_sets_are_forced_below_fifty(prompts):
    """The rule that stops a warning-heavy report carrying a 75+ score."""
    for name, prompt in prompts.items():
        assert "OVERALL_SCORE MUST be below 50" in prompt, (
            f"{name}: the sub-50 rule for fault-heavy sets is gone. This is the "
            "exact regression that let bad-form sets score 90."
        )


def test_partial_reps_cap_range_of_motion_score(prompts):
    for name, prompt in prompts.items():
        assert "45 or lower" in prompt, (
            f"{name}: partial-rep cap missing -- half reps could score 80 again"
        )


def test_wrong_exercise_is_scored_down(prompts):
    for name, prompt in prompts.items():
        assert "25 or" in prompt, (
            f"{name}: wrong-exercise rule missing -- the analyzer would quietly "
            "grade whatever movement was performed instead"
        )


def test_grading_is_decoupled_from_what_gets_written(prompts):
    """The actual regression, asserted directly.

    The sub-50 trigger must key off what the model OBSERVED. If it keys off
    what it prints, any length limit silently defuses it.
    """
    for name, prompt in prompts.items():
        assert "Grade what you OBSERVED" in prompt, (
            f"{name}: grading is no longer explicitly tied to observation. If the "
            "sub-50 rule counts printed bullets again, a length limit will "
            "silently disable it -- see this module's docstring."
        )


def test_presentation_limits_cannot_soften_the_score(prompts):
    """If the prompt limits length, it MUST say that limit is not a grading input.

    This is the guard proper. Adding a new brevity rule is fine; adding one
    without scoping it away from scoring is how this broke last time.
    """
    limit_markers = ("at most 3 bullets", "no more than", "under about 18 words")
    for name, prompt in prompts.items():
        if not any(marker in prompt for marker in limit_markers):
            continue  # no length limit in play, nothing to scope
        assert "has no effect on grading" in prompt, (
            f"{name}: the prompt limits how much gets written but never says that "
            "limit is excluded from scoring. That combination is what caused the "
            "regression -- scope the new limit, or the score drifts back up."
        )
