// The marketing site's waitlist form is the only thing on that page a user
// can actually fail at, and it is wired to a placeholder endpoint until launch
// (see marketing/README.md). These tests run the real marketing/app.js IIFE in
// jsdom -- what ships is what is tested.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadMarketingApp } from "./support/loadMarketingApp.js";

// The submit handler's fetch chain settles on microtasks; a resolved promise
// flushed twice is enough to run .then/.catch and their DOM writes.
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function submit(form) {
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

let realFetch;

beforeEach(() => {
  realFetch = global.fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("validEmail", () => {
  it("accepts ordinary addresses", () => {
    const { validEmail } = loadMarketingApp();
    for (const good of ["a@b.co", "james@repcheck.app", "first.last+tag@sub.example.com"]) {
      expect(validEmail(good), good).toBe(true);
    }
  });

  it("rejects the shapes a typo actually produces", () => {
    const { validEmail } = loadMarketingApp();
    for (const bad of ["", "james", "james@", "@repcheck.app", "james@repcheck", "a b@c.co", "a@b c.co"]) {
      expect(validEmail(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("waitlist submit", () => {
  it("never posts an invalid address, and says why in the note", async () => {
    const app = loadMarketingApp();
    app.dom.heroInput.value = "not-an-email";

    submit(app.dom.heroForm);
    await flush();

    expect(app.calls).toHaveLength(0);
    expect(app.dom.heroInput.getAttribute("aria-invalid")).toBe("true");
    expect(app.dom.heroNote.className).toContain("is-error");
    expect(app.dom.heroNote.className).not.toContain("is-ok");
    expect(app.dom.heroNote.textContent).not.toBe(app.notes.HERO_NOTE);
    // The button stays live -- a rejected address is a correctable mistake,
    // not a submission in flight.
    expect(app.dom.heroButton.disabled).toBe(false);
  });

  it("trims the address before validating and posting it", async () => {
    const app = loadMarketingApp();
    app.dom.heroInput.value = "  james@repcheck.app  ";

    submit(app.dom.heroForm);
    await flush();

    expect(app.calls).toHaveLength(1);
    expect(JSON.parse(app.calls[0].init.body).email).toBe("james@repcheck.app");
  });

  it("posts JSON to the configured endpoint and confirms with the address", async () => {
    const app = loadMarketingApp();
    app.dom.heroInput.value = "james@repcheck.app";

    submit(app.dom.heroForm);
    await flush();

    expect(app.calls).toHaveLength(1);
    const [{ url, init }] = app.calls;
    expect(url).toBe(app.ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      email: "james@repcheck.app",
      source: "repcheck-marketing",
    });

    expect(app.dom.heroNote.textContent).toContain("james@repcheck.app");
    expect(app.dom.heroNote.className).toContain("is-ok");
    expect(app.dom.heroInput.value).toBe("");
    expect(app.dom.heroButton.textContent).toBe("You're in");
  });

  it("keeps the button locked after success so one signup is one signup", async () => {
    const app = loadMarketingApp();
    app.dom.heroInput.value = "james@repcheck.app";

    submit(app.dom.heroForm);
    await flush();

    expect(app.dom.heroButton.disabled).toBe(true);
  });

  it("fails closed and hands the button back when the endpoint rejects", async () => {
    // This is the live-today path: ENDPOINT is still the Formspree
    // placeholder, so every real submission lands here until it is swapped.
    const app = loadMarketingApp({ fetchImpl: () => Promise.resolve({ ok: false, status: 404 }) });
    const originalLabel = app.dom.heroButton.textContent;
    app.dom.heroInput.value = "james@repcheck.app";

    submit(app.dom.heroForm);
    await flush();

    expect(app.dom.heroNote.className).toContain("is-error");
    expect(app.dom.heroNote.className).not.toContain("is-ok");
    expect(app.dom.heroButton.disabled).toBe(false);
    expect(app.dom.heroButton.textContent).toBe(originalLabel);
    // Nothing was cleared -- the address is still there to retry with.
    expect(app.dom.heroInput.value).toBe("james@repcheck.app");
  });

  it("treats a network error the same as a bad status", async () => {
    const app = loadMarketingApp({ fetchImpl: () => Promise.reject(new Error("offline")) });
    app.dom.heroInput.value = "james@repcheck.app";

    submit(app.dom.heroForm);
    await flush();

    expect(app.dom.heroNote.className).toContain("is-error");
    expect(app.dom.heroButton.disabled).toBe(false);
  });

  it("does not navigate -- the submit is always intercepted", () => {
    const app = loadMarketingApp();
    app.dom.heroInput.value = "james@repcheck.app";
    const evt = new window.Event("submit", { bubbles: true, cancelable: true });

    app.dom.heroForm.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  it("wires both forms on the page independently", async () => {
    const app = loadMarketingApp();
    app.dom.ctaInput.value = "james@repcheck.app";

    submit(app.dom.ctaForm);
    await flush();

    expect(app.calls).toHaveLength(1);
    expect(app.dom.ctaNote.className).toContain("is-ok");
    // The hero form, untouched, still shows its own default copy.
    expect(app.dom.heroNote.textContent).toBe(app.notes.HERO_NOTE);
    expect(app.dom.heroNote.className).not.toContain("is-ok");
  });
});

describe("typing after an error", () => {
  it("restores that form's own default note and clears the invalid flag", async () => {
    const app = loadMarketingApp();
    app.dom.ctaInput.value = "nope";
    submit(app.dom.ctaForm);
    await flush();
    expect(app.dom.ctaNote.className).toContain("is-error");

    app.dom.ctaInput.value = "n";
    app.dom.ctaInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(app.dom.ctaInput.getAttribute("aria-invalid")).toBe(null);
    expect(app.dom.ctaNote.className).not.toContain("is-error");
    // Each form remembers its OWN copy, not the hero's.
    expect(app.dom.ctaNote.textContent).toBe(app.notes.CTA_NOTE);
  });
});

describe("page chrome", () => {
  it("stamps the current year into the footer", () => {
    const app = loadMarketingApp();
    expect(app.dom.yearEl.textContent).toBe(String(new Date().getFullYear()));
  });

  it("marks the nav stuck only once the page has scrolled past the threshold", () => {
    const app = loadMarketingApp();
    // onScroll() runs once at wire-up, at scrollY 0.
    expect(app.dom.nav.classList.contains("is-stuck")).toBe(false);

    window.scrollY = 40;
    window.dispatchEvent(new window.Event("scroll"));
    expect(app.dom.nav.classList.contains("is-stuck")).toBe(true);

    window.scrollY = 0;
    window.dispatchEvent(new window.Event("scroll"));
    expect(app.dom.nav.classList.contains("is-stuck")).toBe(false);
  });

  it("flips away from the OS preference on the first click, and persists it", () => {
    const app = loadMarketingApp({ prefersDark: true });

    app.dom.toggle.click();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("rc-theme")).toBe("light");

    app.dom.toggle.click();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("rc-theme")).toBe("dark");
  });

  it("flips the other way for a light-preferring visitor", () => {
    const app = loadMarketingApp({ prefersDark: false });

    app.dom.toggle.click();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
