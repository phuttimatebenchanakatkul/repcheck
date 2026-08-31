import { describe, it, expect, vi } from "vitest";
import { loadCoachingRateSlider } from "./support/loadCoachingRateSlider.js";

// Mirrors coaching.js's (and onboarding.js's, and coaching_engine.py's)
// rate constants exactly -- if those ever change, update these too.
const LOSS_RATE_MIN_PCT = 0.1;
const LOSS_RATE_MAX_PCT = 2.0;
const LOSS_STANDARD_MIN_KG_PER_WEEK = 0.2;
const LOSS_STANDARD_MAX_KG_PER_WEEK = 0.8;
const GAIN_RATE_MAX_PCT = 0.8; // 0.6 kg/week at the 75kg reference weight
const RATE_REFERENCE_WEIGHT_KG = 75;

function dispatchPointer(el, type, clientX, pointerId = 1) {
  // jsdom has no PointerEvent/setPointerCapture support at all, so a
  // synthetic MouseEvent with a manually attached pointerId is the
  // standard workaround -- same as rateSlider.test.js's identical helper.
  const evt = new MouseEvent(type, { clientX, clientY: 0, bubbles: true, cancelable: true });
  evt.pointerId = pointerId;
  el.dispatchEvent(evt);
}

describe("coaching.js renderRateSlider", () => {
  it("positions the loss 'standard' zone on the track from the passed bodyweight", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    const zone = el.querySelector("#pc-rate-zone");
    expect(zone).not.toBeNull();
    const zoneMinPct = (LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
    const zoneMaxPct = (LOSS_STANDARD_MAX_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100;
    const expectedLeft = ((zoneMinPct - LOSS_RATE_MIN_PCT) / (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT)) * 100;
    const expectedWidth = ((zoneMaxPct - zoneMinPct) / (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT)) * 100;
    expect(parseFloat(zone.style.left)).toBeCloseTo(expectedLeft, 4);
    expect(parseFloat(zone.style.width)).toBeCloseTo(expectedWidth, 4);
  });

  it("gain mode has no zone element and no badge -- the 'standard' highlight only applies to loss", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: false, value: 0.35, weightKg: "75", onChange: () => {} });
    expect(el.querySelector("#pc-rate-zone")).toBeNull();
    expect(el.querySelector("#pc-rate-badge").textContent).toBe("");
  });

  it.each([
    [LOSS_RATE_MIN_PCT, "Slower"],
    [(LOSS_STANDARD_MIN_KG_PER_WEEK / RATE_REFERENCE_WEIGHT_KG) * 100, "Standard (Recommended)"],
    [0.6, "Standard"],
    [1.5, "Faster"],
  ])("badges the loss slider at %f%% as %s at the reference bodyweight", (value, expectedBadge) => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    expect(el.querySelector("#pc-rate-badge").textContent).toBe(expectedBadge);
  });

  it("extends the gain slider's ceiling to 0.6 kg/week at the reference bodyweight", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: false, value: GAIN_RATE_MAX_PCT, weightKg: String(RATE_REFERENCE_WEIGHT_KG), onChange: () => {} });
    expect(el.querySelector("#pc-rate-slider").getAttribute("aria-valuemax")).toBe(String(GAIN_RATE_MAX_PCT));
    expect(el.querySelector("#pc-rate-kg-week").textContent).toBe("0.6");
  });

  it("shows only the weekly rate, as \"<kg> lost Per Week\" -- no percent, no monthly readout", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "100", onChange: () => {} });
    expect(el.querySelector("#pc-rate-kg-week").textContent).toBe("1");
    expect(el.querySelector(".pc-rate-readout-verb").textContent).toBe("lost");
    expect(el.querySelector(".pc-rate-readout-freq").textContent).toBe("Per Week");
    expect(el.querySelector("#pc-rate-pct-week")).toBeNull();
    expect(el.querySelector("#pc-rate-kg-month")).toBeNull();
    expect(el.querySelector("#pc-rate-pct-month")).toBeNull();
  });

  it("labels the gain direction as \"gained\" instead of \"lost\"", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: false, value: 0.35, weightKg: "75", onChange: () => {} });
    expect(el.querySelector(".pc-rate-readout-verb").textContent).toBe("gained");
  });

  it("keyboard Home/End jump to the slider's min/max and fire onChange", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "75", onChange });
    const slider = el.querySelector("#pc-rate-slider");
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MIN_PCT);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MAX_PCT);
  });

  it("loss mode with zero/invalid bodyweight renders no zone and no badge, same as gain mode", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "", onChange: () => {} });
    expect(el.querySelector("#pc-rate-zone")).toBeNull();
    expect(el.querySelector("#pc-rate-badge").textContent).toBe("");
  });

  // Regression coverage for the same setPointerCapture bug fixed on
  // onboarding.js's identical slider (see rateSlider.test.js) -- ported
  // here unchanged, since this file duplicates that exact pointerdown
  // handler code.
  it("pointerdown still updates the value and fires onChange when setPointerCapture is unavailable", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange });
    const slider = el.querySelector("#pc-rate-slider");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });
    expect(typeof slider.setPointerCapture).toBe("undefined"); // sanity check this test exercises the real gap
    dispatchPointer(slider, "pointerdown", 100); // ratio 0.5 across the mocked 200px track
    const expected = LOSS_RATE_MIN_PCT + 0.5 * (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT);
    expect(onChange).toHaveBeenCalledWith(expected);
    expect(parseFloat(slider.getAttribute("aria-valuenow"))).toBeCloseTo(expected, 3);
  });

  // Regression coverage for coaching.js's own addition (not present in
  // onboarding.js, which has no enclosing bottom-sheet to protect
  // against): dragging the slider must not let the drag's pointerdown/
  // pointermove bubble out to the wizard sheet's own swipe-to-dismiss
  // gesture handling (see the e.stopPropagation() calls in
  // onPointerDown/onPointerMove and the touchstart/touchmove listeners).
  it("stops pointerdown and pointermove from bubbling past the slider (guards against the wizard sheet's swipe-to-dismiss)", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange: () => {} });
    const slider = el.querySelector("#pc-rate-slider");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });

    let bubbledToBody = 0;
    document.body.addEventListener("pointerdown", () => bubbledToBody++);
    document.body.addEventListener("pointermove", () => bubbledToBody++);

    dispatchPointer(slider, "pointerdown", 100);
    dispatchPointer(slider, "pointermove", 120);

    expect(bubbledToBody).toBe(0);
  });

  it("thumb scale reverts after pointerup, not just the is-dragging class", () => {
    const { renderRateSlider } = loadCoachingRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange: () => {} });
    const slider = el.querySelector("#pc-rate-slider");
    const thumb = el.querySelector("#pc-rate-thumb");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });

    dispatchPointer(slider, "pointerdown", 100);
    expect(thumb.style.transform).toContain("scale(1.15)");

    dispatchPointer(slider, "pointerup", 100);
    expect(thumb.style.transform).not.toContain("scale");
  });
});
