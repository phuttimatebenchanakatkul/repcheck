# TODOS

## Workouts

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

## i18n

### Thai translation missing for the wizard's location step

**What:** 8 keys under `workouts.wizard.location.*` (plus `locationTitle` and `stepLocation`) have English text but no Thai translation -- a Thai user sees the raw i18n key rendered on "Where do you usually train?".

**Why:** User-visible: Thai users hit un-translated UI on a step every AI-suggested split still goes through.

**Context:** Pre-existing gap, predates the split-review-redesign and self-build location-skip work. Confirmed missing and deliberately deferred when `tests/test_i18n_key_parity.py` was added (see `KNOWN_MISSING_THAI` in that file, which has its own test pinning the list so a real fix doesn't go unnoticed). To fix: translate the 8 keys in `static/i18n.js`'s Thai locale block, then remove them from `KNOWN_MISSING_THAI`.

**Effort:** S
**Priority:** P2
**Depends on:** None

## Hyrox

### PB card's div[role="button"] trigger wraps a real nested `<button>`

**What:** The new "Your personal bests" card's per-format section trigger (`renderMyBestsCard()`, `static/hyrox.js`) is a `div[role="button"] tabindex="0"` that structurally contains a real `<button class="pb-time-btn">` (the hero time). This solves the HTML5 constraint (`<button>` can't nest `<button>` -- the browser silently closes the outer one) but not the ARIA one: a `role="button"` container should not contain other interactive controls. Screen reader behavior for nested interactive elements varies by AT/browser combination -- some double-announce, some drop the inner control's semantics.

**Why:** Real accessibility gap on a brand-new, genuinely keyboard-operable widget (this PR also added the first working keydown handler in this file). Not blocking because the underlying HTML5 constraint that caused this shape is real and the current implementation does correctly avoid double-firing (see `handleKeydown`'s `event.target !== target` guard), but the ARIA pattern itself should be revisited.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`. A real fix likely means moving the expand affordance to a dedicated control adjacent to, not wrapping, the hero time (e.g. a separate chevron button next to the time button, both siblings under a non-interactive row container) -- a layout change, not a one-line fix.

**Effort:** M
**Priority:** P3
**Depends on:** None

### PB card's keyboard toggle drops focus back to `<body>` on expand/collapse

**What:** `render()` (`static/hyrox.js`) unconditionally does `this.root.innerHTML = ""` and rebuilds the whole tree; there is no `.focus()` restoration anywhere in the file. `togglePbFormat()` calls `render()`, so a keyboard user who presses Enter/Space to expand a PB section loses focus back to `<body>` and must re-tab from the top to continue.

**Why:** This is an app-wide pre-existing pattern (full-rebuild rendering with no focus restoration), not unique to this PR, but this PR is the first to attach a newly-working custom keyboard handler (`handleKeydown`) to a disclosure control, making the gap freshly user-facing rather than theoretical.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`. Fixing properly means either targeted DOM patching instead of full rebuilds (a much larger architectural change touching every render call site) or saving/restoring focus by a stable identifier (e.g. `data-format`) around the `render()` call in `togglePbFormat()` specifically -- the narrower, more tractable option if only this toggle is fixed rather than the pattern app-wide.

**Effort:** S (narrow fix, just this toggle) / L (app-wide)
**Priority:** P3
**Depends on:** None

### "No detail available" toast always blames "another device" even when the real cause is local-history eviction

**What:** Local history is trimmed to the most recent `MAX_HISTORY` entries on every save (`static/hyrox.js`). If a user's server-side PB is older than that cutoff, its local backing record gets silently evicted, and tapping the PB button shows "No detail available for this result — it was set on another device" -- which is factually wrong when the race was actually set on this device and the app just stopped keeping the record.

**Why:** Low likelihood (requires a lot of completed races to hit the cap) but the copy asserts a specific wrong cause rather than a neutral one when it does happen.

**Context:** Found by Claude's adversarial review during `/ship` on `feat/hyrox-personal-bests-report`. Deferred as a copy/product decision -- soften the message to a neutral "No detail available for this result" (drops the false specificity but also drops the reassuring, usually-correct explanation), or increase local history retention, or accept as-is given the low likelihood.

**Effort:** S
**Priority:** P4
**Depends on:** A product decision on the intended wording

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
