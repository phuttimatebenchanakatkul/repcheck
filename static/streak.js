/**
 * RepCheckStreak -- the single source of truth for "did the user use
 * RepCheck on day X", and the streak numbers derived from it.
 *
 * WHAT COUNTS AS A STREAK DAY
 * ---------------------------
 * Any real USE of the app: doing a daily challenge, logging a workout,
 * logging food, logging a weigh-in, running a form analysis, logging a
 * HYROX race, completing a weekly check-in, asking the AI coach
 * something, or building/editing a split plan.
 *
 * Merely opening the app does NOT count, and never has -- there is
 * deliberately no "page view" source below. A streak is meant to reward
 * doing something, not launching the app and bouncing.
 *
 * This used to live as three hand-copied `hasActivityOn()` blocks (home,
 * challenges and streaks pages) that each only knew about the workout and
 * nutrition logs -- so a day spent entirely on the daily challenge, a
 * weigh-in or a form analysis showed up as a broken streak. They're all
 * routed through this file now so the rule can't drift between pages
 * again.
 *
 * WHERE THE DAYS COME FROM
 * ------------------------
 * Most features already leave a dated local record behind, so they're
 * read straight out of the logs they were always writing (which means
 * existing users' history counts retroactively, with no migration):
 *
 *   repcheck_workout_log_v2    date -> [entries]   logged a workout
 *   repcheck_nutrition_log_v1  date -> [entries]   logged food
 *   repcheck_weight_log_v1     date -> entry       logged a weigh-in
 *   repcheck_workout_chat_v1   date -> [turns]     used the workout AI chat
 *   repcheck_analyze_log_v1    [{analyzedAt}]      ran a form analysis
 *   repcheck_hyrox_history_v1  [{date}]            logged a HYROX race
 *
 * Everything else -- the daily challenge above all, which is stored
 * server-side only -- has no dated local record, so those features call
 * mark() and land in repcheck_activity_log_v1 (date -> [action names]).
 * That key is registered for account sync exactly like the logs above, so
 * a streak follows the account across devices.
 *
 * Past server-side activity (challenges, analyses, races and check-in
 * photos from before this file existed, or done on another device) is
 * back-filled once per browser session from /api/activity/dates -- see
 * seedFromServer(). Pages that show a streak should re-render on the
 * `repcheck:streak-updated` event, since that back-fill lands async.
 *
 * NOT counted on purpose: repcheck_day_status_v1. Those are manual
 * overrides the user applies to some OTHER (usually past) day from the
 * logging-history calendar, so treating one as activity would let a
 * streak be back-dated into existence long after the fact.
 */
(function () {
  "use strict";

  var ACTIVITY_LOG_KEY = "repcheck_activity_log_v1";
  var WORKOUT_LOG_KEY = "repcheck_workout_log_v2";
  var NUTRITION_LOG_KEY = "repcheck_nutrition_log_v1";
  var WEIGHT_LOG_KEY = "repcheck_weight_log_v1";
  var WORKOUT_CHAT_KEY = "repcheck_workout_chat_v1";
  var ANALYZE_LOG_KEY = "repcheck_analyze_log_v1";
  var HYROX_HISTORY_KEY = "repcheck_hyrox_history_v1";

  // sessionStorage, not localStorage: one back-fill per browser session is
  // enough to recover history, and a per-session flag still re-checks on
  // the next visit (picking up whatever another device did meanwhile)
  // without a request on every single page load.
  //
  // account_sync.js clears this by name wherever it wipes one account's
  // local data (logout, and landing on a different account without one) --
  // a session outlives that, so a stale flag would leave the new account
  // un-back-filled and showing a zero streak. Keep the two in step.
  var SEEDED_FLAG = "repcheck_activity_seeded";

  var UPDATED_EVENT = "repcheck:streak-updated";

  function loadJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key));
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function toIsoDate(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  // Every date with at least one qualifying action, rebuilt by refresh().
  // A Set rather than a re-parse per lookup because computing the longest
  // streak probes every day of a user's history, and the calendar on the
  // streaks page probes a full month on every render.
  var activeDates = new Set();

  // date -> [entries]: the day counts once the array has something in it.
  // An empty array is what's left after deleting the last entry of a day,
  // so it must NOT count.
  function collectFilledArrayDays(set, key) {
    var log = loadJson(key, {});
    if (!isPlainObject(log)) return;
    Object.keys(log).forEach(function (iso) {
      if (Array.isArray(log[iso]) && log[iso].length > 0) set.add(iso);
    });
  }

  // date -> single entry (the weight log): presence is the whole signal.
  function collectValueDays(set, key) {
    var log = loadJson(key, {});
    if (!isPlainObject(log)) return;
    Object.keys(log).forEach(function (iso) {
      if (log[iso] !== null && log[iso] !== undefined) set.add(iso);
    });
  }

  // Flat arrays of entries stamped with a time rather than filed under a
  // date -- epoch ms (analyze log) or an ISO datetime string (HYROX). Both
  // are converted through the local timezone so the day they land on
  // matches the day the user experienced, which is what every other source
  // here is keyed by.
  function collectTimestampedDays(set, key, field) {
    var entries = loadJson(key, []);
    if (!Array.isArray(entries)) return;
    entries.forEach(function (entry) {
      if (!entry || entry[field] === null || entry[field] === undefined) return;
      var date = new Date(entry[field]);
      if (isNaN(date.getTime())) return;
      set.add(toIsoDate(date));
    });
  }

  function refresh() {
    var set = new Set();
    collectFilledArrayDays(set, WORKOUT_LOG_KEY);
    collectFilledArrayDays(set, NUTRITION_LOG_KEY);
    collectFilledArrayDays(set, WORKOUT_CHAT_KEY);
    collectFilledArrayDays(set, ACTIVITY_LOG_KEY);
    collectValueDays(set, WEIGHT_LOG_KEY);
    collectTimestampedDays(set, ANALYZE_LOG_KEY, "analyzedAt");
    collectTimestampedDays(set, HYROX_HISTORY_KEY, "date");
    activeDates = set;
    return activeDates;
  }

  function hasActivityOn(iso) {
    return activeDates.has(iso);
  }

  function notifyUpdated() {
    document.dispatchEvent(new CustomEvent(UPDATED_EVENT));
  }

  /**
   * Record that the user just did `action` (a short stable id like
   * "challenge" or "checkin"), stamped with TODAY's local date.
   *
   * Only for features that leave no dated record of their own -- calling
   * it after a workout/food/weight save would just duplicate a day the
   * logs above already report.
   */
  function mark(action) {
    if (!action) return;
    var iso = toIsoDate(new Date());
    var log = loadJson(ACTIVITY_LOG_KEY, {});
    if (!isPlainObject(log)) log = {};
    var todays = Array.isArray(log[iso]) ? log[iso] : [];
    if (todays.indexOf(action) !== -1) return; // already recorded today
    log[iso] = todays.concat([action]);
    // A failed write (quota, private browsing) must not take the action
    // itself down with it -- the streak is a reward, not the feature.
    try {
      localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(log));
    } catch (err) {}
    refresh();
    notifyUpdated();
  }

  /** Length of the run of active days ending today. */
  function current() {
    var cursor = new Date();
    // If today has nothing on it yet, count from yesterday instead so an
    // ongoing streak isn't zeroed out before the day is even over.
    if (!hasActivityOn(toIsoDate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    var streak = 0;
    while (hasActivityOn(toIsoDate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  /** Longest run of consecutive active days ever recorded. */
  function longest() {
    var sorted = Array.from(activeDates).sort();
    var best = 0;
    var run = 0;
    var previous = null;
    sorted.forEach(function (iso) {
      var date = new Date(iso + "T00:00:00");
      run = (previous && Math.round((date - previous) / 86400000) === 1) ? run + 1 : 1;
      if (run > best) best = run;
      previous = date;
    });
    return best;
  }

  /**
   * Merge the server's record of what this account did -- challenge
   * attempts, form analyses, HYROX races, check-in photos -- into the
   * local activity log. Everything there predates this file for existing
   * users, and challenges have no client-side record at all, so without
   * this a user who does the daily challenge every day would still see a
   * zero streak.
   *
   * Resolves to true when it actually added something (i.e. the caller
   * should re-render), false on any failure -- a back-fill that can't
   * reach the server just leaves the locally-known days in place.
   */
  function seedFromServer() {
    if (!window.REPCHECK_LOGGED_IN || typeof fetch !== "function") {
      return Promise.resolve(false);
    }
    // getTimezoneOffset() is minutes BEHIND UTC (UTC+7 -> -420); the
    // server needs the conventional sign so it can bucket its UTC
    // timestamps into the user's own calendar days.
    var offset = -new Date().getTimezoneOffset();
    return fetch("/api/activity/dates?tz_offset_minutes=" + offset)
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (!data || !data.ok || !isPlainObject(data.dates)) return false;
        var log = loadJson(ACTIVITY_LOG_KEY, {});
        if (!isPlainObject(log)) log = {};
        var changed = false;
        Object.keys(data.dates).forEach(function (iso) {
          var incoming = data.dates[iso];
          if (!Array.isArray(incoming)) return;
          var existing = Array.isArray(log[iso]) ? log[iso] : [];
          var merged = existing.slice();
          incoming.forEach(function (action) {
            if (typeof action === "string" && merged.indexOf(action) === -1) {
              merged.push(action);
              changed = true;
            }
          });
          log[iso] = merged;
        });
        if (!changed) return false;
        try {
          localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(log));
        } catch (err) {}
        refresh();
        notifyUpdated();
        return true;
      })
      .catch(function () { return false; });
  }

  refresh();

  window.RepCheckStreak = {
    mark: mark,
    refresh: refresh,
    hasActivityOn: hasActivityOn,
    current: current,
    longest: longest,
    activeDates: function () { return activeDates; },
    seedFromServer: seedFromServer,
    toIsoDate: toIsoDate,
    UPDATED_EVENT: UPDATED_EVENT,
  };

  function runInitialSeed() {
    try {
      if (!sessionStorage.getItem(SEEDED_FLAG)) {
        sessionStorage.setItem(SEEDED_FLAG, "1");
        seedFromServer();
      }
    } catch (err) {
      // No sessionStorage (private browsing in some engines) -- seed
      // anyway rather than silently leaving server-side activity out.
      seedFromServer();
    }
  }

  // account_sync.js (loaded just before this file -- see base.html) may be
  // about to WIPE this device's local data out from under us. Its own
  // "Hydrate from the account on load" step detects a shared/kiosk device
  // that's now logged into a DIFFERENT account without an explicit logout
  // in between, and reacts by clearing every synced key -- including
  // ACTIVITY_LOG_KEY -- before that account's data is trusted.
  //
  // If the seed above ran first, it would read this device's stale
  // leftover activity log (the previous account's), merge in the new
  // account's real server dates, and push the CONTAMINATED result to the
  // new account's server row -- and because this key merges rather than
  // overwrites (see account_sync.js's MERGE_LOG_KEYS), that contamination
  // could never be cleanly undone afterward. So: wait for account_sync.js's
  // "repcheck:sync-hydrated" signal (fired once its own pull settles,
  // success or failure) before running the once-per-session auto-seed.
  //
  // Only wait when account_sync.js is actually going to fire that signal --
  // it early-returns without ever touching /api/sync for a logged-out
  // visitor, in which case seedFromServer() would no-op anyway.
  if (window.REPCHECK_LOGGED_IN) {
    var seeded = false;
    var seedOnce = function () {
      if (seeded) return;
      seeded = true;
      runInitialSeed();
    };
    document.addEventListener("repcheck:sync-hydrated", seedOnce, { once: true });
    // Defensive timeout: if account_sync.js somehow never dispatches (a
    // future change drops the signal, or the browser lacks fetch), don't
    // leave the streak permanently un-seeded -- fall back after a grace
    // period long enough for a normal /api/sync round trip to finish.
    setTimeout(seedOnce, 5000);
  } else {
    runInitialSeed();
  }
})();
