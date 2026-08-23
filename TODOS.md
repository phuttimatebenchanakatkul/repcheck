# TODOS

## Streaks

### Four streak back-fill queries in get_activity_dates() have no covering index

**What:** `get_activity_dates()` (`database.py`) runs one `WHERE user_id = ?` query per entry in `ACTIVITY_DATE_SOURCES` (`challenge_submissions`, `analyze_results`, `hyrox_results`, `progress_photos`). None of the four tables has an index usable for a bare `user_id` predicate -- `challenge_submissions`'s only key is `PRIMARY KEY (challenge_id, user_id)`, which can't serve it, and the other three have no secondary index at all.

**Why:** This route is called once per browser session for essentially every logged-in user (via `static/streak.js`'s `seedFromServer()`), so it's four full table scans per session start, across tables that only grow. Invisible at current scale; becomes a real bottleneck as the user base and each table's row count grow.

**Context:** Flagged by the performance specialist during `/ship`'s pre-landing review for the "streak counts any app use" feature. Deferred (user chose "ship as-is" over fixing inline) to keep that PR scoped to the streak-rule change itself; not urgent given the current data volume.

**Effort:** S
**Priority:** P3
**Depends on:** None

### static/streak.js's refresh() fully rebuilds its activity-day Set on every call instead of updating incrementally

**What:** `refresh()` (`static/streak.js`) does a full `JSON.parse` + iterate over all 7 tracked localStorage logs (workout, nutrition, weight, workout chat, activity log, analyze log, HYROX history) every time it's called -- once unconditionally at module load, and again inside `mark()`/`seedFromServer()` whenever a new day is recorded. Since `templates/base.html` now loads `streak.js` on every page (not just pages that show a streak), this scan happens on every navigation regardless of whether the page uses the result.

**Why:** Avoidable work: an incremental update (add just the new day to the existing `Set`) would suffice for `mark()`/`seedFromServer()`'s cases. Unlikely to be felt at realistic localStorage sizes for a long time (a few KB at most for any real user today), so this is a "before it becomes noticeable" cleanup, not an active problem.

**Context:** Flagged by the performance specialist during `/ship`'s pre-landing review for the "streak counts any app use" feature. Deferred (user chose "ship as-is" over reworking the accounting logic) -- a real fix is a design change (incremental Set maintenance) with more risk of a subtle accounting bug than the current full-rebuild-every-time approach.

**Effort:** M
**Priority:** P4
**Depends on:** None

## Workouts

### Workout chat's `describeSet()` duplicates the weight/reps formatting logic already in `renderEntry()`/`renderEntryDetail()`

**What:** The new "last 7 days" AI chat widget (`templates/workouts.html`, `describeSet()` in the workout-chat IIFE) re-implements weight/reps/unilateral formatting that already exists in `renderEntry()`/`renderEntryDetail()` -- the same logic that renders each exercise card. The two implementations aren't shared by a common helper.

**Why:** Two copies of "how to read a set's weight/reps out of an entry" can drift silently -- a future fix to one (e.g. a new set shape, a bodyweight-detection tweak) might not get applied to the other, and the AI chat would then describe a workout differently than what's actually shown on the card above it.

**Context:** Flagged by the maintainability specialist during `/ship`'s pre-landing review for the workout-chat feature. Not fixed inline because extracting a shared `formatSetForDisplay(entry, set)` helper means touching `renderEntry()`/`renderEntryDetail()`, pre-existing, well-tested rendering code that this PR doesn't otherwise touch -- a larger, separately-reviewable change rather than a mechanical one-file fix.

**Effort:** S
**Priority:** P3
**Depends on:** None

### No server-side message-length cap on any of the three AI chatbots

**What:** `/api/workout-chat`, `/api/coach-chat`, and `/api/analyze-chat` (`app.py`) all accept `message` with only a client-side `maxlength="600"` on the `<input>` -- nothing bounds it server-side before it's forwarded into a Gemini `Content` part.

**Why:** Low risk in practice (Gemini has its own token limits, and all three routes already require login + share the 3-messages/day `ai_chat` rate limit, so abuse is both authenticated and heavily throttled), but a malicious or buggy client could send an arbitrarily large `message` and this app never validates it.

**Context:** Flagged by the testing specialist during `/ship`'s pre-landing review for the workout-chat feature. Not fixed inline because it's a pre-existing characteristic shared identically by all three chatbots, not something this PR introduced -- fixing it for just the new route would leave the other two inconsistent, so a real fix should add one shared cap (e.g. a `MAX_MESSAGE_CHARS` constant) across all three routes together.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Edited sets/reps in the review step's exercise editor are a write-only round-trip

**What:** The new per-exercise sets/reps editor (`templates/workouts.html`, `renderSplitStepReview()`'s carousel) saves `exercisePrescriptions` into the plan's localStorage blob on Save, but nothing in the app ever reads it back. `renderTodaysPlanCard()` and `renderWholeSplitBody()` (the "Today's Plan" card and the saved-split view) compute displayed sets/reps purely via `getSetsRepsText(name)` -- the generic movement-pattern bucket -- never consulting `plan.exercisePrescriptions`. `renderSplitStepReview()` also unconditionally resets `exercisePrescriptions` to `{}` on every entry, regardless of whether the plan already had customizations -- so any prior prescription is silently discarded the next time the AI-suggest path is used to rebuild the split.

**Why:** A user can tap an exercise, edit sets/reps, watch the box turn amber ("edited"), tap Save -- and that customization is never shown anywhere in the app afterward, and is silently discarded the next time a split gets regenerated. The amber-highlight/reset-to-standard UI strongly implies the intent was for this to be the plan's real, persisted sets/reps, not a value that's saved but functionally inert.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/assign-week-carousel`. Not fixed in that branch because closing the loop is a product decision, not a one-line fix: does `getSetsRepsText`'s "N sets • X-Y reps" range-display format even make sense to replace with a specific `sets×reps` once customized? Does the exact-match `prescriptionKey(label, name)` lookup still make sense once a plan has been rebuilt (label reuse across regenerations)? Note (2026-08-14, `edit-split-flow-redesign` branch): the "edit an existing split" entry point no longer rehydrates the wizard from the saved plan at all (see the removed `openEditSplitModal()` -- editing a split now always starts blank, same as building one from scratch), which removes one specific place this gap used to bite but doesn't touch the core problem described above.

**Effort:** M
**Priority:** P2
**Depends on:** None

### The week view's inline exercise add/remove has no real-execution test coverage

**What:** `renderWholeSplitBody()`'s inline exercise remove button, the "Pick exercises" button, and `persistSplitPlan()` (all added in `edit-split-flow-redesign`) are only covered by Python source-level regex assertions against the rendered Jinja template (`tests/test_split_modal_bottom_sheet_and_edit.py`) -- nothing actually executes this code in a JS runtime. The sibling wizard step (`renderSplitStepReview()`) already has a real jsdom extraction harness (`tests-js/support/loadReviewStep.js`, used by `tests-js/reviewStep.test.js`) that runs the real function and asserts on actual DOM/state changes, but no equivalent harness exists for `renderWholeSplitBody`/`renderExercisePickerStep`.

**Why:** A regex match against the template string can only catch structural regressions (a line got deleted, a call site changed), not runtime bugs in the actual logic -- index-based splice correctness, the closure-captured `getSelected`/`onDone` callbacks actually firing in the right order, or `persistSplitPlan`'s side effects actually running. This isn't theoretical: both real bugs found during this branch's development (the "Today's Plan" card going stale after an inline edit, and the modal title getting stuck on "Pick exercises — {day}") were runtime behavior issues caught only by manual browser testing -- neither would have been caught by a regex test, and neither was anticipated until observed. A real jsdom harness would have plausibly caught at least the stale-card bug directly (assert `calls.replanned` after a remove, same pattern the wizard's save test already uses successfully).

**Context:** Flagged by the testing specialist during this branch's `/ship` pre-landing review (confidence 58/10, not certain but empirically supported by the finding above). Deferred rather than built inline because a proper extraction harness for `renderWholeSplitBody`/`renderExercisePickerStep` is comparable in size to `loadReviewStep.js` itself (~150-200 lines) -- real new infrastructure, not a quick addition to this PR.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Duplicate day labels now have write-path exposure, not just display-path

**What:** `renderWholeSplitBody()`'s inline edit controls (added in `edit-split-flow-redesign`) resolve which `plan.days` entry to mutate via `plan.days.find((d) => d.label === activeLabel)` -- the same label-keyed lookup the existing "A custom day literally named 'Rest' hides its own workout" TODO already flags as a display-path collision risk. If `plan.days` ever contains two entries with the same label (nothing in the custom-split builder enforces uniqueness), `.find()` silently returns only the first match. Before this branch, that collision only affected which day's content got *displayed*; now the inline remove-exercise and pick-exercises buttons write through that same lookup, so an edit intended for the second same-labeled day would silently mutate the first one's exercise list instead.

**Why:** Previously a confusing-but-harmless display quirk; now a genuine data-corruption path -- a user editing what they believe is one day's exercises could silently corrupt a different day's data, with no error or indication anything went wrong.

**Context:** Found by Claude's adversarial review during `/ship` on `edit-split-flow-redesign`. Same root cause and same fix options as the existing "custom day literally named 'Rest'" TODO above (day-label uniqueness isn't enforced anywhere in the custom-split builder) -- properly fixing either finding likely fixes both, since both stem from `plan.days` entries being addressed by label instead of a stable id. Deferred as an architectural change (adding a real per-day id touches the saved-plan schema and every place that currently keys off `label`), not a one-line fix, and this branch's own scope is the edit-entry-flow redesign, not the underlying data model.

**Effort:** M (touches the saved-plan schema if done properly)
**Priority:** P3
**Depends on:** None

### Inline split-plan edits increase repcheck_split_plan_v1's sync write frequency with no ordering guarantee

**What:** `repcheck_split_plan_v1` is synced by `static/account_sync.js` as a plain last-write-wins key (not in `MERGE_LOG_KEYS`), pushed via independent fire-and-forget `sendBeacon`/`fetch` PUTs with no version or ordering guarantee -- the same architecture already flagged for `repcheck_workout_log_v2` below ("account_sync.js's generic merge push can still resurrect a deleted workout entry if delivered late"). Before `edit-split-flow-redesign`, `persistSplitPlan()` (then inline in the wizard's save handler) only fired once per completed wizard flow. This branch calls it on every inline exercise add/remove tap in the week view too, so a single editing session can now fire many more of these unordered writes in quick succession.

**Why:** More frequent unordered writes to the same key widens the window for a stale write (a backgrounded tab, a delayed beacon, a flaky connection retried later) to land after a newer one and silently revert exercise additions/removals a user already made and saw persist -- the exact failure mode already documented for the workout log, now applicable to split plans too because the write pattern changed from occasional to frequent.

**Context:** Found by Claude's adversarial review during `/ship` on `edit-split-flow-redesign`. Same fix shape as the workout-log entry below: `account_sync.js` would need per-key version/ordering guarantees (or a dedicated CRUD endpoint instead of whole-blob last-write-wins), which is shared sync infrastructure touching every key in `SYNC_KEYS`, not something this branch's scope (the edit-entry-flow redesign) should take on.

**Effort:** M
**Priority:** P3
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

**Addendum (feat/assign-week-day-picker, 2026-08-13):** The day pill's tap-to-cycle gesture was replaced with a tap-to-open `.split-carousel-pill-menu` (see the "day-type picker" entry below). Its `.split-carousel-pill-menu-item` options are `padding: 8px 10px` at 13px font, an effective height under 44px -- and unlike the dots, this IS the primary control for reassigning a day (there's no other path). Flagged as [LOW] confidence by the design review (code-only, not visually measured) and not blocking ship, but worth a closer look if this screen gets another pass -- padding the tappable area without growing the visible menu row would close most of the gap.

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

### Decide what the day-type picker should do when it orphans a training day

**What:** In the split-review screen, tapping the day pill (formerly: cycled its assignment one tap at a time, before the day-type picker menu of 2026-08-13; before that: tapping the already-selected weekday grid cell, before the carousel redesign of 2026-08-13) now opens a menu and reassigns the day directly to whichever label or Rest is picked. Nothing stops a user from reassigning every day to Rest, or picking away the only weekday scheduled for a given training day -- that day's exercises stay in `plan.days` but become unreachable via `plan.schedule`. The underlying risk is unchanged by the interaction-model swap; only how a user reaches that state changed (now one direct tap instead of N cycling taps).

**Why:** This is a product decision, not a confirmed bug -- a user might legitimately decide they don't want a given training day this week. But it's currently silent either way: no warning, no indication a day type has become unscheduled.

**Context:** Surfaced by the original coverage audit for the split-review-redesign ship. `tests-js/reviewStep.test.js`'s picker-menu tests pin that normal reassignment doesn't crash, but don't specifically assert the orphan/0-instances-scheduled edge case, deliberately without asserting the *outcome* is desirable. Needs a product call: leave as-is (user's own choice), warn when a day type becomes fully unscheduled, or prevent the last instance of a day type from being picked away.

**Effort:** S (once the desired behavior is decided)
**Priority:** P3
**Depends on:** A product decision on the intended behavior

### Six near-identical read-modify-write-upsert blocks in database.py

**What:** `set_user_data`, `append_nutrition_log_entry`, `remove_nutrition_log_entry`, `set_weight_log_entry`, `append_hyrox_history_entry`, `remove_hyrox_history_entry`, and (as of 2026-08-13) `set_workout_log_day` all repeat the same shape: `SELECT value ... WHERE user_id = ? AND key = ?`, `json.loads`, apply a one-line mutation, `json.dumps`, `INSERT ... ON CONFLICT(user_id, key) DO UPDATE`.

**Why:** Seven copies of the same upsert shell means a future bugfix to the transaction/locking behavior (e.g. the `BEGIN IMMEDIATE` fix `set_workout_log_day` just got, see the entry below) has to be manually re-applied to every copy instead of fixed once.

**Context:** Flagged by the maintainability specialist during the workout-log-sync-fix ship review. Deferred because factoring a shared `_upsert_user_data_json(user_id, key, mutate)` helper means touching five pre-existing, already-shipped functions this PR doesn't otherwise change -- real scope creep for a PR whose actual bug was specific to the workout log.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Same date-regex validation line repeated across 5 routes in app.py

**What:** `re.match(r"^\d{4}-\d{2}-\d{2}$", date_iso)` appears identically in the nutrition log-entry POST/DELETE, weight log-entry, checkin photo upload, and (as of 2026-08-13) workout log-day routes.

**Why:** Minor duplication; a future change to date validation (e.g. rejecting impossible calendar dates like "2026-13-99", which the current regex allows -- see `test_log_day_route_date_validation_is_shape_only_not_calendar_aware`) would need five identical edits.

**Context:** Flagged by the maintainability specialist during the workout-log-sync-fix ship review. Deferred for the same reason as the database.py duplication above -- factoring `_valid_iso_date()`/`parse_date_iso_or_400()` means touching four pre-existing routes this PR doesn't otherwise change.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Workout/nutrition/weight/HYROX logs store their whole history as one JSON blob per user

**What:** `set_workout_log_day()` (and the sibling functions it mirrors) read, deserialize, mutate, re-serialize, and rewrite the user's ENTIRE multi-date log on every single write -- even though only one date's entries actually changed. The workout log now writes far more often than the others (debounced from every keystroke while editing reps/weight, not just discrete add/delete taps), so this cost scales with both total account history AND active-editing frequency.

**Why:** Not a correctness bug (fixed with `BEGIN IMMEDIATE` for the concurrency angle -- see `set_workout_log_day`'s docstring and `test_set_workout_log_day_serializes_genuinely_concurrent_writes_to_different_dates`), but a standing architectural cost: a long-time user's blob grows with their history, and every keystroke-triggered sync pays for the whole blob's parse+reserialize+write, not just the touched date. SQLite also only allows one writer for the whole database file at a time, so more frequent writes to this table increase how often the global write lock is contended as usage grows.

**Context:** Flagged by the performance specialist during the workout-log-sync-fix ship review. Out of scope for a bugfix PR -- properly fixing this means splitting each key into per-date rows (e.g. `key = f"{WORKOUT_LOG_KEY}:{date_iso}"`), which changes the `user_data` table's read/write shape for every one of the six functions above, not just the workout log.

**Effort:** L
**Priority:** P3
**Depends on:** None

### account_sync.js's generic merge push can still resurrect a deleted workout entry if delivered late

**What:** `repcheck_workout_log_v2` is still in `static/account_sync.js`'s `SYNC_KEYS`, so every `localStorage.setItem` for the workout log (including the authoritative save that already went through `POST /api/workout/log-day`) also fires the generic wrapped-setItem sendBeacon push, which lands on the merge-only `set_user_data` route. `BEGIN IMMEDIATE` (added in this PR) closes the race when that push arrives at roughly the same instant as the authoritative write, but a push that's delayed well past that -- a stale background tab, a flaky connection retried later, a browser's beacon queue holding it -- lands as an ordinary later write. A union merge has no way to represent "this entry was intentionally removed," so a sufficiently late merge push can still reintroduce a deleted workout entry.

**Why:** This is the same bug class the original report described, just narrowed from "any deletion, any time" to "a deletion whose stale merge-push arrives after the authoritative delete." Not theoretical -- backgrounding a tab mid-edit and letting it flush minutes later is an ordinary mobile usage pattern.

**Context:** Found during adversarial review of the workout-log-sync-fix. Investigated whether simply removing `repcheck_workout_log_v2` from `SYNC_KEYS` would close this completely -- it would not, because `SYNC_KEYS.forEach` also drives the pull/hydration-on-load loop that new devices depend on to receive the workout log at all; removing it from the Set breaks hydration along with the push. A real fix means restructuring `account_sync.js` to decouple the push path from the pull path per key (e.g. two separate key lists, or a per-key config object with independent push/pull flags), which is shared infrastructure touching every synced key, not just workouts -- out of scope for this bugfix PR.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Stale background tab can resurrect a deleted workout entry via an unrelated edit on the same date

**What:** If a user deletes a workout entry on Device A, then returns to a tab on Device B that had the same date open before the deletion (with the deleted entry still in its in-memory `log`), any edit on Device B to a *different* entry on that same date calls `saveLog(dateIso)` with the stale full-day array, which is authoritative and overwrites the date wholesale -- silently restoring the deleted entry as a side effect of an unrelated edit.

**Why:** `POST /api/workout/log-day` is correct to be an authoritative whole-day overwrite (that's the fix for the original bug), but that also means any caller with stale in-memory state for that day can undo someone else's deletion without ever touching the deleted entry itself. No error, no conflict signal -- it looks like the edit just worked.

**Context:** Found during adversarial review of the workout-log-sync-fix. Needs a product decision before it's worth building: periodic re-hydration of the currently-viewed date while a tab is backgrounded/idle, an ETag/version check on save that rejects a stale base state, or accepting this as a rare multi-device-editing edge case not worth the complexity.

**Effort:** M (once the desired behavior is decided)
**Priority:** P3
**Depends on:** A product decision on the intended behavior

### No upper bound on a workout entry's field sizes or on distinct dates per user

**What:** `POST /api/workout/log-day` caps entry *count* per day at 200 and requires dict shape, but doesn't bound the size of any individual field (`exercise` name, `sets` array contents, etc.) or the number of distinct dates a user can accumulate in the log over time.

**Why:** Lower-severity than the concurrency/staleness findings above -- this is a self-inflicted-only growth/storage concern (a user can only bloat their own blob), not a cross-user or data-loss issue. Still worth bounding eventually since the whole-blob-per-write pattern (see the entry above on per-date rows) means an unbounded blob makes every future write more expensive too.

**Context:** Found during adversarial review of the workout-log-sync-fix.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Unescaped entry.exercise in workout log rendering (pre-existing, self-XSS only)

**What:** `templates/workouts.html` interpolates `entry.exercise` into rendered HTML without escaping when displaying logged workout entries. The self-build exercise picker uses a fixed list so this isn't reachable through normal UI, but the field isn't server-validated against that list -- a crafted `POST /api/workout/log-day` payload (or a modified client) could store an entry name containing markup.

**Why:** Impact is limited to self-XSS (a user can only inject into their own view of their own data; nothing here reads another user's entries), so this doesn't meet the bar for an urgent fix, but it's a real gap worth closing with proper escaping.

**Context:** Found during adversarial review of the workout-log-sync-fix. Confirmed pre-existing -- not introduced by this PR's changes, which only added a new authoritative write path and didn't touch how entries are rendered. Deferred as out of scope for a sync-bugfix PR. Narrowed to `workouts.html` only as of 2026-08-14: `home.html`'s matching unescaped `recent[0].exercise` interpolation (the "Form check" glance card's `renderAnalyze()`) was removed wholesale along with the rest of the "Today" glance grid -- not fixed for escaping, just gone along with the feature it belonged to.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Analyze

### Per-analysis chat thread merge can silently drop a message on a length tie

**What:** `repcheck_analyze_chat_v1_<id>` (the AI chat thread attached to each form analysis) is reconciled across devices by `database.py`'s `_merge_chat_thread()` and `static/account_sync.js`'s `mergeChatThread()` picking whichever side's `history` array is *longer* -- not a true per-message union merge like every other `MERGE_LOG_KEYS` family in this file (see `_merge_by_id`/`_merge_date_keyed` and their JS mirrors). "Longer wins" only preserves every message if one side's history is always a strict prefix of the other's.

**Why:** If two devices append *different* messages to the same thread and both end up the same length, whichever side is "incoming" wins the tie and its history entirely replaces the other's -- one real message is silently and permanently dropped, with no error surfaced to either device.

**Context:** Found by Claude's adversarial review during `/ship` for the stranded-keys sync fix (`feat/sync-remaining-local-keys`), which introduced server-side sync for this key. Flagged INVESTIGATE rather than fixed inline: a proper fix needs a real per-message merge (e.g. tagging each history entry with a stable id/ordinal at send time, then unioning by that id the way `_merge_by_id` already does for every other array-shaped log), which is a design decision, not a mechanical one-line fix.

**Effort:** M
**Priority:** P3
**Depends on:** None

## i18n

### Thai translation missing for the wizard's location step

**What:** 8 keys under `workouts.wizard.location.*` (plus `locationTitle` and `stepLocation`) have English text but no Thai translation -- a Thai user sees the raw i18n key rendered on "Where do you usually train?".

**Why:** User-visible: Thai users hit un-translated UI on a step every AI-suggested split still goes through.

**Context:** Pre-existing gap, predates the split-review-redesign and self-build location-skip work. Confirmed missing and deliberately deferred when `tests/test_i18n_key_parity.py` was added (see `KNOWN_MISSING_THAI` in that file, which has its own test pinning the list so a real fix doesn't go unnoticed). To fix: translate the 8 keys in `static/i18n.js`'s Thai locale block, then remove them from `KNOWN_MISSING_THAI`.

**Effort:** S
**Priority:** P2
**Depends on:** None

## Hyrox

### History rows are a div[role="button"] wrapping a real nested `<button>`

**What:** Each history row (`renderHistory()`, `static/hyrox.js`) is a `div[role="button"] tabindex="0"` that structurally contains a real `<button class="hx-history-remove">` (the "x"). This solves the HTML5 constraint (`<button>` can't nest `<button>` -- the browser silently closes the outer one) but not the ARIA one: a `role="button"` container should not contain other interactive controls. Screen reader behavior for nested interactive elements varies by AT/browser combination -- some double-announce, some drop the inner control's semantics.

**Why:** Real accessibility gap on a brand-new, genuinely keyboard-operable widget (this PR also added the first working keydown handler in this file). Not blocking because the underlying HTML5 constraint that caused this shape is real and the current implementation does correctly avoid double-firing (see `handleKeydown`'s `event.target !== target` guard), but the ARIA pattern itself should be revisited.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`, where the instance was the "Your personal bests" card's section trigger. That card was removed in v0.1.2.0, but the identical shape survives in the history rows, so the issue moved rather than closed -- repointed there. A real fix likely means making the row container non-interactive and giving the open action its own control adjacent to (not wrapping) the remove button -- a layout change, not a one-line fix. `handleKeydown`'s `event.target !== target` guard still correctly prevents double-firing in the meantime (see `tests/test_hyrox_keyboard_activation.py`).

**Effort:** M
**Priority:** P3
**Depends on:** None

### Keyboard activation drops focus back to `<body>` on every re-render

**What:** `render()` (`static/hyrox.js`) unconditionally does `this.root.innerHTML = ""` and rebuilds the whole tree; there is no `.focus()` restoration anywhere in the file. Any keyboard activation routed through `handleKeydown` therefore drops focus to `<body>`: pressing Enter on a history row or a personal-best board row opens the detail modal, and dismissing it leaves the user re-tabbing from the top.

**Why:** This is an app-wide pre-existing pattern (full-rebuild rendering with no focus restoration), not unique to any one feature, but `handleKeydown` makes it reachable by keyboard on two live surfaces, so the gap is user-facing rather than theoretical.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`. The original instance was the PB card's expand toggle, removed in v0.1.2.0; the pattern outlived it, so this is repointed at the surviving keyboard-activated rows. Fixing properly means either targeted DOM patching instead of full rebuilds (a much larger architectural change touching every render call site) or saving/restoring focus by a stable identifier (e.g. `data-id`) around the `render()` calls reached from `handleKeydown` -- the narrower, more tractable option.

**Effort:** S (narrow fix, just the keyboard-reachable rows) / L (app-wide)
**Priority:** P3
**Depends on:** None

### History rows render comboLabel() unescaped (pre-existing, self-XSS only)

**What:** `renderHistory()` and `renderRaceDetailModal()` (`static/hyrox.js`) both emit `<span class="hx-history-tag">${comboLabel(r.gender, r.category, r.format)}</span>` into a template literal assigned via `innerHTML`. `comboLabel()` builds that string through `RepCheckI18n.t("hyrox.finishLabel", {...})`, which substitutes its vars with split/join and does not escape them, and it passes `category`/`format` straight through whenever they are not one of the fixed ids. `setCategory(value)` stores whatever `data-value` it is handed without validating against `CATEGORY_IDS`, and history records also arrive through account sync.

**Why:** Verified, not theoretical: rendering a history record whose `category`, `format`, or `gender` contains `"><img src=x onerror=alert(1)>` produces a live `<img>` in the row, confirmed against the real English dictionary. Self-XSS only -- the data is the user's own -- which is why it is P3 and not P0. Same class as the workout-log entry above.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-pb-leaderboard`. That branch closed the instance it introduced (`pbBoardLabel()` now goes through `escapeHtml`, and the board's `data-key` through a new `escapeAttr`), and deliberately left these two pre-existing call sites alone. The systemic fix is making `RepCheckI18n.t()` escape its vars by default, which would close all of the remaining sinks at once; the narrow fix is wrapping these two call sites in the `escapeHtml` that already exists in the file.

**Effort:** S (two call sites) / M (systemic t() escaping + audit of every intentional-markup caller)
**Priority:** P3
**Depends on:** None

### "No detail available" toast always blames "another device" even when the real cause is local-history eviction

**Fixed on `fix/never-evict-race-history`, 2026-08-14** -- resolved at the root cause. `MAX_HISTORY` (the count-based `saveHistory()` trim this TODO was about) is gone entirely; local Hyrox history is never truncated by count or age. The toast's "set on another device" copy is no longer a false-attribution risk, since local-history eviction is no longer a thing that can happen.

~~**What:** Local history is trimmed to the most recent `MAX_HISTORY` entries on every save (`static/hyrox.js`). If a user's server-side PB is older than that cutoff, its local backing record gets silently evicted, and tapping the PB button shows "No detail available for this result — it was set on another device" -- which is factually wrong when the race was actually set on this device and the app just stopped keeping the record.~~

~~**Why:** Low likelihood (requires a lot of completed races to hit the cap) but the copy asserts a specific wrong cause rather than a neutral one when it does happen.~~

~~**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`. Deferred as a copy/product decision -- soften the message to a neutral "No detail available for this result" (drops the false specificity but also drops the reassuring, usually-correct explanation), or increase local history retention, or accept as-is given the low likelihood.~~

**Effort:** S
**Priority:** P4 (resolved)
**Depends on:** None

### Unbounded Hyrox history re-uploads the full blob on every single save

**What:** `repcheck_hyrox_history_v1` is one of `account_sync.js`'s `SYNC_KEYS`, so every `saveHistory()` write (finishing a race, deleting one, or caching an AI analysis result) already re-uploads the entire history array via the wrapped `localStorage.setItem` -- this was true even before `fix/never-evict-race-history`. What that fix changes is the *size ceiling*: the array can no longer be capped at ~200 entries, so a long-lived account's full-blob re-upload grows without bound on every single write, including ones that only touch one record (e.g. caching one race's AI analysis text).

**Why:** Not a correctness bug -- `account_sync.js`'s `pushToServer()` already has documented fallback handling for oversized payloads (sendBeacon queue-full retries via fetch, keepalive-quota-exceeded retries without keepalive), so this degrades gracefully rather than failing outright. But it's a standing efficiency cost that scales with account age: JSON.stringify of the whole array plus a full network re-transmission, repeated on every write, for the life of the account, when most writes only change one record.

**Context:** Found by the security and performance specialists during `/ship` on `fix/never-evict-race-history` (both independently flagged the same root cause). A real fix means either delta/batched sync for this key specifically (only the changed record, not the whole array) or restructuring the synced value's shape (e.g. per-race rows instead of one array blob) -- the same "one JSON blob per user, whole-blob read-modify-write" architectural pattern already tracked for workout/nutrition/weight logs elsewhere in this file, now also true of Hyrox history now that it's unbounded. Out of scope for a bugfix branch whose actual mandate was "never evict race data."

**Effort:** L
**Priority:** P3
**Depends on:** None

### No recovery path once a device's localStorage quota is hit for Hyrox history

**What:** `saveHistory()`'s catch (added on `fix/never-evict-race-history`) surfaces a toast when `localStorage.setItem` throws `QuotaExceededError`, but `this.history` only ever grows and a failed save is never retried. Every future write on that device -- finishing a race, deleting one, caching an AI analysis -- re-triggers the same failure until the array shrinks. The only shrink path is `removeHistory()`, one entry at a time; there's no bulk-clear UI, and the toast copy just says "try another device."

**Why:** Product/UX gap, not a code defect -- the underlying data is safe (server-authoritative, never lost), but a device that hits this has a genuinely degraded experience with no clear way out short of manually deleting races one by one or switching devices.

**Context:** Found by Claude's adversarial review during `/ship` on `fix/never-evict-race-history`, as a follow-on to the QuotaExceededError catch it also verified. Needs a product decision: a bulk "free up space" flow (e.g. clear local cache for races already confirmed synced server-side, since they're recoverable via hydration), or accept the one-at-a-time deletion path as sufficient given how rare hitting the quota actually is.

**Effort:** M (once the desired recovery UX is decided)
**Priority:** P4
**Depends on:** A product decision on the intended recovery flow

### Add-a-station category tabs don't implement the full ARIA APG tabs keyboard pattern

**What:** The new category tab bar (`buildStationPickerSheetContent()`, `static/hyrox.js`) has `role="tablist"` / `role="tab"` / `aria-selected` (added during this branch's pre-landing review), but not the rest of the ARIA Authoring Practices tabs pattern: no arrow-key navigation between tabs, and the tiles grid below isn't wired up as a `role="tabpanel"` linked via `aria-controls`/`aria-labelledby`.

**Why:** Screen reader and keyboard users get correct "this is a tab, this one's selected" semantics (the part that matters most), but not the expected arrow-key-to-switch-tabs interaction a screen reader user familiar with the ARIA pattern would expect -- they're still limited to Tab-and-Enter through each button.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-station-picker-grid-tabs`. Deferred because full APG conformance (arrow-key roving tabindex + tabpanel linkage) is a small but real behavioral addition, not part of the redesign itself, and the current partial semantics are still a net improvement over the plain buttons this branch replaced.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Add-a-station tile grid looks visually unbalanced for 2-station categories

**What:** `.hx-station-picker-grid` (`static/hyrox.css`) is a fixed `repeat(3, 1fr)` grid. Cardio has 3 stations and fills the row; Sled Work, Carry & Lunge, and Explosive each have only 2, so their row renders as 2 tiles left-aligned with an empty gap where a 3rd tile would be.

**Why:** Purely cosmetic -- no broken functionality, just an asymmetric look on 3 of the 4 tabs. Noticeable but low-severity.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-station-picker-grid-tabs`. A real fix is a design decision (e.g. center 2-tile rows, or switch to a flex-wrap layout that doesn't reserve a 3rd column when unused), not a mechanical one-line fix.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Nutrition

### Nutrition log entries aren't validated for numeric shape server-side

**What:** `POST /api/nutrition/log-entry` (`app.py`'s `api_nutrition_log_entry()`) only checks that `entry` is a dict with a truthy `id` before persisting it via `append_nutrition_log_entry()` (`database.py`). It never validates that `grams`/`baseCalories`/`baseProtein`/`baseFat`/`baseCarbs` exist or are numeric.

**Why:** A malformed entry (buggy import path, tampered localStorage synced up via `account_sync.js`, a future code path that forgets a field) is accepted and stored as-is, then synced to every device. `static/nutrition_macros.js`'s `sumMacrosForDay()` now guards against this client-side (coerces bad fields to 0 instead of NaN-poisoning the day total), but that's a display-layer mitigation, not a data-integrity fix -- the bad entry is still persisted and re-served to every consumer.

**Context:** Found by Claude's adversarial review during `/ship` on `fix/homepage-nutrition-calorie-mismatch`. Deferred because it's a server-side schema-validation decision independent of that branch's client-side calorie-math fix, and needs a call on where in the stack to enforce it (route-level schema check vs. a shared validator also used by other nutrition-log write paths).

**Effort:** S
**Priority:** P2
**Depends on:** None

### Onboarding rate-of-change slider's thumb is below the 44px touch guideline

**What:** `.ob-rate-slider-thumb` (`templates/onboarding.html`, the custom rate-of-weight-change slider added on `weight-loss-rate-slider-redesign`) is 26x26px, and the slider's overall hit area (`.ob-rate-slider`, which captures pointerdown across its full width) is 32px tall -- both below Apple's 44px HIG touch-target guideline.

**Why:** Same class of finding already resolved elsewhere in this app (see the now-resolved "Weekday grid tap targets" entry above) -- small miss-taps on a control users interact with directly. Low severity: the slider is draggable across its full width, not a discrete tap target, and the visible thumb is only the drag handle, not the sole interactive surface.

**Context:** Flagged by the design specialist during `/ship` on `weight-loss-rate-slider-redesign` (LOW confidence -- code-level detection only, not verified visually). Deferred as a minor visual-density tradeoff: increasing the slider's height to 44px would need matching adjustments to the badge/readout spacing above and below it to avoid the step feeling oversized.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Widening the onboarding rate range changed the null-rate fallback for the separate coaching.js wizard too

**What:** `coaching_engine.py`'s `LOSS_RATE_DEFAULT_PCT`/`GAIN_RATE_MAX_PCT` are shared server-side constants used by `_validate_coaching_profile()` (`app.py`) for TWO independent wizards: the new onboarding flow (`static/onboarding.js`, this branch's scope) and the separate "Personalized Coaching" wizard (`static/coaching.js`, deliberately left untouched -- its own slider still shows the old 1.0-2.0% / 0.25-0.5% ranges). `_validate_coaching_profile()` substitutes `LOSS_RATE_DEFAULT_PCT` whenever a caller sends an explicit `null` for `loss_rate_pct` (a real, previously-tested path -- see `tests/test_coaching_rate_null.py`), not just when the key is missing. Since that default changed from 1.5% to ~0.267% as part of recalibrating onboarding's range to a 0.2-0.8 kg/week target, a `coaching.js` user who happens to hit this null-fallback path now gets a rate value well below what `coaching.js`'s own slider UI would ever let them select (it never goes below 1.0%) -- their saved profile would disagree with what their own wizard shows as the valid range.

**Why:** Narrow (requires a `coaching.js` user's client to send an explicit `null` rate rather than omitting the key or a real value, which per that test file's own docstring is a real, previously-fixed reachable path, not purely theoretical) but a genuine behavioral bleed-through across a boundary this branch intentionally tried to keep clean (onboarding-only scope, confirmed via explicit user decision before implementation).

**Context:** Found while implementing the onboarding rate-slider redesign (`weight-loss-rate-slider-redesign` branch) -- widening `coaching_engine.py`'s shared MIN/MAX/DEFAULT constants was an explicit, confirmed decision for this branch (needed so the new 0.2-0.8 kg/week loss zone and 0.6 kg/week gain ceiling are even reachable), but the null-fallback DEFAULT bleeding into the other wizard's users is a side effect of that shared file, not something this branch's own scope covers fixing. A real fix means giving each wizard its own default (e.g. a `default_pct` argument threaded through `_validate_coaching_profile()` instead of a bare module constant), which touches the validation function's signature and every caller, not just the onboarding flow this branch actually changed.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Check-in context flags aren't cross-checked against the actual check-in week

**What:** `api_coaching_weekly_adjustment()` (`app.py`) validates `high_carb_days`/`bloating_days` for shape (ISO date string, ASCII digits, capped at 31 entries) but never checks that a flagged date actually falls within `week_weight_entries`/the check-in week being scored. The client UI (`renderCheckinFlagGrid()`, `static/coaching.js`) only ever lets a user toggle dates from `checkin.weekDates`, so this is unreachable through the app itself -- only a client calling the API directly could submit an out-of-range or nonsensical date (month/day aren't range-checked beyond `\d{2}`, so `"2026-13-45"` passes format validation).

**Why:** A flagged date with no relationship to the week actually being reviewed still reaches `checkin_analyzer.py`'s Gemini prompt as "the user flagged this about their own week: they ate notably more carbs...", letting a user (or direct API caller) retroactively attach a water-retention excuse to any weigh-in. Low severity: this is self-directed (same account, same trust boundary as every other self-reported check-in field -- weight entries and calorie logs are equally unvalidated against reality), and the numeric outcome stays clamped to the existing +/-150 kcal/day `WEEKLY_ADJUSTMENT_LIMIT` regardless of what the AI reads in the prompt.

**Context:** Found by the red-team specialist during `/ship` on `checkin-context-prompts` (confidence 6/10). Deferred because it doesn't cross the app's existing trust model (all check-in inputs are self-reported and already unvalidated against ground truth) and a real fix means determining "the check-in week" server-side (timezone-aware, likely needs to intersect against `week_weight_entries`' own date set) -- more scope than this branch's stated intent.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Silent AI-fallback on check-in loses the user's flagged days with no signal

**What:** When `analyze_checkin()` (`checkin_analyzer.py`) raises `CheckinAnalysisError` for any reason (Gemini timeout, malformed response, transient API error), `app.py`'s except-block falls back to `coaching_engine.weekly_adjustment()` -- which never receives `high_carb_days`/`bloating_days` at all -- and still returns `{"ok": true}` with no indication the flags were ignored. This isn't specific to the context-flags feature: the same silent fallback already existed for progress photos before this branch (a text-only check-in and a check-in with photos that hits an AI hiccup both silently degrade to the deterministic-only reasoning), and is the intentional, documented design (see `checkin_analyzer.py`'s module docstring: deterministic math is the safety floor/fallback, AI is the judgment layer).

**Why:** A user who took the extra step of flagging high-carb/bloated days gets a normal-looking successful check-in with zero indication those flags never factored into the number they received -- the exact outlier-weigh-in-triggers-too-big-a-cut scenario this feature exists to prevent can still happen silently on any AI-call hiccup.

**Context:** Found by the red-team specialist during `/ship` on `checkin-context-prompts` (confidence 5/10). Deferred: this is a pre-existing property of the whole check-in AI-fallback architecture (already true for photos), not a regression introduced by this diff, and surfacing "AI reviewed this vs. deterministic fallback used" to the user is a result-screen/API-contract change bigger than this branch's scope.

**Effort:** M
**Priority:** P3
**Depends on:** None

### submitCheckin()'s payload construction has no direct JS test

**What:** `submitCheckin()` (`static/coaching.js`) builds the `/api/coaching/weekly-adjustment` POST body including `high_carb_days: Object.keys(c.highCarbDays)` and `bloating_days: Object.keys(c.bloatedDays)`, but `submitCheckin()` itself has zero test coverage in `tests-js/` (confirmed: no test file references it). `tests-js/checkinContextFlags.test.js` covers `toggleCheckinFlag()`/`renderCheckinFlagGrid()` (the state mutation and rendering), and `tests/test_checkin_context_flags.py` proves the server correctly forwards a `high_carb_days`/`bloating_days` payload shaped exactly like what `submitCheckin()` sends -- but nothing exercises the actual `Object.keys(...)` transformation that turns the UI's flag-map state into that payload.

**Why:** A bug in that one line (e.g. sending the flag map itself instead of its keys, or swapping which map feeds which field) would not be caught by any existing test. Low risk in practice: `Object.keys()` is a builtin with no room for the kind of logic bug the rest of this feature's tests already guard against.

**Context:** Flagged by the testing specialist during `/ship` on `checkin-context-prompts` (confidence 5.5/10). Deferred rather than fixed inline because `submitCheckin()` is a large async method (fetch, photo-file handling, localStorage) -- isolating just its payload-construction logic for a test is a bigger extraction than the two simple methods already covered, comparable in scope to building a new harness rather than reusing the existing `loadCheckinFlags.js` pattern.

**Effort:** S
**Priority:** P3
**Depends on:** None

### AI-generated `reason` text is rendered via unescaped innerHTML with no sanitization

**What:** `renderCoachingCard()`'s adjustment banner (`static/coaching.js`, `${this.lastAdjustment.reason}`) and the check-in result screen (`${adj.reason}`) both splice the AI-generated `reason` string from `analyze_checkin()`/`weekly_adjustment()` directly into a template string that's assigned via `el()`'s `wrap.innerHTML = html.trim()` -- no `escapeHtml()`/sanitize helper exists anywhere in `coaching.js`. `reason` is capped at 400 chars server-side (`checkin_analyzer.py`) but never HTML-escaped.

**Why:** `reason` is Gemini-generated text built from a prompt that includes multiple free-text-adjacent inputs (this branch's `high_carb_days`/`bloating_days` are locked to ASCII digits/dashes and can't reach this, but the prompt also includes the user's profile fields and other check-in context). If the model ever returns markup-like text in its `reason` response -- via a prompt-injection attempt through some other input, or simply an unlucky generation -- it would render unescaped in the user's own browser. Self-XSS in practice (own account, own data), but a real gap: no output encoding exists on this path at all.

**Context:** Found by the Claude adversarial review during `/ship` on `checkin-context-prompts` (INVESTIGATE, not introduced by this diff -- pre-existing across all of `coaching.js`'s AI-reason rendering, not specific to the new check-in flags). Deferred because a real fix means adding an `escapeHtml()` helper (or switching these two call sites to `textContent`) across the whole file's AI-output rendering, not a change scoped to this branch's own diff.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Check-in flag pills reuse the day-status pill's shape with no toggle-vs-cycle distinction

**What:** `renderCheckinFlagGrid()` (`static/coaching.js`) reuses the exact `.pc-ck-day` circular pill component (same size/shape) as `renderCheckinDayGrid()` directly above it in the same check-in sheet, differentiated only by an added `.pc-ck-flag-day` modifier class for color. The first grid cycles each day through statuses on tap; the two new grids are independent on/off toggles -- three visually-identical rows of round pills with no shape/icon distinction between the "cycle" and "toggle" affordances.

**Why:** A user could reasonably assume all three pill rows behave the same way (cycling through states) rather than two of them being simple flags. Purely a visual/interaction-design polish item, not a functional bug -- the pills are labeled with section headers (`coaching.checkin.highCarbLabel`/`bloatedLabel`) directly above each row.

**Context:** Flagged by the design specialist during `/ship` on `checkin-context-prompts` (confidence 5/10). Deferred as a subjective design-polish call -- picking a distinct shape/icon treatment (e.g. rounded-square/checkbox look) is a visual decision better made deliberately than folded into a review-fix pass.

**Effort:** S
**Priority:** P4
**Depends on:** None

### No server-side length cap on a custom food's emoji

**What:** `api_create_custom_food()` (`app.py`) takes `emoji` as `str(payload.get("emoji") or "").strip()` and only defaults it when empty -- nothing bounds its length before it goes into the `custom_foods.emoji` column. The custom-*exercise* route directly below it does cap its own emoji field (`emoji = emoji[:8]`), so the two sibling routes disagree.

**Why:** Low risk (the route requires login, and the picker UI only ever sends one glyph), but a hand-rolled request could store an arbitrarily large string in that column and it would then be rendered as the food's icon in the log list on every page load. The inconsistency with the exercise route is the real smell -- one of the two is wrong.

**Context:** Noticed during `/ship`'s pre-landing review on `feat/food-emoji-picker` while tracing every consumer of `CUSTOM_FOOD_EMOJIS`. Not fixed inline: pre-existing, on a line that branch doesn't touch, and the right fix is to make both routes agree on one shared cap rather than patch the food route alone.

**Effort:** S
**Priority:** P4
**Depends on:** None

### "Quick add" dock still abandons the meal being edited in add-ingredient mode

**What:** `manualMacroCtaHtml()` (`templates/nutrition.html`) is appended on every branch of the food-search sheet, including when the sheet was opened by `openAddIngredientModal()`. Its `[data-manual-macro]` handler does `closeModal(); openQuickMacroModal();` -- and `closeModal()` nulls `modalMode`, so the food gets logged as its own standalone entry instead of being added as an ingredient of the meal the user was editing. The `[data-custom-index]` branch has the same gap.

**Why:** The user is mid-edit on one meal and silently ends up with a second unrelated entry in their day, which they then have to find and delete. The sticky dock is the loudest control on the sheet, so it's the one they're most likely to reach for.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. That branch fixed its own new instance (the Custom tab's "Create a food" row is suppressed in add-ingredient mode) but deliberately did not touch the two pre-existing ones -- a real fix threads the `entryId` through the create/quick-macro/custom-food paths and the af-sheet result flow so the created food can be appended as an ingredient, which is a separate change with its own tests.

**Effort:** M
**Priority:** P1
**Depends on:** None

### A custom food can be created but never deleted from the app

**What:** `DELETE /api/custom-foods/<id>` exists (`app.py`) and has no caller anywhere in `templates/` or `static/`.

**Why:** A typo'd food (a mistyped name with an 8000 kcal value) is permanent and keeps matching every future search. The food sheet's new "Custom" tab now presents that list prominently, which makes the missing affordance obvious in a way it wasn't when custom foods only surfaced as search hits.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Deferred: needs a UI decision (swipe-to-delete on the row, matching the food log's own swipe gesture, vs an edit mode) rather than just wiring the endpoint.

**Effort:** S
**Priority:** P1
**Depends on:** None

### The Custom tab can't tell "you have no custom foods" from "the fetch failed"

**What:** `loadCustomFoods()` (`templates/nutrition.html`) swallows every failure into an empty `catch`, is called exactly once at page load, and never re-runs. The food sheet's Custom tab renders `nutrition.custom.empty` ("Foods you build yourself show up here.") for all of: a genuinely empty library, a 500, a 401, an offline phone, and a request that simply hasn't landed yet.

**Why:** A user with 40 saved foods can be told, in a confident empty state, that they have none -- and the obvious next action ("Create a food") makes them recreate a duplicate. There is no loading state, no error state, and no retry.

**Context:** Flagged by the maintainability specialist and Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Deferred: needs a tri-state (unloaded / loaded / failed) plus a re-render when the fetch resolves while the sheet is open, which is more than the tab change itself warranted.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Favoriting a scanned food leaves a dead row once its log entries are gone

**What:** The `[data-fav-toggle]` handler keys on the food NAME, so a scan/barcode/quick-macro name can be favorited, and that favorite persists in localStorage independently of the log. Delete every entry for that name and `relogRowEntry()` finds nothing, so the Favorites tab renders it with no macro line on the `data-food` path, where `openLogAmountModal()` early-returns -- a row that does nothing on tap, with no way to clear it except re-hearting it.

**Why:** It is the same dead-row failure `feat/food-sheet-custom-tab` removed from the Recent tab, surviving in the one place that fix can't reach (there is no entry left to render from).

**Context:** Found by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Deferred: the honest fix is either to drop unresolvable names from the favorites list (silently hides a favorite) or to render them as explicitly unavailable -- a product call, not a mechanical fix.

**Effort:** S
**Priority:** P2
**Depends on:** None

### The analyze-food sheet's screens are hardcoded English

**What:** `renderRelogConfirm()`, `renderAfChoice()` and the create-food form (`templates/nutrition.html`) emit literals -- "Amount", "Cancel", "Log again", "Log your food any way you like.", "Create food" -- while the food-search sheet around them is fully `RepCheckI18n.t()`-driven.

**Why:** A Thai user tapping a Thai-named food on a Thai-labelled tab is dropped onto an English confirm dialog. The food sheet's re-log row now makes that transition part of a normal logging flow rather than a scan-only path.

**Context:** Noticed by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Deferred: it's a bulk i18n extraction across the whole af sheet (dozens of strings, en + th), unrelated to that branch's scope.

**Effort:** M
**Priority:** P2
**Depends on:** None

### The food sheet's two default-view empty states are still plain text, not the mascot

**What:** `#163` standardised four empty screens onto `RepCheckMascot.emptyState()`, and on the food-search sheet that covers only the no-match QUERY state. The sheet's two default-view empty states -- `nutrition.searchToAdd` (pre-existing) and `nutrition.custom.empty` (added with the Custom tab) -- still render as plain `.nl-search-empty` text, so the same sheet shows a mascot when a search misses and a grey sentence when a tab is empty.

**Why:** The Custom tab's empty state is the one every user hits on first open, which is exactly the moment the mascot exists for. Converting both together is one change and one visual check; converting either alone leaves the sheet half-and-half.

**Context:** Noticed during `/ship` on `feat/food-sheet-custom-tab` while merging `#163`. Not done there: it needs a title/sub copy split (en + th) for both states and a pose choice, and the branch's dev session had expired so the result could not be checked visually. Related to the existing "Two competing empty-state treatments ship side by side" entry under Design.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Onboarding's putSynced() swallows failed saves, so an account can be marked onboarded with no server-side profile

**What:** `putSynced()` (`static/onboarding.js`) ends with `.catch(function () {})` and never checks `res.ok`, so the `await Promise.all(syncPromises)` in `save()` — whose own comment says it waits "for the server to actually confirm" before POSTing `/api/onboarding/complete` — resolves even when every PUT failed. An offline or flaky-network user gets `onboarding_completed = true` with no profile/goals behind it, the exact state that comment claims the design prevents.

**Why:** Silent data loss on the very first thing a new account does. The user lands on home with no targets and no obvious way to know why. `coaching.js`'s wizardSave may share the pattern.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/onboarding-5-steps`. Pre-existing (untouched by that branch), so it was spun off rather than folded into the wizard-condensing PR.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Verify the onboarding weight/height wheels don't capture page scroll on a real touch device

**What:** The 5-screen onboarding puts both vertical scroll-wheels (weight, height) on one screen that itself scrolls on phones. A flick that starts over a wheel scrolls the WHEEL (silently changing the stored kg/cm) instead of the page. The wheels have ~96px side gutters at 375px width and the value label sits directly above each wheel, so real exposure is unproven — desktop QA cannot answer it.

**Why:** If real, an accidental flick corrupts the weight that feeds the calorie math, with no error anywhere.

**Context:** Red-team finding during `/ship` on `feat/onboarding-5-steps`; user chose "accept, verify on device" over shipping an engage-on-tap guard unverified. If the trap reproduces, the fix sketch is: wheel scrolls only after a tap/focus on it, or shrink the capture window.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Onboarding option taps rebuild the whole screen instead of updating the tapped card in place

**What:** Every `set-*` tap in `static/onboarding.js` re-renders the full screen via `renderKeepingScroll()` — on the About-you screen that rebuilds ~1,400 nodes (366-row weight wheel + 101-row height wheel) per tap, and on Body & activity it re-creates the six body-type `<img>` cards. Scroll and focus are restored, but the wheels can flash through position 0 for a frame and the images re-decode.

**Why:** Per-tap main-thread work on the mobile signup path; an in-place `.is-selected` toggle plus a Next-button state update would eliminate it.

**Context:** Performance finding during `/ship` on `feat/onboarding-5-steps`; user chose "ship as-is" to keep the verified branch untouched. The source-contract tests in `tests-js/onboardingCombinedScreens.test.js` pin the current `renderKeepingScroll()` wiring and must be rewritten alongside the refactor.

**Effort:** M
**Priority:** P3
**Depends on:** None

## Security

### RepCheckI18n.t() does not escape its vars, and ~8 innerHTML sinks rely on it

**What:** `t(key, vars)` (`static/i18n.js`) substitutes with `text = text.split("{"+k+"}").join(vars[k])` -- no escaping. Nearly every list row in the app is a template literal assigned via `innerHTML`, so any `t()` call carrying a user-controlled var inside one is an injection sink. Remaining unescaped sinks are the user's OWN custom exercise and food names: `templates/workouts.html` (`exerciseRowHtml`'s `data-name`/`${name}`/`data-fav-toggle`, and `renderList`'s `data-exercise`), plus the food equivalents in `templates/nutrition.html`. Names are stored raw (`create_custom_exercise` caps length at 60 but does not sanitize).

**Why:** Self-XSS only -- these strings never leave the account that typed them, and `SESSION_COOKIE_SAMESITE = "Lax"` (`app.py`) blocks the drive-by CSRF path. That is why it was not fixed inline. But the pattern is one shared-list feature away from becoming cross-user, and the current state is inconsistent: the same file now escapes some interpolations and not others.

**Context:** Found by the adversarial pass during `/ship` on `feat/mascot-empty-states`, alongside a genuinely cross-user stored XSS on the leaderboards and friends list -- that one WAS fixed on that branch (see `tests/test_cross_user_name_escaping.py`). The right fix here is systemic: make `t()` escape its vars by default and give the handful of call sites that intentionally pass markup an explicit opt-out, rather than adding more call-site `escapeHtml()` calls. Note there is no shared escape helper -- `workouts.html`, `nutrition.html`, `index.html`, `hyrox.js`, `challenges.html` and `friends.html` each define their own.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Blue label text on the card background falls below AA contrast in dark mode

**What:** `--blue` is a single fixed `#2f66e8` in both themes (`static/style.css`), so blue 14px text on the dark `--card-bg` (`#1c1c1e`) is ~3.4:1 -- below AA's 4.5:1 for non-large text. The house `background: var(--blue-bg); color: var(--blue)` pairing is ~3.2:1 in dark, so this is systemic, not local to one component. Affects the food sheet's new `.nl-create-food-label` and existing blue-on-card text such as `static/style.css:1471`.

**Why:** The blue label is what carries the affordance's meaning, and dark mode is this app's default theme.

**Context:** Flagged by the design specialist during `/ship` on `feat/food-sheet-custom-tab`. Deferred: the fix is a theme-aware accent token (a lighter blue under `:root[data-theme="dark"]`) applied across every blue-on-card use -- a design-system change, not something to do inside one feature branch.

**Effort:** M
**Priority:** P2
**Depends on:** None

### relogEntry() silently drops any field it doesn't enumerate, and lands collapsed

**What:** `relogEntry()` (`templates/nutrition.html`) whitelists `grams, unit, baseCalories, baseCarbs, baseFat, baseProtein` when cloning a non-composite entry. Anything else on the original (`barcode`, `servings`, `emoji`, a future field) is lost, and because the clone becomes the newest entry for that name, `latestEntryForFood()` hands the degraded copy to every later render -- lossy on each round trip. It also skips the `EXPANDED.add(id)` that `addFoodToSelectedDay()` does, so a re-logged entry appears collapsed while a searched one appears expanded.

**Why:** Small today (few extra fields exist), but it is a silent data-narrowing path that compounds, and the re-log flow is now reachable from the food sheet's landing tab rather than only the recent-scans list.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Deferred: switching to a copy-then-override shape needs a check of every consumer that assumes those exact keys.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Design

### 42 tinted icon-badge glows still ship after DESIGN.md dropped the pattern

**What:** DESIGN.md used to prescribe a matching tinted `box-shadow` behind every gradient icon badge. It no longer does (corrected on `feat/hyrox-pb-leaderboard`) because the glow kept getting removed by hand everywhere it landed. The CSS has not caught up: 42 tinted glows remain by this item's own grep (recounted 2026-08-21; `feat/onboarding-5-steps` removed one, on `.ob-result-hero-icon` — the rest of the drift from the original 46 came from other branches in passing), mostly `static/coaching.css` (the `.pc-ck-chip-*` set, `.pc-card-icon-*`, `.pc-day-cell-dot`) and `static/hyrox.css`, plus two in `templates/home.html`.

**Why:** The doc and the code now disagree, which is the same failure mode that produced the repeated one-off removals in the first place: a new badge gets built from whichever source the author happened to read. Finishing the sweep is what makes the rule self-enforcing.

**How to find them:** `grep -rEn "box-shadow: 0 [0-9]+px [0-9]+px rgba\((31, 169, 113|185, 131, 42|47, 102, 232|124, 79, 224|232, 131, 47)" --include=*.css --include=*.html static/ templates/`

**Context:** Counted during `/ship` on `feat/hyrox-pb-leaderboard`, which removed the glow from `.pb-trophy` and corrected DESIGN.md but deliberately did not touch the other 45 — an app-wide visual change does not belong in a PR about a leaderboard. Worth doing as one sweep with a before/after screenshot pass, not incrementally.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Two competing empty-state treatments ship side by side

**What:** `static/mascot.js` covers four screens (Hyrox leaderboard, food search, both exercise pickers, challenges). Race history (`.hx-history-empty-rich`, a stopwatch emoji in an `--amber-bg` circle, `static/hyrox.js`) and the workout log (`.wl-empty`, a sprout emoji, `templates/workouts.html`) still use their own treatment. On the Hyrox page the two sit one tab apart.

**Why:** The point of the mascot was one empty-state language; the app currently has two systematised-but-mutually-inconsistent ones. Converting the remaining pair needs one new pose each (a timer-flavoured pose and a ready-to-start pose) plus deleting `.hx-history-empty-icon` / `.wl-empty-icon`.

**Context:** Flagged by the design specialist during `/ship` on `feat/mascot-empty-states`. Left out to keep that PR scoped; the comments in `static/mascot.js` and `templates/base.html` were narrowed so they no longer claim a consolidation that hasn't happened.

**Effort:** S
**Priority:** P3
**Depends on:** None

### openScannedResultModal()/openRelogConfirmModal() null afPreviewUrl without revoking it

**What:** Both set `afPreviewUrl = null` directly, dropping the last reference to a live blob URL. `useAfImage()` and `closeAnalyzeFoodModal()` both call `URL.revokeObjectURL` first.

**Why:** Leaks a full-resolution meal photo for the page's lifetime each time it happens. Narrow window (a preview must still be assigned), and it is a copied pattern rather than a new one.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`.

**Effort:** S
**Priority:** P3
**Depends on:** None

### The Custom tab renders every custom food with no cap and no lazy images

**What:** The Custom branch of `renderModalDefaultSections()` maps over all of `customFoods`, while every other list in that sheet is bounded (`getRecentFoods(8)`, `getTopPicksForHour(hour, 8)`, `MODAL_MAX_RESULTS` for search). `get_custom_foods()` (`database.py`) has no LIMIT either, and each row's food image has no `loading="lazy"`.

**Why:** A heavy user's whole library becomes one unbounded `innerHTML` rebuild inside a bottom sheet on every tab tap. Not felt at realistic library sizes; capping is also a product call, since this list is the user's own library where completeness matters more than in a suggestion list.

**Context:** Flagged by the performance specialist during `/ship` on `feat/food-sheet-custom-tab`.

**Effort:** S
**Priority:** P3
**Depends on:** None

### foodIconHtml()'s image lookup walks Object.prototype

**What:** `foodIconHtml()` (`templates/nutrition.html`) does a bare `FOOD_IMAGES[name]` lookup, so a food named `constructor`, `toString`, or `__proto__` returns a truthy inherited value and renders a broken image whose src is the coerced function source.

**Why:** Cosmetic, not injectable (the coerced values contain no quotes), but a food name is user- and model-authored text, so the guard belongs there.

**Context:** Noticed by Claude's adversarial review during `/ship` on `feat/food-sheet-custom-tab`. Fix is an `Object.prototype.hasOwnProperty.call(FOOD_IMAGES, name)` check.

**Effort:** S
**Priority:** P4
**Depends on:** None

### Search doesn't match log-only food names, so a Recent row vanishes when you type it

**What:** `renderModalResults()` (`templates/nutrition.html`) builds rows from `FOOD_LIBRARY.filter(...)` plus `customFoods` only. Every one of those names passes `foodByName()`, so `foodRowHtml`'s `data-relog-entry` branch is structurally unreachable in the query view. A scanned meal is now the first thing a user can see on the Recent tab -- but typing its name yields `nutrition.noMatch` ("No foods match ...") for a food that is one tap away on the tab behind the search box.

**Why:** Browse and search disagree about what exists. The Recent tab change made this visible by putting log-only names in front of every user on open.

**Context:** Found by the red-team pass during `/ship` on `feat/food-sheet-custom-tab`. Deferred: matching distinct log-only names in the query view is a new search source (ranking, dedup against library hits, and a cap), not a fix to the tab change.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Custom-food and Open Food Facts rows don't honour the hour the sheet was opened from

**What:** The `[data-custom-index]` and `[data-off-index]` click branches (`templates/nutrition.html`) call `closeModal(); openScannedResultModal(...)` with no `const hourForLog = pendingHour` capture, unlike the `[data-food]` and `[data-relog-entry]` branches beside them. `renderAfResult` then renders its hour select with "Now" pre-selected, so `addAfResultToLog` logs at the current wall clock.

**Why:** Opening the sheet from a specific hour row and picking a Recent row logs at that hour, while picking a Custom row logs at "Now" -- two rows in one sheet behaving differently. Currently unreachable in the shipped UI: nothing calls `openAddFoodModal()` since the hour-row "+" was removed, so `pendingHour` is always null when this sheet opens. It becomes a live inconsistency the moment an hour-pinned entry point comes back.

**Context:** Found by the red-team pass during `/ship` on `feat/food-sheet-custom-tab`. Deferred: the fix needs `renderAfResult` to accept a pre-selected hour, which is the scan-result screen's own contract rather than this sheet's.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

<!-- Shipped items move here, newest first, with the version or date they landed. -->
