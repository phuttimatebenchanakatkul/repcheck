// Coverage for coaching.js's check-in context-flag toggles
// (toggleCheckinFlag/renderCheckinFlagGrid) -- previously untested. These
// back the "ate a lot of carbs" / "felt more bloated" day-pill grids in the
// weekly check-in sheet (see checkin_analyzer.py's _build_context_flags_line
// for what these flags feed into on the server side).
import { describe, expect, it } from "vitest";
import { loadCheckinFlags } from "./support/loadCheckinFlags.js";

function makeFakeApp(overrides = {}) {
  return {
    checkin: {
      highCarbDays: {},
      bloatedDays: {},
      weekDates: ["2026-08-10", "2026-08-11", "2026-08-12"],
      ...overrides,
    },
    renderCalls: 0,
    render() {
      this.renderCalls += 1;
    },
  };
}

describe("toggleCheckinFlag", () => {
  it("turns a day on when it wasn't flagged", () => {
    const { toggleCheckinFlag } = loadCheckinFlags();
    const app = makeFakeApp();

    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-11");

    expect(app.checkin.highCarbDays).toEqual({ "2026-08-11": true });
    expect(app.renderCalls).toBe(1);
  });

  it("turns a day back off when it was already flagged", () => {
    const { toggleCheckinFlag } = loadCheckinFlags();
    const app = makeFakeApp({ highCarbDays: { "2026-08-11": true } });

    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-11");

    expect(app.checkin.highCarbDays).toEqual({});
    expect(app.renderCalls).toBe(1);
  });

  it("keeps highCarbDays and bloatedDays independent of each other", () => {
    const { toggleCheckinFlag } = loadCheckinFlags();
    const app = makeFakeApp();

    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-11");
    toggleCheckinFlag.call(app, "bloatedDays", "2026-08-11");

    // Same date, both flag maps -- toggling one must not affect the other.
    expect(app.checkin.highCarbDays).toEqual({ "2026-08-11": true });
    expect(app.checkin.bloatedDays).toEqual({ "2026-08-11": true });

    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-11");

    expect(app.checkin.highCarbDays).toEqual({});
    expect(app.checkin.bloatedDays).toEqual({ "2026-08-11": true });
  });

  it("re-renders on every toggle so the UI reflects the new state", () => {
    const { toggleCheckinFlag } = loadCheckinFlags();
    const app = makeFakeApp();

    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-10");
    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-12");
    toggleCheckinFlag.call(app, "highCarbDays", "2026-08-10");

    expect(app.renderCalls).toBe(3);
  });
});

describe("renderCheckinFlagGrid", () => {
  it("marks a flagged day's pill as data-active=\"true\"", () => {
    const { renderCheckinFlagGrid } = loadCheckinFlags();
    const app = makeFakeApp({ highCarbDays: { "2026-08-11": true } });

    const html = renderCheckinFlagGrid.call(app, "highCarbDays", "toggle-checkin-high-carb-day");

    expect(html).toContain('data-date="2026-08-11" data-active="true"');
  });

  it("marks an unflagged day's pill as data-active=\"false\"", () => {
    const { renderCheckinFlagGrid } = loadCheckinFlags();
    const app = makeFakeApp(); // nothing flagged

    const html = renderCheckinFlagGrid.call(app, "highCarbDays", "toggle-checkin-high-carb-day");

    expect(html).toContain('data-date="2026-08-10" data-active="false"');
    expect(html).toContain('data-date="2026-08-11" data-active="false"');
    expect(html).toContain('data-date="2026-08-12" data-active="false"');
  });

  it("wires the given action name and one pill per week date", () => {
    const { renderCheckinFlagGrid } = loadCheckinFlags();
    const app = makeFakeApp();

    const html = renderCheckinFlagGrid.call(app, "bloatedDays", "toggle-checkin-bloated-day");

    const actionMatches = html.match(/data-action="toggle-checkin-bloated-day"/g) || [];
    expect(actionMatches).toHaveLength(3);
  });

  it("reads its own flag map independently -- highCarbDays state doesn't leak into a bloatedDays render", () => {
    const { renderCheckinFlagGrid } = loadCheckinFlags();
    const app = makeFakeApp({ highCarbDays: { "2026-08-11": true }, bloatedDays: {} });

    const html = renderCheckinFlagGrid.call(app, "bloatedDays", "toggle-checkin-bloated-day");

    expect(html).toContain('data-date="2026-08-11" data-active="false"');
  });
});
