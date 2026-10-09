// static/ai_consent.js -- asks before the first AI request leaves the device
// (App Review Guideline 5.1.2(i)). The wrapper sits on window.fetch, so these
// tests drive it exactly the way a page would: by calling fetch.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, "..", "static", "ai_consent.js"), "utf8");

function ok(body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

function load({ granted = false, loggedIn = true } = {}) {
  delete window.RepCheckAIConsent;
  window.REPCHECK_AI_CONSENT = granted;
  window.REPCHECK_LOGGED_IN = loggedIn;
  const server = vi.fn((url) => {
    if (String(url).includes("/api/ai-consent")) return ok({ ok: true, granted: true });
    return ok({ ok: true, reply: "hi" });
  });
  window.fetch = server;
  new Function(SRC)();
  return server;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("RepCheckAIConsent fetch gate", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("holds an AI request until the user allows it, records consent, then sends it", async () => {
    const server = load();
    const pending = window.fetch("/api/coach-chat", { method: "POST", body: "{}" });
    await flush();
    expect(document.querySelector(".aic-overlay")).not.toBeNull();
    expect(server).not.toHaveBeenCalled();

    document.querySelector(".aic-btn-primary").click();
    const res = await pending;
    expect((await res.json()).reply).toBe("hi");
    const urls = server.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(["/api/ai-consent", "/api/coach-chat"]);
    expect(JSON.parse(server.mock.calls[0][1].body)).toEqual({ granted: true });
    expect(document.querySelector(".aic-overlay")).toBeNull();
    expect(window.RepCheckAIConsent.isGranted()).toBe(true);
  });

  it("never sends the content when the user declines", async () => {
    const server = load();
    const pending = window.fetch("/api/analyze-food", { method: "POST", body: new FormData() });
    await flush();
    document.querySelector(".aic-btn-secondary").click();
    const res = await pending;
    expect(res.status).toBe(403);
    expect((await res.json()).needs_ai_consent).toBe(true);
    expect(server).not.toHaveBeenCalled();
  });

  it("lets non-AI requests straight through", async () => {
    const server = load();
    await window.fetch("/api/sync/workout_log", { method: "POST", body: "{}" });
    await window.fetch("/api/generate-split", { method: "POST", body: JSON.stringify({ split_type: "ppl" }) });
    expect(server).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".aic-overlay")).toBeNull();
  });

  it("asks before an AI-built split, but not a hand-built one", () => {
    load();
    const m = window.RepCheckAIConsent._matches;
    expect(m("POST", "/api/generate-split", JSON.stringify({ split_type: "ai_suggest" }))).toBe(true);
    expect(m("POST", "/api/generate-split", JSON.stringify({ split_type: "ppl" }))).toBe(false);
    expect(m("POST", "/analyze", null)).toBe(true);
    expect(m("GET", "/analyze", null)).toBe(false);
    expect(m("POST", "/api/challenges/42/submit", null)).toBe(true);
  });

  it("sends a weekly check-in even after a decline -- it has a non-AI answer", async () => {
    const server = load();
    const pending = window.fetch("/api/coaching/weekly-adjustment", { method: "POST", body: "{}" });
    await flush();
    document.querySelector(".aic-btn-secondary").click();
    await pending;
    expect(server.mock.calls.map((c) => String(c[0]))).toEqual(["/api/coaching/weekly-adjustment"]);
  });

  it("asks only once for concurrent AI requests", async () => {
    load();
    const a = window.fetch("/api/coach-chat", { method: "POST" });
    const b = window.fetch("/api/workout-chat", { method: "POST" });
    await flush();
    expect(document.querySelectorAll(".aic-overlay")).toHaveLength(1);
    document.querySelector(".aic-btn-primary").click();
    await Promise.all([a, b]);
  });

  it("does not ask an account that already agreed", async () => {
    const server = load({ granted: true });
    await window.fetch("/api/coach-chat", { method: "POST" });
    expect(document.querySelector(".aic-overlay")).toBeNull();
    expect(server).toHaveBeenCalledTimes(1);
  });

  it("withdrawal is recorded on the server and takes effect at once", async () => {
    const server = load({ granted: true });
    server.mockImplementationOnce(() => ok({ ok: true, granted: false }));
    await window.RepCheckAIConsent.set(false);
    expect(JSON.parse(server.mock.calls[0][1].body)).toEqual({ granted: false });
    expect(window.RepCheckAIConsent.isGranted()).toBe(false);
  });

  it("names Google Gemini in the dialog and links the privacy policy", async () => {
    load();
    window.fetch("/api/coach-chat", { method: "POST" });
    await flush();
    const text = document.querySelector(".aic-card").textContent;
    expect(text).toContain("Google's Gemini AI");
    expect(document.querySelector(".aic-link").getAttribute("href")).toBe("/privacy#ai");
  });
});
