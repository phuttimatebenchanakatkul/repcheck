// RepCheckNative.signInWithGoogle -- the iOS shell's Google sign-in handoff.
//
// The bug, seen in a real TestFlight build: tapping "Continue with Google"
// in the packaged app finished the whole OAuth flow and dumped the user on
// the website, still signed out in the app. Google refuses OAuth in an
// embedded webview and Capacitor sends off-origin navigations to Safari, so
// the session cookie was set in Safari's jar where the app cannot read it.
// Redirecting "back" would not have fixed it -- the session was in the wrong
// browser, not at the wrong URL.
//
// So the shell opens the flow in SFSafariViewController via @capacitor/browser,
// the server hands back a one-time token over repcheck://, and the webview
// redeems it. These tests drive that through fake plugins.
//
// The browser cases matter most, same as native.test.js: almost every user is
// on the web, where signInWithGoogle must decline and leave the plain link
// completely alone.

import { describe, it, expect, vi } from "vitest";
import { loadNative, fakeCapacitor } from "./support/loadNative.js";

/** Capture the appUrlOpen handler the bridge registers, so tests can fire it. */
function fakeApp() {
  const listeners = {};
  return {
    plugin: {
      addListener: vi.fn((event, handler) => {
        listeners[event] = handler;
        return Promise.resolve({ remove() {} });
      }),
    },
    fire(event, payload) {
      if (!listeners[event]) throw new Error(`nothing listening for ${event}`);
      return listeners[event](payload);
    },
    has(event) {
      return Boolean(listeners[event]);
    },
  };
}

function fakeBrowser({ openFails = false } = {}) {
  return {
    open: vi.fn(() => (openFails ? Promise.reject(new Error("no browser")) : Promise.resolve())),
    close: vi.fn(() => Promise.resolve()),
  };
}

describe("signInWithGoogle in a plain browser", () => {
  it("declines, so the ordinary link navigates as it always has", () => {
    const assign = vi.fn();
    const { native } = loadNative({ assign });

    expect(native.signInWithGoogle("/auth/google")).toBe(false);
    // Declining has to mean doing NOTHING -- the caller only skips its own
    // preventDefault. Navigating here too would double-trigger the flow.
    expect(assign).not.toHaveBeenCalled();
  });

  it("registers no appUrlOpen listener at all", () => {
    const app = fakeApp();
    loadNative({ capacitor: null });

    expect(app.has("appUrlOpen")).toBe(false);
  });
});

describe("signInWithGoogle inside the shell", () => {
  it("opens the flow in the in-app browser, flagged as native", async () => {
    const browser = fakeBrowser();
    const app = fakeApp();
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Browser: browser, App: app.plugin } }),
    });

    expect(native.signInWithGoogle("/auth/google")).toBe(true);
    expect(browser.open).toHaveBeenCalledTimes(1);

    const { url } = browser.open.mock.calls[0][0];
    // native=1 is what tells the server to hand back a token instead of
    // setting a cookie in a browser the app cannot read.
    expect(url).toContain("native=1");
    expect(url).toContain("/auth/google");
  });

  it("keeps an existing query string when adding native=1", () => {
    const browser = fakeBrowser();
    const app = fakeApp();
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Browser: browser, App: app.plugin } }),
    });

    native.signInWithGoogle("/auth/google?next=/nutrition");

    const { url } = browser.open.mock.calls[0][0];
    expect(url).toContain("next=/nutrition");
    expect(url).toContain("native=1");
    // One "?" only -- a second would make the server read the whole tail as
    // part of the previous value and silently lose next=.
    expect(url.split("?").length).toBe(2);
  });

  it("redeems the token when iOS reopens the app", () => {
    const assign = vi.fn();
    const browser = fakeBrowser();
    const app = fakeApp();
    loadNative({
      capacitor: fakeCapacitor({ plugins: { Browser: browser, App: app.plugin } }),
      assign,
    });

    app.fire("appUrlOpen", { url: "repcheck://auth?token=abc123" });

    expect(assign).toHaveBeenCalledWith("/auth/native-complete?token=abc123");
    // The sign-in browser must be dismissed, or the user lands on a
    // logged-in app hidden behind a stale Google page.
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("listens before the button is ever tapped", () => {
    const app = fakeApp();
    loadNative({ capacitor: fakeCapacitor({ plugins: { App: app.plugin } }) });

    // iOS can deliver the URL before a handler attached inside the click
    // would exist; a missed event strands the user on the login page.
    expect(app.has("appUrlOpen")).toBe(true);
  });

  it("ignores unrelated deep links", () => {
    const assign = vi.fn();
    const app = fakeApp();
    loadNative({ capacitor: fakeCapacitor({ plugins: { App: app.plugin } }), assign });

    app.fire("appUrlOpen", { url: "repcheck://something-else?token=abc" });
    app.fire("appUrlOpen", { url: "https://example.com/?token=abc" });
    app.fire("appUrlOpen", {});

    expect(assign).not.toHaveBeenCalled();
  });

  it("ignores a callback with no token rather than navigating to a broken URL", () => {
    const assign = vi.fn();
    const app = fakeApp();
    loadNative({ capacitor: fakeCapacitor({ plugins: { App: app.plugin } }), assign });

    app.fire("appUrlOpen", { url: "repcheck://auth" });

    expect(assign).not.toHaveBeenCalled();
  });

  it("url-decodes the token", () => {
    const assign = vi.fn();
    const app = fakeApp();
    loadNative({ capacitor: fakeCapacitor({ plugins: { App: app.plugin } }), assign });

    app.fire("appUrlOpen", { url: "repcheck://auth?token=a%2Bb%2Fc" });

    expect(assign).toHaveBeenCalledWith("/auth/native-complete?token=a%2Bb%2Fc");
  });
});

describe("signInWithGoogle when the shell is half-configured", () => {
  it("declines if the Browser plugin was never synced into the project", () => {
    const { native } = loadNative({ capacitor: fakeCapacitor({ plugins: {} }) });

    // package.json can list a plugin the native project has not been rebuilt
    // with. Falling back to the plain link is wrong-but-working; throwing
    // would leave a button that does nothing.
    expect(native.signInWithGoogle("/auth/google")).toBe(false);
  });

  it("falls back to a normal navigation if the browser refuses to open", async () => {
    const assign = vi.fn();
    const browser = fakeBrowser({ openFails: true });
    const app = fakeApp();
    const { native } = loadNative({
      capacitor: fakeCapacitor({ plugins: { Browser: browser, App: app.plugin } }),
      assign,
    });

    native.signInWithGoogle("/auth/google");
    await Promise.resolve();
    await Promise.resolve();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign.mock.calls[0][0]).toContain("native=1");
  });

  it("still redeems the token if the Browser plugin is missing at callback time", () => {
    const assign = vi.fn();
    const app = fakeApp();
    loadNative({ capacitor: fakeCapacitor({ plugins: { App: app.plugin } }), assign });

    app.fire("appUrlOpen", { url: "repcheck://auth?token=abc123" });

    // Not being able to close a browser must never block signing in.
    expect(assign).toHaveBeenCalledWith("/auth/native-complete?token=abc123");
  });
});
