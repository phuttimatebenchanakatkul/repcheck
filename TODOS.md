# TODOS

## Workouts

### Edited sets/reps in the review step's exercise editor are a write-only round-trip

**What:** The new per-exercise sets/reps editor (`templates/workouts.html`, `renderSplitStepReview()`'s carousel) saves `exercisePrescriptions` into the plan's localStorage blob on Save, but nothing in the app ever reads it back. `renderTodaysPlanCard()` and `renderWholeSplitBody()` (the "Today's Plan" card and the saved-split view) compute displayed sets/reps purely via `getSetsRepsText(name)` -- the generic movement-pattern bucket -- never consulting `plan.exercisePrescriptions`. `openEditSplitModal()` (re-opening "Edit split" on an existing plan) rehydrates `splitWizard` from the saved plan's `days`/`goal`/etc. but never reads `exercisePrescriptions` back into the in-memory map, and `renderSplitStepReview()` unconditionally resets it to `{}` on every entry regardless of whether the plan already had customizations.

**Why:** A user can tap an exercise, edit sets/reps, watch the box turn amber ("edited"), tap Save -- and that customization is never shown anywhere again. Re-opening "Edit split" silently discards it with no warning. The amber-highlight/reset-to-standard UI strongly implies the intent was for this to be the plan's real, persisted sets/reps, not a value that's saved but functionally inert.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/assign-week-carousel`. Not fixed in that branch because closing the loop is a product decision, not a one-line fix: does `getSetsRepsText`'s "N sets • X-Y reps" range-display format even make sense to replace with a specific `sets×reps` once customized? Does `openEditSplitModal()` need to seed `exercisePrescriptions` from the saved plan, and does the exact-match `prescriptionKey(label, name)` lookup still make sense once a plan has been edited and re-saved (label reuse across regenerations)?

**Effort:** M
**Priority:** P2
**Depends on:** None

### Same exercise appearing twice in one generated day would share one prescription

**What:** `getPrescription(label, name)` (`templates/workouts.html`) keys only by `(label, name)`. If `day.exercises` ever contains the same exercise name twice for one day, both instances would share one prescription object and edit in lockstep with no UI indication. The self-build exercise picker structurally prevents this (uses a `Set`), but the AI-suggest path's generated days (`split_planner.py`, not audited here) haven't been checked for whether the server can ever emit a duplicate exercise name within one day.

**Why:** Low-probability, not attacker-facing (the user's own data), but would read as a confusing bug if it ever happened -- editing one instance's sets/reps would silently change the other's too.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/assign-week-carousel`. Needs a check against `split_planner.py`'s generation logic, which is outside that branch's changed files.

**Effort:** S (once confirmed whether it can actually happen)
**Priority:** P3
**Depends on:** None

### Rapid double-tap on a sheet-opening button can leak a scroll-lock

**What:** `window.openBottomSheet()` (`base.html`) defers adding its `is-open` class by two `requestAnimationFrame` calls (a standard technique to force a reflow before the CSS transition starts). Any code that guards against double-opening by checking for that class -- e.g. `openSplitModalOverlay()` in `templates/workouts.html` -- has a ~16-33ms window where a second call won't see it yet, double-incrementing `window.__pcSheetLockCount`. Since it's only ever decremented once per close, this leaves body scroll locked (`position: fixed`) permanently after the sheet closes, recoverable only by a page reload.

**Why:** Narrow (needs a real double-tap faster than ~2 animation frames on the exact same button) and low-consequence (a stuck scroll, not data loss), but it's a shared-infrastructure gap, not specific to one sheet -- every sheet in the app that opens via a single button tap has this same exposure, not just the split modal.

**Context:** Surfaced during the split-modal-shrink-regression fix's pre-landing review. Not fixed there since it's pre-existing behavior of `openBottomSheet` itself, not something that PR introduced, and fixing it properly means either debouncing the open button at the click-handler level or making `openBottomSheet` idempotent synchronously (e.g. an immediate "opening" flag set before the rAF pair, not gated on the class the rAFs add).

**Effort:** S
**Priority:** P4
**Depends on:** None

### A custom day literally named "Rest" hides its own workout

**What:** `isRestLabel(label)` in the split-review step (and the same pattern in `renderWholeSplitBody`, `templates/workouts.html`) is `!label || label === "Rest"`. Day labels are free text on the custom-split path, so nothing stops a user from naming a training day "Rest" verbatim. When they do, the UI treats it as a non-training day -- the drawer shows "Recovery day, nothing scheduled" instead of the real exercise list, and the grid cell renders with the dashed rest style, even though `plan.days` still has real exercises stored for it.

**Why:** Silent content loss from the user's own perspective -- their workout is saved but effectively unreachable through either review UI. Low likelihood (a user has to type "Rest" as a training day name, the semantic opposite of what they'd normally type) but zero validation prevents it.

**Context:** Found during adversarial review of the split-review-redesign. Pre-existing pattern (the literal-string-as-sentinel collision already exists in `renderWholeSplitBody`, unrelated to this PR), but the redesign is the first place this collision actively hides content rather than just mis-selecting a `<select>` option. Root cause is that "Rest" the sentinel and "Rest" a valid custom day name share the same string namespace with no way to distinguish them -- a real fix likely means either disallowing "Rest" (case-insensitive) as a custom day name at creation time, or moving the sentinel to a value no user input can produce (e.g. `null` instead of the string `"Rest"`, which would touch the saved-plan schema and everything downstream that reads it).

**Effort:** M (touches the saved-plan schema if done properly)
**Priority:** P3
**Depends on:** None

### Weekday grid tap targets are below Apple's 44px touch guideline

**Fixed by /qa on feat/assign-week-carousel, 2026-08-13** -- resolved by removal, not a direct fix. The "Assign your week" screen no longer has a weekday grid at all: `renderSplitStepReview()` was redesigned into a one-day-at-a-time carousel, and `.split-week-cell` no longer exists in `templates/workouts.html`. The carousel's own controls have a different (better, though not perfect) sizing profile: `.split-carousel-arrow` is 34px, and day-to-day jumps have two paths -- the arrows, or the new 8px `.split-carousel-dot` row (a secondary/supplementary way to jump directly to a day, not the primary interaction). The dots are below the 44px guideline too, but as optional pagination affordances behind a same-purpose 34px primary control, this is a materially smaller gap than the old grid being users' *only* way to assign a day. Not re-opened as a fresh TODO since it's a common, accepted mobile pattern (photo-gallery-style pagination dots) rather than the primary control missing a target size.

~~**What:** The 7-cell weekday grid in the split-review "Assign your week" screen (`.split-week-cell` in `templates/workouts.html`) renders at roughly 28-36px square on real phone widths (320-375px) -- the primary interactive control of that screen.~~

~~**Why:** Small miss-taps on the most-used control of a brand-new screen. Clears WCAG 2.2 AA's 24px minimum, but not Apple's stricter 44px HIG recommendation.~~

~~**Context:** Flagged by the design specialist during the split-review-redesign ship review, confirmed by hand-computing the actual rendered width (modal padding + grid padding + 6px gaps across 7 columns leaves ~28.6px per cell at 320px). Fitting 7 columns of 44px cells plus gaps needs more horizontal room than a 320px phone has inside the current modal chrome, so a real fix means either extending the tappable hit-area beyond the visible swatch (padding trick, doesn't shrink the swatch) or reworking the layout (e.g. fewer visible columns with horizontal scroll). Not done at ship time because it's a layout change, not a quick CSS tweak, and the review found it late.~~

**Effort:** M
**Priority:** P2 (resolved)
**Depends on:** None

### Colorblind fallback when abbreviation AND accent collide

**Fixed by /qa on feat/assign-week-carousel, 2026-08-13** -- resolved by removal. The `labelAbbrev` text-abbreviation mechanism this TODO describes no longer exists; `renderSplitStepReview()`'s carousel redesign dropped it entirely. The current UI never asks a user to distinguish two day types by a 1-2 letter abbreviation -- the day pill always spells out the full label as text (`Push`, `Push Day`, etc.), so a colorblind user reads the actual label rather than relying on color or an ambiguous abbreviation. The underlying `DAY_ACCENTS` 5-color-repeat-past-5 behavior is unchanged (still applies to dot colors), but color is now purely decorative/supplementary, not load-bearing for distinguishing days the way an ambiguous letter pair was.

~~**What:** When two day labels collide as prefixes (e.g. "Push" / "Push Day"), both abbreviate to the same 2 letters. If their accent colours also repeat (6+ unique custom day types, since `DAY_ACCENTS` only has 5 entries), a colorblind user sees two visually identical grid cells with no way to tell them apart.~~

~~**Why:** Real accessibility gap, but narrow -- needs a prefix collision AND 6+ custom day types AND colorblindness stacked together.~~

~~**Context:** Flagged by the design specialist during the split-review-redesign ship review. The accent-repeat-past-5 behavior itself is intentionally documented (not hidden) via `tests-js/reviewStep.test.js`'s "assigns a distinct accent... reused past 5 via modulo" test. A real fix adds a secondary differentiator (dot, pattern, or a wider accent palette) for the collision case in `renderSplitStepReview()` (`templates/workouts.html`).~~

**Effort:** S
**Priority:** P3 (resolved)
**Depends on:** None

### Two magic-number/duplication cleanups in the split review step

**What:** `REVIEW_MONDAY_FIRST` (`templates/workouts.html`) is a byte-for-byte duplicate of the pre-existing `SPLIT_VIEW_MONDAY_FIRST` used by `renderWholeSplitBody`. `REVIEW_WEEKDAY_NAME_INDEX = [1,2,3,4,5,6,0]` is a hand-written lookup table where `renderWholeSplitBody` computes the same Monday-first-to-Sunday-indexed mapping dynamically via `WEEKDAY_KEYS.indexOf(key)`.

**Why:** Two copies of the same weekday-ordering fact can silently drift if one is ever edited without the other. Zero behavior change to fix, pure maintainability.

**Context:** Flagged by the maintainability specialist during the split-review-redesign ship review. Deferred because consolidating `REVIEW_MONDAY_FIRST` means touching `renderWholeSplitBody`, which the split-review PR doesn't otherwise touch and its test suite doesn't cover; and `REVIEW_WEEKDAY_NAME_INDEX`'s literal value is currently pinned by an assertion in `tests/test_split_review_step.py`, so switching to the dynamic form means updating that test too. Low risk, but not worth doing in the same PR that just fixed a real bug in the adjacent `labelAbbrev` logic.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Decide what tap-to-cycle should do when it orphans a training day

**What:** In the split-review screen, tapping the day pill (formerly: tapping the already-selected weekday grid cell, before the carousel redesign of 2026-08-13) cycles its assignment through every unique day label plus Rest. Nothing stops a user from cycling every day to Rest, or cycling away the only weekday scheduled for a given training day -- that day's exercises stay in `plan.days` but become unreachable via `plan.schedule`.

**Why:** This is a product decision, not a confirmed bug -- a user might legitimately decide they don't want a given training day this week. But it's currently silent either way: no warning, no indication a day type has become unscheduled.

**Context:** Surfaced by the original coverage audit for the split-review-redesign ship. `tests-js/reviewStep.test.js`'s "cycles through every unique label then Rest, then wraps back" test pins that normal cycling doesn't crash, but (unlike the pre-carousel test this replaced) doesn't specifically assert the orphan/0-instances-scheduled edge case, deliberately without asserting the *outcome* is desirable. Needs a product call: leave as-is (user's own choice), warn when a day type becomes fully unscheduled, or prevent the last instance of a day type from being cycled away.

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

## Nutrition

### Nutrition log entries aren't validated for numeric shape server-side

**What:** `POST /api/nutrition/log-entry` (`app.py`'s `api_nutrition_log_entry()`) only checks that `entry` is a dict with a truthy `id` before persisting it via `append_nutrition_log_entry()` (`database.py`). It never validates that `grams`/`baseCalories`/`baseProtein`/`baseFat`/`baseCarbs` exist or are numeric.

**Why:** A malformed entry (buggy import path, tampered localStorage synced up via `account_sync.js`, a future code path that forgets a field) is accepted and stored as-is, then synced to every device. `static/nutrition_macros.js`'s `sumMacrosForDay()` now guards against this client-side (coerces bad fields to 0 instead of NaN-poisoning the day total), but that's a display-layer mitigation, not a data-integrity fix -- the bad entry is still persisted and re-served to every consumer.

**Context:** Found by Claude's adversarial review during `/ship` on `fix/homepage-nutrition-calorie-mismatch`. Deferred because it's a server-side schema-validation decision independent of that branch's client-side calorie-math fix, and needs a call on where in the stack to enforce it (route-level schema check vs. a shared validator also used by other nutrition-log write paths).

**Effort:** S
**Priority:** P2
**Depends on:** None
