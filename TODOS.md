# TODOS

## Workouts

### A custom day literally named "Rest" hides its own workout

**What:** `isRestLabel(label)` in the split-review step (and the same pattern in `renderWholeSplitBody`, `templates/workouts.html`) is `!label || label === "Rest"`. Day labels are free text on the custom-split path, so nothing stops a user from naming a training day "Rest" verbatim. When they do, the UI treats it as a non-training day -- the drawer shows "Recovery day, nothing scheduled" instead of the real exercise list, and the grid cell renders with the dashed rest style, even though `plan.days` still has real exercises stored for it.

**Why:** Silent content loss from the user's own perspective -- their workout is saved but effectively unreachable through either review UI. Low likelihood (a user has to type "Rest" as a training day name, the semantic opposite of what they'd normally type) but zero validation prevents it.

**Context:** Found during adversarial review of the split-review-redesign. Pre-existing pattern (the literal-string-as-sentinel collision already exists in `renderWholeSplitBody`, unrelated to this PR), but the redesign is the first place this collision actively hides content rather than just mis-selecting a `<select>` option. Root cause is that "Rest" the sentinel and "Rest" a valid custom day name share the same string namespace with no way to distinguish them -- a real fix likely means either disallowing "Rest" (case-insensitive) as a custom day name at creation time, or moving the sentinel to a value no user input can produce (e.g. `null` instead of the string `"Rest"`, which would touch the saved-plan schema and everything downstream that reads it).

**Effort:** M (touches the saved-plan schema if done properly)
**Priority:** P3
**Depends on:** None

### Weekday grid tap targets are below Apple's 44px touch guideline

**What:** The 7-cell weekday grid in the split-review "Assign your week" screen (`.split-week-cell` in `templates/workouts.html`) renders at roughly 28-36px square on real phone widths (320-375px) -- the primary interactive control of that screen.

**Why:** Small miss-taps on the most-used control of a brand-new screen. Clears WCAG 2.2 AA's 24px minimum, but not Apple's stricter 44px HIG recommendation.

**Context:** Flagged by the design specialist during the split-review-redesign ship review, confirmed by hand-computing the actual rendered width (modal padding + grid padding + 6px gaps across 7 columns leaves ~28.6px per cell at 320px). Fitting 7 columns of 44px cells plus gaps needs more horizontal room than a 320px phone has inside the current modal chrome, so a real fix means either extending the tappable hit-area beyond the visible swatch (padding trick, doesn't shrink the swatch) or reworking the layout (e.g. fewer visible columns with horizontal scroll). Not done at ship time because it's a layout change, not a quick CSS tweak, and the review found it late.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Colorblind fallback when abbreviation AND accent collide

**What:** When two day labels collide as prefixes (e.g. "Push" / "Push Day"), both abbreviate to the same 2 letters. If their accent colours also repeat (6+ unique custom day types, since `DAY_ACCENTS` only has 5 entries), a colorblind user sees two visually identical grid cells with no way to tell them apart.

**Why:** Real accessibility gap, but narrow -- needs a prefix collision AND 6+ custom day types AND colorblindness stacked together.

**Context:** Flagged by the design specialist during the split-review-redesign ship review. The accent-repeat-past-5 behavior itself is intentionally documented (not hidden) via `tests-js/reviewStep.test.js`'s "assigns a distinct accent... reused past 5 via modulo" test. A real fix adds a secondary differentiator (dot, pattern, or a wider accent palette) for the collision case in `renderSplitStepReview()` (`templates/workouts.html`).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Two magic-number/duplication cleanups in the split review step

**What:** `REVIEW_MONDAY_FIRST` (`templates/workouts.html`) is a byte-for-byte duplicate of the pre-existing `SPLIT_VIEW_MONDAY_FIRST` used by `renderWholeSplitBody`. `REVIEW_WEEKDAY_NAME_INDEX = [1,2,3,4,5,6,0]` is a hand-written lookup table where `renderWholeSplitBody` computes the same Monday-first-to-Sunday-indexed mapping dynamically via `WEEKDAY_KEYS.indexOf(key)`.

**Why:** Two copies of the same weekday-ordering fact can silently drift if one is ever edited without the other. Zero behavior change to fix, pure maintainability.

**Context:** Flagged by the maintainability specialist during the split-review-redesign ship review. Deferred because consolidating `REVIEW_MONDAY_FIRST` means touching `renderWholeSplitBody`, which the split-review PR doesn't otherwise touch and its test suite doesn't cover; and `REVIEW_WEEKDAY_NAME_INDEX`'s literal value is currently pinned by an assertion in `tests/test_split_review_step.py`, so switching to the dynamic form means updating that test too. Low risk, but not worth doing in the same PR that just fixed a real bug in the adjacent `labelAbbrev` logic.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Decide what tap-to-cycle should do when it orphans a training day

**What:** In the split-review screen, tapping the already-selected weekday cell cycles its assignment through every unique day label plus Rest. Nothing stops a user from cycling every day to Rest, or cycling away the only weekday scheduled for a given training day -- that day's exercises stay in `plan.days` but become unreachable via `plan.schedule`.

**Why:** This is a product decision, not a confirmed bug -- a user might legitimately decide they don't want a given training day this week. But it's currently silent either way: no warning, no indication a day type has become unscheduled.

**Context:** Surfaced by the original coverage audit for the split-review-redesign ship. `tests-js/reviewStep.test.js`'s "cycling a day that trains 0 times after wrapping does not throw" test pins that the mechanism doesn't crash, deliberately without asserting the *outcome* is desirable. Needs a product call: leave as-is (user's own choice), warn when a day type becomes fully unscheduled, or prevent the last instance of a day type from being cycled away.

**Effort:** S (once the desired behavior is decided)
**Priority:** P3
**Depends on:** A product decision on the intended behavior

## i18n

### Thai translation missing for the wizard's location step

**What:** 8 keys under `workouts.wizard.location.*` (plus `locationTitle` and `stepLocation`) have English text but no Thai translation -- a Thai user sees the raw i18n key rendered on "Where do you usually train?".

**Why:** User-visible: Thai users hit un-translated UI on a step every AI-suggested split still goes through.

**Context:** Pre-existing gap, predates the split-review-redesign and self-build location-skip work. Confirmed missing and deliberately deferred when `tests/test_i18n_key_parity.py` was added (see `KNOWN_MISSING_THAI` in that file, which has its own test pinning the list so a real fix doesn't go unnoticed). To fix: translate the 8 keys in `static/i18n.js`'s Thai locale block, then remove them from `KNOWN_MISSING_THAI`.

**Effort:** S
**Priority:** P2
**Depends on:** None
