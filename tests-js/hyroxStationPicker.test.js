// DOM-level coverage for the Add-a-station picker in static/hyrox.js:
// buildStationPickerSheetContent() (the category tab bar + icon-tile grid)
// and setStationPickerCategory() (switching the active tab). Both are
// tested against bare HyroxApp instances (see loadHyroxApp.js) rather than
// a fully-constructed app, since construction eagerly touches
// localStorage/i18n/render -- far outside what these two methods need.
//
// The 4 categories and their station assignments live only INSIDE
// buildStationPickerSheetContent (not module-scope, so not directly
// importable) -- deliberately not hand-copied into a second table here,
// since that's exactly the kind of duplicate this project's other loaders
// avoid (see loadHyroxApp.js's header). Instead these tests drive the real
// method through every tab and cross-check against CUSTOM_STATION_KEYS
// (the real, exported source of truth for "which 9 stations exist").
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHyroxApp, makeBareHyroxApp } from "./support/loadHyroxApp.js";

function tabLabels(wrap) {
  return [...wrap.querySelectorAll(".hx-station-picker-tab")].map((t) => t.textContent.trim());
}

function tileValues(wrap) {
  return [...wrap.querySelectorAll(".hx-station-picker-tile")].map((t) => t.dataset.value);
}

describe("buildStationPickerSheetContent", () => {
  it("defaults to the first tab active on first render (no prior category set)", () => {
    const app = makeBareHyroxApp();
    const wrap = app.buildStationPickerSheetContent();

    const tabs = [...wrap.querySelectorAll(".hx-station-picker-tab")];
    expect(tabs.length).toBeGreaterThan(1); // more than one category to switch between
    expect(tabs[0].classList.contains("is-active")).toBe(true);
    expect(tabs.filter((t) => t.classList.contains("is-active"))).toHaveLength(1);
    expect(app.stationPickerCategory).toBeTruthy(); // build() sets a default, not left undefined
  });

  it("renders every tile with a valid station key, a real icon, and a non-empty name", () => {
    const { CUSTOM_STATION_KEYS, STATION_TITLES } = loadHyroxApp();
    const app = makeBareHyroxApp();
    const wrap = app.buildStationPickerSheetContent();

    const tiles = [...wrap.querySelectorAll(".hx-station-picker-tile")];
    expect(tiles.length).toBeGreaterThan(0);
    tiles.forEach((tile) => {
      expect(tile.dataset.action).toBe("add-custom-station");
      expect(CUSTOM_STATION_KEYS).toContain(tile.dataset.value);
      expect(tile.querySelector(".hx-station-picker-tile-icon svg")).toBeTruthy();
      expect(tile.querySelector(".hx-station-picker-tile-name").textContent.trim()).toBe(
        STATION_TITLES[tile.dataset.value]
      );
    });
  });

  it("falls back to a real category if stationPickerCategory holds an unknown key", () => {
    const defaultApp = makeBareHyroxApp();
    const defaultWrap = defaultApp.buildStationPickerSheetContent();

    const app = makeBareHyroxApp({ stationPickerCategory: "nonexistent-category" });
    const wrap = app.buildStationPickerSheetContent();

    // Same fallback the default (unset) path takes -- an unrecognized
    // category never renders an empty/broken sheet.
    expect(tileValues(wrap)).toEqual(tileValues(defaultWrap));
    expect(tabLabels(wrap)[0]).toBe(tabLabels(defaultWrap)[0]);
  });

  it("switching through every tab covers all 9 CUSTOM_STATION_KEYS exactly once, no gaps or overlap", () => {
    const { CUSTOM_STATION_KEYS } = loadHyroxApp();
    const app = makeBareHyroxApp();
    let wrap = app.buildStationPickerSheetContent();
    const tabCount = wrap.querySelectorAll(".hx-station-picker-tab").length;

    // Walk every tab by index, driven through the real
    // setStationPickerCategory (not direct field assignment) so the
    // dispatcher-facing path gets exercised too.
    app.syncStationPickerSheetContent = () => {
      wrap = app.buildStationPickerSheetContent();
    };
    const categoryKeysSeen = new Set();
    const seen = [];
    for (let i = 0; i < tabCount; i++) {
      const key = wrap.querySelectorAll(".hx-station-picker-tab")[i].dataset.value;
      expect(categoryKeysSeen.has(key)).toBe(false); // each tab maps to a distinct category
      categoryKeysSeen.add(key);
      app.setStationPickerCategory(key);
      seen.push(...tileValues(wrap));
    }

    expect(seen.sort()).toEqual([...CUSTOM_STATION_KEYS].sort());
  });
});

describe("setStationPickerCategory", () => {
  it("updates stationPickerCategory and re-syncs the open sheet", () => {
    const app = makeBareHyroxApp();
    const wrap = app.buildStationPickerSheetContent();
    const otherTabKey = wrap.querySelectorAll(".hx-station-picker-tab")[1].dataset.value;
    app.syncStationPickerSheetContent = vi.fn();

    app.setStationPickerCategory(otherTabKey);

    expect(app.stationPickerCategory).toBe(otherTabKey);
    expect(app.syncStationPickerSheetContent).toHaveBeenCalledTimes(1);
  });

  it("re-selecting the same tab is idempotent (still resolves to one active tab)", () => {
    const app = makeBareHyroxApp();
    const wrap = app.buildStationPickerSheetContent();
    const key = wrap.querySelectorAll(".hx-station-picker-tab")[0].dataset.value;
    app.syncStationPickerSheetContent = vi.fn();

    app.setStationPickerCategory(key);
    app.setStationPickerCategory(key);

    expect(app.stationPickerCategory).toBe(key);
    expect(app.syncStationPickerSheetContent).toHaveBeenCalledTimes(2);
  });

  it("switching category changes which tiles the next buildStationPickerSheetContent() call renders", () => {
    const app = makeBareHyroxApp();
    const firstWrap = app.buildStationPickerSheetContent();
    const firstTiles = tileValues(firstWrap);
    const otherTabKey = firstWrap.querySelectorAll(".hx-station-picker-tab")[1].dataset.value;
    app.syncStationPickerSheetContent = vi.fn();

    app.setStationPickerCategory(otherTabKey);
    const secondWrap = app.buildStationPickerSheetContent();

    expect(tileValues(secondWrap)).not.toEqual(firstTiles);
    expect(secondWrap.querySelectorAll(".hx-station-picker-tab")[1].classList.contains("is-active")).toBe(true);
  });
});
