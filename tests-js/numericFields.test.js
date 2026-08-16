import { describe, it, expect, beforeEach } from "vitest";
import { loadNumericFields } from "./support/loadNumericFields.js";

// The shared blank-on-focus behavior for every [data-clear-on-focus]
// number field: macros and serving sizes on the create-food screen, logged
// entry amounts, workout set weight/reps, coaching + onboarding weights,
// the log-weight sheet, and the Hyrox race-setup fields.

function numberField(value, { attr = true } = {}) {
  const input = document.createElement("input");
  input.type = "number";
  if (attr) input.setAttribute("data-clear-on-focus", "");
  input.value = value;
  document.body.appendChild(input);
  return input;
}

function countInputEvents(input) {
  const seen = { count: 0, bubbled: 0 };
  input.addEventListener("input", () => { seen.count++; });
  document.body.addEventListener("input", () => { seen.bubbled++; });
  return seen;
}

describe("numeric_fields.js -- clear-on-focus for number inputs", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("binds focusin/focusout on document (not focus/blur, which don't bubble past re-rendered markup)", () => {
    const { bound } = loadNumericFields();
    expect(bound.map((b) => b.type).sort()).toEqual(["focusin", "focusout"]);
  });

  it("blanks a pre-filled field on focus and fires a bubbling input event so live previews follow", () => {
    const { focusIn } = loadNumericFields();
    const input = numberField("100");
    const seen = countInputEvents(input);

    focusIn(input);

    expect(input.value).toBe("");
    expect(seen.count).toBe(1);
    expect(seen.bubbled).toBe(1);
  });

  it("restores the previous value on blur-while-empty, so tapping in and out changes nothing", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("100");
    const seen = countInputEvents(input);

    focusIn(input);
    focusOut(input);

    expect(input.value).toBe("100");
    expect(seen.count).toBe(2);
    expect(input.dataset.prevValue).toBeUndefined();
  });

  it("keeps what was typed on blur and does not fire a restore event", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("100");
    const seen = countInputEvents(input);

    focusIn(input);
    input.value = "250";
    focusOut(input);

    expect(input.value).toBe("250");
    expect(seen.count).toBe(1); // the clear only -- no restore
    expect(input.dataset.prevValue).toBeUndefined();
  });

  // The regression this guards: an earlier per-element version of this
  // helper captured the value once at wire-up time, so a second visit to
  // the same field restored the value it had on first render -- silently
  // reverting an edit the user had already made (and, on the food log,
  // writing that stale number back through the input listener).
  it("stashes the value at focus time, not at wire-up time, so a second visit restores the edited value", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("100");

    focusIn(input);
    input.value = "250";
    focusOut(input);

    focusIn(input);
    expect(input.value).toBe("");
    focusOut(input);

    expect(input.value).toBe("250");
  });

  it("no-ops on an already-empty field: nothing to clear, and nothing to restore on the way out", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("");
    const seen = countInputEvents(input);

    focusIn(input);
    expect(input.value).toBe("");
    expect(seen.count).toBe(0);

    focusOut(input);
    expect(input.value).toBe("");
    expect(seen.count).toBe(0);
  });

  it("treats whitespace-only as empty on blur and restores", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("60");

    focusIn(input);
    input.value = "   ";
    focusOut(input);

    expect(input.value).toBe("60");
  });

  it("leaves fields without the opt-in attribute alone (search boxes, names, barcodes)", () => {
    const { focusIn, focusOut } = loadNumericFields();
    const input = numberField("100", { attr: false });

    focusIn(input);
    expect(input.value).toBe("100");

    input.value = "";
    focusOut(input);
    expect(input.value).toBe("");
  });

  it("ignores focus landing on a non-element target", () => {
    const { api } = loadNumericFields();
    expect(() => api.handleFocusIn({ target: document })).not.toThrow();
    expect(() => api.handleFocusOut({ target: null })).not.toThrow();
  });
});
