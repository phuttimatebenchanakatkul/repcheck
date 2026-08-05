/**
 * Personalized nutrition coaching (nutrition page).
 *
 * Same architectural choice as static/hyrox.js: a single class that owns
 * its whole subtree and re-renders wholesale, with one delegated click
 * listener instead of many. It reads/writes the *same* localStorage keys
 * nutrition.html's own inline script uses for goals/log (so both stay in
 * sync), plus its own keys for the coaching profile, weight log, and
 * daily logging status.
 *
 * The actual calorie/macro math lives server-side in coaching_engine.py
 * (see /api/coaching/*) — this file is UI + local data plumbing only.
 */
(function () {
  "use strict";

  // Short alias for translations. Called at render time (not cached) so it
  // always reflects the current language, and the whole module re-renders
  // on "repcheck:language-changed".
  const t = (key, vars) => RepCheckI18n.t(key, vars);

  const PROFILE_KEY = "repcheck_coaching_profile_v1";
  const WEIGHT_LOG_KEY = "repcheck_weight_log_v1";
  const DAY_STATUS_KEY = "repcheck_day_status_v1";
  const LAST_ADJUSTMENT_KEY = "repcheck_coaching_last_adjustment_v1";
  const DISTRIBUTION_KEY = "repcheck_coaching_distribution_v1";
  const INACTIVITY_NOTIFIED_KEY = "repcheck_coaching_inactivity_notified_v1";
  // Mirrors templates/base.html's own copy of this same key -- set there
  // (and here, at check-in submit time) when a logged weight crosses the
  // profile's goalWeightKg, cleared the moment a later weigh-in drifts
  // back off-goal. Its only job is letting checkinDaysRemaining() force
  // check-in "ready" ahead of the normal 7-day cadence.
  const ACHIEVED_KEY = "repcheck_coaching_goal_achieved_v1";
  // Set once the user has completed the check-in for a given goal, so the
  // achievement doesn't re-fire on every subsequent weigh-in. Mirrors
  // base.html's constant of the same name -- see there for the full why.
  const ACHIEVED_HANDLED_KEY = "repcheck_coaching_goal_achieved_handled_v1";
  const GOALS_KEY = "repcheck_nutrition_goals_v1";          // shared with nutrition.html
  const NUTRITION_LOG_KEY = "repcheck_nutrition_log_v1";    // shared, read-only here
  const SPLIT_PLAN_KEY = "repcheck_split_plan_v1";          // shared with workouts.html, read-only here

  const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WEEKDAY_LETTERS_MON_FIRST = ["M", "T", "W", "T", "F", "S", "S"];

  // Mirrors coaching_engine.py's ranges exactly (same ids) so the choice
  // made here maps directly to the server-side calculation.
  const MALE_BODY_FAT_RANGES = [
    { id: "m1", label: "7-10%" },
    { id: "m2", label: "11-14%" },
    { id: "m3", label: "15-20%" },
    { id: "m4", label: "21-25%" },
    { id: "m5", label: "26-35%" },
    { id: "m6", label: "36-45%" },
  ];
  // Deliberately higher than the male ranges at each equivalent tier --
  // see coaching_engine.py's MALE/FEMALE_BODY_FAT_RANGES comment for why.
  const FEMALE_BODY_FAT_RANGES = [
    { id: "f1", label: "15-18%" },
    { id: "f2", label: "19-22%" },
    { id: "f3", label: "23-28%" },
    { id: "f4", label: "29-34%" },
    { id: "f5", label: "35-42%" },
    { id: "f6", label: "43-50%" },
  ];

  // Option ids only — titles/subs are looked up from i18n at render time
  // (coaching.<group>.<id>.title / .sub) so they follow the language.
  const ASPIRATION_IDS = ["lose", "maintain", "gain"];
  const ACTIVITY_IDS = ["lift_and_cardio", "cardio_only", "lift_only", "none"];
  const PROTEIN_IDS = ["low_moderate", "moderate", "high", "highest"];
  const DIET_IDS = ["balanced", "low_fat", "low_carb", "keto"];
  const DISTRIBUTION_IDS = ["stable", "weekly"];

  // Same icon set as onboarding.js's identical wizard steps (duplicated,
  // not imported -- see this file's header comment for why the two
  // wizards are kept as separate modules) so re-configuring goals here
  // looks like the same flow as first-time setup, not a plainer cousin
  // of it.
  const ICONS = {
    trendDown: `<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>`,
    equal: `<line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/>`,
    trendUp: `<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
    male: `<circle cx="10" cy="14" r="6"/><line x1="14.5" y1="9.5" x2="20" y2="4"/><polyline points="14 4 20 4 20 10"/>`,
    female: `<circle cx="12" cy="9" r="6"/><line x1="12" y1="15" x2="12" y2="21"/><line x1="9" y1="18" x2="15" y2="18"/>`,
    dumbbell: `<rect x="2" y="9" width="3" height="6" rx="1"/><rect x="19" y="9" width="3" height="6" rx="1"/><rect x="6" y="7" width="2.5" height="10" rx="1"/><rect x="15.5" y="7" width="2.5" height="10" rx="1"/><line x1="8.5" y1="12" x2="15.5" y2="12"/>`,
    pulse: `<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`,
    liftCardio: `<circle cx="3" cy="12" r="2"/><circle cx="21" cy="12" r="2"/><polyline points="5 12 9 12 11 6 13 18 15 12 19 12"/>`,
    moon: `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>`,
    plate: `<circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="3"/><line x1="12" y1="12" x2="19" y2="16.5"/><line x1="12" y1="12" x2="5" y2="16.5"/>`,
    droplet: `<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S13 5 12 2c-1 3-2 4.4-4 6.5S5 13 5 15a7 7 0 0 0 7 7Z"/><line x1="4" y1="4" x2="20" y2="20"/>`,
    wheatSlash: `<line x1="12" y1="22" x2="12" y2="8"/><line x1="12" y1="10" x2="8" y2="7"/><line x1="12" y1="10" x2="16" y2="7"/><line x1="12" y1="14" x2="8" y2="11"/><line x1="12" y1="14" x2="16" y2="11"/><line x1="12" y1="18" x2="8" y2="15"/><line x1="12" y1="18" x2="16" y2="15"/><line x1="4" y1="4" x2="20" y2="20"/>`,
    avocado: `<path d="M12 2c4 3 6 7 6 11a6 6 0 0 1-12 0c0-4 2-8 6-11Z"/><circle cx="12" cy="14" r="3"/>`,
    barsEven: `<rect x="4" y="8" width="4" height="10" rx="1"/><rect x="10" y="8" width="4" height="10" rx="1"/><rect x="16" y="8" width="4" height="10" rx="1"/>`,
    barsUneven: `<rect x="4" y="12" width="4" height="6" rx="1"/><rect x="10" y="6" width="4" height="12" rx="1"/><rect x="16" y="9" width="4" height="9" rx="1"/>`,
  };
  function iconSvg(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  }
  // A single reusable "how much" glyph (1-4 filled bars) instead of four
  // unrelated icons -- protein preference is a magnitude, not a category,
  // so the icon reads as a meter, not a symbol per option.
  function proteinMeterSvg(filled) {
    let bars = "";
    for (let i = 0; i < 4; i++) {
      const h = 6 + i * 4;
      const y = 20 - h;
      bars += i < filled
        ? `<rect x="${2 + i * 6}" y="${y}" width="4" height="${h}" rx="1"/>`
        : `<rect x="${2 + i * 6}" y="${y}" width="4" height="${h}" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
    }
    return `<svg viewBox="0 0 24 24" fill="currentColor">${bars}</svg>`;
  }
  const ASPIRATION_ICONS = { lose: "trendDown", maintain: "equal", gain: "trendUp" };
  const GENDER_ICONS = { male: "male", female: "female" };
  const ACTIVITY_ICONS = { lift_and_cardio: "liftCardio", cardio_only: "pulse", lift_only: "dumbbell", none: "moon" };
  const DIET_ICONS = { balanced: "plate", low_fat: "droplet", low_carb: "wheatSlash", keto: "avocado" };
  const DISTRIBUTION_ICONS = { stable: "barsEven", weekly: "barsUneven" };

  function optionsFor(ids, prefix, iconMap) {
    return ids.map((id) => ({
      id,
      title: t(`${prefix}.${id}.title`),
      sub: t(`${prefix}.${id}.sub`),
      icon: iconMap ? iconSvg(iconMap[id]) : null,
    }));
  }

  function aspirationTitle(id) {
    return t(`coaching.aspiration.${id}.title`);
  }

  const WIZARD_STEPS = ["aspiration", "weight_gender", "goal_weight", "height", "body_type", "activity", "protein", "diet", "distribution", "result"];
  const HEIGHT_MIN_CM = 130;
  const HEIGHT_MAX_CM = 230;
  // Same bounds as onboarding.js's identical goal-weight step.
  const MIN_WEIGHT_KG = 35;
  const MAX_WEIGHT_KG = 400;
  // Mirrors coaching_engine.py's LOSS_RATE_*/GAIN_RATE_* constants exactly
  // -- keep these in sync if those ever change. Gain's range sits lower
  // than loss's (see that file's GAIN_RATE_* comment for why).
  const LOSS_RATE_MIN_PCT = 1.0;
  const LOSS_RATE_MAX_PCT = 2.0;
  const LOSS_RATE_DEFAULT_PCT = 1.5;
  const GAIN_RATE_MIN_PCT = 0.25;
  const GAIN_RATE_MAX_PCT = 0.5;
  const GAIN_RATE_DEFAULT_PCT = 0.35;

  // ---------- Small local helpers ----------
  function toIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function daysSince(dateIso) {
    if (!dateIso) return Infinity;
    const then = new Date(dateIso + "T00:00:00");
    const now = new Date();
    return Math.floor((now - then) / 86400000);
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  }
  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  // Small fixed-position confirmation/error toast, shared by anything in
  // this file that does an awaited server write (currently just
  // persistWeightEntry) and wants to make the save result
  // visible rather than silent -- mirrors nutrition.html's own
  // .nl-save-error-toast pattern for the same reason (that page confirmed
  // this was needed after "logged food that then vanished" bug reports).
  function showSaveToast(message, isError) {
    const existing = document.querySelector(".pc-save-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `pc-save-toast ${isError ? "is-error" : "is-success"}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), isError ? 6000 : 2500);
  }

  function bodyFatRangesFor(gender) {
    return gender === "female" ? FEMALE_BODY_FAT_RANGES : MALE_BODY_FAT_RANGES;
  }

  // Realistic 3D-render body-fat reference images (static/bodyfat/*.webp,
  // one per range id m1..m6 / f1..f6) so users can actually compare
  // themselves to the figure, like the reference charts fitness apps use.
  // Generated once with the app's own Gemini image model -- no third-party
  // copyright baggage -- and shipped as ordinary static assets.
  //
  // onerror falls back to a neutral body silhouette (inline base64 SVG) so a
  // failed image load never shows the browser's broken-image glyph -- same
  // fallback as onboarding.js's bodyTypeImageHtml.
  var BODY_TYPE_FALLBACK_SRC = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0ODAgNDgwIj48ZyBmaWxsPSIjOGI4ZjlhIj48Y2lyY2xlIGN4PSIyNDAiIGN5PSIxNTAiIHI9IjcyIi8+PHBhdGggZD0iTTExMCA0ODBjMC05NiA1OC0xNjAgMTMwLTE2MHMxMzAgNjQgMTMwIDE2MHoiLz48L2c+PC9zdmc+";
  function bodyTypeImageHtml(rangeId) {
    return `<img src="/static/bodyfat/${rangeId}.webp" alt="" loading="lazy" class="pc-body-type-img" onerror="this.onerror=null;this.src='${BODY_TYPE_FALLBACK_SRC}'">`;
  }

  function loadWeightLog() { return loadJson(WEIGHT_LOG_KEY, {}); }
  function loadDayStatusMap() { return loadJson(DAY_STATUS_KEY, {}); }
  function loadNutritionLog() { return loadJson(NUTRITION_LOG_KEY, {}); }

  function sumCaloriesForDay(entries) {
    if (!Array.isArray(entries)) return 0;
    return entries.reduce((sum, entry) => {
      const items = (entry.ingredients && entry.ingredients.length) ? entry.ingredients : [entry];
      return sum + items.reduce((s, item) => s + (item.baseCalories * item.grams) / 100, 0);
    }, 0);
  }

  // Same per-entry scaling as sumCaloriesForDay, but broken out by macro
  // (grams, not calories) -- used to show "eaten so far today" against
  // the coaching card's protein/fat/carb targets.
  function sumMacrosForDay(entries) {
    const totals = { protein: 0, fat: 0, carbs: 0 };
    if (!Array.isArray(entries)) return totals;
    entries.forEach((entry) => {
      const items = (entry.ingredients && entry.ingredients.length) ? entry.ingredients : [entry];
      items.forEach((item) => {
        const scale = item.grams / 100;
        totals.protein += item.baseProtein * scale;
        totals.fat += item.baseFat * scale;
        totals.carbs += item.baseCarbs * scale;
      });
    });
    return totals;
  }

  function hasEntries(dateIso, nutritionLog) {
    const entries = nutritionLog[dateIso];
    return Array.isArray(entries) && entries.length > 0;
  }

  function getDayStatus(dateIso, nutritionLog, dayStatusMap) {
    const override = dayStatusMap[dateIso];
    if (override === "fasting" || override === "incomplete") return override;
    return hasEntries(dateIso, nutritionLog) ? "logged" : "none";
  }

  function computeStatusStreak(nutritionLog, dayStatusMap) {
    let cursor = new Date();
    if (getDayStatus(toIsoDate(cursor), nutritionLog, dayStatusMap) !== "logged") {
      cursor.setDate(cursor.getDate() - 1);
    }
    let streak = 0;
    while (getDayStatus(toIsoDate(cursor), nutritionLog, dayStatusMap) === "logged") {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function getTrainingDaysFromSplitPlan() {
    const plan = loadJson(SPLIT_PLAN_KEY, null);
    if (!plan || !plan.schedule) return [];
    return Object.keys(plan.schedule).filter((day) => plan.schedule[day] && plan.schedule[day] !== "Rest");
  }

  function startOfWeekMonday(date) {
    const d = new Date(date);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  // ---------- Main controller ----------
  class CoachingApp {
    constructor(root) {
      this.root = root;
      this.profile = loadJson(PROFILE_KEY, null);
      this.lastAdjustment = loadJson(LAST_ADJUSTMENT_KEY, null);
      this.wizard = null;
      this.dayPopup = null;
      this.checkin = null; // weekly check-in modal state -- see maybeShowWeeklyCheckin()
      // Which of the two views the weekly bar chart is showing --
      // "remaining" (default): what's left (or over) toward each day's
      // target. "consumed": totals actually eaten that day. Switched via
      // the Consumed/Remaining segmented control under the chart; resets
      // to "remaining" on reload rather than persisting, since that's the
      // more useful default to land back on.
      this.macroChartMode = "remaining";
      // Which day's numbers the chart's right-hand "X of Y" figures show
      // -- defaults to today, changeable by tapping any day column.
      this.selectedChartDay = toIsoDate(new Date());

      // Delegated on document rather than this.root: the weekly check-in
      // button now lives in nutrition.html's static "Today's Totals"
      // header, outside this module's own subtree (see syncCheckinButton()),
      // so the listener has to reach it too.
      document.addEventListener("click", (event) => this.handleClick(event));
      // Re-render the whole module (keeping wizard/popup state) when the
      // language changes, so all its dynamically-built text switches too.
      document.addEventListener("repcheck:language-changed", () => this.render());
      // Same idea for units (kg/lb, cm/ft-in) — weight/height fields
      // re-render in whatever the user just switched to.
      document.addEventListener("repcheck:units-changed", () => this.render());
      // nutrition.html's saveLog() fires this on every add/edit/remove —
      // without it, the coaching card's "eaten today" bar fill only
      // reflected the log as of the last full page load, so logging a
      // food didn't visibly move the bars until you reloaded the page.
      document.addEventListener("repcheck:nutrition-log-updated", () => this.render());
      // base.html's own weight-log flow is what actually sets/clears
      // ACHIEVED_KEY (it runs on every page, this module only on
      // /nutrition) -- this just re-renders so an already-mounted Check-in
      // button here flips to "ready" immediately instead of needing a
      // reload once that flag changes.
      document.addEventListener("repcheck:weight-logged", () => this.render());

      this.applyTodaysDistributedGoalIfNeeded();
      this.maybeNotifyInactivity();
      this.render();
    }

    // ---------- Event handling ----------
    handleClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;

      if (action === "open-wizard") return this.openWizard();
      if (action === "close-wizard") return this.closeWizard();
      if (action === "wizard-set-aspiration") return this.wizardSet("aspiration", target.dataset.value);
      if (action === "wizard-set-gender") return this.wizardSet("gender", target.dataset.value);
      if (action === "wizard-set-body-type") return this.wizardSet("bodyFatRangeId", target.dataset.value);
      if (action === "wizard-set-activity") return this.wizardSet("activityLevel", target.dataset.value);
      if (action === "wizard-set-protein") return this.wizardSet("proteinPreference", target.dataset.value);
      if (action === "wizard-set-diet") return this.wizardSet("dietPreference", target.dataset.value);
      if (action === "wizard-set-distribution") return this.wizardSet("distribution", target.dataset.value);
      if (action === "wizard-next") return this.wizardNext();
      if (action === "wizard-back") return this.wizardBack();
      if (action === "wizard-save") return this.wizardSave();
      if (action === "set-chart-mode") return this.setChartMode(target.dataset.mode);
      if (action === "select-chart-day") return this.selectChartDay(target.dataset.date);
      if (action === "open-day-popup") return this.openDayPopup(target.dataset.date);
      if (action === "close-day-popup") return this.closeDayPopup();
      if (action === "set-day-status") return this.setDayStatus(target.dataset.status);
      if (action === "dismiss-inactivity") return this.dismissInactivity();
      if (action === "open-checkin") return this.openCheckin();
      if (action === "cycle-checkin-day") return this.cycleCheckinDayStatus(target.dataset.date);
      if (action === "checkin-submit") return this.submitCheckin();
      if (action === "checkin-done") return this.closeCheckin();
      if (action === "checkin-set-new-goals") return this.closeCheckin(() => this.openWizard());
    }

    // ---------- Inactivity ----------
    getLastActivityIso() {
      const weightDates = Object.keys(loadWeightLog());
      const nutritionLog = loadNutritionLog();
      const nutritionDates = Object.keys(nutritionLog).filter((d) => (nutritionLog[d] || []).length);
      const all = [...weightDates, ...nutritionDates].sort();
      return all.length ? all[all.length - 1] : null;
    }

    maybeNotifyInactivity() {
      if (!this.profile) return;
      const lastActivity = this.getLastActivityIso() || this.profile.createdAt;
      const idle = daysSince(lastActivity);
      if (idle < 3) return;
      if (!("Notification" in window)) return;

      const todayIso = toIsoDate(new Date());
      if (localStorage.getItem(INACTIVITY_NOTIFIED_KEY) === todayIso) return;

      const fire = () => {
        try {
          new Notification("RepCheck", {
            body: t("coaching.notify.body"),
            icon: "/static/logo-mark.png",
          });
        } catch (err) { /* some browsers restrict this without a service worker — the in-app banner still shows */ }
        localStorage.setItem(INACTIVITY_NOTIFIED_KEY, todayIso);
      };

      if (Notification.permission === "granted") {
        fire();
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => { if (perm === "granted") fire(); });
      }
    }

    dismissInactivity() {
      localStorage.setItem(INACTIVITY_NOTIFIED_KEY, toIsoDate(new Date()));
      this.render();
    }

    // ---------- Weekly check-in ----------
    // Surfaced as a "Check in" button (here and on the home page's
    // Nutrition tile) that's disabled with a "come back in N days"
    // message until 7 days have passed since the last check-in, rather
    // than popping up on its own. Once due, it opens a modal to review/
    // adjust each of the last 7 days' logging status, confirm today's
    // weight, optionally attach front/back progress photos, then run the
    // calorie-adjustment analysis and show the result before it can be
    // dismissed. The actual adjustment math lives in coaching_engine.py's
    // weekly_adjustment() (no photos) or checkin_analyzer.py (photos
    // provided, AI-reviewed but still bounded by the same safety cap) --
    // this file is UI + local data plumbing only.
    checkinDaysRemaining() {
      if (!this.profile) return null;
      // Goal reached -- ready right now regardless of the normal cadence.
      // See ACHIEVED_KEY's own comment; home.html mirrors this same
      // override in its duplicated due-logic.
      if (loadJson(ACHIEVED_KEY, null)) return 0;
      const lastCheck = this.profile.lastAdjustmentDate || this.profile.createdAt;
      return Math.max(0, 7 - daysSince(lastCheck));
    }

    // Stateless re-check at check-in submit time -- never trust the
    // persisted ACHIEVED_KEY flag here, since that's only for
    // checkinDaysRemaining()'s early "ready" override, not a cache of
    // this result. Mirrors templates/base.html's own copy of this check.
    checkGoalAchievedNow() {
      if (!this.profile || !this.profile.aspiration || this.profile.aspiration === "maintain" || !this.profile.goalWeightKg) return false;
      const weightLog = loadWeightLog();
      const dates = Object.keys(weightLog).sort();
      if (!dates.length) return false;
      const latest = weightLog[dates[dates.length - 1]].kg;
      const goal = parseFloat(this.profile.goalWeightKg);
      return this.profile.aspiration === "lose" ? latest <= goal : latest >= goal;
    }

    openCheckin() {
      // this.profile is otherwise only ever set once, at construction (see
      // the constructor) or when the wizard is saved -- unlike weightLog/
      // dayStatusMap/nutritionLog below, which this function already
      // reloads fresh every time. account_sync.js's server hydration can
      // update PROFILE_KEY in localStorage via nativeSetItem without this
      // instance ever finding out (its normal page-reload refresh is
      // deliberately SKIPPED while a modal -- including this very check-in
      // sheet, or any other "*-overlay" element -- is open, so it can be
      // deferred indefinitely for a tab that's been sitting open). Refresh
      // BEFORE the days-remaining check below, not after, so a stale
      // lastAdjustmentDate can't wrongly gate opening either. A tab open
      // since before the profile's last real edit would otherwise submit
      // whatever stale (or, for one open before any profile ever existed,
      // entirely absent) snapshot it started with -- reachable on any
      // profile field, surfacing as that field's specific server error
      // ("Please choose a gender", etc.) instead of the generic one, since
      // the request itself is well-formed and reaches the validator fine.
      this.profile = loadJson(PROFILE_KEY, null);
      if (this.checkinDaysRemaining() > 0) return;

      const weightLog = loadWeightLog();
      const dayStatusMap = loadDayStatusMap();
      const nutritionLog = loadNutritionLog();
      const todayIso = toIsoDate(new Date());
      const todaysEntry = weightLog[todayIso];

      const weekDates = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        weekDates.push(toIsoDate(d));
      }
      const dayStatuses = {};
      weekDates.forEach((iso) => { dayStatuses[iso] = getDayStatus(iso, nutritionLog, dayStatusMap); });

      this.checkin = {
        step: "gather",
        todayIso,
        weekDates,
        dayStatuses,
        alreadyLoggedToday: !!todaysEntry,
        weightInput: todaysEntry ? String(RepCheckUnits.kgToDisplay(todaysEntry.kg)) : "",
        frontPhotoFile: null,
        backPhotoFile: null,
        frontPhotoPreviewUrl: null,
        backPhotoPreviewUrl: null,
        frontPhotoId: null,
        backPhotoId: null,
        submitting: false,
        error: null,
        result: null,
      };
      this.render();
    }

    // Same restriction as the pre-existing day-popup (renderDayPopup):
    // a day with zero food entries can only ever be "not logged" or
    // "fasting"; a day with entries can only be "logged" or "incomplete".
    cycleCheckinDayStatus(dateIso) {
      const nutritionLog = loadNutritionLog();
      const hasEntries = Array.isArray(nutritionLog[dateIso]) && nutritionLog[dateIso].length > 0;
      const options = hasEntries ? ["logged", "incomplete"] : ["none", "fasting"];
      const current = this.checkin.dayStatuses[dateIso];
      const next = options[(options.indexOf(current) + 1) % options.length];

      const dayStatusMap = loadDayStatusMap();
      if (next === "logged" || next === "none") {
        delete dayStatusMap[dateIso]; // back to automatic detection
      } else {
        dayStatusMap[dateIso] = next;
      }
      saveJson(DAY_STATUS_KEY, dayStatusMap);
      this.checkin.dayStatuses[dateIso] = getDayStatus(dateIso, nutritionLog, dayStatusMap);
      this.render();
    }

    setCheckinPhoto(angle, file) {
      const fileKey = angle === "front" ? "frontPhotoFile" : "backPhotoFile";
      const urlKey = angle === "front" ? "frontPhotoPreviewUrl" : "backPhotoPreviewUrl";
      if (this.checkin[urlKey]) URL.revokeObjectURL(this.checkin[urlKey]);
      this.checkin[fileKey] = file;
      this.checkin[urlKey] = file ? URL.createObjectURL(file) : null;
      this.render();
    }

    async uploadCheckinPhoto(angle, file, dateIso) {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("angle", angle);
      formData.append("date", dateIso);
      try {
        const res = await fetch("/api/checkin/photo", { method: "POST", body: formData });
        const data = await res.json();
        return data.ok ? data.id : null;
      } catch (err) {
        // Best-effort -- a failed photo upload shouldn't block the rest of
        // the check-in (weight + calorie adjustment are the parts that
        // actually matter for the coaching loop); it just won't be part
        // of the AI's review this time.
        return null;
      }
    }

    async submitCheckin() {
      const c = this.checkin;
      if (c.submitting) return;
      c.submitting = true;
      c.error = null;
      this.render();

      try {
        if (!c.alreadyLoggedToday && c.weightInput) {
          const kg = RepCheckUnits.displayToKg(c.weightInput);
          if (kg && kg > 0 && kg <= 400) {
            const entry = { kg, loggedAt: Date.now() };
            if (window.REPCHECK_LOGGED_IN) {
              // persistWeightEntry() writes localStorage itself, from the
              // server's authoritative response -- see that function.
              await this.persistWeightEntry(c.todayIso, entry);
            } else {
              const weightLog = loadWeightLog();
              weightLog[c.todayIso] = entry;
              saveJson(WEIGHT_LOG_KEY, weightLog);
            }
          }
        }

        if (this.checkGoalAchievedNow()) {
          // Skip the normal adjustment fetch (and any attached photos --
          // they'd have nothing left to be analyzed for) entirely: the
          // goal is met, so the only meaningful next step is re-running
          // the full wizard, not a macro tweak. lastAdjustmentDate still
          // advances as normal so the 7-day cadence stays in sync.
          //
          // ACHIEVED_KEY is CLEARED here, not set: it exists purely to
          // force check-in "ready" ahead of the 7-day cadence once the
          // goal is hit (checkinDaysRemaining() returns 0 while it's
          // present). Setting it at submit time meant that override never
          // switched off -- the home banner kept advertising a check-in
          // that was already done, and the nutrition button stayed
          // clickable forever. Completing the check-in IS the thing it
          // was waiting for, so it has done its job. Re-running the
          // wizard is driven by the result screen's own "Set new goals"
          // button, not by this flag.
          localStorage.removeItem(ACHIEVED_KEY);
          // ...and remember they've acted on THIS goal, so the next
          // weigh-in (still at goal, naturally) doesn't immediately
          // re-fire the congrats sheet and re-ready the check-in.
          localStorage.setItem(ACHIEVED_HANDLED_KEY, JSON.stringify({
            goalWeightKg: parseFloat(this.profile.goalWeightKg),
            aspiration: this.profile.aspiration,
          }));
          this.profile.lastAdjustmentDate = c.todayIso;
          saveJson(PROFILE_KEY, this.profile);
          c.result = "goal-achieved";
          c.resultPrevious = null;
          c.step = "result";
          c.submitting = false;
          this.render();
          return;
        }

        const uploads = [];
        if (c.frontPhotoFile) uploads.push(this.uploadCheckinPhoto("front", c.frontPhotoFile, c.todayIso).then((id) => { c.frontPhotoId = id; }));
        if (c.backPhotoFile) uploads.push(this.uploadCheckinPhoto("back", c.backPhotoFile, c.todayIso).then((id) => { c.backPhotoId = id; }));
        await Promise.all(uploads);

        const weightLog = loadWeightLog();
        const dayStatusMap = loadDayStatusMap();
        const nutritionLog = loadNutritionLog();
        const weekWeightEntries = c.weekDates
          .filter((d) => weightLog[d])
          .map((d) => ({ date: d, kg: weightLog[d].kg }));
        const weekCalorieDays = c.weekDates
          .filter((d) => getDayStatus(d, nutritionLog, dayStatusMap) === "logged")
          .map((d) => ({ date: d, calories: sumCaloriesForDay(nutritionLog[d]) }));
        const currentGoals = loadJson(GOALS_KEY, null);
        const photoIds = [c.frontPhotoId, c.backPhotoId].filter((id) => id != null);

        let adjustment = null;
        let previousTargets = null;
        let requestFailed = false;
        let serverError = null;
        if (currentGoals) {
          // GOALS_KEY only ever stores {protein, fat, carbs} -- calories is
          // always derived for display (see renderWeekChart/renderGoalsCard)
          // and was never included here, so the backend's "calories"
          // required-field check on current_targets failed on every single
          // check-in submission. Compute it the same way display does.
          const currentTargets = {
            ...currentGoals,
            calories: Math.round(currentGoals.protein * 4 + currentGoals.fat * 9 + currentGoals.carbs * 4),
          };
          // Kept for the result screen, which shows each macro's old -> new
          // value -- after this block runs, GOALS_KEY already holds the NEW
          // targets, so this is the only copy of what they changed from.
          previousTargets = currentTargets;
          // Bound the wait from this side too. checkin_analyzer.py caps its
          // own Gemini call at CHECKIN_ANALYSIS_TIMEOUT_SECONDS (30s), which
          // covers a slow/hung MODEL -- but not a request that never reaches
          // the server or whose response never arrives (dropped mobile
          // connection, backgrounded tab, a dev server blocked by another
          // request). Without an abort here that fetch simply never settles,
          // so `submitting` stays true and "Complete check-in" is disabled on
          // "Loading..." forever, with no error and nothing to retry -- the
          // exact "I can't complete my check-in" report this guards against.
          // 45s = the server's 30s budget plus room for upload/latency, so a
          // request the server IS still working on isn't cut off early.
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 45000);
          let response;
          try {
            response = await fetch("/api/coaching/weekly-adjustment", {
              method: "POST",
              signal: controller.signal,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                aspiration: this.profile.aspiration,
                gender: this.profile.gender,
                weight_kg: this.profile.weightKg,
                body_fat_range_id: this.profile.bodyFatRangeId,
                activity_level: this.profile.activityLevel,
                protein_preference: this.profile.proteinPreference,
                diet_preference: this.profile.dietPreference,
                loss_rate_pct: this.profile.lossRatePct,
                gain_rate_pct: this.profile.gainRatePct,
                current_targets: currentTargets,
                week_weight_entries: weekWeightEntries,
                week_calorie_days: weekCalorieDays,
                photo_ids: photoIds,
              }),
            });
          } finally {
            clearTimeout(timeoutId);
          }
          const data = await response.json();
          if (data.ok) {
            adjustment = data.adjustment;
          } else {
            // A real failure (bad profile data, server error) is NOT the
            // same as "no adjustment needed" -- surface it instead of
            // silently completing the check-in with a false "on track"
            // message and burning the user's weekly attempt.
            requestFailed = true;
            // Keep the server's specific reason. It names the field that
            // actually failed ("Please choose an activity level"), which
            // the generic string cannot -- and when the cause is stored
            // profile data rather than anything on this screen, a bare
            // "something went wrong" leaves the user retrying a button
            // that will never succeed, with nothing to act on.
            serverError = typeof data.error === "string" ? data.error : null;
          }
          if (adjustment) {
            saveJson(GOALS_KEY, { protein: adjustment.protein, fat: adjustment.fat, carbs: adjustment.carbs });
            this.lastAdjustment = { reason: adjustment.reason, delta: adjustment.delta, at: Date.now() };
            saveJson(LAST_ADJUSTMENT_KEY, this.lastAdjustment);
            document.dispatchEvent(new CustomEvent("repcheck:goals-updated"));
          }
        }

        if (requestFailed) {
          // Don't mark the check-in as done -- lastAdjustmentDate stays put
          // so the user's weekly attempt isn't spent on a request that never
          // actually ran, and they can just retry the button.
          c.submitting = false;
          c.error = serverError || t("coaching.checkin.error");
          this.render();
          return;
        }

        this.profile.lastAdjustmentDate = c.todayIso;
        saveJson(PROFILE_KEY, this.profile);
        // ANY completed check-in retires the "ready early" override, not
        // just the goal-achieved one. Clearing it only on that branch left
        // a real hole: achieve the goal, dismiss the congrats sheet, drift
        // back off-goal, then check in. checkGoalAchievedNow() is false by
        // then, so this normal path ran -- and the stale flag kept
        // checkinDaysRemaining() pinned at 0, so the home banner and the
        // nutrition button stayed "ready" forever. (The flag would only
        // self-clear on the next weigh-in through base.html's modal; the
        // weight saved inside the check-in itself doesn't dispatch
        // repcheck:weight-logged, so it never ran that check.)
        localStorage.removeItem(ACHIEVED_KEY);

        c.result = adjustment;
        c.resultPrevious = previousTargets;
        c.step = "result";
        c.submitting = false;
        this.render();
      } catch (err) {
        c.submitting = false;
        c.error = t("coaching.checkin.error");
        this.render();
      }
    }

    // afterClose (optional): deferred until this sheet's own close-cleanup
    // finishes (threaded through syncCheckinSheet()'s closeBottomSheet call
    // below) so opening ANOTHER sheet in response -- e.g. "Set new goals"
    // opening the wizard -- never races the shared pc-sheet-locked cleanup
    // the way calling it immediately here would.
    closeCheckin(afterClose) {
      const c = this.checkin;
      if (c.frontPhotoPreviewUrl) URL.revokeObjectURL(c.frontPhotoPreviewUrl);
      if (c.backPhotoPreviewUrl) URL.revokeObjectURL(c.backPhotoPreviewUrl);
      this.checkin = null;
      this._checkinAfterClose = afterClose || null;
      this.render();
    }

    // ---------- Weekly distribution ----------
    applyTodaysDistributedGoalIfNeeded() {
      if (!this.profile || this.profile.distribution !== "weekly") return;
      const distribution = loadJson(DISTRIBUTION_KEY, null);
      if (!distribution) return;
      const todayKey = WEEKDAY_KEYS[new Date().getDay()];
      const todays = distribution[todayKey];
      if (!todays) return;
      const current = loadJson(GOALS_KEY, null);
      if (current && current.protein === todays.protein && current.fat === todays.fat && current.carbs === todays.carbs) return;
      saveJson(GOALS_KEY, { protein: todays.protein, fat: todays.fat, carbs: todays.carbs });
      document.dispatchEvent(new CustomEvent("repcheck:goals-updated"));
    }

    // ---------- Weekly chart controls ----------
    setChartMode(mode) {
      if (mode !== "consumed" && mode !== "remaining") return;
      if (mode === this.macroChartMode) return;
      this.macroChartMode = mode;
      this.updateWeekChart();
    }

    selectChartDay(dateIso) {
      if (!dateIso || dateIso === this.selectedChartDay) return;
      this.selectedChartDay = dateIso;
      this.updateWeekChart();
    }

    // ---------- Weight logging ----------
    // Authoritative server write for a weigh-in, same reasoning as
    // nutrition.html's persistLogEntry(): the generic localStorage-blob
    // sync (static/account_sync.js) is fire-and-forget and was letting a
    // freshly-logged weigh-in get silently overwritten by a stale
    // hydration pull if the user navigated away right after logging it.
    // This is awaited so the UI can show a clear, real confirmation (or a
    // real error) instead of just assuming the localStorage write alone
    // means it's actually saved to the account.
    async persistWeightEntry(dateIso, entry) {
      if (!window.REPCHECK_LOGGED_IN) return; // nothing to confirm — log-only-in-this-browser mode
      try {
        const response = await fetch("/api/weight/log-entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date: dateIso, entry }),
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "Save failed");
        // Adopt the server's response as the canonical log instead of
        // trusting this device's own locally-computed blob -- see the
        // identical fix (and reasoning) in base.html's "Log weight" sheet.
        if (data.weight_log) saveJson(WEIGHT_LOG_KEY, data.weight_log);
        showSaveToast(t("coaching.weight.saved"), false);
      } catch (err) {
        showSaveToast(t("coaching.weight.saveError"), true);
      }
    }

    // ---------- Day status popup ----------
    openDayPopup(dateIso) {
      this.dayPopup = { date: dateIso };
      this.render();
    }
    closeDayPopup() {
      this.dayPopup = null;
      this.render();
    }
    setDayStatus(status) {
      const dayStatusMap = loadDayStatusMap();
      if (status === "logged") {
        delete dayStatusMap[this.dayPopup.date]; // clear override -> back to automatic detection
      } else {
        dayStatusMap[this.dayPopup.date] = status;
      }
      saveJson(DAY_STATUS_KEY, dayStatusMap);
      this.dayPopup = null;
      this.render();
    }

    // ---------- Wizard ----------
    openWizard() {
      const p = this.profile;
      this.wizard = {
        stepIndex: 0,
        aspiration: p ? p.aspiration : null,
        gender: p ? p.gender : null,
        weightKg: p ? String(p.weightKg) : "",
        // Blank (not pre-filled) for a profile saved before this step
        // existed, or one saved through this wizard before this fix --
        // the user just re-enters it once, same as any other missing field.
        goalWeightKg: (p && p.goalWeightKg) ? String(p.goalWeightKg) : "",
        heightCm: (p && p.heightCm) || 170,
        bodyFatRangeId: p ? p.bodyFatRangeId : null,
        activityLevel: p ? p.activityLevel : null,
        proteinPreference: p ? p.proteinPreference : null,
        dietPreference: p ? p.dietPreference : "balanced",
        distribution: p ? p.distribution : "stable",
        lossRatePct: (p && p.lossRatePct) || LOSS_RATE_DEFAULT_PCT,
        gainRatePct: (p && p.gainRatePct) || GAIN_RATE_DEFAULT_PCT,
        result: null,
        computing: false,
        error: null,
      };
      this.render();
    }
    closeWizard() {
      this.wizard = null;
      this.render();
    }
    wizardSet(field, value) {
      this.wizard[field] = value;
      // Body-fat range ids are gender-specific (m1-m6 vs f1-f6). If the
      // user changes gender after already picking a body type (e.g. while
      // editing their profile), the old id is invalid for the new gender —
      // clear it so the body-type step doesn't show "nothing selected" yet
      // still let them advance and hit a server validation error.
      if (field === "gender") {
        const valid = bodyFatRangesFor(value).some((r) => r.id === this.wizard.bodyFatRangeId);
        if (!valid) this.wizard.bodyFatRangeId = null;
      }
      this.render();
    }

    wizardCanProceed() {
      const w = this.wizard;
      const step = WIZARD_STEPS[w.stepIndex];
      if (step === "aspiration") return !!w.aspiration;
      if (step === "weight_gender") return !!w.gender && parseFloat(w.weightKg) > 0 && parseFloat(w.weightKg) <= 400;
      if (step === "goal_weight") {
        const gv = parseFloat(w.goalWeightKg);
        return gv >= MIN_WEIGHT_KG && gv <= MAX_WEIGHT_KG;
      }
      if (step === "height") return w.heightCm >= HEIGHT_MIN_CM && w.heightCm <= HEIGHT_MAX_CM;
      if (step === "body_type") return !!w.bodyFatRangeId;
      if (step === "activity") return !!w.activityLevel;
      if (step === "protein") return !!w.proteinPreference;
      if (step === "diet") return !!w.dietPreference;
      if (step === "distribution") return !!w.distribution;
      return true;
    }

    // "goal_weight" only makes sense when actually moving away from the
    // current weight -- for "maintain" it's the same number by definition,
    // so the step is skipped rather than asking a redundant question. Not a
    // generic skip engine (nothing else in this wizard needs one) -- just
    // enough to walk past this one condition, mirroring onboarding.js's
    // shouldSkipStep/nextVisibleIndex/prevVisibleIndex shape.
    wizardShouldSkipStep(step) {
      return step === "goal_weight" && this.wizard.aspiration === "maintain";
    }
    wizardVisibleSteps() {
      return WIZARD_STEPS.filter((s) => !this.wizardShouldSkipStep(s));
    }
    nextVisibleIndex(fromIndex) {
      let idx = fromIndex + 1;
      while (idx < WIZARD_STEPS.length && this.wizardShouldSkipStep(WIZARD_STEPS[idx])) idx++;
      return idx;
    }
    prevVisibleIndex(fromIndex) {
      let idx = fromIndex - 1;
      while (idx >= 0 && this.wizardShouldSkipStep(WIZARD_STEPS[idx])) idx--;
      return idx;
    }

    async wizardNext() {
      if (!this.wizardCanProceed()) return;
      const w = this.wizard;
      const nextIndex = this.nextVisibleIndex(w.stepIndex);
      const nextStep = WIZARD_STEPS[nextIndex];

      if (nextStep === "result") {
        w.computing = true;
        w.error = null;
        w.stepIndex = nextIndex;
        this.render();

        try {
          const response = await fetch("/api/coaching/calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              aspiration: w.aspiration,
              gender: w.gender,
              weight_kg: parseFloat(w.weightKg),
              height_cm: w.heightCm,
              body_fat_range_id: w.bodyFatRangeId,
              activity_level: w.activityLevel,
              protein_preference: w.proteinPreference,
              diet_preference: w.dietPreference,
              distribution: w.distribution,
              loss_rate_pct: w.aspiration === "lose" ? w.lossRatePct : null,
              gain_rate_pct: w.aspiration === "gain" ? w.gainRatePct : null,
              training_days: getTrainingDaysFromSplitPlan(),
            }),
          });
          const data = await response.json();
          if (!data.ok) throw new Error(data.error || t("coaching.wizard.error"));
          w.result = data;
        } catch (err) {
          w.error = err.message || t("coaching.wizard.error");
        }
        w.computing = false;
        this.render();
        return;
      }

      w.stepIndex = nextIndex;
      this.render();
    }

    wizardBack() {
      if (this.wizard.stepIndex === 0) return;
      this.wizard.stepIndex = Math.max(0, this.prevVisibleIndex(this.wizard.stepIndex));
      this.wizard.result = null;
      this.render();
    }

    wizardSave() {
      const w = this.wizard;
      if (!w.result) return;

      const todayIso = toIsoDate(new Date());
      this.profile = {
        aspiration: w.aspiration,
        gender: w.gender,
        weightKg: parseFloat(w.weightKg),
        // BUG FIX: this whole object used to be built with no goalWeightKg
        // key at all, silently dropping it (this.profile was replaced
        // wholesale, not merged) for any profile that had one set by
        // onboarding.js -- same convention as onboarding.js's own save():
        // "maintain" has no distinct target, it's just the current weight.
        goalWeightKg: w.aspiration === "maintain" ? parseFloat(w.weightKg) : parseFloat(w.goalWeightKg),
        heightCm: w.heightCm,
        bodyFatRangeId: w.bodyFatRangeId,
        activityLevel: w.activityLevel,
        proteinPreference: w.proteinPreference,
        dietPreference: w.dietPreference,
        distribution: w.distribution,
        lossRatePct: w.aspiration === "lose" ? w.lossRatePct : null,
        gainRatePct: w.aspiration === "gain" ? w.gainRatePct : null,
        createdAt: (this.profile && this.profile.createdAt) || todayIso,
        lastAdjustmentDate: todayIso,
      };
      saveJson(PROFILE_KEY, this.profile);
      // Fresh goal -- reaching it is a new milestone, so let the
      // achievement flow fire again rather than staying suppressed by
      // whatever the user already acted on for the previous goal.
      localStorage.removeItem(ACHIEVED_KEY);
      localStorage.removeItem(ACHIEVED_HANDLED_KEY);
      saveJson(GOALS_KEY, {
        protein: w.result.targets.protein,
        fat: w.result.targets.fat,
        carbs: w.result.targets.carbs,
      });
      if (w.result.distribution) {
        saveJson(DISTRIBUTION_KEY, w.result.distribution);
      } else {
        localStorage.removeItem(DISTRIBUTION_KEY);
      }
      this.lastAdjustment = null;
      localStorage.removeItem(LAST_ADJUSTMENT_KEY);

      this.wizard = null;
      document.dispatchEvent(new CustomEvent("repcheck:goals-updated"));
      this.render();
    }

    // ---------- Rendering ----------
    render() {
      this.root.innerHTML = "";
      const frag = document.createDocumentFragment();

      const inactivityBanner = this.renderInactivityBanner();
      if (inactivityBanner) frag.appendChild(inactivityBanner);

      // The "Personalized coaching" goal/target card is intentionally not
      // rendered on the nutrition page anymore -- "Today's Totals" (the
      // ring + macro pills at the top of the main log card) is the primary
      // daily view now, and it's also where the weekly check-in button
      // lives (see syncCheckinButton()). Weight tracking has its own full
      // page at /weight-history, linked from the home page. The "Daily
      // logging" streak card is hidden too now (removed by request);
      // renderCoachingCard() and renderLoggingCard() are left defined so
      // either can be re-enabled by appending it here again if wanted.

      this.root.appendChild(frag);

      if (this.dayPopup) this.root.appendChild(this.renderDayPopup());
      this.syncCheckinSheet();
      this.syncWizardSheet();

      this.syncCheckinButton();
    }

    // The weekly check-in's entry point lives in "Today's Totals" at the
    // top of the page (static markup in nutrition.html, outside this
    // module's own subtree) rather than as its own pc-card here -- see
    // checkinDaysRemaining() for the due/not-due logic this mirrors.
    // Grey and inert until it's actually due, so it never asks for
    // attention it hasn't earned yet.
    syncCheckinButton() {
      const btn = document.getElementById("nl-checkin-btn");
      if (!btn) return;
      const daysLeft = this.checkinDaysRemaining();
      const isReady = daysLeft === 0;
      btn.classList.toggle("is-ready", isReady);
      btn.disabled = !isReady;
      btn.title = isReady || daysLeft === null
        ? ""
        : t("coaching.checkin.comeBackIn", { n: daysLeft, s: daysLeft === 1 ? "" : "s" });
    }

    renderInactivityBanner() {
      if (!this.profile) return null;
      const lastActivity = this.getLastActivityIso() || this.profile.createdAt;
      const idle = daysSince(lastActivity);
      if (idle < 3) return null;
      return el(`
        <div class="pc-inactivity-banner">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div style="flex:1;">${t("coaching.inactivity", { n: idle })}</div>
          <button type="button" class="pc-btn-secondary" data-action="dismiss-inactivity" style="flex-shrink:0;">${t("coaching.dismiss")}</button>
        </div>
      `);
    }

    // ---------- Weekly nutrition chart ----------
    // Four rows (Calories, Protein, Fat, Carbs), each with one bar per
    // day of the current week -- tap a day to see that day's numbers on
    // the right, tap Consumed/Remaining to switch what every bar's fill
    // means. goals/calories are today's flat daily target, used as the
    // target for every day (this app doesn't vary the target by weekday
    // outside the optional +/-10% training-day distribution, which stays
    // a separate "Stable"/"Distributed" note below the chart).
    renderWeekChart(goals, calories) {
      const isConsumedMode = this.macroChartMode === "consumed";
      const todayIso = toIsoDate(new Date());
      const weekStart = startOfWeekMonday(new Date());
      const nutritionLog = loadNutritionLog();

      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateIso = toIsoDate(d);
        const eaten = sumMacrosForDay(nutritionLog[dateIso]);
        return {
          dateIso,
          letter: WEEKDAY_LETTERS_MON_FIRST[i],
          isToday: dateIso === todayIso,
          isSelected: dateIso === this.selectedChartDay,
          consumed: {
            calories: Math.round(eaten.protein * 4 + eaten.fat * 9 + eaten.carbs * 4),
            protein: Math.round(eaten.protein),
            fat: Math.round(eaten.fat),
            carbs: Math.round(eaten.carbs),
          },
        };
      });
      const selectedDay = days.find((d) => d.isSelected) || days.find((d) => d.isToday) || days[0];

      const metrics = [
        { key: "calories", label: t("common.calories"), target: calories, unit: "kcal" },
        { key: "protein", label: t("common.protein"), target: goals.protein, unit: "g" },
        { key: "fat", label: t("common.fat"), target: goals.fat, unit: "g" },
        { key: "carbs", label: t("common.carbs"), target: goals.carbs, unit: "g" },
      ];

      // Bar fill %: "consumed" = how much of the target is eaten so far
      // (capped at 100 -- going over just means a full bar, no negative
      // weirdness in this compact view); "remaining" = how much target
      // capacity is left (0 once at or past it).
      function fillPct(target, consumed) {
        if (target <= 0) return consumed > 0 ? 100 : 0;
        if (isConsumedMode) return Math.max(0, Math.min(100, (consumed / target) * 100));
        return Math.max(0, Math.min(100, ((target - consumed) / target) * 100));
      }

      return `
        <div class="pc-week-card">
          <div class="pc-week-title">${t("coaching.week.title")}</div>
          <div class="pc-week-grid">
            ${metrics.map((m) => {
              // Same number the bar's fill represents -- how much has been
              // eaten in Consumed mode, how much is left toward the target
              // in Remaining mode (floored at 0, matching the bar itself
              // never showing negative "over" as more empty space).
              const selectedValue = isConsumedMode
                ? selectedDay.consumed[m.key]
                : Math.max(0, Math.round(m.target - selectedDay.consumed[m.key]));
              return `
                <div class="pc-week-row">
                  <div class="pc-week-row-label">
                    <span class="pc-week-dot pc-week-dot-${m.key}"></span>${m.label}
                  </div>
                  <div class="pc-week-row-bars">
                    ${days.map((d) => `
                      <button
                        type="button"
                        class="pc-week-bar-col ${d.isSelected ? "is-selected" : ""}"
                        data-action="select-chart-day"
                        data-date="${d.dateIso}"
                        aria-label="${d.dateIso}"
                      >
                        <span class="pc-week-bar-track">
                          <span class="pc-week-bar-fill pc-week-bar-${m.key}" data-metric="${m.key}" data-date="${d.dateIso}" style="height:${fillPct(m.target, d.consumed[m.key])}%;"></span>
                        </span>
                      </button>
                    `).join("")}
                  </div>
                  <div class="pc-week-row-total">
                    <span class="pc-week-row-total-value" data-metric-total="${m.key}">${selectedValue}${m.unit === "g" ? "g" : ""}</span>
                    <span class="pc-week-row-total-of">${t("coaching.week.of", { n: Math.round(m.target) })}</span>
                  </div>
                </div>
              `;
            }).join("")}
            <div class="pc-week-row pc-week-daylabels-row">
              <div class="pc-week-row-label"></div>
              <div class="pc-week-row-bars">
                ${days.map((d) => `
                  <button type="button" class="pc-week-daylabel ${d.isSelected ? "is-selected" : ""} ${d.isToday ? "is-today" : ""}" data-action="select-chart-day" data-date="${d.dateIso}">${d.letter}</button>
                `).join("")}
              </div>
              <div class="pc-week-row-total"></div>
            </div>
          </div>
          <div class="pc-week-toggle">
            <button type="button" class="pc-week-toggle-btn ${!isConsumedMode ? "" : "is-active"}" data-action="set-chart-mode" data-mode="consumed">${t("coaching.week.consumed")}</button>
            <button type="button" class="pc-week-toggle-btn ${isConsumedMode ? "" : "is-active"}" data-action="set-chart-mode" data-mode="remaining">${t("coaching.week.remaining")}</button>
          </div>
        </div>
      `;
    }

    // Updates the existing week-chart bars/numbers/selection in place
    // instead of going through the normal full this.render() (which does
    // this.root.innerHTML = "" and rebuilds everything from scratch --
    // see render() above). That teardown/rebuild is exactly why toggling
    // Consumed/Remaining or tapping a different day used to jump instantly
    // instead of animating: a brand new <span> already at the new height
    // has nothing to transition *from*, even with the CSS `transition:
    // height` already on .pc-week-bar-fill. Mutating the same, still-
    // mounted elements lets that transition actually interpolate.
    // Falls back to a full render() if the chart isn't currently on the
    // page (e.g. coaching isn't set up yet, so renderWeekChart never ran).
    updateWeekChart() {
      if (!this.profile || !this.root.querySelector(".pc-week-card")) {
        this.render();
        return;
      }

      const isConsumedMode = this.macroChartMode === "consumed";
      const todayIso = toIsoDate(new Date());
      const weekStart = startOfWeekMonday(new Date());
      const nutritionLog = loadNutritionLog();
      const goals = loadJson(GOALS_KEY, { protein: 0, fat: 0, carbs: 0 });
      const calories = Math.round(goals.protein * 4 + goals.fat * 9 + goals.carbs * 4);

      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const dateIso = toIsoDate(d);
        const eaten = sumMacrosForDay(nutritionLog[dateIso]);
        return {
          dateIso,
          isToday: dateIso === todayIso,
          isSelected: dateIso === this.selectedChartDay,
          consumed: {
            calories: Math.round(eaten.protein * 4 + eaten.fat * 9 + eaten.carbs * 4),
            protein: Math.round(eaten.protein),
            fat: Math.round(eaten.fat),
            carbs: Math.round(eaten.carbs),
          },
        };
      });
      const selectedDay = days.find((d) => d.isSelected) || days.find((d) => d.isToday) || days[0];

      const metrics = [
        { key: "calories", target: calories, unit: "kcal" },
        { key: "protein", target: goals.protein, unit: "g" },
        { key: "fat", target: goals.fat, unit: "g" },
        { key: "carbs", target: goals.carbs, unit: "g" },
      ];
      function fillPct(target, consumed) {
        if (target <= 0) return consumed > 0 ? 100 : 0;
        if (isConsumedMode) return Math.max(0, Math.min(100, (consumed / target) * 100));
        return Math.max(0, Math.min(100, ((target - consumed) / target) * 100));
      }

      metrics.forEach((m) => {
        days.forEach((d) => {
          const fillEl = this.root.querySelector(`.pc-week-bar-fill[data-metric="${m.key}"][data-date="${d.dateIso}"]`);
          if (fillEl) fillEl.style.height = `${fillPct(m.target, d.consumed[m.key])}%`;
        });
        const selectedValue = isConsumedMode
          ? selectedDay.consumed[m.key]
          : Math.max(0, Math.round(m.target - selectedDay.consumed[m.key]));
        const totalEl = this.root.querySelector(`.pc-week-row-total-value[data-metric-total="${m.key}"]`);
        if (totalEl) totalEl.textContent = `${selectedValue}${m.unit === "g" ? "g" : ""}`;
      });

      this.root.querySelectorAll(".pc-week-bar-col").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.date === this.selectedChartDay);
      });
      this.root.querySelectorAll(".pc-week-daylabel").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.date === this.selectedChartDay);
      });
      this.root.querySelectorAll(".pc-week-toggle-btn").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.mode === this.macroChartMode);
      });
    }

    renderCoachingCard() {
      if (!this.profile) {
        return el(`
          <div class="pc-card">
            <div class="pc-card-title">${t("coaching.title")}</div>
            <div class="pc-setup-cta">
              <div class="pc-setup-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
              </div>
              <div class="pc-setup-text">
                <strong>${t("coaching.setup.lead")}</strong> ${t("coaching.setup.body")}
              </div>
            </div>
            <button type="button" class="pc-btn-primary" data-action="open-wizard" style="margin-top:14px;">${t("coaching.setup.button")}</button>
          </div>
        `);
      }

      const goals = loadJson(GOALS_KEY, { protein: 0, fat: 0, carbs: 0 });
      const calories = Math.round(goals.protein * 4 + goals.fat * 9 + goals.carbs * 4);
      const aspirationLabel = aspirationTitle(this.profile.aspiration);
      const weekChart = this.renderWeekChart(goals, calories);
      const card = el(`
        <div class="pc-card">
          <div class="pc-card-head">
            <div>
              <div class="pc-card-title">${t("coaching.title")}</div>
              <div class="pc-card-sub">${t("coaching.goalPrefix")} ${aspirationLabel}</div>
            </div>
          </div>
          <div class="pc-target-row">
            <div class="pc-target-calories">${calories}</div>
            <div class="pc-target-label">${t("coaching.kcalPerDayTarget")}</div>
          </div>
          ${weekChart}
          <div id="pc-adjustment-slot"></div>
          <div class="pc-card-actions">
            <button type="button" class="pc-btn-secondary" data-action="open-wizard">${t("coaching.editProfile")}</button>
            ${this.renderCheckinButtonHtml()}
          </div>
        </div>
      `);

      if (this.lastAdjustment) {
        const slot = card.querySelector("#pc-adjustment-slot");
        const sign = this.lastAdjustment.delta > 0 ? "+" : "";
        slot.appendChild(el(`
          <div class="pc-adjustment-banner">
            <strong>${t("coaching.adjustmentPrefix", { sign, delta: this.lastAdjustment.delta })}</strong> ${this.lastAdjustment.reason}
          </div>
        `));
      }

      return card;
    }

    // Shared by renderCoachingCard() above and syncCheckinButton() --
    // home.html's own Nutrition tile shows the same button/countdown by
    // reading repcheck_coaching_profile_v1 directly (see that template),
    // since it's a separate page script and doesn't load this class.
    renderCheckinButtonHtml() {
      const daysLeft = this.checkinDaysRemaining();
      if (daysLeft > 0) {
        const label = t("coaching.checkin.comeBackIn", { n: daysLeft, s: daysLeft === 1 ? "" : "s" });
        return `<button type="button" class="pc-btn-secondary" disabled title="${label}">${label}</button>`;
      }
      return `<button type="button" class="pc-btn-primary" data-action="open-checkin">${t("coaching.checkin.button")}</button>`;
    }

    renderLoggingCard() {
      const nutritionLog = loadNutritionLog();
      const dayStatusMap = loadDayStatusMap();
      const streak = computeStatusStreak(nutritionLog, dayStatusMap);

      const weekStart = startOfWeekMonday(new Date());
      const todayIso = toIsoDate(new Date());

      const card = el(`
        <div class="pc-card">
          <div class="pc-card-head">
            <div class="pc-card-title-group">
              <div class="pc-card-icon pc-card-icon-logging">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7a2 2 0 0 0 4 0V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3Zm0 0v7"/></svg>
              </div>
              <div class="pc-card-title">${t("coaching.logging.title")}</div>
            </div>
            <div class="pc-streak-badge ${streak > 0 ? "is-active" : ""}">🔥 ${t("coaching.streak", { n: streak, s: streak === 1 ? "" : "s" })}</div>
          </div>
          <div class="pc-day-strip" id="pc-day-strip"></div>
          <div class="pc-day-legend">
            <div class="pc-day-legend-item"><span class="pc-day-legend-dot" style="background:var(--green)"></span>${t("coaching.legend.logged")}</div>
            <div class="pc-day-legend-item"><span class="pc-day-legend-dot" style="background:var(--amber)"></span>${t("coaching.legend.fasting")}</div>
            <div class="pc-day-legend-item"><span class="pc-day-legend-dot" style="background:var(--border)"></span>${t("coaching.legend.incomplete")}</div>
            <div class="pc-day-legend-item"><span class="pc-day-legend-dot" style="background:var(--bg); border:1px solid var(--border);"></span>${t("coaching.legend.notLogged")}</div>
          </div>
          <a href="/logging-history" class="pc-card-link">${t("coaching.logging.viewFullMonth")}</a>
        </div>
      `);

      const stripEl = card.querySelector("#pc-day-strip");
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(d.getDate() + i);
        const iso = toIsoDate(d);
        const status = getDayStatus(iso, nutritionLog, dayStatusMap);
        const isFuture = iso > todayIso;
        const cell = el(`
          <button type="button" class="pc-day-cell ${iso === todayIso ? "is-today" : ""}" data-status="${status}"
                  data-action="${isFuture ? "" : "open-day-popup"}" data-date="${iso}" ${isFuture ? "disabled style=\"opacity:0.35;cursor:default;\"" : ""}>
            <span class="pc-day-cell-letter">${WEEKDAY_LETTERS_MON_FIRST[i]}</span>
            <span class="pc-day-cell-dot">${d.getDate()}</span>
          </button>
        `);
        stripEl.appendChild(cell);
      }

      return card;
    }

    renderDayPopup() {
      const dateIso = this.dayPopup.date;
      const nutritionLog = loadNutritionLog();
      const dayStatusMap = loadDayStatusMap();
      const currentStatus = getDayStatus(dateIso, nutritionLog, dayStatusMap);
      const dateLabel = new Date(dateIso + "T00:00:00").toLocaleDateString(RepCheckI18n.locale(), { weekday: "long", month: "short", day: "numeric" });

      // A day with zero food entries can only be reset to "Not logged" or
      // marked "Fasting" -- "Incomplete" implies some logging happened, so
      // it can't apply here. Conversely a day with at least one entry
      // can't be "Fasting" (there's food logged), so its only alternative
      // is "Incomplete". Same "logged" id in both cases either way -- it
      // just clears the override back to automatic detection -- but the
      // label reflects what that actually resolves to for this day.
      const options = hasEntries(dateIso, nutritionLog)
        ? [
            { id: "logged", title: t("coaching.status.logged.title") },
            { id: "incomplete", title: t("coaching.status.incomplete.title") },
          ]
        : [
            { id: "logged", title: t("coaching.status.notLogged.title") },
            { id: "fasting", title: t("coaching.status.fasting.title") },
          ];

      const overlay = el(`
        <div class="pc-popup-overlay">
          <div class="pc-popup" id="pc-popup-inner">
            <div class="pc-popup-title">${dateLabel}</div>
            <div class="pc-popup-sub">${t("coaching.dayPopup.question")}</div>
            <div class="pc-popup-options" id="pc-popup-options"></div>
            <button type="button" class="pc-btn-secondary pc-popup-close" data-action="close-day-popup">${t("common.close")}</button>
          </div>
        </div>
      `);
      // Deliberately NOT data-action + stopPropagation here: stopping
      // propagation on the inner card would also block every button
      // inside it (set-day-status, close) from ever reaching the root's
      // delegated click listener. Instead, this dedicated listener only
      // reacts to a click landing exactly on the backdrop itself.
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) this.closeDayPopup();
      });

      const optionsEl = overlay.querySelector("#pc-popup-options");
      options.forEach((opt) => {
        optionsEl.appendChild(el(`
          <button type="button" class="pc-popup-option ${currentStatus === opt.id ? "is-selected" : ""}" data-action="set-day-status" data-status="${opt.id}">
            <span>${opt.title}</span>
          </button>
        `));
      });

      return overlay;
    }

    // ---------- Wizard rendering ----------
    // Presented as the SAME shared bottom sheet every other sheet in the
    // app uses (base.html's window.openBottomSheet/closeBottomSheet/
    // bindSheetDrag + style.css's .log-sheet-* classes) -- this used to be
    // its own centered .pc-wizard-overlay dialog, the one modal in the app
    // that didn't match the rest of the bottom-sheet design language (and
    // whose close button was a non-compliant 30x30px). Exact same
    // create-once-then-resync-inner-content pattern as syncCheckinSheet()
    // just below: the shell is built once and kept across re-renders, so
    // picking an option or hitting Next (each a full render()) only swaps
    // the step content -- it never re-plays the slide-up animation.
    syncWizardSheet() {
      const existing = document.getElementById("pc-wizard-sheet-root");

      if (!this.wizard) {
        if (existing) {
          window.closeBottomSheet(existing, ".log-sheet", () => existing.remove());
        }
        return;
      }

      let overlay = existing;
      if (!overlay) {
        overlay = el(`
          <div class="log-sheet-overlay" id="pc-wizard-sheet-root">
            <div class="log-sheet">
              <div class="log-sheet-handle"></div>
              <div class="log-sheet-head">
                <div class="pc-wizard-title">${t("coaching.title")}</div>
                <button type="button" class="log-sheet-close" data-action="close-wizard" aria-label="${t("common.close")}">&times;</button>
              </div>
              <div class="log-sheet-body" id="pc-wizard-sheet-body"></div>
            </div>
          </div>
        `);
        document.body.appendChild(overlay);
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) this.closeWizard();
        });
        window.openBottomSheet(overlay, ".log-sheet");
        window.bindSheetDrag(overlay, ".log-sheet", ".log-sheet-handle", () => this.closeWizard());
      }

      const body = overlay.querySelector("#pc-wizard-sheet-body");
      body.innerHTML = "";
      body.appendChild(this.renderWizardProgress());
      body.appendChild(this.renderWizardStep());
    }

    renderWizardProgress() {
      // Dot count matches what a "maintain" user actually sees -- they never
      // reach goal_weight, so it never gets a dot for them.
      const visible = this.wizardVisibleSteps();
      const currentStep = WIZARD_STEPS[this.wizard.stepIndex];
      const currentVisibleIndex = visible.indexOf(currentStep);
      const dots = visible.map((_, i) => `<div class="pc-wizard-progress-dot ${i <= currentVisibleIndex ? "is-done" : ""}"></div>`).join("");
      return el(`<div class="pc-wizard-progress">${dots}</div>`);
    }

    renderWizardStep() {
      const step = WIZARD_STEPS[this.wizard.stepIndex];
      if (step === "aspiration") return this.renderAspirationStep();
      if (step === "weight_gender") return this.renderWeightGenderStep();
      if (step === "goal_weight") return this.renderGoalWeightStep();
      if (step === "height") return this.renderHeightStep();
      if (step === "body_type") return this.renderBodyTypeStep();
      if (step === "activity") return this.renderActivityStep();
      if (step === "protein") return this.renderProteinStep();
      if (step === "diet") return this.renderDietStep();
      if (step === "distribution") return this.renderDistributionStep();
      return this.renderResultStep();
    }

    // showSub: every choice step passes false now -- just the title, no
    // subtext under any question (including "What's your goal", which
    // used to be the one exception that kept it).
    renderChoiceGrid(items, action, selectedValue, showSub = true) {
      const grid = el(`<div class="pc-choice-grid"></div>`);
      items.forEach((item) => {
        grid.appendChild(el(`
          <button type="button" class="pc-choice-card ${selectedValue === item.id ? "is-selected" : ""}" data-action="${action}" data-value="${item.id}">
            ${item.icon ? `<div class="pc-choice-icon">${item.icon}</div>` : ""}
            <div class="pc-choice-text">
              <div class="pc-choice-title">${item.title}</div>
              ${showSub && item.sub ? `<div class="pc-choice-sub">${item.sub}</div>` : ""}
            </div>
            <div class="pc-choice-check">✓</div>
          </button>
        `));
      });
      return grid;
    }

    renderAspirationStep() {
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepAspiration")}</div></div>`);
      wrap.appendChild(this.renderChoiceGrid(optionsFor(ASPIRATION_IDS, "coaching.aspiration", ASPIRATION_ICONS), "wizard-set-aspiration", this.wizard.aspiration, false));
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderWeightGenderStep() {
      const w = this.wizard;
      const weightUnit = RepCheckUnits.weightUnitLabel();
      const displayWeight = w.weightKg ? RepCheckUnits.kgToDisplay(parseFloat(w.weightKg)) : "";
      const wrap = el(`
        <div>
          <div class="pc-wizard-step-label">${t("coaching.wizard.stepWeightGender")}</div>
          <div class="pc-field">
            <label for="pc-weight-kg">${t("coaching.wizard.currentWeight", { unit: weightUnit })}</label>
            <input type="number" id="pc-weight-kg" min="1" step="0.1" value="${displayWeight}">
          </div>
        </div>
      `);
      const weightInput = wrap.querySelector("#pc-weight-kg");
      weightInput.addEventListener("click", (e) => e.stopPropagation());

      const genderGrid = this.renderChoiceGrid(
        [{ id: "male", title: t("coaching.gender.male"), icon: iconSvg(GENDER_ICONS.male) },
         { id: "female", title: t("coaching.gender.female"), icon: iconSvg(GENDER_ICONS.female) }],
        "wizard-set-gender",
        w.gender,
        false
      );
      wrap.appendChild(genderGrid);

      weightInput.addEventListener("input", (e) => {
        w.weightKg = String(RepCheckUnits.displayToKg(e.target.value) || 0);
      });

      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    // Only reachable for lose/gain (skipped for maintain -- see
    // wizardShouldSkipStep()). Mirrors onboarding.js's identical step,
    // including its direct disabled-toggle on input: this step has no
    // other control (unlike weight_gender, where picking a gender choice
    // card already forces a full re-render), so wizardCanProceed() has to
    // be re-checked on every keystroke by hand rather than waiting for
    // the next render() to happen to notice.
    renderGoalWeightStep() {
      const w = this.wizard;
      const weightUnit = RepCheckUnits.weightUnitLabel();
      const displayGoalWeight = w.goalWeightKg ? RepCheckUnits.kgToDisplay(parseFloat(w.goalWeightKg)) : "";
      const wrap = el(`
        <div>
          <div class="pc-wizard-step-label">${t("coaching.wizard.stepGoalWeight")}</div>
          <div class="pc-field">
            <label for="pc-goal-weight-kg">${t("coaching.wizard.goalWeight", { unit: weightUnit })}</label>
            <input type="number" id="pc-goal-weight-kg" min="1" step="0.1" value="${displayGoalWeight}">
            <div class="pc-field-hint" id="pc-goal-weight-hint"></div>
          </div>
        </div>
      `);
      const goalInput = wrap.querySelector("#pc-goal-weight-kg");
      goalInput.addEventListener("click", (e) => e.stopPropagation());
      const hintEl = wrap.querySelector("#pc-goal-weight-hint");
      const updateHint = () => {
        const cur = parseFloat(w.weightKg) || 0;
        const goal = parseFloat(w.goalWeightKg) || 0;
        if (goal > 0 && goal < MIN_WEIGHT_KG) {
          hintEl.textContent = t("coaching.wizard.minWeightHint", { min: RepCheckUnits.formatWeightKg(MIN_WEIGHT_KG) });
          return;
        }
        hintEl.textContent = cur > 0 && goal > 0
          ? t("coaching.wizard.goalWeightHint", { diff: RepCheckUnits.formatWeightKg(Math.abs(cur - goal)), weight: RepCheckUnits.formatWeightKg(cur) })
          : "";
      };
      updateHint();

      // Rate-of-change slider: only meaningful when actually moving away
      // from the current weight, so it lives here (not the earlier
      // weight/gender step) as part of "how fast to reach this goal
      // weight" -- direction-specific (loss vs gain) since the safe/sane
      // range differs each way (see coaching_engine.py's LOSS_RATE_* vs
      // GAIN_RATE_* comments).
      if (w.aspiration === "lose" || w.aspiration === "gain") {
        const isLose = w.aspiration === "lose";
        const rateKey = isLose ? "lossRatePct" : "gainRatePct";
        const min = isLose ? LOSS_RATE_MIN_PCT : GAIN_RATE_MIN_PCT;
        const max = isLose ? LOSS_RATE_MAX_PCT : GAIN_RATE_MAX_PCT;
        const step = isLose ? 0.1 : 0.05;
        const decimals = isLose ? 1 : 2;
        const label = isLose ? t("coaching.wizard.lossRate") : t("coaching.wizard.gainRate");
        const rateField = el(`
          <div class="pc-field">
            <label for="pc-rate-slider">${label} <span id="pc-rate-value">${w[rateKey].toFixed(decimals)}</span>${t("coaching.wizard.perWeek")}</label>
            <input type="range" id="pc-rate-slider" min="${min}" max="${max}" step="${step}" value="${w[rateKey]}">
            <div class="pc-field-hint" id="pc-rate-hint"></div>
          </div>
        `);
        const slider = rateField.querySelector("#pc-rate-slider");
        const valueLabel = rateField.querySelector("#pc-rate-value");
        const rateHintEl = rateField.querySelector("#pc-rate-hint");
        const updateRateHint = () => {
          const wv = parseFloat(w.weightKg) || 0;
          rateHintEl.textContent = wv > 0
            ? t("coaching.wizard.rateHint", {
                rate: RepCheckUnits.formatWeightKg(w[rateKey] / 100 * wv),
                weight: RepCheckUnits.formatWeightKg(wv),
              })
            : "";
        };
        slider.addEventListener("click", (e) => e.stopPropagation());
        slider.addEventListener("input", (e) => {
          w[rateKey] = parseFloat(e.target.value);
          valueLabel.textContent = w[rateKey].toFixed(decimals);
          updateRateHint();
        });
        updateRateHint();
        wrap.appendChild(rateField);
      }

      wrap.appendChild(this.renderWizardActions());
      const nextBtn = wrap.querySelector('[data-action="wizard-next"]');
      goalInput.addEventListener("input", (e) => {
        w.goalWeightKg = String(RepCheckUnits.displayToKg(e.target.value) || 0);
        updateHint();
        if (nextBtn) nextBtn.disabled = !this.wizardCanProceed();
      });
      return wrap;
    }

    // A vertical scroll-snap ruler instead of a horizontal <input
    // type=range> -- dragging/scrolling vertically through a tall list of
    // 1cm ticks gives much finer control over landing on one exact value
    // than a thumb sliding across a short horizontal track does. Shares
    // .pc-height-ruler-* classes with onboarding.js's identical version
    // (see coaching.css).
    renderHeightStep() {
      const w = this.wizard;
      const tickPx = 14;
      const rows = [];
      for (let cm = HEIGHT_MIN_CM; cm <= HEIGHT_MAX_CM; cm++) {
        const isMajor = cm % 10 === 0;
        const isMid = !isMajor && cm % 5 === 0;
        rows.push(`
          <div class="pc-height-ruler-row">
            <span class="pc-height-ruler-label">${isMajor ? cm : ""}</span>
            <span class="pc-height-ruler-mark ${isMajor ? "is-major" : isMid ? "is-mid" : ""}"></span>
          </div>
        `);
      }
      const wrap = el(`
        <div>
          <div class="pc-wizard-step-label">${t("coaching.wizard.height")}</div>
          <div class="pc-height-ruler">
            <div class="pc-height-ruler-value" id="pc-height-value">${RepCheckUnits.formatHeightCm(w.heightCm)}</div>
            <div class="pc-height-ruler-window">
              <div class="pc-height-ruler-indicator"></div>
              <div class="pc-height-ruler-scroll" id="pc-height-scroll" tabindex="0">${rows.join("")}</div>
            </div>
          </div>
        </div>
      `);
      const scrollEl = wrap.querySelector("#pc-height-scroll");
      const valueLabel = wrap.querySelector("#pc-height-value");
      scrollEl.addEventListener("click", (e) => e.stopPropagation());
      scrollEl.addEventListener("scroll", () => {
        const index = Math.round(scrollEl.scrollTop / tickPx);
        w.heightCm = Math.max(HEIGHT_MIN_CM, Math.min(HEIGHT_MAX_CM, HEIGHT_MIN_CM + index));
        valueLabel.textContent = RepCheckUnits.formatHeightCm(w.heightCm);
      }, { passive: true });
      // setTimeout rather than requestAnimationFrame -- rAF only fires on
      // an actual paint, which some automated/backgrounded tab contexts
      // never deliver, silently leaving the ruler stuck at scrollTop 0.
      setTimeout(() => {
        scrollEl.scrollTop = (w.heightCm - HEIGHT_MIN_CM) * tickPx;
      });
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderBodyTypeStep() {
      const w = this.wizard;
      const gender = w.gender || "male";
      const ranges = bodyFatRangesFor(gender);
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepBodyType")}</div></div>`);
      const grid = el(`<div class="pc-body-type-grid"></div>`);
      ranges.forEach((r, i) => {
        const isSelected = w.bodyFatRangeId === r.id;
        grid.appendChild(el(`
          <button type="button" class="pc-body-type-card ${isSelected ? "is-selected" : ""}" data-action="wizard-set-body-type" data-value="${r.id}">
            ${isSelected ? `<span class="pc-body-type-check">✓</span>` : ""}
            <div class="pc-body-type-icon">${bodyTypeImageHtml(r.id)}</div>
            <div class="pc-body-type-label">${r.label}</div>
          </button>
        `));
      });
      wrap.appendChild(grid);
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderActivityStep() {
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepActivity")}</div></div>`);
      wrap.appendChild(this.renderChoiceGrid(optionsFor(ACTIVITY_IDS, "coaching.activity", ACTIVITY_ICONS), "wizard-set-activity", this.wizard.activityLevel, false));
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderProteinStep() {
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepProtein")}</div></div>`);
      const items = PROTEIN_IDS.map((id, i) => ({
        id,
        title: t(`coaching.protein.${id}.title`),
        sub: t(`coaching.protein.${id}.sub`),
        icon: proteinMeterSvg(i + 1),
      }));
      wrap.appendChild(this.renderChoiceGrid(items, "wizard-set-protein", this.wizard.proteinPreference, false));
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderDietStep() {
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepDiet")}</div></div>`);
      wrap.appendChild(this.renderChoiceGrid(optionsFor(DIET_IDS, "coaching.diet", DIET_ICONS), "wizard-set-diet", this.wizard.dietPreference, false));
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderDistributionStep() {
      const wrap = el(`<div><div class="pc-wizard-step-label">${t("coaching.wizard.stepDistribution")}</div></div>`);
      wrap.appendChild(this.renderChoiceGrid(optionsFor(DISTRIBUTION_IDS, "coaching.distribution", DISTRIBUTION_ICONS), "wizard-set-distribution", this.wizard.distribution, false));
      wrap.appendChild(this.renderWizardActions());
      return wrap;
    }

    renderResultStep() {
      const w = this.wizard;
      if (w.computing) {
        return el(`<div class="pc-card-sub" style="text-align:center; padding:40px 0;">${t("coaching.wizard.calculating")}</div>`);
      }
      if (w.error) {
        const wrap = el(`<div><div class="pc-card-sub" style="text-align:center; padding:20px 0; color:var(--red);">${w.error}</div></div>`);
        wrap.appendChild(this.renderWizardActions());
        return wrap;
      }

      const targets = w.result.targets;
      const wrap = el(`
        <div>
          <div class="pc-wizard-step-label">${t("coaching.wizard.yourTarget")}</div>
          <div class="pc-result-calories">${targets.calories}</div>
          <div class="pc-result-label">${t("coaching.wizard.kcalPerDay")}</div>
          <div class="pc-macro-row">
            <div class="pc-macro-chip"><div class="pc-macro-chip-value">${targets.protein}g</div><div class="pc-macro-chip-label">${t("common.protein")}</div></div>
            <div class="pc-macro-chip"><div class="pc-macro-chip-value">${targets.fat}g</div><div class="pc-macro-chip-label">${t("common.fat")}</div></div>
            <div class="pc-macro-chip"><div class="pc-macro-chip-value">${targets.carbs}g</div><div class="pc-macro-chip-label">${t("common.carbs")}</div></div>
          </div>
          <div class="pc-result-detail">${t("coaching.wizard.maintenance", { tdee: targets.tdee, bmr: targets.bmr })}</div>
          <div class="pc-wizard-actions">
            <button type="button" class="pc-btn-secondary" data-action="wizard-back">${t("common.back")}</button>
            <button type="button" class="pc-btn-primary" data-action="wizard-save">${t("coaching.wizard.saveStart")}</button>
          </div>
        </div>
      `);
      return wrap;
    }

    renderWizardActions() {
      const isFirst = this.wizard.stepIndex === 0;
      return el(`
        <div class="pc-wizard-actions">
          ${isFirst ? "" : `<button type="button" class="pc-btn-secondary" data-action="wizard-back">${t("common.back")}</button>`}
          <button type="button" class="pc-btn-primary" data-action="wizard-next" ${this.wizardCanProceed() ? "" : "disabled"}>${t("common.next")}</button>
        </div>
      `);
    }

    // ---------- Weekly check-in bottom sheet ----------
    // Presented as a classic iOS card sheet, via the SAME shared sheet
    // system every other bottom sheet in the app uses (base.html's
    // window.openBottomSheet/closeBottomSheet/bindSheetDrag, see also
    // .log-sheet-overlay in style.css and .af-modal-overlay in
    // nutrition.html) -- not a bespoke reimplementation, so the motion is
    // guaranteed identical rather than incidentally similar, and there's
    // only one place that owns the shared .pc-sheet-active/.pc-sheet-locked
    // classes on <html>. The sheet lives on document.body -- NOT inside
    // .app -- because .app gets a transform for the recede, and a fixed
    // child of a transformed ancestor would scale along with it;
    // openBottomSheet reparents it there automatically. No backdrop-click
    // or × button, but the sheet can be swiped/scrolled down to dismiss
    // (bindSheetDrag) or completed via the form's own flow.
    //
    // The shell is created once and kept across re-renders so cycling a day
    // or editing weight (which each trigger a full render) only swaps the
    // inner content -- it never re-plays the slide-up animation.
    syncCheckinSheet() {
      const existing = document.getElementById("pc-ck-sheet-root");

      if (!this.checkin) {
        if (existing) {
          const afterClose = this._checkinAfterClose;
          this._checkinAfterClose = null;
          window.closeBottomSheet(existing, ".pc-ck-sheet", () => {
            existing.remove();
            if (afterClose) afterClose();
          });
        }
        return;
      }

      let overlay = existing;
      if (!overlay) {
        overlay = el(`
          <div class="pc-ck-sheet-overlay" id="pc-ck-sheet-root">
            <div class="pc-ck-sheet">
              <div class="pc-ck-sheet-handle"></div>
              <div class="pc-ck-sheet-inner" id="pc-checkin-inner"></div>
            </div>
          </div>
        `);
        document.body.appendChild(overlay);
        window.openBottomSheet(overlay, ".pc-ck-sheet");
        window.bindSheetDrag(overlay, ".pc-ck-sheet", ".pc-ck-sheet-handle", () => this.closeCheckin());
      }

      const inner = overlay.querySelector("#pc-checkin-inner");
      inner.innerHTML = "";
      inner.appendChild(this.checkin.step === "result" ? this.renderCheckinResult() : this.renderCheckinGather());
    }

    renderCheckinPhotoSlot(angle) {
      const c = this.checkin;
      const previewUrl = angle === "front" ? c.frontPhotoPreviewUrl : c.backPhotoPreviewUrl;
      const label = angle === "front" ? t("coaching.checkin.front") : t("coaching.checkin.back");
      const inputId = `pc-checkin-photo-${angle}`;
      return `
        <label class="pc-checkin-photo-slot ${previewUrl ? "has-photo" : ""}" for="${inputId}">
          ${previewUrl
            ? `<img src="${previewUrl}" class="pc-checkin-photo-preview" alt="">`
            : `<span class="pc-checkin-photo-plus"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>`}
          <span class="pc-checkin-photo-slot-label">${label}</span>
          <input type="file" id="${inputId}" data-photo-input="${angle}" accept="image/*" capture="environment" style="display:none;">
        </label>
      `;
    }

    // One tappable pill per day, the weekday letter INSIDE the colored
    // circle (green=logged, amber=fasting, grey=incomplete) -- bigger
    // targets and one glance instead of the old letter-above-tiny-dot.
    renderCheckinDayGrid() {
      const c = this.checkin;
      const days = c.weekDates.map((iso) => {
        const status = c.dayStatuses[iso];
        const weekdayLetter = new Date(iso + "T00:00:00").toLocaleDateString(RepCheckI18n.locale(), { weekday: "narrow" });
        return `
          <button type="button" class="pc-ck-day" data-action="cycle-checkin-day" data-date="${iso}" data-status="${status}">
            ${weekdayLetter}
          </button>
        `;
      }).join("");
      return `
        <div class="pc-ck-day-grid">${days}</div>
        <div class="pc-checkin-legend">
          <span class="pc-checkin-legend-item"><span class="pc-checkin-legend-dot" data-status="logged"></span>${t("coaching.legend.logged")}</span>
          <span class="pc-checkin-legend-item"><span class="pc-checkin-legend-dot" data-status="fasting"></span>${t("coaching.legend.fasting")}</span>
          <span class="pc-checkin-legend-item"><span class="pc-checkin-legend-dot" data-status="incomplete"></span>${t("coaching.legend.incomplete")}</span>
          <span class="pc-checkin-legend-item"><span class="pc-checkin-legend-dot" data-status="none"></span>${t("coaching.legend.notLogged")}</span>
        </div>
      `;
    }

    // Small helper for the check-in's sectioned layout: gradient icon
    // chip + title (+ optional sub) above whatever the section holds.
    ckSectionHead(chipClass, iconSvg, title, sub) {
      return `
        <div class="pc-ck-section-head">
          <span class="pc-ck-chip ${chipClass}">${iconSvg}</span>
          <span class="pc-ck-section-text">
            <span class="pc-ck-section-title">${title}</span>
            ${sub ? `<span class="pc-ck-section-sub">${sub}</span>` : ""}
          </span>
        </div>
      `;
    }

    renderCheckinGather() {
      const c = this.checkin;
      const weightUnit = RepCheckUnits.weightUnitLabel();
      const CAL_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
      const SCALE_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M18 20V4M6 20v-4"/></svg>`;
      const CAM_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;

      const wrap = el(`
        <div class="pc-ck">
          <div class="pc-wizard-body pc-ck-body">
            <div class="pc-ck-hero">
              <div class="pc-ck-hero-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </div>
              <div class="pc-ck-hero-title">${t("coaching.checkin.title")}</div>
              <div class="pc-ck-hero-sub">${t("coaching.checkin.sub")}</div>
            </div>

            <div class="pc-ck-section">
              ${this.ckSectionHead("pc-ck-chip-green", CAL_SVG, t("coaching.checkin.daysLabel"))}
              ${this.renderCheckinDayGrid()}
            </div>

            <div class="pc-ck-section">
              ${this.ckSectionHead("pc-ck-chip-blue", SCALE_SVG, t("coaching.wizard.currentWeight", { unit: weightUnit }))}
              ${c.alreadyLoggedToday
                ? `<div class="pc-checkin-logged-note">✓ ${t("coaching.checkin.weightAlreadyLogged")}</div>`
                : `
                  <div class="pc-ck-weight-field">
                    <input type="number" id="pc-checkin-weight" min="1" step="0.1" value="${c.weightInput}" placeholder="0.0">
                    <span class="pc-ck-weight-unit">${weightUnit}</span>
                  </div>
                `}
            </div>

            <div class="pc-ck-section">
              ${this.ckSectionHead("pc-ck-chip-purple", CAM_SVG, t("coaching.checkin.photosLabel"))}
              <div class="pc-checkin-photo-row">
                ${this.renderCheckinPhotoSlot("front")}
                ${this.renderCheckinPhotoSlot("back")}
              </div>
            </div>

            ${c.error ? `<div class="pc-checkin-error">${c.error}</div>` : ""}
            <button type="button" class="pc-ck-submit" data-action="checkin-submit" ${c.submitting ? "disabled" : ""}>${c.submitting ? t("common.loading") : t("coaching.checkin.complete")}</button>
          </div>
        </div>
      `);
      const weightInput = wrap.querySelector("#pc-checkin-weight");
      if (weightInput) {
        weightInput.addEventListener("input", (e) => { c.weightInput = e.target.value; });
      }
      wrap.querySelectorAll("[data-photo-input]").forEach((input) => {
        input.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) this.setCheckinPhoto(input.dataset.photoInput, file);
        });
      });
      return wrap;
    }

    // One row per macro on the result screen: name on the left, old -> new
    // on the right with a signed +/-g chip, so the user can see exactly
    // which macros the adjustment touched (and that untouched ones stayed
    // put) instead of only being told a calorie delta.
    renderCheckinMacroRows(adj, prev) {
      return ["protein", "fat", "carbs"].map((key) => {
        const after = Math.round(adj[key]);
        const before = prev ? Math.round(prev[key]) : after;
        const diff = after - before;
        const chipClass = diff > 0 ? "is-up" : diff < 0 ? "is-down" : "is-same";
        const chip = diff === 0 ? t("coaching.checkin.sameChip") : `${diff > 0 ? "+" : ""}${diff}g`;
        const values = diff === 0 ? `${after}g` : `${before}g <span class="pc-ck-macro-arrow">→</span> <strong>${after}g</strong>`;
        return `
          <div class="pc-ck-macro-row">
            <span class="pc-ck-macro-name">${t("common." + key)}</span>
            <span class="pc-ck-macro-vals">${values}<span class="pc-ck-macro-diff ${chipClass}">${chip}</span></span>
          </div>`;
      }).join("");
    }

    renderCheckinResult() {
      const adj = this.checkin.result;
      const prev = this.checkin.resultPrevious;
      if (adj === "goal-achieved") {
        return el(`
          <div class="pc-ck">
            <div class="pc-wizard-body pc-ck-body pc-ck-result">
              <div class="pc-ck-done-badge pc-ck-achieved-badge">🎉</div>
              <div class="pc-ck-hero-title">${t("coaching.checkin.goalAchievedTitle")}</div>
              <div class="pc-ck-ontrack-sub">${t("coaching.checkin.goalAchievedSub", { weight: RepCheckUnits.formatWeightKg(parseFloat(this.profile.goalWeightKg)) })}</div>
              <button type="button" class="pc-ck-submit" data-action="checkin-set-new-goals">${t("coaching.checkin.setNewGoals")}</button>
            </div>
          </div>
        `);
      }
      // For a real adjustment (not the plain "on track" result), the
      // calorie delta gets its own hero moment before the rest of the
      // screen appears: a huge count-up number covers the result body on
      // its own, then shrinks/fades away into the number's normal small
      // spot while everything else (badge, title, macros, reason, done
      // button) reveals underneath, top to bottom. See
      // runCheckinResultReveal() below for the actual sequencing --
      // every element that should stay hidden until then carries
      // .pc-ck-reveal-item.
      const wrap = el(`
        <div class="pc-ck">
          <div class="pc-wizard-body pc-ck-body pc-ck-result${adj ? " pc-ck-result-revealing" : ""}">
            ${adj ? `
              <div class="pc-ck-hero-overlay" id="pc-ck-hero-overlay">
                <div class="pc-ck-hero-delta" id="pc-ck-hero-delta-num">0</div>
                <div class="pc-ck-hero-delta-label">${t("coaching.wizard.kcalPerDay")}</div>
              </div>
            ` : ""}
            <div class="pc-ck-done-badge pc-ck-reveal-item">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div class="pc-ck-hero-title pc-ck-reveal-item">${t("coaching.checkin.doneTitle")}</div>
            ${adj ? `
              <div class="pc-ck-delta pc-ck-reveal-item" id="pc-ck-delta-num">${adj.delta > 0 ? "+" : ""}${adj.delta}</div>
              <div class="pc-ck-delta-label pc-ck-reveal-item">${t("coaching.wizard.kcalPerDay")}</div>
              <div class="pc-ck-new-target pc-ck-reveal-item">${t("coaching.checkin.newTarget", { n: adj.calories })}</div>
              <div class="pc-ck-macros-title pc-ck-reveal-item">${t("coaching.checkin.macrosTitle")}</div>
              <div class="pc-ck-macros pc-ck-reveal-item">${this.renderCheckinMacroRows(adj, prev)}</div>
              <div class="pc-ck-reason pc-ck-reveal-item">${adj.reason}</div>
            ` : `
              <div class="pc-ck-ontrack-title">${t("coaching.checkin.onTrack")}</div>
              <div class="pc-ck-ontrack-sub">${t("coaching.checkin.onTrackSub")}</div>
            `}
            <button type="button" class="pc-ck-submit pc-ck-reveal-item" data-action="checkin-done">${t("common.done")}</button>
          </div>
        </div>
      `);
      if (adj) this.runCheckinResultReveal(wrap, adj.delta);
      return wrap;
    }

    // Orchestrates the result screen's "hero number first" entrance: the
    // calorie delta counts up huge and alone (covering everything else
    // via .pc-ck-hero-overlay), then shrinks/fades away once it's landed,
    // revealing the real (already-built, just hidden) result content
    // underneath in a top-to-bottom stagger. Everything here is additive
    // choreography on top of the DOM renderCheckinResult() already
    // built -- no separate render pass.
    runCheckinResultReveal(wrap, delta) {
      const overlay = wrap.querySelector("#pc-ck-hero-overlay");
      const heroDeltaEl = wrap.querySelector("#pc-ck-hero-delta-num");
      const resultBody = wrap.querySelector(".pc-ck-result");
      const revealItems = wrap.querySelectorAll(".pc-ck-reveal-item");
      if (!overlay || !resultBody) return;

      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        overlay.remove();
        resultBody.classList.remove("pc-ck-result-revealing");
        return;
      }

      // Stagger each item's entrance so they're ready to animate in
      // sequence, top to bottom, the instant .is-revealed is added below.
      revealItems.forEach((item, i) => {
        item.style.transitionDelay = `${i * 70}ms`;
      });

      if (heroDeltaEl) this.animateDelta(heroDeltaEl, delta);

      const HOLD_MS = 900; // the ~800ms count-up, plus a brief beat to let it land
      setTimeout(() => {
        overlay.classList.add("is-leaving");
        resultBody.classList.add("is-revealed");
        overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      }, HOLD_MS);
    }

    // Counts from 0 up (or down) to the final delta over ~800ms with an
    // ease-out curve, combined with a brief pop-then-settle scale (see
    // .pc-ck-delta-pop in coaching.css) so the number arriving reads as an
    // event, not static text. No existing count-up pattern anywhere else
    // in this codebase to reuse (confirmed via grep) -- this is new.
    animateDelta(el, toValue) {
      const finalText = `${toValue > 0 ? "+" : ""}${toValue}`;
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        el.textContent = finalText;
        return;
      }
      const DURATION = 800;
      const start = performance.now();
      const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
      el.classList.add("pc-ck-delta-pop");
      const tick = (now) => {
        const progress = Math.min(1, (now - start) / DURATION);
        const current = Math.round(toValue * easeOutCubic(progress));
        el.textContent = `${current > 0 ? "+" : ""}${current}`;
        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = finalText;
        }
      };
      requestAnimationFrame(tick);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("coaching-root");
    if (root) new CoachingApp(root);
  });
})();
