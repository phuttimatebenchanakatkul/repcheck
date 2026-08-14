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

  it("keyboard ArrowRight/ArrowLeft/PageUp/PageDown step by the documented small/big fractions", () => {
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    const span = LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT;
    const smallStep = span / 100;
    const bigStep = span / 10;
    // Repeated float add/subtract doesn't round-trip exactly (1.0 + step -
    // step lands at 0.9999999999999999, not 1.0), so assert with tolerance
    // rather than the exact literal -- that's a float-precision artifact,
    // not a bug in the step arithmetic itself.
    const lastCall = () => onChange.mock.calls.at(-1)[0];

    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0 + smallStep, 9);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0, 9);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0 + smallStep, 9);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0, 9);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "PageUp", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0 + bigStep, 9);
    slider.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    expect(lastCall()).toBeCloseTo(1.0, 9);
  });

  it("loss mode with zero/invalid bodyweight renders no zone and no badge, same as gain mode", () => {
    // renderRateSlider only computes a zone when `isLose && wv > 0`
    // (see the `let zoneMinPct = null` branch) -- an onboarding user who
    // reaches this step with an unset/invalid weightKg must not crash or
    // show a nonsensical zone positioned from a 0 or NaN bodyweight.
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "", onChange: () => {} });
    expect(el.querySelector("#ob-rate-zone")).toBeNull();
    expect(el.querySelector("#ob-rate-badge").textContent).toBe("");
  });

  it("pointermove continues tracking after pointerdown, and pointerup stops it", () => {
    // The QA pass that manually verified dragging (see
    // .gstack/qa-reports/qa-report-localhost-2026-08-14.md) exercised a
    // single click-to-position, not a multi-point pointerdown -> several
    // pointermove -> pointerup sequence -- so the live-drag-tracking path
    // and the "stop tracking after pointerup" path had no coverage at all,
    // unit or E2E. This closes that gap directly.
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });

    dispatchPointer(slider, "pointerdown", 0); // ratio 0 -> min
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MIN_PCT);

    dispatchPointer(slider, "pointermove", 100); // ratio 0.5, mid-drag
    const mid = LOSS_RATE_MIN_PCT + 0.5 * (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT);
    expect(onChange).toHaveBeenLastCalledWith(mid);

    dispatchPointer(slider, "pointermove", 200); // ratio 1.0 -> max, still mid-drag
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MAX_PCT);

    dispatchPointer(slider, "pointerup", 200);
    const callsAtRelease = onChange.mock.calls.length;
    dispatchPointer(slider, "pointermove", 0); // move AFTER release must be ignored (dragging = false)
    expect(onChange.mock.calls.length).toBe(callsAtRelease);
    expect(slider.classList.contains("is-dragging")).toBe(false);
  });

  // Regression test for a real bug introduced (and caught before commit)
  // while fixing a performance finding: the thumb's drag-scale bump moved
  // from a stylesheet rule (`.is-dragging .ob-rate-slider-thumb { transform:
  // scale(1.15) }`, reverted automatically by the class removal on
  // pointerup) into the same inline `transform` string redraw() writes on
  // every frame -- an inline style always wins over a stylesheet rule on
  // the same property, so once the scale moved inline, removing the
  // `is-dragging` class alone stopped being enough to undo it. Without an
  // explicit redraw() call in onPointerUp, the thumb would stay visually
  // scaled up forever after every release.
  it("thumb scale reverts after pointerup, not just the is-dragging class", () => {
    const { renderRateSlider } = loadRateSlider();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange: () => {} });
    const slider = el.querySelector("#ob-rate-slider");
    const thumb = el.querySelector("#ob-rate-thumb");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 });

    dispatchPointer(slider, "pointerdown", 100);
    expect(thumb.style.transform).toContain("scale(1.15)");

    dispatchPointer(slider, "pointerup", 100);
    expect(thumb.style.transform).not.toContain("scale");
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
  it("falls back to the slider's min when the track has zero width (e.g. rendered while hidden)", () => {
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 1.0, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    document.body.appendChild(el);
    slider.getBoundingClientRect = () => ({ left: 0, right: 0, width: 0, top: 0, bottom: 24, height: 24 });
    dispatchPointer(slider, "pointerdown", 100);
    expect(onChange).toHaveBeenLastCalledWith(LOSS_RATE_MIN_PCT);
  });

  // Regression-shaped test for the cached-rect performance fix itself:
  // dragRect is captured once in onPointerDown and reused for every
  // pointermove in the same gesture (see the comment above `let dragRect`
  // in onboarding.js) instead of re-querying getBoundingClientRect() on
  // every move, which would force a synchronous layout flush each time.
  // Every other drag test in this file mocks a getBoundingClientRect that
  // never changes mid-drag, so they'd pass identically whether the rect
  // were cached or re-queried live -- this test is the only one that
  // actually distinguishes the two by changing the mock's return value
  // between pointerdown and pointermove and asserting the move still uses
  // the stale (cached) rect, plus that the DOM method itself is invoked
  // only once per gesture.
  it("caches the slider's bounding rect once per drag gesture instead of re-querying it on every pointermove", () => {
    const { renderRateSlider } = loadRateSlider();
    const onChange = vi.fn();
    const { el } = renderRateSlider({ isLose: true, value: 0.5, weightKg: "75", onChange });
    const slider = el.querySelector("#ob-rate-slider");
    document.body.appendChild(el);

    const rectAtDown = { left: 0, right: 200, width: 200, top: 0, bottom: 24, height: 24 };
    const rectDuringMove = { left: 1000, right: 1200, width: 200, top: 0, bottom: 24, height: 24 };
    const getRect = vi.fn(() => rectAtDown);
    slider.getBoundingClientRect = getRect;

    dispatchPointer(slider, "pointerdown", 100); // ratio 0.5 against rectAtDown
    const midFromDown = LOSS_RATE_MIN_PCT + 0.5 * (LOSS_RATE_MAX_PCT - LOSS_RATE_MIN_PCT);
    expect(onChange).toHaveBeenLastCalledWith(midFromDown);
    expect(getRect).toHaveBeenCalledTimes(1);

    // Swap the mock so any *new* call to getBoundingClientRect would report
    // a slider that has moved 1000px to the right -- if pointermove were
    // re-querying instead of reusing the cached rect, clientX=100 would now
    // resolve to a ratio of (100-1000)/200, clamped to 0 -> the slider's
    // min, not the same 0.5 ratio as pointerdown.
    slider.getBoundingClientRect = vi.fn(() => rectDuringMove);
    dispatchPointer(slider, "pointermove", 100);
    expect(onChange).toHaveBeenLastCalledWith(midFromDown);
    expect(slider.getBoundingClientRect).not.toHaveBeenCalled();
  });

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
