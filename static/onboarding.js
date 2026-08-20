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
  // Goal-achievement state, cleared when save() writes a new goal -- see
  // there. Same keys as coaching.js/base.html; declared here too since this
  // file is a standalone IIFE with no shared module scope.
  const ACHIEVED_KEY = "repcheck_coaching_goal_achieved_v1";
  const ACHIEVED_HANDLED_KEY = "repcheck_coaching_goal_achieved_handled_v1";

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
  // -- keep these in sync if those ever change, including the derivation
  // (kg/week target at RATE_REFERENCE_WEIGHT_KG, not a bare %) so the two
  // files can't silently drift to different numbers for the same intent.
  const RATE_REFERENCE_WEIGHT_KG = 75;
  const LOSS_STANDARD_MIN_KG_PER_WEEK = 0.2;
  const LOSS_STANDARD_MAX_KG_PER_WEEK = 0.8;
  const LOSS_RATE_MIN_PCT = 0.1;
  const LOSS_RATE_MAX_PCT = 2.0;
  const LOSS_RATE_DEFAULT_PCT = (LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
  const GAIN_RATE_MIN_PCT = 0.25;
  const GAIN_STANDARD_MAX_KG_PER_WEEK = 0.6;
  const GAIN_RATE_MAX_PCT = (GAIN_STANDARD_MAX_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
  const GAIN_RATE_DEFAULT_PCT = 0.35;
  // How many weeks a "per month" readout multiplies the weekly rate by --
  // the precise average (365.25 / 7 / 12), not the common but slightly-off
  // "4 weeks" shorthand, since this is arithmetic the app is asserting as
  // a specific number to the user (see the "Per Month" row in
  // renderRateSlider()), not just a rough label.
  const WEEKS_PER_MONTH = 365.25 / 7 / 12;

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
    return `<img src="/static/bodyfat/${rangeId}.webp" alt="" decoding="async" class="ob-body-type-img" onerror="this.onerror=null;this.src='${BODY_TYPE_FALLBACK_SRC}'">`;
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

  // ---------- State ----------
  // stepIndex -1 = intro screen, 0..STEPS.length-1 = question steps,
  // "generating"/"result" handled via separate boolean/string flags below.
  // Nutrition questions only. First run no longer asks anything about a
  // workout split -- those questions live in workouts.html's split wizard,
  // which every user goes through anyway the first time they build or edit
  // a split, so asking them here only made setup longer and handed people a
  // plan before they'd seen the app. Onboarding now always finishes on the
  // nutrition-only result screen and never writes a split plan; home.html/
  // workouts.html already treat "no plan yet" as the create-a-plan CTA.
  // The same ten questions, grouped into five screens so setup feels
  // short: related questions share a screen (each with its own small
  // sub-heading) and Next only unlocks once every question on the screen
  // is answered. The data collected -- and the profile/targets computed
  // from it -- are identical to the old one-question-per-screen flow.
  const STEPS = [
    "aspiration", "about_you", "goal_weight", "body_activity", "preferences",
  ];

  // "goal_weight" only makes sense when the user is actually trying to move
  // away from their current weight -- for "maintain" it's the same number
  // by definition, so the step is skipped rather than asking a redundant
  // question (see nextVisibleIndex/prevVisibleIndex below).
  function shouldSkipStep(step) {
    return step === "goal_weight" && w.aspiration === "maintain";
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
    // A real starting position for the weight ruler to render at, same
    // idea as heightCm below -- unlike a blank text input, a scroll wheel
    // has no "empty" state, so it needs a plausible value to sit at before
    // the user has touched it at all.
    weightKg: "70",
    goalWeightKg: "",
    heightCm: 170,
    bodyFatRangeId: null,
    activityLevel: null,
    proteinPreference: null,
    dietPreference: "balanced",
    distribution: "stable",
    lossRatePct: LOSS_RATE_DEFAULT_PCT,
    gainRatePct: GAIN_RATE_DEFAULT_PCT,
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
    wrapEl.classList.toggle("is-wide", currentStep() === "body_activity");
    renderProgress();
    bodyEl.innerHTML = "";
    bodyEl.appendChild(renderCurrentView());
  }

  // For taps that just select an option on the CURRENT screen: a full
  // render() replaces #ob-body's children, which resets the page's scroll
  // position -- fine when every screen fit one question, but the combined
  // screens are tall enough to scroll, and snapping back to the top after
  // every tap would make the lower question unanswerable in peace.
  function renderKeepingScroll() {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  function renderCurrentView() {
    if (w.stepIndex === -1) return renderIntro();
    if (w.generating) return renderGenerating();
    if (w.stepIndex >= STEPS.length) return renderResult();
    const step = currentStep();
    if (step === "aspiration") return renderAspirationStep();
    if (step === "about_you") return renderAboutYouStep();
    if (step === "goal_weight") return renderGoalWeightStep();
    if (step === "body_activity") return renderBodyActivityStep();
    return renderPreferencesStep();
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

  // ---------- Combined-screen plumbing ----------
  // Each of the old one-question screens is now a "section": the same
  // content it always rendered, under a small sub-heading (its old screen
  // title) instead of the big step label, with no Next/Back row of its
  // own -- the combined screen appends one shared actions row at the end.
  function section(labelKey, ...children) {
    const sec = el(`<div class="ob-substep"><div class="ob-substep-label">${t(labelKey)}</div></div>`);
    children.forEach((child) => sec.appendChild(child));
    return sec;
  }

  function renderGenderSection() {
    const items = [
      { id: "male", title: t("coaching.gender.male"), icon: iconSvg(GENDER_ICONS.male) },
      { id: "female", title: t("coaching.gender.female"), icon: iconSvg(GENDER_ICONS.female) },
    ];
    return section("coaching.wizard.stepGender", renderChoiceGrid(items, "set-gender", w.gender, false));
  }

  function renderAboutYouStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("onboarding.step.aboutYou")}</div></div>`);
    wrap.appendChild(renderGenderSection());
    wrap.appendChild(renderWeightSection());
    wrap.appendChild(renderHeightSection());
    // The rulers can only ever hold in-range values (see their comments),
    // so gender is the one answer on this screen that can still be missing.
    wrap.appendChild(renderWizardActions(!!w.gender));
    return wrap;
  }

  // A vertical scroll-snap ruler instead of a horizontal <input type=number>
  // -- same rationale as the height ruler below: a fresh signup entering
  // their weight for the first time gets a wheel they can flick through
  // instead of having to summon a number keyboard. Ticks in whole kg (the
  // canonical unit) regardless of the user's display preference, same as
  // the height ruler ticking in whole cm even when showing ft/in -- only
  // the value LABEL is unit-aware, the ruler itself always ticks in the
  // unit the profile is actually stored/validated in.
  const WEIGHT_RULER_TICK_PX = 14;

  function renderWeightSection() {
    const rows = [];
    for (let kg = MIN_WEIGHT_KG; kg <= MAX_WEIGHT_KG; kg++) {
      const isMajor = kg % 10 === 0;
      const isMid = !isMajor && kg % 5 === 0;
      rows.push(`
        <div class="ob-weight-ruler-row">
          <span class="ob-weight-ruler-label">${isMajor ? kg : ""}</span>
          <span class="ob-weight-ruler-mark ${isMajor ? "is-major" : isMid ? "is-mid" : ""}"></span>
        </div>
      `);
    }
    const ruler = el(`
      <div class="ob-weight-ruler">
        <div class="ob-weight-ruler-value" id="ob-weight-value">${RepCheckUnits.formatWeightKg(parseFloat(w.weightKg))}</div>
        <div class="ob-weight-ruler-window">
          <div class="ob-weight-ruler-indicator"></div>
          <div class="ob-weight-ruler-scroll" id="ob-weight-scroll" tabindex="0">${rows.join("")}</div>
        </div>
      </div>
    `);
    const wrap = section("coaching.wizard.stepWeight", ruler);
    const scrollEl = wrap.querySelector("#ob-weight-scroll");
    const valueLabel = wrap.querySelector("#ob-weight-value");
    scrollEl.addEventListener("scroll", () => {
      const index = Math.round(scrollEl.scrollTop / WEIGHT_RULER_TICK_PX);
      w.weightKg = String(Math.max(MIN_WEIGHT_KG, Math.min(MAX_WEIGHT_KG, MIN_WEIGHT_KG + index)));
      valueLabel.textContent = RepCheckUnits.formatWeightKg(parseFloat(w.weightKg));
    }, { passive: true });
    // setTimeout rather than requestAnimationFrame -- see renderHeightSection
    // below for why.
    setTimeout(() => {
      scrollEl.scrollTop = (parseFloat(w.weightKg) - MIN_WEIGHT_KG) * WEIGHT_RULER_TICK_PX;
    });
    // Unlike the old text input, the ruler can never produce an out-of-
    // range value (every row is clamped to [MIN_WEIGHT_KG, MAX_WEIGHT_KG]
    // by construction), so there's nothing to re-validate on scroll --
    // same reasoning as renderHeightSection, which has no live disabled-
    // toggle either.
    return wrap;
  }

  // Rate is a % of bodyweight per week (see coaching_engine.py's
  // LOSS_RATE_*/GAIN_RATE_* for where that number comes from). Projecting a
  // target date from it is pure linear arithmetic, entirely independent of
  // the server's BMR/TDEE/calorie math -- so unlike the calorie numbers
  // themselves, this is safe and correct to compute client-side instead of
  // round-tripping to the server for it.
  function estimateGoalDate(weightKg, goalWeightKg, ratePct) {
    const cur = parseFloat(weightKg) || 0;
    const goal = parseFloat(goalWeightKg) || 0;
    if (cur <= 0 || goal <= 0 || !ratePct) return null;
    const weeklyChangeKg = cur * (ratePct / 100);
    const weeksNeeded = weeklyChangeKg > 0 ? Math.abs(cur - goal) / weeklyChangeKg : 0;
    if (!isFinite(weeksNeeded) || weeksNeeded <= 0) return null;
    const eta = new Date();
    eta.setDate(eta.getDate() + Math.round(weeksNeeded * 7));
    return eta;
  }

  // Custom continuous slider for "how fast" (rate of weight loss/gain),
  // replacing the old native <input type="range">. Two things a native
  // range input can't do that this step needs: (1) a highlighted "standard"
  // zone on the track whose position depends on the user's own bodyweight,
  // not a fixed spot, and (2) genuinely continuous dragging (no discrete
  // step "clicks") for a smoother feel than a coarse native step allows.
  // Value is always % of bodyweight/week internally -- see the
  // LOSS_RATE_*/GAIN_RATE_* comment above for why kg/week is only a display
  // conversion, never the stored unit.
  function renderRateSlider({ isLose, value, weightKg, onChange }) {
    const min = isLose ? LOSS_RATE_MIN_PCT : GAIN_RATE_MIN_PCT;
    const max = isLose ? LOSS_RATE_MAX_PCT : GAIN_RATE_MAX_PCT;
    const wv = parseFloat(weightKg) || 0;
    // Only the loss direction gets a highlighted "standard" zone -- gain
    // just gets the same smooth continuous slider with a wider range, since
    // that's the only thing asked for on the gain side.
    let zoneMinPct = null;
    let zoneMaxPct = null;
    if (isLose && wv > 0) {
      zoneMinPct = Math.max(min, Math.min(max, (LOSS_STANDARD_MIN_KG_PER_WEEK / wv) * 100));
      zoneMaxPct = Math.max(min, Math.min(max, (LOSS_STANDARD_MAX_KG_PER_WEEK / wv) * 100));
    }

    const rateLabel = isLose ? t("coaching.wizard.lossRate") : t("coaching.wizard.gainRate");
    const unitLabel = RepCheckUnits.weightUnitLabel();
    const pctUnitLabel = t("coaching.wizard.percentBodyweightUnit");
    const wrap = el(`
      <div class="ob-field ob-rate-field">
        <label>${rateLabel} <span id="ob-rate-header-value"></span>${t("coaching.wizard.perWeek")}</label>
        <div class="ob-rate-badge" id="ob-rate-badge"></div>
        <div class="ob-rate-slider" id="ob-rate-slider" role="slider" tabindex="0"
             aria-valuemin="${min}" aria-valuemax="${max}" aria-label="${rateLabel}">
          <div class="ob-rate-slider-track">
            ${zoneMinPct !== null ? `<div class="ob-rate-slider-zone" id="ob-rate-zone"></div>` : ""}
          </div>
          <div class="ob-rate-slider-thumb" id="ob-rate-thumb"></div>
        </div>
        <div class="ob-rate-readout-row">
          <span class="ob-rate-readout-sign">+</span>
          <div class="ob-rate-readout-box"><span id="ob-rate-kg-week"></span><span class="ob-rate-readout-unit">${unitLabel}</span></div>
          <div class="ob-rate-readout-box ob-rate-readout-box-pct"><span id="ob-rate-pct-week"></span><span class="ob-rate-readout-unit">${pctUnitLabel}</span></div>
          <span class="ob-rate-readout-freq">${t("coaching.wizard.perWeekLabel")}</span>
        </div>
        <div class="ob-rate-readout-row">
          <span class="ob-rate-readout-sign">+</span>
          <div class="ob-rate-readout-box"><span id="ob-rate-kg-month"></span><span class="ob-rate-readout-unit">${unitLabel}</span></div>
          <div class="ob-rate-readout-box ob-rate-readout-box-pct"><span id="ob-rate-pct-month"></span><span class="ob-rate-readout-unit">${pctUnitLabel}</span></div>
          <span class="ob-rate-readout-freq">${t("coaching.wizard.perMonthLabel")}</span>
        </div>
        <div class="ob-eta-card" id="ob-rate-eta" data-label="${t("coaching.wizard.rateEtaLabel")}"></div>
      </div>
    `);

    const sliderEl = wrap.querySelector("#ob-rate-slider");
    const zoneEl = wrap.querySelector("#ob-rate-zone");
    const thumbEl = wrap.querySelector("#ob-rate-thumb");
    const badgeEl = wrap.querySelector("#ob-rate-badge");
    const headerValueEl = wrap.querySelector("#ob-rate-header-value");
    const kgWeekEl = wrap.querySelector("#ob-rate-kg-week");
    const pctWeekEl = wrap.querySelector("#ob-rate-pct-week");
    const kgMonthEl = wrap.querySelector("#ob-rate-kg-month");
    const pctMonthEl = wrap.querySelector("#ob-rate-pct-month");

    if (zoneEl && zoneMinPct !== null) {
      const zoneLeft = ((zoneMinPct - min) / (max - min)) * 100;
      const zoneWidth = ((zoneMaxPct - zoneMinPct) / (max - min)) * 100;
      zoneEl.style.left = `${zoneLeft}%`;
      zoneEl.style.width = `${zoneWidth}%`;
    }

    let current = Math.max(min, Math.min(max, value));

    function inZone(val) {
      return zoneMinPct !== null && val >= zoneMinPct && val <= zoneMaxPct;
    }

    function redraw() {
      const t01 = (current - min) / (max - min);
      // transform, not left -- this runs on every pointermove/keydown
      // during a drag, and a `left` write is layout-triggering while a
      // `transform` write is compositor-only (see .ob-rate-slider-thumb's
      // `left: 0` in onboarding.html; the -13px half-width centering now
      // lives in this calc() instead of a static CSS margin-left). The
      // drag-scale bump is folded into this same string -- an inline
      // transform overrides a stylesheet transform.scale() rule on the
      // same property rather than combining with it, so that effect can't
      // live in a separate CSS class alongside this.
      //
      // The offset must be in px, not %: a CSS transform percentage
      // resolves against the THUMB's own border box (26px), not the
      // track it's positioned in, so `translateX(t01 * 100%)` only ever
      // moved the thumb a few px regardless of value. Reuse the cached
      // drag-gesture rect while dragging (same perf reasoning as
      // dragRect elsewhere in this function); otherwise take one
      // fresh measurement, which redraw() only needs for keydown/init,
      // not on every pointermove.
      const trackWidth = dragging && dragRect ? dragRect.width : sliderEl.getBoundingClientRect().width;
      thumbEl.style.transform = `translateX(calc(${t01 * trackWidth}px - 13px))${dragging ? " scale(1.15)" : ""}`;
      sliderEl.setAttribute("aria-valuenow", current.toFixed(3));

      const standard = inZone(current);
      thumbEl.classList.toggle("is-standard", standard);
      headerValueEl.textContent = current.toFixed(2);

      if (zoneMinPct !== null) {
        // Small drag tolerance around the zone's lower edge -- the
        // "Standard (Recommended)" label calls out the specific
        // recommended entry point, not just "anywhere in the zone", but
        // landing back on one exact float value via a continuous drag
        // isn't a realistic target without some tolerance.
        const tolerance = (max - min) * 0.02;
        const atRecommended = Math.abs(current - zoneMinPct) <= tolerance;
        let badgeKey = "coaching.wizard.rateStandard";
        if (current < zoneMinPct) badgeKey = "coaching.wizard.rateSlower";
        else if (current > zoneMaxPct) badgeKey = "coaching.wizard.rateFaster";
        else if (atRecommended) badgeKey = "coaching.wizard.rateStandardRecommended";
        badgeEl.textContent = t(badgeKey);
        badgeEl.className = "ob-rate-badge" + (standard ? " is-standard" : "");
      } else {
        badgeEl.textContent = "";
        badgeEl.className = "ob-rate-badge";
      }

      const weekKg = (current / 100) * wv;
      kgWeekEl.textContent = RepCheckUnits.kgToDisplay(weekKg);
      pctWeekEl.textContent = current.toFixed(2);
      kgMonthEl.textContent = RepCheckUnits.kgToDisplay(weekKg * WEEKS_PER_MONTH);
      pctMonthEl.textContent = (current * WEEKS_PER_MONTH).toFixed(2);
    }

    function setValue(next) {
      current = Math.max(min, Math.min(max, next));
      redraw();
      onChange(current);
    }

    function valueFromClientX(clientX, rect) {
      const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
      return min + Math.max(0, Math.min(1, ratio)) * (max - min);
    }

    let dragging = false;
    // Cached once per drag gesture in onPointerDown, reused for every
    // pointermove until pointerup -- re-querying getBoundingClientRect() on
    // every pointermove (which can fire many times per animation frame)
    // forces a synchronous layout flush each time, since the browser must
    // resolve any pending layout before it can answer. The slider's own
    // position never changes mid-drag, so one read per gesture is enough.
    let dragRect = null;
    function onPointerDown(e) {
      dragging = true;
      sliderEl.classList.add("is-dragging");
      // Capture is a nice-to-have (keeps the drag tracking correctly if the
      // pointer strays outside the slider's own bounds mid-drag) but must
      // never block the value update below -- a failed capture (seen on
      // some browsers/input types) would otherwise silently break dragging
      // entirely for that pointer, since every line after a thrown
      // exception here would simply never run.
      try { sliderEl.setPointerCapture(e.pointerId); } catch (err) {}
      sliderEl.focus();
      dragRect = sliderEl.getBoundingClientRect();
      setValue(valueFromClientX(e.clientX, dragRect));
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragging) return;
      setValue(valueFromClientX(e.clientX, dragRect));
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      sliderEl.classList.remove("is-dragging");
      try { sliderEl.releasePointerCapture(e.pointerId); } catch (err) {}
      // redraw()'s transform string includes the drag-scale bump only
      // while `dragging` is true (see redraw() above) -- without this
      // call, the thumb would stay visually scaled up after release,
      // since nothing else re-renders it once the drag ends.
      redraw();
    }
    sliderEl.addEventListener("pointerdown", onPointerDown);
    sliderEl.addEventListener("pointermove", onPointerMove);
    sliderEl.addEventListener("pointerup", onPointerUp);
    sliderEl.addEventListener("pointercancel", onPointerUp);

    // Keyboard control -- a custom slider loses the native <input
    // type="range">'s built-in arrow-key handling for free, so it has to
    // be reimplemented explicitly here to not regress keyboard
    // accessibility relative to what it's replacing.
    sliderEl.addEventListener("keydown", (e) => {
      const smallStep = (max - min) / 100;
      const bigStep = (max - min) / 10;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { setValue(current + smallStep); e.preventDefault(); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setValue(current - smallStep); e.preventDefault(); }
      else if (e.key === "PageUp") { setValue(current + bigStep); e.preventDefault(); }
      else if (e.key === "PageDown") { setValue(current - bigStep); e.preventDefault(); }
      else if (e.key === "Home") { setValue(min); e.preventDefault(); }
      else if (e.key === "End") { setValue(max); e.preventDefault(); }
    });

    redraw();

    return { el: wrap, etaEl: wrap.querySelector("#ob-rate-eta") };
  }

  // The bounds a goal weight may take, given which way the user said they
  // want to move. A typed number let you set a goal on the WRONG side of
  // your current weight -- "lose" with a goal above where you already are,
  // which then drove a "Rate of weight loss" slider and a goal date for a
  // gain. Deriving the range from aspiration makes that unreachable rather
  // than merely discouraged. Whole kg, matching the ruler's tick unit, so
  // the nearest legal value is always exactly on a tick.
  function goalWeightBounds(aspiration, currentKg) {
    const cur = parseFloat(currentKg) || 0;
    if (aspiration === "lose") {
      // Strictly below current: the highest legal goal is the last whole
      // kg under it (69 for a 70 kg user, 69 for a 69.4 kg one).
      const max = Math.min(MAX_WEIGHT_KG, Math.ceil(cur) - 1);
      return { min: MIN_WEIGHT_KG, max, valid: max >= MIN_WEIGHT_KG };
    }
    if (aspiration === "gain") {
      const min = Math.max(MIN_WEIGHT_KG, Math.floor(cur) + 1);
      return { min, max: MAX_WEIGHT_KG, valid: min <= MAX_WEIGHT_KG };
    }
    return { min: MIN_WEIGHT_KG, max: MAX_WEIGHT_KG, valid: true };
  }

  const GOAL_RULER_TICK_PX = 14;

  function renderGoalWeightStep() {
    const bounds = goalWeightBounds(w.aspiration, w.weightKg);

    // A goal carried in from a previous pass (or a previous aspiration)
    // can sit outside the range this direction allows, so snap it in
    // before drawing -- otherwise the wheel would open showing a value it
    // cannot actually travel back to.
    const seeded = parseFloat(w.goalWeightKg) || 0;
    const startKg = bounds.valid
      ? Math.max(bounds.min, Math.min(bounds.max, seeded > 0 ? Math.round(seeded) : (w.aspiration === "gain" ? bounds.min : bounds.max)))
      : 0;
    if (bounds.valid) w.goalWeightKg = String(startKg);

    let cols = [];
    if (bounds.valid) {
      for (let kg = bounds.min; kg <= bounds.max; kg++) {
        const isMajor = kg % 10 === 0;
        const isMid = !isMajor && kg % 5 === 0;
        cols.push(`
          <div class="ob-goal-ruler-col">
            <span class="ob-goal-ruler-collabel">${isMajor ? kg : ""}</span>
            <span class="ob-goal-ruler-tick ${isMajor ? "is-major" : isMid ? "is-mid" : ""}"></span>
          </div>
        `);
      }
    }

    // When there's no legal goal in this direction (current weight is
    // already sitting on MIN_WEIGHT_KG/MAX_WEIGHT_KG), skip the ruler
    // entirely rather than draw an empty, non-functional track -- just the
    // blocked message below and a disabled Next.
    const wrap = el(`
      <div>
        <div class="ob-wizard-step-label">${t("coaching.wizard.stepGoalWeight")}</div>
        ${bounds.valid ? `
        <div class="ob-goal-ruler">
          <div class="ob-goal-ruler-value" id="ob-goal-value"></div>
          <div class="ob-goal-ruler-delta" id="ob-goal-weight-hint"></div>
          <div class="ob-goal-ruler-window">
            <div class="ob-goal-ruler-indicator"></div>
            <div class="ob-goal-ruler-scroll" id="ob-goal-scroll" tabindex="0"
                 role="slider" aria-valuemin="${bounds.min}" aria-valuemax="${bounds.max}"
                 aria-label="${t("coaching.wizard.goalWeight", { unit: RepCheckUnits.weightUnitLabel() })}">
              <div class="ob-goal-ruler-pad" id="ob-goal-pad-start"></div>
              ${cols.join("")}
              <div class="ob-goal-ruler-pad" id="ob-goal-pad-end"></div>
            </div>
          </div>
          <div class="ob-goal-ruler-bounds">
            <span>${RepCheckUnits.formatWeightKg(bounds.min)}</span>
            <span>${RepCheckUnits.formatWeightKg(bounds.max)}</span>
          </div>
        </div>
        ` : `<div class="ob-field-hint" id="ob-goal-weight-hint"></div>`}
      </div>
    `);
    const scrollEl = wrap.querySelector("#ob-goal-scroll");
    const valueEl = wrap.querySelector("#ob-goal-value");
    const hintEl = wrap.querySelector("#ob-goal-weight-hint");
    const updateHint = () => {
      const cur = parseFloat(w.weightKg) || 0;
      const goal = parseFloat(w.goalWeightKg) || 0;
      hintEl.textContent = cur > 0 && goal > 0
        ? t("coaching.wizard.goalWeightHint", { diff: RepCheckUnits.formatWeightKg(Math.abs(cur - goal)), weight: RepCheckUnits.formatWeightKg(cur) })
        : "";
    };

    if (!bounds.valid) {
      // Current weight sits right at MIN_WEIGHT_KG (lose) or MAX_WEIGHT_KG
      // (gain), leaving no legal goal on the requested side at all -- the
      // ruler has nowhere to go, so don't draw one a user could scroll
      // forever without ever landing on a value.
      hintEl.textContent = t("coaching.wizard.goalNoRoomHint");
      wrap.appendChild(renderWizardActions(false));
      return wrap;
    }

    updateHint();

    // No-op unless the rate field below actually exists (aspiration is
    // lose/gain) -- the ruler's own scroll listener further down calls this
    // unconditionally so scrolling to a new goal weight keeps the ETA under
    // the rate slider in sync, without the two listeners needing to know
    // about each other's state.
    let updateRateEta = () => {};

    // Rate-of-change slider: only meaningful when actually moving away
    // from the current weight, so it lives here (not the earlier weight
    // step) as part of "how fast to reach this goal weight" --
    // direction-specific (loss vs gain) since the safe/sane range differs
    // each way (see coaching_engine.py's LOSS_RATE_*/GAIN_RATE_* comments).
    if (w.aspiration === "lose" || w.aspiration === "gain") {
      const isLose = w.aspiration === "lose";
      const rateKey = isLose ? "lossRatePct" : "gainRatePct";
      const rateSlider = renderRateSlider({
        isLose,
        value: w[rateKey],
        weightKg: w.weightKg,
        onChange: (next) => {
          w[rateKey] = next;
          updateRateEta();
        },
      });
      // Shown as a card (see .ob-eta-card in onboarding.html), not the
      // plain hint text the other fields use -- the goal date is the one
      // number in this step worth a user's eye landing on it first, so it
      // gets its own visually distinct treatment. The card hides itself via
      // CSS's :empty selector when there's nothing to show, so this only
      // ever needs to set/clear textContent, same as every other hint here.
      updateRateEta = () => {
        const eta = estimateGoalDate(w.weightKg, w.goalWeightKg, w[rateKey]);
        rateSlider.etaEl.textContent = eta
          ? eta.toLocaleDateString(RepCheckI18n.locale(), { month: "short", day: "numeric", year: "numeric" })
          : "";
      };
      updateRateEta();
      wrap.appendChild(rateSlider.el);
    }

    // The ruler can never land on a value outside [bounds.min, bounds.max]
    // by construction (every column is clamped, same reasoning as the
    // current-weight ruler above), so unlike the old text input there's
    // nothing left to validate here -- Next only needs updateRateEta/hint
    // wiring, not a disabled toggle.
    wrap.appendChild(renderWizardActions(true));

    // Each column's own scroll-snap point is its CENTRE, not its left
    // edge -- `scroll-snap-align: center` means the browser settles at
    // `padStart + i*TICK + TICK/2`, half a tick past where a naive
    // `i*TICK` would put it. Both the initial scrollLeft and the
    // scroll-handler's inverse of it have to use the same offset or the
    // rest position for a given kg drifts by one tick from what the
    // native snap actually lands on (confirmed against this build: with
    // no `-TICK/2` term, landing exactly at the left bound read back one
    // kg higher than the bound itself).
    const GOAL_RULER_HALF_TICK = GOAL_RULER_TICK_PX / 2;
    valueEl.textContent = RepCheckUnits.formatWeightKg(startKg);
    scrollEl.setAttribute("aria-valuenow", startKg);
    scrollEl.addEventListener("scroll", () => {
      const index = Math.round((scrollEl.scrollLeft - GOAL_RULER_HALF_TICK) / GOAL_RULER_TICK_PX);
      const kg = Math.max(bounds.min, Math.min(bounds.max, bounds.min + index));
      w.goalWeightKg = String(kg);
      scrollEl.setAttribute("aria-valuenow", kg);
      valueEl.textContent = RepCheckUnits.formatWeightKg(kg);
      updateHint();
      updateRateEta();
    }, { passive: true });

    // The left/right pads have to be exactly half the window's width so
    // the first and last ticks can still scroll to the centre indicator --
    // computed from the measured element rather than hardcoded, since the
    // window is fluid-width, not a fixed px box like the vertical ruler.
    // setTimeout (not requestAnimationFrame) matches renderHeightSection's
    // reasoning: the wrap must be attached to the document and laid out
    // before getBoundingClientRect()/scrollTo() are meaningful, and
    // wizard navigation attaches it synchronously right after this
    // function returns, one tick later than rAF would allow.
    setTimeout(() => {
      // Rounded to a whole px: a fractional pad width (e.g. 143.5px) shifts
      // the browser's true scrollLeft=0 a few px off from where the tick
      // math expects it, so the leftmost bound becomes unreachable by one
      // or two kg even though the pad and the ticks are otherwise correct.
      const windowEl = wrap.querySelector(".ob-goal-ruler-window");
      const halfWidth = windowEl ? Math.round(windowEl.getBoundingClientRect().width / 2) : 0;
      wrap.querySelector("#ob-goal-pad-start").style.width = `${halfWidth}px`;
      wrap.querySelector("#ob-goal-pad-end").style.width = `${halfWidth}px`;
      scrollEl.scrollLeft = (startKg - bounds.min) * GOAL_RULER_TICK_PX + GOAL_RULER_TICK_PX / 2;
    });

    return wrap;
  }

  // A vertical scroll-snap ruler instead of a horizontal <input type=range>
  // -- dragging/scrolling vertically through a tall list of 1cm ticks
  // gives much finer control over landing on one exact value than a thumb
  // sliding across a short horizontal track does.
  const HEIGHT_RULER_TICK_PX = 14;

  function renderHeightSection() {
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
    const ruler = el(`
      <div class="ob-height-ruler">
        <div class="ob-height-ruler-value" id="ob-height-value">${RepCheckUnits.formatHeightCm(w.heightCm)}</div>
        <div class="ob-height-ruler-window">
          <div class="ob-height-ruler-indicator"></div>
          <div class="ob-height-ruler-scroll" id="ob-height-scroll" tabindex="0">${rows.join("")}</div>
        </div>
      </div>
    `);
    const wrap = section("onboarding.step.height", ruler);
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
    return wrap;
  }

  function renderBodyTypeSection() {
    const gender = w.gender || "male";
    const ranges = bodyFatRangesFor(gender);
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
    return section("coaching.wizard.stepBodyType", grid);
  }

  function renderBodyActivityStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("onboarding.step.bodyActivity")}</div></div>`);
    wrap.appendChild(renderBodyTypeSection());
    wrap.appendChild(section("coaching.wizard.stepActivity",
      renderChoiceGrid(optionsFor(ACTIVITY_IDS, "coaching.activity", ACTIVITY_ICONS), "set-activity", w.activityLevel, true)));
    wrap.appendChild(renderWizardActions(!!w.bodyFatRangeId && !!w.activityLevel));
    return wrap;
  }

  function renderPreferencesStep() {
    const wrap = el(`<div><div class="ob-wizard-step-label">${t("onboarding.step.preferences")}</div></div>`);
    const proteinItems = PROTEIN_IDS.map((id, i) => ({
      id,
      title: t(`coaching.protein.${id}.title`),
      sub: t(`coaching.protein.${id}.sub`),
      icon: proteinMeterSvg(i + 1),
    }));
    wrap.appendChild(section("coaching.wizard.stepProtein",
      renderChoiceGrid(proteinItems, "set-protein", w.proteinPreference, false)));
    wrap.appendChild(section("coaching.wizard.stepDiet",
      renderChoiceGrid(optionsFor(DIET_IDS, "coaching.diet", DIET_ICONS), "set-diet", w.dietPreference, true)));
    wrap.appendChild(section("coaching.wizard.stepDistribution",
      renderChoiceGrid(optionsFor(DISTRIBUTION_IDS, "coaching.distribution", DISTRIBUTION_ICONS), "set-distribution", w.distribution, true)));
    wrap.appendChild(renderWizardActions(!!w.proteinPreference && !!w.dietPreference && !!w.distribution));
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
          // Onboarding no longer builds a split, so there are no known
          // training days yet -- same shape api_coaching_calculate already
          // handled for users who said they don't exercise.
          training_days: [],
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

  // w.error carries whatever the API put in `error` (or a thrown message)
  // straight into innerHTML via el(). Not another user's text -- #178
  // deleted the free-text onboarding steps that were -- but still a
  // non-i18n string reaching a markup sink, which is the same shape as the
  // bug this file's tests were written for. Cheap to close, so it is.
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : text;
    return div.innerHTML;
  }

  function renderResult() {
    if (w.error) {
      const wrap = el(`<div><div class="ob-error">${escapeHtml(w.error)}</div></div>`);
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

    if (w.nutritionResult.distribution) {
      syncPromises.push(putSynced(DISTRIBUTION_KEY, w.nutritionResult.distribution));
    }

    document.dispatchEvent(new CustomEvent("repcheck:goals-updated"));

    // Finishing setup is the new user's first real use of the app, so day
    // one of their streak starts here. Nothing this wizard writes carries
    // a date of its own, hence the explicit mark.
    if (window.RepCheckStreak) RepCheckStreak.mark("onboarding");

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
    if (action === "set-aspiration") { w.aspiration = value; return renderKeepingScroll(); }
    if (action === "set-gender") {
      w.gender = value;
      if (!bodyFatRangesFor(value).some((r) => r.id === w.bodyFatRangeId)) w.bodyFatRangeId = null;
      return renderKeepingScroll();
    }
    if (action === "set-body-type") { w.bodyFatRangeId = value; return renderKeepingScroll(); }
    if (action === "set-activity") { w.activityLevel = value; return renderKeepingScroll(); }
    if (action === "set-protein") { w.proteinPreference = value; return renderKeepingScroll(); }
    if (action === "set-diet") { w.dietPreference = value; return renderKeepingScroll(); }
    if (action === "set-distribution") { w.distribution = value; return renderKeepingScroll(); }
    if (action === "back-to-days") { w.error = null; w.stepIndex = lastVisibleIndex(); return render(); }
    if (action === "retry-generate") return generateAndCalculate();

    if (action === "back") {
      if (w.stepIndex === 0) return;
      w.stepIndex = Math.max(0, prevVisibleIndex(w.stepIndex));
      return render();
    }
    if (action === "next") {
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
