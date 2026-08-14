import { describe, it, expect, vi } from "vitest";
import { loadRateSlider } from "./support/loadRateSlider.js";

// Mirrors onboarding.js's (and coaching_engine.py's) rate constants exactly
// -- if those ever change, update these too. Same convention as
// tests/test_coaching_rate_null.py's literal boundary values on the Python
// side of this same feature.
const LOSS_RATE_MIN_PCT = 0.1;
const LOSS_RATE_MAX_PCT = 2.0;
const LOSS_STANDARD_MIN_KG_PER_WEEK = 0.2;
const LOSS_STANDARD_MAX_KG_PER_WEEK = 0.8;
const GAIN_RATE_MAX_PCT = 0.8; // 0.6 kg/week at the 75kg reference weight
const RATE_REFERENCE_WEIGHT_KG = 75;

function dispatchPointer(el, type, clientX, pointerId = 1) {
  // jsdom has no PointerEvent/setPointerCapture support at all (verified:
  // both are `undefined`), so a synthetic MouseEvent with a manually
  // attached pointerId is the standard workaround -- the app's own
  // listeners are registered by event *type* string ("pointerdown" etc.),
  // which fire regardless of which Event subclass constructed the event.
  const evt = new MouseEvent(type, { clientX, clientY: 0, bubbles: true, cancelable: true });
  evt.pointerId = pointerId;
  el.dispatchEvent(evt);
}

describe("renderRateSlider", () => {
  it("positions the loss 'standard' zone on the track from the passed bodyweight", () => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    const zone = el.querySelector("#ob-rate-zone");
    expect(zone).not.toBeNull();
    const zoneMinPct = (LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
    const zoneMaxPct = (LOSS_STANDARD_MAX_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
    const expectedLeft = ((zoneMinPct - LOSS_RATE_MIN_PCT) / (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT)) * 100;
    const expectedWidth = ((zoneMaxPct - zoneMinPct) / (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT)) * 100;
    expect(parseFloat(zone.style.left)).toBeCloseTo(expectedLeft, 4);
    expect(parseFloat(zone.style.width)).toBeCloseTo(expectedWidth, 4);
  });

  it("gain mode has no zone element and no badge -- the 'standard' highlight only applies to loss", () => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: false, value: 0.35, weightKg: "75", onChange: () => {} });
    expect(el.querySelector("#ob-rate-zone")).toBeNull();
    expect(el.querySelector("#ob-rate-badge").textContent).toBe("");
  });

  it.each([
    [LOSS_RATE_MIN_PCT, "Slower"],
    [(LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100, "Standard (Recommended)"],
    [0.6, "Standard"],
    [1.5, "Faster"],
  ])("badges the loss slider at %f%% as %s at the reference bodyweight", (value, expectedBadge) => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: true, value, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    expect(el.querySelector("#ob-rate-badge").textContent).toBe(expectedBadge);
  });

  it("extends the gain slider's ceiling to 0.6 kg/week at the reference bodyweight", () => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: false, value: GAIN_RATE_MAX_PCT, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    expect(el.querySelector("#ob-rate-slider").getAttribute("aria-valuemax")).toBe(String(GAIN_RATE_MAX_PCT));
    expect(el.querySelector("#ob-rate-kg-week").textContent).toBe("0.6");
  });

  it("shows both kg and %BW for the weekly and monthly rate", () => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "100", onChange: () => {} });
    expect(el.querySelector("#ob-rate-kg-week").textContent).toBe("1");
    expect(el.querySelector("#ob-rate-pct-week").textContent).toBe("1.00");
    expect(el.querySelector("#ob-rate-kg-month").textContent).toBe("4.3");
    expect(el.querySelector("#ob-rate-pct-month").textContent).toBe("4.35");
  });

  it("keyboard Home/End jump to the slider's min/max and fire onChange", () => {
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MIN_PCT);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MAX_PCT);
  });

  // Regression test for a real bug found during manual browser verification:
  // setPointerCapture() is undefined in some environments (confirmed: jsdom
  // has no PointerEvent/setPointerCapture support at all) and can also
  // throw in real browsers for a pointerId with no active pointer session.
  // Because it used to run BEFORE the value update, a thrown exception
  // there silently skipped setValue()/onChange() for the entire pointer
  // down -- dragging looked like it did nothing. jsdom's real absence of
  // the API exercises this exact failure path directly, no manual
  // exception-throwing mock needed.
  it("pointerdown still updates the value and fires onChange when setPointerCapture is unavailable", () => {
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });
    expect(typeof slider.setPointerCapture).toBe("undefined"); // sanity check this test is exercising the real gap
    dispatchPointer(slider, "pointerdown", 100); // ratio 0.5 across the mocked 200px track
    const expected = LOSS_RATE_MIN_PCT + 0.5 * (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT);
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(parseFloat(slider.getAttribute("aria-valuenow"))).toBeCloseTo(expected, 3);
  });
});
