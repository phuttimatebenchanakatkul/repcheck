// Regression coverage for race setup's gender step in static/hyrox.js.
//
// #109 stopped asking for gender here and pointed this.gender at the
// coaching profile instead. That left users with no saved profile unable
// to start a race at all: canStart() stayed false, so "Start race"
// rendered permanently disabled with nothing on screen explaining why --
// and because every other step below (scale, training space, agenda) is
// gated on this.gender too, the page was a near-empty card with a dead
// button. These tests pin the recovery path: ask only the users who still
// owe an answer, never the ones who already gave one.
//
// Driven against bare HyroxApp instances (see loadHyroxApp.js) rather
// than a constructed app -- buildSetupSteps() reads plain instance fields
// and, with this.gender unset, never reaches the heavy render helpers.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadHyroxApp, makeBareHyroxApp } from "./support/loadHyroxApp.js";

const COACHING_PROFILE_KEY = "repcheck_coaching_profile_v1";

// hyrox.js resolves translations through the global RepCheckI18n at render
// time, and every distance/weight string through RepCheckUnits (both come
// from base.html in the real page). Neither table is what's under test
// here, so these echo back something stable -- assertions below key off
// data-action/data-value, not copy. Without the units stub the steps that
// DO have a gender crash in renderRaceAgenda() rather than failing an
// assertion, which is the confusing-failure mode loadHyroxApp.js warns about.
function stubGlobals() {
  globalThis.RepCheckI18n = {
    t: (key) => key,
    locale: () => "en",
  };
  globalThis.RepCheckUnits = {
    formatDistanceKm: (km) => `${km}km`,
    formatWeightKg: (kg) => `${kg}kg`,
  };
}

// The one field buildSetupSteps() mutates through a method call rather
// than reading directly; seeded so setGender()'s reset has something to
// clear.
function setupApp(fields = {}) {
  return makeBareHyroxApp({
    raceType: "standard",
    category: null,
    format: null,
    gender: null,
    scale: "full",
    stationWeights: {},
    doublesSplit: {},
    // Read by getPersonalBest() once canStart() goes true and the setup
    // page starts offering a PB banner above the button.
    history: [],
    ...fields,
  });
}

function genderButtons(wrap) {
  return [...wrap.querySelectorAll('[data-action="set-gender"]')].map((b) => b.dataset.value);
}

function startBtn(wrap) {
  return wrap.querySelector('[data-action="start-race"]');
}

describe("race setup gender step", () => {
  beforeEach(() => {
    stubGlobals();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("asks for gender once a format is picked and the profile has none", () => {
    const app = setupApp({ category: "open", format: "singles" });

    const wrap = app.buildSetupSteps();

    expect(genderButtons(wrap)).toEqual(["men", "women"]);
  });

  it("never asks when the coaching profile already answered", () => {
    localStorage.setItem(COACHING_PROFILE_KEY, JSON.stringify({ gender: "female" }));
    const app = setupApp({ format: "singles", gender: "women" });

    const wrap = app.buildSetupSteps();

    expect(genderButtons(wrap)).toEqual([]);
  });

  it("holds the question until a format is picked", () => {
    const app = setupApp({ category: "open", format: null });

    const wrap = app.buildSetupSteps();

    expect(genderButtons(wrap)).toEqual([]);
  });

  it("marks the answered option as selected", () => {
    const app = setupApp({ category: "open", format: "singles", gender: "women" });

    const wrap = app.buildSetupSteps();

    const selected = [...wrap.querySelectorAll('[data-action="set-gender"].is-selected')];
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.value).toBe("women");
  });

  // The bug itself: without an answer the button is dead, and answering is
  // what brings it back to life. Both halves matter -- a test that only
  // checked the enabled state would still pass against the broken build
  // for anyone with a profile.
  it("keeps Start race disabled until the question is answered", () => {
    const app = setupApp({ category: "open", format: "singles" });

    expect(startBtn(app.buildSetupSteps()).disabled).toBe(true);

    app.gender = "men";

    expect(startBtn(app.buildSetupSteps()).disabled).toBe(false);
  });
});

describe("setGender", () => {
  beforeEach(() => {
    stubGlobals();
    localStorage.clear();
  });

  it("records the answer and drops weight overrides measured against the old standard", () => {
    let renders = 0;
    const app = setupApp({ stationWeights: { sledPush: 150 } });
    app.render = () => { renders += 1; };

    app.setGender("women");

    expect(app.gender).toBe("women");
    expect(app.stationWeights).toEqual({});
    expect(renders).toBe(1);
  });

  it("ignores a value that isn't a real gender id", () => {
    let renders = 0;
    const app = setupApp({ gender: "men", stationWeights: { sledPush: 150 } });
    app.render = () => { renders += 1; };

    app.setGender("mixed");

    expect(app.gender).toBe("men");
    expect(app.stationWeights).toEqual({ sledPush: 150 });
    expect(renders).toBe(0);
  });

  // The grid and the method are useless to a user unless the delegated
  // listener actually routes between them -- deleting that one line in
  // handleClick() leaves both halves passing their own tests while the
  // button does nothing on a real tap, which is the same silent dead-end
  // this whole fix exists to remove.
  it("is what a tap on the rendered grid dispatches to", () => {
    const app = setupApp({ category: "open", format: "singles" });
    const wrap = app.buildSetupSteps();
    app.render = () => {};

    // The real listener is delegated on #hyrox-root and reads the event's
    // target, so hand handleClick the button the same way a tap would.
    const womenBtn = wrap.querySelector('[data-action="set-gender"][data-value="women"]');
    app.handleClick({ target: womenBtn });

    expect(app.gender).toBe("women");
  });

  it("only accepts the gender ids the setup grid actually offers", () => {
    const { HyroxApp } = loadHyroxApp();
    expect(typeof HyroxApp.prototype.setGender).toBe("function");

    stubGlobals();
    const app = setupApp({ category: "open", format: "singles" });
    const offered = genderButtons(app.buildSetupSteps());

    offered.forEach((id) => {
      const fresh = setupApp({ stationWeights: {} });
      fresh.render = () => {};
      fresh.setGender(id);
      expect(fresh.gender).toBe(id);
    });
  });
});
