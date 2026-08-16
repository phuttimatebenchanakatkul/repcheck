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
 * Clearing deliberately does NOT fire an `input` event, so the blank stays
 * purely visual and never reaches app state. That matters because the
 * restore is driven by focusout, and a focused field can be torn down
 * before focusout ever fires -- a sheet rebuilt by a language switch or an
 * incoming sync rather than by a tap. The blank would then be all that was
 * ever recorded: the set-reps listener stores "" verbatim and saves, and
 * the coaching wizard's stores String(displayToKg("") || 0), i.e. 0. Both
 * survived the teardown as the user's real logged number. Keeping state
 * untouched until something is actually typed removes that failure mode by
 * construction rather than trying to catch every teardown path.
 *
 * The restore DOES fire one: if the user emptied the field themselves,
 * those listeners have already stored the empty value, and putting the old
 * text back without telling them would leave the field showing one number
 * and the state holding another.
 *
 * The trade is that a live preview (the create-food calorie total, the
 * log-amount donut, the coaching wizard's goal-date estimate) keeps showing
 * the previous number while its field sits blank, instead of flashing to
 * zero and back on the way through.
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
