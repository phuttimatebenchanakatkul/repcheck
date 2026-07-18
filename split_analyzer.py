"""Shared workout-split recovery heuristic.

Encodes one explicit training-science rule of thumb: roughly one rest day
for every two consecutive training days, since stringing together long
training streaks without recovery is a common cause of overtraining/injury.
split_planner.py imports this to judge (and, if needed, reject) the weekly
schedule it generates, so the recovery/balance knowledge is applied while
the split is being built rather than in a separate after-the-fact review.
"""

WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def longest_training_streak(schedule):
    """Longest run of consecutive training days in a weekday->label-or-"Rest"
    schedule, wrapping week-to-week (Sunday training into Monday training
    counts as consecutive)."""
    streak = 0
    max_streak = 0
    for day in WEEKDAY_ORDER * 2:
        if schedule.get(day, "Rest") != "Rest":
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
        if max_streak >= 14:
            break
    return max_streak
