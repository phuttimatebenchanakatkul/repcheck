/**
 * Account-based storage sync.
 *
 * RepCheck used to keep almost everything (workouts, nutrition log,
 * coaching profile, weight log, streaks, split plans, HYROX history...)
 * only in the browser's localStorage. That data is scoped per browser
 * *origin* (protocol+host+port) — so a user who logged in via
 * 127.0.0.1:5000 one time and localhost:5000 the next would see their
 * account log in fine (that's server-side) but find all their app data
 * "gone" (it was just stranded under the other origin).
 *
 * This file makes every allow-listed localStorage key also live in the
 * server-side `user_data` table (see database.py / the /api/sync routes
 * in app.py), tied to the logged-in user's account, WITHOUT requiring
 * every page (nutrition.html, workouts.html, coaching.js, hyrox.js, ...)
 * to be rewritten to call a different storage API. It does this by:
 *
 *   1. Wrapping localStorage.setItem/removeItem so any write to a
 *      synced key also fires an async PUT/DELETE to the server.
 *   2. On page load, pulling the account's server-side copy of every
 *      synced key and merging it into localStorage (server wins when
 *      both exist; a key that's only local and was written within this
 *      same session gets adopted onto the account — anything else that's
 *      local-only is treated as stale leftover from a previous browser
 *      session and cleared, never pushed). If anything actually changed,
 *      the page reloads once so the page's own (synchronous,
 *      localStorage-reading) render code picks up the correct values —
 *      avoids having to convert every page's initial render to be async.
 *
 * Must load before any other page script that reads/writes these keys.
 */
(function () {
  "use strict";

  if (!window.REPCHECK_LOGGED_IN) return;

  // Keep this in sync with app.py's SYNCED_DATA_KEYS.
  var SYNC_KEYS = new Set([
    "repcheck_theme",
    "repcheck_language",
    "repcheck_units_v1",
    "repcheck_workout_log_v2",
    "repcheck_split_plan_v1",
    "repcheck_nutrition_log_v1",
    "repcheck_nutrition_goals_v1",
    "repcheck_nutrition_favorites_v1",
    "repcheck_analyze_log_v1",
    "repcheck_coach_chat_v1",
    "repcheck_workout_chat_v1",
    "repcheck_coaching_profile_v1",
    "repcheck_weight_log_v1",
    "repcheck_day_status_v1",
    "repcheck_coaching_last_adjustment_v1",
    "repcheck_coaching_distribution_v1",
    "repcheck_coaching_inactivity_notified_v1",
    "repcheck_coaching_goal_achieved_v1",
    "repcheck_coaching_goal_achieved_handled_v1",
    "repcheck_hyrox_history_v1",
    "repcheck_hyrox_history_synced_v1",
  ]);

  var nativeSetItem = Storage.prototype.setItem.bind(localStorage);
  var nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);

  // Per-key "last written locally, at this timestamp" ledger. This is the
  // actual fix for data loss on navigation, not just a nice-to-have:
  // sendBeacon (below) makes the write *likely* to reach the server before
  // you leave the page, but it's not a guarantee — the server could still
  // process the next page's hydration GET first (e.g. Flask's dev server
  // is single-threaded), or the beacon could just fail silently (its
  // return value only means "queued", never "delivered", and there's no
  // way to know if it actually arrived). If the hydration pull below
  // trusted the server blindly in that case, it would overwrite the
  // freshly-logged data with the stale copy it just read — which is
  // exactly what kept happening. So: never let a hydration pull overwrite
  // a key that was written on THIS device within the last RECENT_WRITE_MS
  // — re-push it to the server instead and let a later pull (after the
  // write has clearly had time to land) reconcile it.
  var WRITE_TIMES_KEY = "__repcheck_sync_write_times";
  var RECENT_WRITE_MS = 20000;

  function loadWriteTimes() {
    try { return JSON.parse(localStorage.getItem(WRITE_TIMES_KEY) || "{}"); }
    catch (err) { return {}; }
  }
  function recordWriteTime(key) {
    var times = loadWriteTimes();
    times[key] = Date.now();
    // Use the native setter directly -- this bookkeeping key isn't in
    // SYNC_KEYS (and shouldn't be), so routing it through the wrapped
    // localStorage.setItem below would be harmless but pointless.
    nativeSetItem(WRITE_TIMES_KEY, JSON.stringify(times));
  }

  // localStorage values are sometimes a raw string (repcheck_theme:
  // "dark") and sometimes JSON (everything else). Round-trip whichever
  // one it is without corrupting the other.
  function decodeStored(raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return raw;
    }
  }
  function encodeForStorage(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  function pushToServer(key, rawValue) {
    if (rawValue === null) {
      // sendBeacon only ever sends POST, so it can't carry a DELETE.
      // Deletions are rare and weren't the case that was actually losing
      // data (adding/editing an entry was), so a plain keepalive fetch
      // (best effort) is enough here.
      fetch("/api/sync/" + encodeURIComponent(key), { method: "DELETE", keepalive: true }).catch(function () {});
      return;
    }

    const body = JSON.stringify({ value: decodeStored(rawValue) });

    // sendBeacon is purpose-built to reliably deliver a request even when
    // the page is being navigated away from right after the call — unlike
    // fetch(..., {keepalive:true}), it isn't cancelled by the browser on
    // unload and isn't skipped for large payloads the way the old
    // size-gated keepalive fetch was. This is what actually fixes the
    // "logged food, left the page, came back and it was gone" bug: the
    // write was getting cancelled or arriving after the *next* page's own
    // hydration GET, which then pulled the still-stale server copy and
    // silently overwrote the fresh local write with it. The server
    // accepts POST as an alias for PUT on this route for exactly this
    // (see app.py's api_sync_put).
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon("/api/sync/" + encodeURIComponent(key), blob);
      if (sent) return;
      // sendBeacon returns false if it couldn't queue the request (e.g.
      // the browser's total outstanding-beacon quota is full) — fall
      // through to the fetch fallback instead of silently dropping it.
    }

    try {
      fetch("/api/sync/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(function () {});
    } catch (err) {
      // A keepalive fetch throws synchronously if the payload exceeds the
      // browser's keepalive quota — retry without it as a last resort,
      // which at least succeeds when the page isn't unloading right now.
      fetch("/api/sync/" + encodeURIComponent(key), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      }).catch(function () {});
    }
  }

  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (SYNC_KEYS.has(key)) {
      recordWriteTime(key);
      pushToServer(key, value);
    }
  };
  localStorage.removeItem = function (key) {
    nativeRemoveItem(key);
    if (SYNC_KEYS.has(key)) {
      recordWriteTime(key);
      pushToServer(key, null);
    }
  };

  // Language and theme are treated as PER-DEVICE preferences, not
  // synced-and-server-wins like everything else in SYNC_KEYS. They're
  // adopted from the account once, the first time a browser has never
  // set one locally — but once this device has its own value, a sync
  // pull must never silently overwrite it.
  //
  // The naive "server always wins" approach (like every other key below)
  // broke exactly this: switch language on your phone -> the PUT that
  // saves it to the server is slow/dropped (flaky mobile network, tab
  // backgrounded mid-request, etc.) -> refresh -> this file's hydration
  // GET still sees the OLD value server-side -> overwrites the phone's
  // fresh local choice right back to the old one. PCs on a stabler
  // connection rarely lose that race, which is why it "worked on PC but
  // not on phone" — the bug was a race, not a platform difference.
  var PER_DEVICE_KEYS = new Set(["repcheck_language", "repcheck_theme"]);

  // Keys whose value is a user-curated SET (a JSON array of unique items),
  // reconciled with the server by UNION rather than last-write-wins. The
  // favorites list is the one that kept "completely disappearing": it's
  // toggled rarely, so the generic sync's short "recently written" trust
  // window has long expired by the next load, and a single dropped push
  // (flaky mobile network, an in-app browser that doesn't deliver
  // background requests, a stale/empty server copy) let hydration wipe the
  // whole list. Merging by union makes disappearance impossible -- the
  // list can only ever grow toward the union of what this device and the
  // server each have. The one trade-off is that a *removal* whose push was
  // dropped can briefly reappear, which is far less alarming than losing
  // every favorite; a fresh removal is still honored because a recent
  // local write is trusted outright (see the merge branch below).
  var MERGE_UNION_KEYS = new Set(["repcheck_nutrition_favorites_v1"]);

  // Append-only LOG keys: collections of dated user entries (workouts,
  // meals, races, analyses, weigh-ins, day statuses). These had the same
  // data-loss failure the favorites list did, but far worse consequences:
  // if the server copy is stale or empty (a dropped push, an in-app
  // browser that doesn't deliver background requests, or an account whose
  // server blob simply hasn't been populated yet), the plain "server wins"
  // hydration below would overwrite the local log with it the moment the
  // 20-second recent-write window elapsed -- silently wiping a whole day
  // of freshly-logged entries. Instead these are reconciled by a
  // structural merge (see mergeLog) that unions entries by id and unions
  // dates, so a log entry present on EITHER side is always kept and the
  // server being behind can never delete local data. Same removal
  // trade-off as favorites: a delete whose push was dropped can briefly
  // reappear, which is vastly preferable to losing everything -- and a
  // fresh removal still sticks via the recent-write trust window.
  var MERGE_LOG_KEYS = new Set([
    "repcheck_workout_log_v2",
    "repcheck_nutrition_log_v1",
    "repcheck_hyrox_history_v1",
    "repcheck_analyze_log_v1",
    "repcheck_weight_log_v1",
    "repcheck_day_status_v1",
  ]);

  // Of those, these two are a flat ARRAY of entries; the rest are
  // date-keyed OBJECTS. mergeLog must be told which so it can't guess
  // wrong: when an array log is empty/absent on BOTH sides, neither value
  // is an array, and guessing-by-shape would fall through to the object
  // merge and write "{}" -- which then crashes readers that expect an
  // array (e.g. hyrox.js does this.history.forEach). Keyed lookup keeps an
  // array log an array (defaulting to []) and an object log an object.
  var ARRAY_LOG_KEYS = new Set([
    "repcheck_hyrox_history_v1",
    "repcheck_analyze_log_v1",
  ]);

  // Union an array of entries by id (falling back to a full-value key for
  // entries without one, e.g. the analyze log), local taking precedence on
  // an id collision so this device's edits to an existing entry win.
  function mergeById(localArr, serverArr) {
    var out = [];
    var seen = {};
    localArr.concat(serverArr).forEach(function (item) {
      var k = (item && typeof item === "object" && item.id != null)
        ? "id:" + String(item.id)
        : "j:" + JSON.stringify(item);
      if (!Object.prototype.hasOwnProperty.call(seen, k)) {
        seen[k] = true;
        out.push(item);
      }
    });
    return out;
  }

  // Union a date-keyed object (workout/nutrition = date -> entry array;
  // weight/day-status = date -> scalar). Every date on either side is kept;
  // arrays are id-merged, scalars prefer the local value on a conflict.
  function mergeDateKeyed(localObj, serverObj) {
    var lo = isPlainObject(localObj) ? localObj : {};
    var se = isPlainObject(serverObj) ? serverObj : {};
    var out = {};
    var keys = {};
    Object.keys(lo).forEach(function (k) { keys[k] = true; });
    Object.keys(se).forEach(function (k) { keys[k] = true; });
    Object.keys(keys).forEach(function (k) {
      var lv = lo[k], sv = se[k];
      if (Array.isArray(lv) || Array.isArray(sv)) {
        out[k] = mergeById(Array.isArray(lv) ? lv : [], Array.isArray(sv) ? sv : []);
      } else if (lv !== undefined) {
        out[k] = lv;
      } else {
        out[k] = sv;
      }
    });
    return out;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function mergeLog(key, localVal, serverVal) {
    if (ARRAY_LOG_KEYS.has(key)) {
      return mergeById(Array.isArray(localVal) ? localVal : [], Array.isArray(serverVal) ? serverVal : []);
    }
    return mergeDateKeyed(localVal, serverVal);
  }

  // Does a merged log actually contain any entries? Used to decide whether
  // a hydration merge is worth a page reload (empty normalization isn't).
  function logHasEntries(val) {
    if (Array.isArray(val)) return val.length > 0;
    if (isPlainObject(val)) return Object.keys(val).some(function (k) {
      var v = val[k];
      return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
    });
    return false;
  }

  function applyLive(key) {
    if (key === "repcheck_language" && window.RepCheckI18n) {
      RepCheckI18n.setLang(RepCheckI18n.getLang());
    } else if (key === "repcheck_theme") {
      if (localStorage.getItem("repcheck_theme") === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
  }

  // ---------- Clear this device's local copies on logout ----------
  // Without this, logging out and signing into a DIFFERENT (or brand-new)
  // account in the same browser left every synced key sitting in
  // localStorage from the PREVIOUS account. The hydration pull below
  // treats "server has never seen this key" as "adopt whatever's in this
  // browser onto the account" (intentional for the anonymous-user ->
  // signup case) — so the new account would immediately inherit the old
  // account's nutrition log, HYROX history, workout log, etc. and push
  // them to its own server row as if they were its own data. Clearing on
  // logout (not on login) keeps the legitimate case working — an
  // anonymous user's local data still adopts into the account they sign
  // up with — while making sure nothing survives an actual account
  // switch. Theme/language are left alone since those are genuinely
  // per-device, not account data (see PER_DEVICE_KEYS above).
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.tagName !== "FORM" || !form.action || form.action.indexOf("/logout") === -1) return;
    SYNC_KEYS.forEach(function (key) {
      if (!PER_DEVICE_KEYS.has(key)) nativeRemoveItem(key);
    });
    nativeRemoveItem(WRITE_TIMES_KEY);
    try { sessionStorage.removeItem("repcheck_hydrated_reload"); } catch (err) {}
  });

  // ---------- Hydrate from the account on load ----------
  // Second, belt-and-suspenders layer on top of the logout clear above:
  // covers the case where a browser ends up logged into a different
  // account WITHOUT an explicit logout in between (session cookie expired
  // or was cleared, a shared/kiosk device, etc.) — anything this device's
  // local data was last synced under an account id that doesn't match
  // whoever's actually logged in now gets wiped before hydration runs, so
  // it can never get "adopted" onto the wrong account.
  var OWNER_KEY = "__repcheck_sync_owner_id";

  fetch("/api/sync")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.ok) return;

      var lastOwnerId = localStorage.getItem(OWNER_KEY);
      var currentOwnerId = String(data.user_id);
      if (lastOwnerId !== null && lastOwnerId !== currentOwnerId) {
        SYNC_KEYS.forEach(function (key) {
          if (!PER_DEVICE_KEYS.has(key)) nativeRemoveItem(key);
        });
        nativeRemoveItem(WRITE_TIMES_KEY);
      }
      nativeSetItem(OWNER_KEY, currentOwnerId);

      var serverValues = data.values || {};
      var needsReload = false;
      var writeTimes = loadWriteTimes();
      var now = Date.now();

      SYNC_KEYS.forEach(function (key) {
        var hasServer = Object.prototype.hasOwnProperty.call(serverValues, key);
        var localRaw = localStorage.getItem(key);

        if (PER_DEVICE_KEYS.has(key)) {
          if (localRaw === null && hasServer) {
            // Never set on this device before — adopt the account's value.
            nativeSetItem(key, encodeForStorage(serverValues[key]));
            applyLive(key);
          } else if (localRaw !== null && (!hasServer || encodeForStorage(serverValues[key]) !== localRaw)) {
            // This device already has its own choice — keep it, and make
            // sure the server reflects it (so a brand-new device adopts
            // whichever device touched it most recently).
            pushToServer(key, localRaw);
          }
          return;
        }

        // This device wrote this key very recently — trust that write over
        // whatever the server just returned, even if they differ, instead
        // of overwriting it. The earlier push to the server (sendBeacon,
        // see pushToServer) may simply not have landed yet by the time this
        // GET was answered; blindly trusting "server wins" here is exactly
        // what was silently discarding freshly-logged food after a
        // navigation. Re-push it so the server catches up instead.
        var recentlyWrittenLocally = key in writeTimes && (now - writeTimes[key]) < RECENT_WRITE_MS;
        // Whether THIS device ever wrote this key at all (at any time, not
        // just recently). The write-times ledger is wiped on logout and on
        // an owner mismatch (see below), so a surviving entry means the
        // key was genuinely written by the account currently logged in --
        // it is this account's own data, even if the entry is old.
        var writtenLocallyEver = key in writeTimes;

        // Union-merged keys (favorites) never let the server shrink or wipe
        // the local set -- the disappearance bug users kept hitting. A very
        // recent local change is authoritative (a just-made removal must
        // stick), so trust and push it as-is. Otherwise merge local ∪ server
        // so nothing is ever lost, and push the union up if it added
        // anything the server didn't have.
        if (MERGE_UNION_KEYS.has(key)) {
          if (recentlyWrittenLocally) {
            if (localRaw !== null && (!hasServer || encodeForStorage(serverValues[key]) !== localRaw)) {
              pushToServer(key, localRaw);
            }
            return;
          }
          var localArr = [];
          try { localArr = localRaw !== null ? (JSON.parse(localRaw) || []) : []; } catch (e) { localArr = []; }
          if (!Array.isArray(localArr)) localArr = [];
          var serverArr = (hasServer && Array.isArray(serverValues[key])) ? serverValues[key] : [];
          var mergedList = [];
          var mergedSeen = {};
          localArr.concat(serverArr).forEach(function (item) {
            var itemKey = String(item);
            if (!Object.prototype.hasOwnProperty.call(mergedSeen, itemKey)) {
              mergedSeen[itemKey] = true;
              mergedList.push(item);
            }
          });
          var mergedRaw = JSON.stringify(mergedList);
          if (mergedRaw !== localRaw) {
            nativeSetItem(key, mergedRaw);
            // Only force a page refresh when the union actually ADDED
            // items to show (server had favorites this device didn't).
            // Normalizing a missing key to "[]" changes nothing visible,
            // and reloading for it made every brand-new account's very
            // first page load flash-reload for no reason.
            if (mergedList.length) needsReload = true;
          }
          if (!hasServer || encodeForStorage(serverValues[key]) !== mergedRaw) {
            pushToServer(key, mergedRaw); // server was missing some -> bring it up to the union
          }
          return;
        }

        // Append-only log keys: structural merge so a stale/empty server
        // copy can never wipe locally-logged entries (see MERGE_LOG_KEYS).
        if (MERGE_LOG_KEYS.has(key)) {
          if (recentlyWrittenLocally) {
            // A just-made change (including a deletion) is authoritative;
            // make sure the server has it, don't merge the old copy back in.
            if (localRaw !== null && (!hasServer || encodeForStorage(serverValues[key]) !== localRaw)) {
              pushToServer(key, localRaw);
            }
            return;
          }
          var localLog = null, serverLog = null;
          try { localLog = localRaw !== null ? JSON.parse(localRaw) : null; } catch (e) { localLog = null; }
          serverLog = hasServer ? serverValues[key] : null;
          var mergedLog = mergeLog(key, localLog, serverLog);
          var mergedLogRaw = JSON.stringify(mergedLog);
          if (mergedLogRaw !== localRaw) {
            nativeSetItem(key, mergedLogRaw);
            // Reload only when the merge actually surfaced entries (e.g.
            // another device's logs, or adopting the account's data on a
            // fresh browser) -- not for an empty normalization.
            if (logHasEntries(mergedLog)) needsReload = true;
          }
          if (!hasServer || encodeForStorage(serverValues[key]) !== mergedLogRaw) {
            pushToServer(key, mergedLogRaw); // bring the server up to the merged log
          }
          return;
        }

        if (hasServer) {
          var encoded = encodeForStorage(serverValues[key]);
          if (localRaw !== encoded) {
            if (recentlyWrittenLocally) {
              pushToServer(key, localRaw);
            } else {
              nativeSetItem(key, encoded); // from the server — don't push it right back
              needsReload = true;
            }
          }
        } else if (localRaw !== null) {
          if (recentlyWrittenLocally || writtenLocallyEver) {
            // The server has no copy of this key, but this device DID write
            // it under the current account (recently, or at some earlier
            // point -- e.g. the onboarding wizard's save(), a meal log, or
            // a favorite that was toggled a while ago). The push that was
            // meant to sync it up simply never landed -- a dropped
            // sendBeacon, a flaky mobile connection, or an in-app browser
            // that doesn't deliver background requests reliably. This is
            // exactly how a rarely-re-written key like the favorites list
            // could "completely disappear": one failed push, and the old
            // behavior (delete anything the server hadn't seen) wiped it on
            // the very next load. Re-push it so the server catches up
            // instead of destroying the user's own data.
            pushToServer(key, localRaw);
          } else {
            // Server has never seen this key, and this device never wrote
            // it either (no write-times entry). It's stale leftover data
            // from whatever was in this browser before (a different
            // account's session that predates the logout-clearing below, a
            // shared/kiosk device, etc.), not this account's data. This
            // used to get "adopted" onto whichever account logs in next,
            // which is exactly how a brand-new signup ended up with a
            // previous account's food log, workout history, and HYROX times
            // already in it. Clear it instead so a new (or different)
            // account always starts genuinely empty.
            nativeRemoveItem(key);
          }
        }
      });

      // Forcing a reload while the user has an open modal (search, "add
      // to log" amount confirm, a wizard, ...) yanks the page out from
      // under whatever they were mid-way through -- including a food
      // they'd just picked but hadn't hit "Add to log" on yet, or were
      // about to. Every modal in this app follows the same "*-overlay"
      // element that's display:none until open, so this is a generic
      // enough check to skip the reload for now and let it happen on a
      // later, less disruptive page load instead (this hydration pull
      // itself already applied the server values via nativeSetItem
      // above -- only the *reload* is being deferred, so the page just
      // finishes catching up to them on next navigation rather than
      // right now).
      var hasOpenModal = Array.prototype.some.call(
        document.querySelectorAll('[class*="-overlay"]'),
        function (el) { return getComputedStyle(el).display !== "none"; }
      );

      if (needsReload && hasOpenModal) {
        sessionStorage.removeItem("repcheck_hydrated_reload");
      } else if (needsReload && !sessionStorage.getItem("repcheck_hydrated_reload")) {
        sessionStorage.setItem("repcheck_hydrated_reload", "1");
        location.reload();
      }
    })
    .catch(function () {});
})();
