/**
 * Combined first-run onboarding wizard (nutrition + workout split).
 *
 * Reached only via app.py's home() route redirecting brand-new accounts
 * here right after signup/login (see /onboarding), before they ever see
 * home.html. Merges the two wizards that used to live separately on the
 * nutrition page (static/coaching.js) and the workouts page
 * (templates/workouts.html's split wizard) into one continuous flow, then
 * writes the exact same localStorage keys those two wizards always wrote
 * -- repcheck_coaching_profile_v1 / repcheck_nutrition_goals_v1 /
 * repcheck_coaching_distribution_v1 / repcheck_split_plan_v1 -- so
 * nutrition.html and workouts.html see a fully set-up profile and split
 * exactly as if the user had gone through both wizards individually.
 *
 * Mirrors coaching.js's step logic/i18n keys for the nutrition half and
 * workouts.html's split-wizard logic/i18n keys for the workout half
 * rather than importing either module directly -- both are tightly bound
 * to their own page's DOM/root element, so duplicating the small amount
 * of pure logic here (body-type SVGs, validation) was simpler and safer
 * than refactoring either into a shared module under time pressure.
 *
 * Visual design is fully self-contained too: this file uses its own
 * .ob-choice-*, .ob-btn-*, .ob-field-* classes (defined in onboarding.html's
 * <style> block) instead of coaching.css's shared .pc-* classes, even
 * though the two wizards render near-identical UI. coaching.css's .pc-*
 * classes are load-bearing for coaching.js's own separate "Personalized
 * Coaching" wizard (and several unrelated buttons elsewhere on the
 * nutrition page), so redesigning them in place would have redesigned
 * that other wizard too -- keeping a separate class set here means this
 * wizard's look can be freely iterated on without any risk of touching
 * that other flow.
 */
(function () {
  "use strict";

  const t = (key, vars) => RepCheckI18n.t(key, vars);

  const PROFILE_KEY = "repcheck_coaching_profile_v1";
  const GOALS_KEY = "repcheck_nutrition_goals_v1";
  const DISTRIBUTION_KEY = "repcheck_coaching_distribution_v1";
  const SPLIT_PLAN_KEY = "repcheck_split_plan_v1";
  // Goal-achievement state, cleared when save() writes a new goal -- see
  // there. Same keys as coaching.js/base.html; declared here too since this
  // file is a standalone IIFE with no shared module scope.
  const ACHIEVED_KEY = "repcheck_coaching_goal_achieved_v1";
  const ACHIEVED_HANDLED_KEY = "repcheck_coaching_goal_achieved_handled_v1";

  const MONDAY_FIRST = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  // Same "not actually i18n'd" convention already used for these labels in
  // workouts.html/home.html's own weekday strips -- matched here rather
  // than introducing a translation this app doesn't have anywhere else.
  const MONDAY_FIRST_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const HEIGHT_MIN_CM = 130;
  const HEIGHT_MAX_CM = 230;
  // Matches _validate_coaching_profile's floor in app.py -- below this the
  // Katch-McArdle BMR/protein math this feeds into stops producing safe,
  // realistic targets, so the wizard blocks it client-side too instead of
  // only failing at the very end when generateAndCalculate() calls the
  // server. Kept in sync with the server value; the server is what
  // actually enforces it (this is just faster feedback).
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

  const ASPIRATION_IDS = ["lose", "maintain", "gain"];
  const ACTIVITY_IDS = ["lift_and_cardio", "cardio_only", "lift_only", "none"];
  const PROTEIN_IDS = ["low_moderate", "moderate", "high", "highest"];
  const DIET_IDS = ["balanced", "low_fat", "low_carb", "keto"];
  const DISTRIBUTION_IDS = ["stable", "weekly"];

  // ---------- Icons ----------
  // A small stroke-based icon library so every choice card can carry a
  // glyph a user can recognize without reading the label (the whole point
  // of this file's redesign) -- same visual language already used
  // elsewhere in the app (viewBox 0 0 24 24, stroke=currentColor,
  // stroke-width 2, round caps/joins; see nutrition.html's macro icons).
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
    home: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
    homeGym: `<path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><rect x="8" y="14" width="1.8" height="4" rx="0.5"/><rect x="14.2" y="14" width="1.8" height="4" rx="0.5"/><line x1="9.8" y1="16" x2="14.2" y2="16"/>`,
    ppl: `<line x1="3" y1="6" x2="15" y2="6"/><polyline points="11 2 15 6 11 10"/><line x1="21" y1="12" x2="9" y2="12"/><polyline points="13 8 9 12 13 16"/><line x1="12" y1="16" x2="12" y2="22"/><polyline points="8 18 12 22 16 18"/>`,
    upperLower: `<rect x="4" y="3" width="16" height="8" rx="1"/><rect x="4" y="13" width="16" height="8" rx="1" fill="currentColor" fill-opacity="0.18"/>`,
    person: `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>`,
    calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>`,
    sliders: `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
    sparkle: `<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" fill="currentColor" stroke="none"/>`,
    check: `<polyline points="20 6 9 17 4 12"/>`,
    // Exact same paths as nutrition.html's macro icons (nl-icon-*) --
    // reused verbatim rather than redrawn, so the result screen's macro
    // chips read as literally the same icon language as the rest of the
    // app, not just a similar one.
    calories: `<path d="M8.5 14.5A2.5 2.5 0 0 0 11 17a2.5 2.5 0 0 0 2.5-2.5c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7.5 7.5 0 1 1-15 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>`,
    proteinMacro: `<rect x="2" y="9" width="3" height="6" rx="1"/><rect x="19" y="9" width="3" height="6" rx="1"/><path d="M5 12h1M18 12h1"/><rect x="6.5" y="7" width="2" height="10" rx="1"/><rect x="15.5" y="7" width="2" height="10" rx="1"/><path d="M8.5 12h7"/>`,
    fatMacro: `<path d="M12 2.69s5.66 5.86 8 10.09A8 8 0 1 1 4 12.78C6.34 8.55 12 2.69 12 2.69z"/>`,
    carbsMacro: `<path d="m2 22 1-1h3l9-9"/><path d="M3.5 19.5 12 11"/><path d="M18 3a2.83 2.83 0 0 0-2.83 2.83c0 1.14.65 2.05 1.65 2.9C17.65 9.36 18 10.5 18 11a3 3 0 0 0 3-3c0-1.5-1-2.5-1.83-3.17C18.35 4.05 18 3.14 18 3Z"/><path d="M13 8a2.83 2.83 0 0 0-2.83 2.83c0 1.14.65 2.05 1.65 2.9.83.7 1.18 1.85 1.18 2.35a3 3 0 0 0 3-3c0-1.5-1-2.5-1.83-3.17C13.35 9.05 13 8.14 13 8Z"/><path d="M8 13a2.83 2.83 0 0 0-2.83 2.83c0 1.14.65 2.05 1.65 2.9.83.7 1.18 1.85 1.18 2.35a3 3 0 0 0 3-3c0-1.5-1-2.5-1.83-3.17C8.35 14.05 8 13.14 8 13Z"/>`,
    bulb: `<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.9V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.1A7 7 0 0 0 12 2Z"/>`,
  };

  function iconSvg(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ""}</svg>`;
  }

  // A single reusable "how much" glyph (1-4 filled bars) instead of four
  // unrelated icons -- protein preference is a magnitude, not a category,
  // so the icon should read as a meter, not a symbol per option.
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
  const LOCATION_ICONS = { gym: "dumbbell", home: "home", hybrid: "homeGym" };
  const SPLIT_TYPE_ICONS = { ppl: "ppl", upper_lower: "upperLower", full_body: "person", bro_split: "calendar", custom: "sliders" };
  const GYM_EXPERIENCE_IDS = ["home_workouts", "gym_regular", "new_or_lapsed"];
  const GYM_EXPERIENCE_ICONS = { home_workouts: "home", gym_regular: "dumbbell", new_or_lapsed: "sparkle" };

  // Mirrors coaching_engine.py's ranges exactly (same ids).
  const MALE_BODY_FAT_RANGES = [
    { id: "m1", label: "7-10%" }, { id: "m2", label: "11-14%" }, { id: "m3", label: "15-20%" },
    { id: "m4", label: "21-25%" }, { id: "m5", label: "26-35%" }, { id: "m6", label: "36-45%" },
  ];
  // Deliberately higher than the male ranges at each equivalent tier --
  // see coaching_engine.py's MALE/FEMALE_BODY_FAT_RANGES comment for why.
  const FEMALE_BODY_FAT_RANGES = [
    { id: "f1", label: "15-18%" }, { id: "f2", label: "19-22%" }, { id: "f3", label: "23-28%" },
    { id: "f4", label: "29-34%" }, { id: "f5", label: "35-42%" }, { id: "f6", label: "43-50%" },
  ];
  function bodyFatRangesFor(gender) {
    return gender === "female" ? FEMALE_BODY_FAT_RANGES : MALE_BODY_FAT_RANGES;
  }

  // Realistic 3D-render body-fat reference images (static/bodyfat/*.webp,
  // one per range id m1..m6 / f1..f6) so users can actually compare
  // themselves to the figure, like the reference charts fitness apps use.
  // Generated once with the app's own Gemini image model -- no third-party
  // copyright baggage -- and shipped as ordinary static assets. Same
  // helper as coaching.js (duplicated rather than shared -- see file header).
  //
  // If an image ever fails to load (a lagging deploy, a network blip), the
  // onerror swaps in a neutral body silhouette (inline base64 SVG) instead
  // of the browser's broken-image glyph -- the % label below the figure
  // still conveys the choice, so the step stays usable. `this.onerror=null`
  // prevents an infinite loop if the fallback itself somehow can't render.
  var BODY_TYPE_FALLBACK_SRC = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0ODAgNDgwIj48ZyBmaWxsPSIjOGI4ZjlhIj48Y2lyY2xlIGN4PSIyNDAiIGN5PSIxNTAiIHI9IjcyIi8+PHBhdGggZD0iTTExMCA0ODBjMC05NiA1OC0xNjAgMTMwLTE2MHMxMzAgNjQgMTMwIDE2MHoiLz48L2c+PC9zdmc+";
  function bodyTypeImageHtml(rangeId) {
    return `<img src="/static/bodyfat/${rangeId}.webp" alt="" loading="lazy" class="ob-body-type-img" onerror="this.onerror=null;this.src='${BODY_TYPE_FALLBACK_SRC}'">`;
  }

  function optionsFor(ids, prefix, iconMap) {
    return ids.map((id) => ({
      id,
      title: t(`${prefix}.${id}.title`),
      sub: t(`${prefix}.${id}.sub`),
      icon: iconMap ? iconSvg(iconMap[id]) : null,
    }));
  }

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  // Real per-exercise illustration from the icon pack (see
  // exercise_icons.py / workouts.html's identical helper) -- falls back
  // to a generic barbell for any exercise the pack doesn't cover.
  function exerciseIconHtml(name) {
    const path = (window.EXERCISE_ICONS || {})[name];
    if (path) return `<img src="/static/${path}" alt="" class="ex-icon-img">`;
    return "\u{1F3CB}️";
  }

  // ---------- State ----------
  // stepIndex -1 = intro screen, 0..STEPS.length-1 = question steps,
  // "generating"/"result" handled via separate boolean/string flags below.
  const STEPS = [
    "aspiration", "gender", "weight", "goal_weight", "height", "body_type", "activity",
    "protein", "diet", "distribution", "gym_experience", "location", "split_type",
    "lifting_goal", "days_per_week",
  ];

  // Steps built entirely around a workout split -- meaningless once the
  // user has said they don't exercise at all, so the whole section is
  // skipped and they land straight on the nutrition-only result screen
  // (see generateAndCalculate()/renderResult()/save() below for the other
  // half of this: none of them call /api/generate-split or expect a plan).
  const WORKOUT_SECTION_STEPS = ["gym_experience", "location", "split_type", "lifting_goal", "days_per_week"];

  // "goal_weight" only makes sense when the user is actually trying to move
  // away from their current weight -- for "maintain" it's the same number
  // by definition, so the step is skipped rather than asking a redundant
  // question (see nextVisibleIndex/prevVisibleIndex below).
  function shouldSkipStep(step) {
    if (step === "goal_weight") return w.aspiration === "maintain";
    if (WORKOUT_SECTION_STEPS.includes(step)) return w.activityLevel === "none";
    return false;
  }
  function visibleSteps() {
    return STEPS.filter((s) => !shouldSkipStep(s));
  }
  function nextVisibleIndex(fromIndex) {
    let idx = fromIndex + 1;
    while (idx < STEPS.length && shouldSkipStep(STEPS[idx])) idx++;
    return idx;
  }
  function prevVisibleIndex(fromIndex) {
    let idx = fromIndex - 1;
    while (idx >= 0 && shouldSkipStep(STEPS[idx])) idx--;
    return idx;
  }
  function lastVisibleIndex() {
    return prevVisibleIndex(STEPS.length);
  }

  const w = {
    stepIndex: -1,
    aspiration: null,
    gender: null,
    weightKg: "",
    goalWeightKg: "",
    heightCm: 170,
    bodyFatRangeId: null,
    activityLevel: null,
    proteinPreference: null,
    dietPreference: "balanced",
    distribution: "stable",
    lossRatePct: LOSS_RATE_DEFAULT_PCT,
    gainRatePct: GAIN_RATE_DEFAULT_PCT,
    gymExperience: null,
    location: null,
    splitType: null,
    customDays: [],
    liftingGoal: "",
    daysPerWeek: null,
    generatedDays: null,
    generatedSchedule: null,
    rationale: null,
    nutritionResult: null,
    generating: false,
    error: null,
  };

  const bodyEl = document.getElementById("ob-body");
  const progressEl = document.getElementById("ob-progress");
  const wrapEl = document.querySelector(".ob-wrap");

  function currentStep() {
    return w.stepIndex >= 0 && w.stepIndex < STEPS.length ? STEPS[w.stepIndex] : null;
  }

  function renderProgress() {
    if (w.stepIndex < 0) { progressEl.innerHTML = ""; return; }
    const visible = visibleSteps();
    const currentVisibleIndex = visible.indexOf(currentStep());
    const dots = visible.map((_, i) => `<div class="ob-progress-dot ${i <= currentVisibleIndex ? "is-done" : ""}"></div>`).join("");
    progressEl.innerHTML = dots;
  }

  function render() {
    wrapEl.classList.toggle("is-wide", currentStep() === "body_type");
    renderProgress();
    bodyEl.innerHTML = "";
    bodyEl.appendChild(renderCurrentView());
  }

  function renderCurrentView() {
    if (w.stepIndex === -1) return renderIntro();
    if (w.generating) return renderGenerating();
    if (w.stepIndex >= STEPS.length) return renderResult();
    const step = currentStep();
    if (step === "aspiration") return renderAspirationStep();
    if (step === "gender") return renderGenderStep();
    if (step === "weight") return renderWeightStep();
    if (step === "goal_weight") return renderGoalWeightStep();
    if (step === "height") return renderHeightStep();
    if (step === "body_type") return renderBodyTypeStep();
    if (step === "activity") return renderActivityStep();
    if (step === "protein") return renderProteinStep();
    if (step === "diet") return renderDietStep();
    if (step === "distribution") return renderDistributionStep();
    if (step === "gym_experience") return renderGymExperienceStep();
    if (step === "location") return renderLocationStep();
    if (step === "split_type") return renderSplitTypeStep();
    if (step === "lifting_goal") return renderLiftingGoalStep();
    return renderDaysPerWeekStep();
  }

  // ---------- Intro ----------
  function renderIntro() {
    const name = window.REPCHECK_USER_NAME || "";
    const wrap = el(`
      <div class="ob-intro">
        <div class="ob-intro-title">${t("onboarding.intro.title", { name })}</div>
        <div class="ob-intro-sub">${t("onboarding.intro.sub")}</div>
      </div>
    `);
    const actions = el(`<div class="ob-wizard-actions"><button type="button" class="ob-btn-primary" data-action="start">${t("common.next")}</button></div>`);
    wrap.appendChild(actions);
    return wrap;
  }

  // ---------- Shared choice grid ----------
  function renderChoiceGrid(items, action, selectedValue, showSub) {
    const grid = el(`<div class="ob-choice-grid"></div>`);
    items.forEach((item) => {
      grid.appendChild(el(`
        <button type="button" class="ob-choice-card ${selectedValue === item.id ? "is-selected" : ""}" data-action="${action}" data-value="${item.id}">
          ${item.icon ? `<div class="ob-choice-icon">${item.icon}</div>` : ""}
          <div class="ob-choice-text">
            <div class="ob-choice-title">${item.title}</div>
            ${showSub && item.sub ? `<div class="ob-choice-sub">${item.sub}</div>` : ""}
          </div>
          <div class="ob-choice-check">✓</div>
        </button>
      `));
    });
    return grid;
  }

  function renderWizardActions(canProceed) {
    const isFirst = w.stepIndex === 0;
    return el(`
      <div class="ob-wizard-actions">
        ${isFirst ? "" : `<button type="button" class="ob-btn-secondary" data-action="back">${t("common.back")}</button>`}
        <button type="button" class="ob-btn-primary" data-action="next" ${canProceed ? "" : "disabled"}>${t("common.next")}</button>
      </div>
    `);
  }

  // ---------- Nutrition steps (mirrors coaching.js) ----------
  function renderAspirationStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepAspiration")}</div></div>`);
    wrap.appendChild(renderChoiceGrid(optionsFor(ASPIRATION_IDS, "coaching.aspiration", ASPIRATION_ICONS), "set-aspiration", w.aspiration, false));
    wrap.appendChild(renderWizardActions(!!w.aspiration));
    return wrap;
  }

  function renderGenderStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepGender")}</div></div>`);
    const items = [
      { id: "male", title: t("coaching.gender.male"), icon: iconSvg(GENDER_ICONS.male) },
      { id: "female", title: t("coaching.gender.female"), icon: iconSvg(GENDER_ICONS.female) },
    ];
    wrap.appendChild(renderChoiceGrid(items, "set-gender", w.gender, false));
    wrap.appendChild(renderWizardActions(!!w.gender));
    return wrap;
  }

  function renderWeightStep() {
    const weightUnit = RepCheckUnits.weightUnitLabel();
    const displayWeight = w.weightKg ? RepCheckUnits.kgToDisplay(parseFloat(w.weightKg)) : "";
    const wrap = el(`
      <div>
        <div class="ob-wizard-step-label">${t("coaching.wizard.stepWeight")}</div>
        <div class="ob-field">
          <label for="ob-weight-kg">${t("coaching.wizard.currentWeight", { unit: weightUnit })}</label>
          <input type="number" id="ob-weight-kg" min="1" step="0.1" value="${displayWeight}">
          <div class="ob-field-hint" id="ob-weight-hint"></div>
        </div>
      </div>
    `);
    const weightInput = wrap.querySelector("#ob-weight-kg");
    const weightHintEl = wrap.querySelector("#ob-weight-hint");
    const updateWeightHint = () => {
      const wv = parseFloat(w.weightKg) || 0;
      weightHintEl.textContent = wv > 0 && wv < MIN_WEIGHT_KG
        ? t("coaching.wizard.minWeightHint", { min: RepCheckUnits.formatWeightKg(MIN_WEIGHT_KG) })
        : "";
    };
    updateWeightHint();

    const canProceed = () => {
      const wv = parseFloat(w.weightKg);
      return wv >= MIN_WEIGHT_KG && wv <= MAX_WEIGHT_KG;
    };
    wrap.appendChild(renderWizardActions(canProceed()));
    const nextBtn = wrap.querySelector('[data-action="next"]');
    weightInput.addEventListener("input", (e) => {
      w.weightKg = String(RepCheckUnits.displayToKg(e.target.value) || 0);
      updateWeightHint();
      nextBtn.disabled = !canProceed();
    });
    return wrap;
  }

  function renderGoalWeightStep() {
    const weightUnit = RepCheckUnits.weightUnitLabel();
    const displayGoalWeight = w.goalWeightKg ? RepCheckUnits.kgToDisplay(parseFloat(w.goalWeightKg)) : "";
    const wrap = el(`
      <div>
        <div class="ob-wizard-step-label">${t("coaching.wizard.stepGoalWeight")}</div>
        <div class="ob-field">
          <label for="ob-goal-weight-kg">${t("coaching.wizard.goalWeight", { unit: weightUnit })}</label>
          <input type="number" id="ob-goal-weight-kg" min="1" step="0.1" value="${displayGoalWeight}">
          <div class="ob-field-hint" id="ob-goal-weight-hint"></div>
        </div>
      </div>
    `);
    const goalInput = wrap.querySelector("#ob-goal-weight-kg");
    const hintEl = wrap.querySelector("#ob-goal-weight-hint");
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
    // from the current weight, so it lives here (not the earlier weight
    // step) as part of "how fast to reach this goal weight" --
    // direction-specific (loss vs gain) since the safe/sane range differs
    // each way (see coaching_engine.py's LOSS_RATE_*/GAIN_RATE_* comments).
    if (w.aspiration === "lose" || w.aspiration === "gain") {
      const isLose = w.aspiration === "lose";
      const rateKey = isLose ? "lossRatePct" : "gainRatePct";
      const min = isLose ? LOSS_RATE_MIN_PCT : GAIN_RATE_MIN_PCT;
      const max = isLose ? LOSS_RATE_MAX_PCT : GAIN_RATE_MAX_PCT;
      const step = isLose ? 0.1 : 0.05;
      const decimals = isLose ? 1 : 2;
      const label = isLose ? t("coaching.wizard.lossRate") : t("coaching.wizard.gainRate");
      const rateField = el(`
        <div class="ob-field">
          <label for="ob-rate-slider">${label} <span id="ob-rate-value">${w[rateKey].toFixed(decimals)}</span>${t("coaching.wizard.perWeek")}</label>
          <input type="range" id="ob-rate-slider" min="${min}" max="${max}" step="${step}" value="${w[rateKey]}">
          <div class="ob-field-hint" id="ob-rate-hint"></div>
        </div>
      `);
      const slider = rateField.querySelector("#ob-rate-slider");
      const valueLabel = rateField.querySelector("#ob-rate-value");
      const rateHintEl = rateField.querySelector("#ob-rate-hint");
      const updateRateHint = () => {
        const wv = parseFloat(w.weightKg) || 0;
        rateHintEl.textContent = wv > 0
          ? t("coaching.wizard.rateHint", {
              rate: RepCheckUnits.formatWeightKg(w[rateKey] / 100 * wv),
              weight: RepCheckUnits.formatWeightKg(wv),
            })
          : "";
      };
      slider.addEventListener("input", (e) => {
        w[rateKey] = parseFloat(e.target.value);
        valueLabel.textContent = w[rateKey].toFixed(decimals);
        updateRateHint();
      });
      updateRateHint();
      wrap.appendChild(rateField);
    }

    const canProceed = () => {
      const gv = parseFloat(w.goalWeightKg);
      return gv >= MIN_WEIGHT_KG && gv <= MAX_WEIGHT_KG;
    };
    wrap.appendChild(renderWizardActions(canProceed()));
    const nextBtn = wrap.querySelector('[data-action="next"]');
    goalInput.addEventListener("input", (e) => {
      w.goalWeightKg = String(RepCheckUnits.displayToKg(e.target.value) || 0);
      updateHint();
      nextBtn.disabled = !canProceed();
    });
    return wrap;
  }

  // A vertical scroll-snap ruler instead of a horizontal <input type=range>
  // -- dragging/scrolling vertically through a tall list of 1cm ticks
  // gives much finer control over landing on one exact value than a thumb
  // sliding across a short horizontal track does.
  const HEIGHT_RULER_TICK_PX = 14;

  function renderHeightStep() {
    const rows = [];
    for (let cm = HEIGHT_MIN_CM; cm <= HEIGHT_MAX_CM; cm++) {
      const isMajor = cm % 10 === 0;
      const isMid = !isMajor && cm % 5 === 0;
      rows.push(`
        <div class="ob-height-ruler-row">
          <span class="ob-height-ruler-label">${isMajor ? cm : ""}</span>
          <span class="ob-height-ruler-mark ${isMajor ? "is-major" : isMid ? "is-mid" : ""}"></span>
        </div>
      `);
    }
    const wrap = el(`
      <div>
        <div class="ob-wizard-step-label">${t("coaching.wizard.height")}</div>
        <div class="ob-height-ruler">
          <div class="ob-height-ruler-value" id="ob-height-value">${RepCheckUnits.formatHeightCm(w.heightCm)}</div>
          <div class="ob-height-ruler-window">
            <div class="ob-height-ruler-indicator"></div>
            <div class="ob-height-ruler-scroll" id="ob-height-scroll" tabindex="0">${rows.join("")}</div>
          </div>
        </div>
      </div>
    `);
    const scrollEl = wrap.querySelector("#ob-height-scroll");
    const valueLabel = wrap.querySelector("#ob-height-value");
    scrollEl.addEventListener("scroll", () => {
      const index = Math.round(scrollEl.scrollTop / HEIGHT_RULER_TICK_PX);
      w.heightCm = Math.max(HEIGHT_MIN_CM, Math.min(HEIGHT_MAX_CM, HEIGHT_MIN_CM + index));
      valueLabel.textContent = RepCheckUnits.formatHeightCm(w.heightCm);
    }, { passive: true });
    // Jump to the current value once the ruler is actually in the DOM and
    // has a real scroll height to measure against (a fresh render
    // shouldn't visibly animate-scroll into place). setTimeout rather than
    // requestAnimationFrame -- rAF only fires on an actual paint, which
    // some automated/backgrounded tab contexts never deliver, silently
    // leaving the ruler stuck at scrollTop 0.
    setTimeout(() => {
      scrollEl.scrollTop = (w.heightCm - HEIGHT_MIN_CM) * HEIGHT_RULER_TICK_PX;
    });
    wrap.appendChild(renderWizardActions(w.heightCm >= HEIGHT_MIN_CM && w.heightCm <= HEIGHT_MAX_CM));
    return wrap;
  }

  function renderBodyTypeStep() {
    const gender = w.gender || "male";
    const ranges = bodyFatRangesFor(gender);
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepBodyType")}</div></div>`);
    const grid = el(`<div class="ob-body-type-grid"></div>`);
    ranges.forEach((r, i) => {
      const isSelected = w.bodyFatRangeId === r.id;
      grid.appendChild(el(`
        <button type="button" class="ob-body-type-card ${isSelected ? "is-selected" : ""}" data-action="set-body-type" data-value="${r.id}">
          ${isSelected ? `<span class="ob-body-type-check">✓</span>` : ""}
          <div class="ob-body-type-icon">${bodyTypeImageHtml(r.id)}</div>
          <div class="ob-body-type-label">${r.label}</div>
        </button>
      `));
    });
    wrap.appendChild(grid);
    wrap.appendChild(renderWizardActions(!!w.bodyFatRangeId));
    return wrap;
  }

  function renderActivityStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepActivity")}</div></div>`);
    wrap.appendChild(renderChoiceGrid(optionsFor(ACTIVITY_IDS, "coaching.activity", ACTIVITY_ICONS), "set-activity", w.activityLevel, true));
    wrap.appendChild(renderWizardActions(!!w.activityLevel));
    return wrap;
  }

  function renderProteinStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepProtein")}</div></div>`);
    const items = PROTEIN_IDS.map((id, i) => ({
      id,
      title: t(`coaching.protein.${id}.title`),
      sub: t(`coaching.protein.${id}.sub`),
      icon: proteinMeterSvg(i + 1),
    }));
    wrap.appendChild(renderChoiceGrid(items, "set-protein", w.proteinPreference, false));
    wrap.appendChild(renderWizardActions(!!w.proteinPreference));
    return wrap;
  }

  function renderDietStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepDiet")}</div></div>`);
    wrap.appendChild(renderChoiceGrid(optionsFor(DIET_IDS, "coaching.diet", DIET_ICONS), "set-diet", w.dietPreference, true));
    wrap.appendChild(renderWizardActions(!!w.dietPreference));
    return wrap;
  }

  function renderDistributionStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("coaching.wizard.stepDistribution")}</div></div>`);
    wrap.appendChild(renderChoiceGrid(optionsFor(DISTRIBUTION_IDS, "coaching.distribution", DISTRIBUTION_ICONS), "set-distribution", w.distribution, true));
    wrap.appendChild(renderWizardActions(!!w.distribution));
    return wrap;
  }

  function renderGymExperienceStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("onboarding.gymExperience.stepLabel")}</div></div>`);
    wrap.appendChild(renderChoiceGrid(optionsFor(GYM_EXPERIENCE_IDS, "onboarding.gymExperience", GYM_EXPERIENCE_ICONS), "set-gym-experience", w.gymExperience, true));
    wrap.appendChild(renderWizardActions(!!w.gymExperience));
    return wrap;
  }

  // ---------- Workout-split steps (mirrors workouts.html's split wizard) ----------
  function getTrainingLocations() {
    return [
      { id: "gym", title: t("workouts.wizard.location.gym.title"), sub: t("workouts.wizard.location.gym.sub"), icon: iconSvg(LOCATION_ICONS.gym) },
      { id: "home", title: t("workouts.wizard.location.home.title"), sub: t("workouts.wizard.location.home.sub"), icon: iconSvg(LOCATION_ICONS.home) },
      { id: "hybrid", title: t("workouts.wizard.location.hybrid.title"), sub: t("workouts.wizard.location.hybrid.sub"), icon: iconSvg(LOCATION_ICONS.hybrid) },
    ];
  }
  function getSplitTypes() {
    return [
      { id: "ppl", title: t("workouts.split.ppl"), sub: t("workouts.split.pplSub"), icon: iconSvg(SPLIT_TYPE_ICONS.ppl) },
      { id: "upper_lower", title: t("workouts.split.upperLower"), sub: t("workouts.split.upperLowerSub"), icon: iconSvg(SPLIT_TYPE_ICONS.upper_lower) },
      { id: "full_body", title: t("workouts.split.fullBody"), sub: t("workouts.split.fullBodySub"), icon: iconSvg(SPLIT_TYPE_ICONS.full_body) },
      { id: "bro_split", title: t("workouts.split.broSplit"), sub: t("workouts.split.broSplitSub"), icon: iconSvg(SPLIT_TYPE_ICONS.bro_split) },
      { id: "custom", title: t("workouts.split.custom"), sub: t("workouts.split.customSub"), icon: iconSvg(SPLIT_TYPE_ICONS.custom) },
    ];
  }

  function renderLocationStep() {
    const wrap = el(`
      <div>
        <div class="ob-section-label">${t("onboarding.workoutSectionLabel")}</div>
        <div class="ob-wizard-step-label">${t("workouts.wizard.stepLocation")}</div>
        <div class="ob-type-grid"></div>
      </div>
    `);
    const grid = wrap.querySelector(".ob-type-grid");
    getTrainingLocations().forEach((loc) => {
      grid.appendChild(el(`
        <div class="ob-type-card ${w.location === loc.id ? "is-selected" : ""}" data-action="set-location" data-value="${loc.id}">
          <div class="ob-type-card-icon">${loc.icon}</div>
          <div class="ob-type-card-text">
            <div class="ob-type-card-title">${loc.title}</div>
            <div class="ob-type-card-sub">${loc.sub}</div>
          </div>
        </div>
      `));
    });
    wrap.appendChild(renderWizardActions(!!w.location));
    return wrap;
  }

  function renderSplitTypeStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("workouts.wizard.step1")}</div><div class="ob-type-grid"></div></div>`);
    const grid = wrap.querySelector(".ob-type-grid");
    getSplitTypes().forEach((st) => {
      grid.appendChild(el(`
        <div class="ob-type-card ${w.splitType === st.id ? "is-selected" : ""}" data-action="set-split-type" data-value="${st.id}">
          <div class="ob-type-card-icon">${st.icon}</div>
          <div class="ob-type-card-text">
            <div class="ob-type-card-title">${st.title}</div>
            <div class="ob-type-card-sub">${st.sub}</div>
          </div>
        </div>
      `));
    });

    if (w.splitType === "custom") {
      const customWrap = el(`
        <div>
          <div class="ob-custom-input-row">
            <input type="text" id="ob-custom-input" placeholder="${t("workouts.wizard.customPlaceholder")}" autocomplete="off">
            <button type="button" class="ob-custom-add-btn" id="ob-custom-add-btn">${t("workouts.wizard.add")}</button>
          </div>
          <div class="ob-custom-days" id="ob-custom-days"></div>
        </div>
      `);
      wrap.appendChild(customWrap);
      const daysList = customWrap.querySelector("#ob-custom-days");
      w.customDays.forEach((name, i) => {
        daysList.appendChild(el(`
          <div class="ob-custom-day-row">
            <span>${name}</span>
            <button type="button" class="ob-custom-day-remove" data-action="remove-custom-day" data-value="${i}">&times;</button>
          </div>
        `));
      });
      const input = customWrap.querySelector("#ob-custom-input");
      const addBtn = customWrap.querySelector("#ob-custom-add-btn");
      const addDay = () => {
        const value = input.value.trim();
        if (value) { w.customDays.push(value); render(); }
      };
      addBtn.addEventListener("click", addDay);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addDay(); } });
    }

    const canProceed = w.splitType === "custom" ? w.customDays.length > 0 : !!w.splitType;
    wrap.appendChild(renderWizardActions(canProceed));
    return wrap;
  }

  // Optional free-text goal, mirrors workouts.html's renderSplitStepGoal --
  // reuses that wizard's own i18n keys/backend field rather than inventing
  // a new one, since /api/generate-split already keyword-matches and
  // (for AI-backed plans) verbatim-injects this text; onboarding previously
  // just hardcoded goal:"" and skipped asking entirely.
  function renderLiftingGoalStep() {
    const wrap = el(`
      <div>
        <div class="ob-wizard-step-label">${t("workouts.wizard.stepGoal")}</div>
        <div class="ob-field-hint" style="margin-bottom:12px;">${t("workouts.wizard.goalHint")}</div>
        <div class="ob-field">
          <textarea id="ob-goal-text" class="ob-goal-textarea" maxlength="300" placeholder="${t("workouts.wizard.goalPlaceholder")}">${w.liftingGoal}</textarea>
        </div>
      </div>
    `);
    wrap.querySelector("#ob-goal-text").addEventListener("input", (e) => {
      w.liftingGoal = e.target.value;
    });
    wrap.appendChild(renderWizardActions(true));
    return wrap;
  }

  function renderDaysPerWeekStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("workouts.wizard.step2")}</div><div class="ob-days-grid"></div></div>`);
    const grid = wrap.querySelector(".ob-days-grid");
    [1, 2, 3, 4, 5, 6, 7].forEach((n) => {
      grid.appendChild(el(`<button type="button" class="ob-day-btn ${w.daysPerWeek === n ? "is-selected" : ""}" data-action="set-days" data-value="${n}">${n}</button>`));
    });
    wrap.appendChild(renderWizardActions(!!w.daysPerWeek));
    return wrap;
  }

  // ---------- Generate + result ----------
  function renderGenerating() {
    return el(`<div class="ob-loading">${t("onboarding.generating")}</div>`);
  }

  async function generateAndCalculate() {
    w.generating = true;
    w.error = null;
    render();
    try {
      let trainingDays = [];
      // A user who said they don't exercise at all never went through the
      // workout-split questions (see WORKOUT_SECTION_STEPS) -- there's no
      // split_type/location/etc to generate a plan from, and generating
      // one anyway would silently hand them a workout plan they explicitly
      // said they don't want. Nutrition targets don't need a plan either
      // way (see api_coaching_calculate in app.py).
      if (w.activityLevel !== "none") {
        const splitRes = await fetch("/api/generate-split", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            split_type: w.splitType,
            days_per_week: w.daysPerWeek,
            custom_days: w.customDays,
            goal: w.splitType === "custom" ? "" : w.liftingGoal,
            custom_days_exercises: {},
            location: w.location,
          }),
        });
        const splitData = await splitRes.json();
        if (!splitData.ok) throw new Error(splitData.error || t("onboarding.error"));
        w.generatedDays = splitData.days;
        w.generatedSchedule = splitData.schedule;
        w.rationale = splitData.rationale;
        trainingDays = Object.keys(w.generatedSchedule).filter(
          (day) => w.generatedSchedule[day] && w.generatedSchedule[day] !== "Rest"
        );
      } else {
        w.generatedDays = null;
        w.generatedSchedule = null;
        w.rationale = null;
      }

      const coachRes = await fetch("/api/coaching/calculate", {
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
          training_days: trainingDays,
        }),
      });
      const coachData = await coachRes.json();
      if (!coachData.ok) throw new Error(coachData.error || t("onboarding.error"));
      w.nutritionResult = coachData;

      w.generating = false;
      w.stepIndex = STEPS.length; // -> result view
      render();
    } catch (err) {
      w.generating = false;
      w.error = err.message || t("onboarding.error");
      // Without this, renderCurrentView() (which only shows the error via
      // renderResult()) sees a stepIndex still pointing at the last
      // question, and silently re-renders that question instead of the
      // error -- reported as "it keeps loading and comes back to the
      // previous question" with no visible error at all.
      w.stepIndex = STEPS.length;
      render();
    }
  }

  function renderResult() {
    if (w.error) {
      const wrap = el(`<div><div class="ob-error">${w.error}</div></div>`);
      wrap.appendChild(el(`
        <div class="ob-wizard-actions">
          <button type="button" class="ob-btn-secondary" data-action="back-to-days">${t("common.back")}</button>
          <button type="button" class="ob-btn-primary" data-action="retry-generate">${t("common.next")}</button>
        </div>
      `));
      return wrap;
    }

    const targets = w.nutritionResult.targets;
    const wrap = el(`
      <div>
        <div class="ob-result-hero">
          <div class="ob-result-hero-icon">${iconSvg("check")}</div>
          <div class="ob-result-hero-title">${t("onboarding.result.title")}</div>
        </div>

        <div class="ob-result-section">
          <div class="ob-section-label">${t("onboarding.result.nutritionLabel")}</div>
          <div class="ob-result-calorie-icon">${iconSvg("calories")}</div>
          <div class="ob-result-calories">${targets.calories}</div>
          <div class="ob-result-label">${t("coaching.wizard.kcalPerDay")}</div>
          <div class="ob-macro-row">
            <div class="ob-macro-chip">
              <div class="ob-macro-chip-icon ob-macro-icon-protein">${iconSvg("proteinMacro")}</div>
              <div class="ob-macro-chip-value">${targets.protein}g</div>
              <div class="ob-macro-chip-label">${t("common.protein")}</div>
            </div>
            <div class="ob-macro-chip">
              <div class="ob-macro-chip-icon ob-macro-icon-fat">${iconSvg("fatMacro")}</div>
              <div class="ob-macro-chip-value">${targets.fat}g</div>
              <div class="ob-macro-chip-label">${t("common.fat")}</div>
            </div>
            <div class="ob-macro-chip">
              <div class="ob-macro-chip-icon ob-macro-icon-carbs">${iconSvg("carbsMacro")}</div>
              <div class="ob-macro-chip-value">${targets.carbs}g</div>
              <div class="ob-macro-chip-label">${t("common.carbs")}</div>
            </div>
          </div>
          <div class="ob-result-detail">${t("coaching.wizard.maintenance", { tdee: targets.tdee, bmr: targets.bmr })}</div>
        </div>
      </div>
    `);

    // No split plan at all for a "none" activity user (see
    // generateAndCalculate()) -- the whole split-review + weekday-assign
    // block only applies when one was actually generated.
    if (w.generatedDays) {
      const splitSection = el(`
        <div class="ob-result-section">
          <div class="ob-section-label">${t("onboarding.result.splitLabel", { n: w.generatedDays.length })}</div>
          ${w.generatedDays.map((day, i) => `
            <div class="ob-review-day">
              <div class="ob-review-day-header">
                <div class="ob-review-day-icon">${iconSvg("dumbbell")}</div>
                <div class="ob-review-day-title">Day ${i + 1} · ${day.label}</div>
              </div>
              <div class="ob-review-exercise-chips">
                ${day.exercises.map((ex) => `<span class="ob-review-exercise-chip"><span class="ob-review-exercise-chip-icon">${exerciseIconHtml(ex)}</span>${ex}</span>`).join("")}
              </div>
            </div>
          `).join("")}
          ${w.rationale ? `
            <div class="ob-rationale">
              <div class="ob-rationale-label">${iconSvg("bulb")}<span>${t("workouts.wizard.whyThisSchedule")}</span></div>
              <div class="ob-rationale-text">${w.rationale}</div>
            </div>
          ` : ""}
          <div class="ob-section-label">${t("workouts.wizard.chooseWorkoutDays")}</div>
          <div id="ob-weekday-assign"></div>
        </div>
      `);
      wrap.appendChild(splitSection);

      const uniqueLabels = [...new Set(w.generatedDays.map((d) => d.label))];
      const restLabel = t("workouts.wizard.rest");
      const assignEl = splitSection.querySelector("#ob-weekday-assign");
      MONDAY_FIRST.forEach((key, i) => {
        assignEl.appendChild(el(`
          <div class="ob-weekday-row">
            <label>${MONDAY_FIRST_LABELS[i]}</label>
            <select data-weekday="${key}">
              <option value="Rest" ${w.generatedSchedule[key] === "Rest" ? "selected" : ""}>${restLabel}</option>
              ${uniqueLabels.map((label) => `<option value="${label}" ${w.generatedSchedule[key] === label ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
        `));
      });
    }

    wrap.appendChild(el(`
      <div class="ob-wizard-actions">
        <button type="button" class="ob-btn-primary" id="ob-save-btn" style="flex:1;">${t("onboarding.getStarted")}</button>
      </div>
    `));
    wrap.querySelector("#ob-save-btn").addEventListener("click", save);
    return wrap;
  }

  // Directly PUTs a synced key and waits for the server to actually
  // confirm it, instead of relying on the fire-and-forget
  // sendBeacon/keepalive-fetch path the wrapped localStorage.setItem below
  // also triggers. That path is fine for normal in-page edits, but right
  // here we're about to mark the account as fully onboarded and then
  // immediately navigate to a brand-new page -- if any of these saves
  // hadn't actually landed on the server yet, onboarding_completed would
  // end up true with no profile/split data behind it, which is exactly
  // what was happening (see app.py's threaded=True comment for the other
  // half of this fix).
  function putSynced(key, value) {
    return fetch("/api/sync/" + encodeURIComponent(key), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }).catch(function () {});
  }

  async function save() {
    const saveBtn = document.getElementById("ob-save-btn");
    saveBtn.disabled = true;
    saveBtn.textContent = t("common.loading");

    const todayIso = new Date().toISOString().slice(0, 10);

    const profile = {
      aspiration: w.aspiration,
      gender: w.gender,
      weightKg: parseFloat(w.weightKg),
      goalWeightKg: w.aspiration === "maintain" ? parseFloat(w.weightKg) : parseFloat(w.goalWeightKg),
      heightCm: w.heightCm,
      bodyFatRangeId: w.bodyFatRangeId,
      activityLevel: w.activityLevel,
      gymExperience: w.gymExperience,
      proteinPreference: w.proteinPreference,
      dietPreference: w.dietPreference,
      distribution: w.distribution,
      lossRatePct: w.aspiration === "lose" ? w.lossRatePct : null,
      gainRatePct: w.aspiration === "gain" ? w.gainRatePct : null,
      createdAt: todayIso,
      lastAdjustmentDate: todayIso,
    };
    const goals = {
      protein: w.nutritionResult.targets.protein,
      fat: w.nutritionResult.targets.fat,
      carbs: w.nutritionResult.targets.carbs,
    };

    // Local writes first (wrapped setItem still fires its own
    // best-effort sync in parallel) so every other page's synchronous,
    // localStorage-reading render code is correct immediately if the
    // reload lands before the awaited PUTs below finish.
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
    // Mirrors coaching.js's wizardSave(): a freshly-set goal is a new
    // milestone, so neither the pending-achievement flag nor the
    // already-acted-on marker from a PREVIOUS goal may carry into it.
    // Without this, someone who used the app anonymously, hit a goal and
    // completed that check-in, then created an account and re-entered the
    // same goal would find the congrats sheet never fires again and the
    // check-in never force-readies for it -- suppressed by a stale marker.
    localStorage.removeItem(ACHIEVED_KEY);
    localStorage.removeItem(ACHIEVED_HANDLED_KEY);
    if (w.nutritionResult.distribution) {
      localStorage.setItem(DISTRIBUTION_KEY, JSON.stringify(w.nutritionResult.distribution));
    } else {
      localStorage.removeItem(DISTRIBUTION_KEY);
    }

    const syncPromises = [putSynced(PROFILE_KEY, profile), putSynced(GOALS_KEY, goals)];

    // No split plan was ever generated for a "none" activity user (see
    // generateAndCalculate()) -- leave the key entirely absent rather than
    // writing one with nulled-out fields, matching how home.html/
    // workouts.html already treat "key missing" as "no plan yet, show the
    // create-a-plan CTA" instead of a broken/empty plan.
    if (w.generatedDays) {
      const schedule = {};
      document.querySelectorAll("#ob-weekday-assign [data-weekday]").forEach((select) => {
        schedule[select.dataset.weekday] = select.value;
      });
      const splitPlan = {
        splitType: w.splitType,
        daysPerWeek: w.daysPerWeek,
        goal: w.splitType === "custom" ? "" : w.liftingGoal,
        days: w.generatedDays,
        schedule,
      };
      localStorage.setItem(SPLIT_PLAN_KEY, JSON.stringify(splitPlan));
      syncPromises.push(putSynced(SPLIT_PLAN_KEY, splitPlan));
    }
    if (w.nutritionResult.distribution) {
      syncPromises.push(putSynced(DISTRIBUTION_KEY, w.nutritionResult.distribution));
    }

    document.dispatchEvent(new CustomEvent("repcheck:goals-updated"));

    // Wait for the server to actually have these before marking the
    // account onboarded -- see putSynced's comment above.
    await Promise.all(syncPromises);

    await fetch("/api/onboarding/complete", { method: "POST" }).catch(function () {});
    // Queue the first-run app tour from step 0 so tour.js walks the new user
    // through the app once they land on home (it reads + clears these keys).
    try {
      localStorage.setItem("repcheck_pending_tour", "1");
      localStorage.setItem("repcheck_tour_step", "0");
    } catch (e) {}
    window.location.href = "/";
  }

  // ---------- Actions ----------
  function handleClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const value = target.dataset.value;

    if (action === "start") { w.stepIndex = 0; return render(); }
    if (action === "set-aspiration") { w.aspiration = value; return render(); }
    if (action === "set-gender") {
      w.gender = value;
      if (!bodyFatRangesFor(value).some((r) => r.id === w.bodyFatRangeId)) w.bodyFatRangeId = null;
      return render();
    }
    if (action === "set-body-type") { w.bodyFatRangeId = value; return render(); }
    if (action === "set-activity") { w.activityLevel = value; return render(); }
    if (action === "set-protein") { w.proteinPreference = value; return render(); }
    if (action === "set-diet") { w.dietPreference = value; return render(); }
    if (action === "set-distribution") { w.distribution = value; return render(); }
    if (action === "set-gym-experience") { w.gymExperience = value; return render(); }
    if (action === "set-location") { w.location = value; return render(); }
    if (action === "set-split-type") { w.splitType = value; return render(); }
    if (action === "remove-custom-day") { w.customDays.splice(parseInt(value, 10), 1); return render(); }
    if (action === "set-days") { w.daysPerWeek = parseInt(value, 10); return render(); }
    if (action === "back-to-days") { w.error = null; w.stepIndex = lastVisibleIndex(); return render(); }
    if (action === "retry-generate") return generateAndCalculate();

    if (action === "back") {
      if (w.stepIndex === 0) return;
      w.stepIndex = Math.max(0, prevVisibleIndex(w.stepIndex));
      return render();
    }
    if (action === "next") {
      // Custom splits already fully specify their own days -- skip the
      // lifting-goal and days-per-week steps and go straight to
      // generation, same as the original split wizard.
      if (currentStep() === "split_type" && w.splitType === "custom") {
        w.daysPerWeek = Math.min(w.customDays.length, 7);
        return generateAndCalculate();
      }
      const nextIndex = nextVisibleIndex(w.stepIndex);
      if (nextIndex >= STEPS.length) return generateAndCalculate();
      w.stepIndex = nextIndex;
      return render();
    }
  }

  document.querySelector(".ob-card").addEventListener("click", handleClick);
  document.addEventListener("repcheck:language-changed", render);
  render();
})();
