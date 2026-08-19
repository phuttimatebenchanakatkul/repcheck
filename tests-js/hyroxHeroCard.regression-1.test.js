// Regression: ISSUE-002 — hero showed "N races" and "Your first race awaits" together
// Found by /qa on 2026-08-18
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-18.md
//
// The chip counts this.history.length but the title keyed off
// getAllPersonalBests(), which drops flagged AND custom races. A user whose
// races are all custom (a first-class feature) or all flagged therefore saw
// a race count sitting directly above "Your first race awaits", forever.
// Three distinct states now, and these pin all three.
import { beforeEach, describe, expect, it } from "vitest";
import { makeBareHyroxApp } from "./support/loadHyroxApp.js";

function stubGlobals() {
  globalThis.RepCheckI18n = { t: (key) => key, locale: () => "en" };
  globalThis.RepCheckUnits = {
    formatDistanceKm: (km) => `${km}km`,
    formatWeightKg: (kg) => `${kg}kg`,
  };
}

function race(overrides = {}) {
  return {
    id: "r1",
    date: "2026-08-18T00:00:00.000Z",
    category: "open",
    format: "singles",
    gender: "men",
    scale: "full",
    totalSeconds: 4200,
    splits: [],
    flagged: false,
    ...overrides,
  };
}

function hero(history) {
  const app = makeBareHyroxApp({ history });
  return app.renderHeroCard();
}

function titleKey(card) {
  return card.querySelector(".hx-hero-title").textContent.trim();
}

function chip(card) {
  const el = card.querySelector(".hx-hero-chip");
  return el ? el.textContent.trim() : null;
}

describe("renderHeroCard", () => {
  beforeEach(stubGlobals);

  it("offers the first-race invitation only when there are genuinely no races", () => {
    const card = hero([]);

    expect(titleKey(card)).toBe("hyrox.hero.emptyTitle");
    expect(chip(card)).toBeNull();
  });

  it("shows the fastest time once a race actually ranks", () => {
    const card = hero([race({ totalSeconds: 4200 }), race({ id: "r2", totalSeconds: 3900 })]);

    // 3900s is the faster of the two, so the hero shows it as a clock.
    expect(titleKey(card)).toBe("1:05:00");
    expect(chip(card)).toContain("hyrox.hero.races");
  });

  // The bug: races exist, none of them rank. Must never claim the user has
  // yet to race when the chip right above is counting their races.
  it("does not claim a first race awaits when flagged races exist", () => {
    const card = hero([race({ flagged: true }), race({ id: "r2", flagged: true })]);

    expect(titleKey(card)).toBe("hyrox.hero.noPbTitle");
    expect(chip(card)).toContain("hyrox.hero.races");
  });

  it("does not claim a first race awaits when only custom races exist", () => {
    const card = hero([race({ category: "custom" })]);

    expect(titleKey(card)).toBe("hyrox.hero.noPbTitle");
    expect(chip(card)).toContain("hyrox.hero.races");
  });
});
