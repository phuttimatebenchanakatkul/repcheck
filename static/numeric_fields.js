/* RepCheck "tap a number field and it goes blank" behavior.
 *
 * Every numeric field in the app is pre-filled with something -- a default
 * (0 protein, 100g serving, 1 serving), last session's load, or the value
 * already logged. Changing it meant backspacing three digits first, which
 * on a phone keyboard is the slowest part of logging anything. So focusing
 * one blanks it completely and you just type the new number.
 *
 * The previous value is stashed on the element and put back on blur if
 * nothing was typed, so tapping into a field and back out never silently
 * changes anything.
 *
 * Fields opt in with a data-clear-on-focus attribute. Binding is delegated
 * off `document` via focusin/focusout (which bubble, unlike focus/blur)
 * rather than per-element, so this survives the many screens here that
 * rebuild their markup with innerHTML on every render -- the nutrition
 * timeline, workout set rows, the Hyrox race-setup sheet -- without every
 * one of them having to re-wire its inputs after each render.
 *
 * Clearing and restoring both dispatch a bubbling `input` event, because
 * several of these fields drive live previews off their own input listener
 * (the create-food calorie total, the log-amount donut, the coaching
 * wizard's goal-date estimate) and those would otherwise keep showing
 * numbers computed from a value the field no longer displays. Every such
 * listener already handles an empty value -- see the callers of
 * displayToKg()/parseFloat() on these fields, which all fall back to the
 * stored value rather than writing a NaN.
 */
(function (global) {
  "use strict";

  function clearableTarget(event) {
    const el = event.target;
    return el && el.closest ? el.closest("[data-clear-on-focus]") : null;
  }

  function handleFocusIn(event) {
    const input = clearableTarget(event);
    // An already-empty field has nothing to clear, and stashing "" as the
    // previous value would make the blur below "restore" a blank.
    if (!input || input.value === "") return;
    input.dataset.prevValue = input.value;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function handleFocusOut(event) {
    const input = clearableTarget(event);
    if (!input) return;
    if (input.value.trim() === "" && input.dataset.prevValue != null) {
      input.value = input.dataset.prevValue;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    delete input.dataset.prevValue;
  }

  document.addEventListener("focusin", handleFocusIn);
  document.addEventListener("focusout", handleFocusOut);

  // Exported for the test suite, which drives the handlers directly rather
  // than relying on jsdom's focus plumbing.
  global.RepCheckNumericFields = { handleFocusIn, handleFocusOut };
})(window);
