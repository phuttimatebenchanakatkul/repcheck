/**
 * RepCheckSuggestions -- "here's what you could log" suggestions for the
 * food and workout log search sheets.
 *
 * EVERY suggestion here is derived from data the user actually has: foods
 * they have logged before (at this time of day, or most recently) and
 * exercises they have logged before. Nothing is invented, and nothing is
 * inferred from a stranger's averages -- a user with no history gets an
 * empty list, and the caller shows a "log your first one" call to action
 * instead of a made-up pick.
 *
 * The two food rules (recent-first, and this hour's habitual "top picks")
 * and the exercise one live here rather than inline in
 * templates/nutrition.html and templates/workouts.html, so the two search
 * sheets share one definition instead of each growing its own copy --
 * those templates call straight into this file, passing their own live
 * in-memory log, which is newer than localStorage mid-session.
 *
 *   repcheck_nutrition_log_v1  date -> [{ food, addedAt, ... }]
 *   repcheck_workout_log_v2    date -> [{ exercise, addedAt, ... }]
 */
(function () {
  "use strict";

  var NUTRITION_LOG_KEY = "repcheck_nutrition_log_v1";
  var WORKOUT_LOG_KEY = "repcheck_workout_log_v2";

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

  // `log` is optional everywhere below: templates that already hold the
  // day-keyed log in memory pass it in, anything else reads localStorage.
  function resolveLog(log, key) {
    var value = log === undefined || log === null ? loadJson(key, {}) : log;
    return isPlainObject(value) ? value : {};
  }

  // Pushes into one array rather than reassigning `out = out.concat(...)`
  // per day: concat re-copies everything gathered so far on every day key,
  // which turns flattening a multi-year log into O(days x entries). Pushed
  // element by element rather than with push.apply -- a single day's array
  // is small, but apply takes the whole array as arguments and blows the
  // stack past ~100k of them.
  function allEntries(log) {
    var out = [];
    Object.keys(log).forEach(function (iso) {
      var day = log[iso];
      if (!Array.isArray(day)) return;
      for (var i = 0; i < day.length; i++) out.push(day[i]);
    });
    return out;
  }

  // Newest first. Entries written before addedAt existed sort last rather
  // than throwing the order off with NaN comparisons.
  function byNewest(entries) {
    return entries.slice().sort(function (a, b) {
      return (b && b.addedAt ? b.addedAt : 0) - (a && a.addedAt ? a.addedAt : 0);
    });
  }

  // Distinct values of `field`, newest logged first.
  function recentNames(entries, field, limit) {
    var seen = {};
    var names = [];
    byNewest(entries).forEach(function (entry) {
      var name = entry ? entry[field] : null;
      if (!name || seen[name]) return;
      seen[name] = true;
      if (names.length < limit) names.push(name);
    });
    return names;
  }

  /**
   * Foods the user genuinely tends to eat AROUND `hour` -- not just
   * anything logged there once. A food qualifies only if it was logged in
   * this hour's window on at least TOP_PICK_MIN_DAYS *different days*, so
   * a one-off never shows up while a real habit does. The window is the
   * target hour +/-1 so "my usual 8am breakfast" still counts when it
   * lands at 7:50 one day and 8:15 the next. Ranked by how many distinct
   * days it recurs on.
   */
  var TOP_PICK_MIN_DAYS = 2;
  function topPicksForHour(hour, limit, log) {
    var entries = allEntries(resolveLog(log, NUTRITION_LOG_KEY));
    var daysByFood = {}; // food -> { iso: true } it was logged near this hour
    entries.forEach(function (entry) {
      if (!entry || !entry.food || !entry.addedAt) return;
      var when = new Date(entry.addedAt);
      var hourDiff = Math.abs(when.getHours() - hour);
      if (hourDiff > 12) hourDiff = 24 - hourDiff; // wrap midnight (23 vs 0 = 1 apart)
      if (hourDiff > 1) return;
      if (!daysByFood[entry.food]) daysByFood[entry.food] = {};
      daysByFood[entry.food][toIsoDate(when)] = true;
    });
    return Object.keys(daysByFood)
      .map(function (food) { return { food: food, days: Object.keys(daysByFood[food]).length }; })
      .filter(function (row) { return row.days >= TOP_PICK_MIN_DAYS; })
      .sort(function (a, b) { return b.days - a.days; })
      .slice(0, limit)
      .map(function (row) { return row.food; });
  }

  /** Distinct foods, most recently logged first. */
  function recentFoods(limit, log) {
    return recentNames(allEntries(resolveLog(log, NUTRITION_LOG_KEY)), "food", limit);
  }

  /** Distinct exercises, most recently logged first. */
  function recentExercises(limit, log) {
    return recentNames(allEntries(resolveLog(log, WORKOUT_LOG_KEY)), "exercise", limit);
  }

  window.RepCheckSuggestions = {
    toIsoDate: toIsoDate,
    topPicksForHour: topPicksForHour,
    recentFoods: recentFoods,
    recentExercises: recentExercises,
    TOP_PICK_MIN_DAYS: TOP_PICK_MIN_DAYS,
  };
})();
