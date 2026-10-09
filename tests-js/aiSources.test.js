// static/ai_sources.js -- the citation list under every AI chat reply
// (App Review Guideline 1.4.1). Turns live in localStorage and sync across
// devices, so html() must treat what it is handed as untrusted.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, "..", "static", "ai_sources.js"), "utf8");

function load() {
  delete window.RepCheckSources;
  delete window.RepCheckNative;
  new Function(SRC)();
  return window.RepCheckSources;
}

const STUDY = {
  id: "issn_protein_2017",
  title: "International Society of Sports Nutrition Position Stand: protein and exercise",
  publisher: "Journal of the International Society of Sports Nutrition, 2017",
  url: "https://pubmed.ncbi.nlm.nih.gov/28642676/",
};

describe("RepCheckSources.html", () => {
  beforeEach(() => { document.body.innerHTML = ""; });

  it("renders a labelled, linked list plus a link to the full /sources page", () => {
    document.body.innerHTML = load().html([STUDY]);
    const link = document.querySelector(".ai-sources ol a[data-source-link]");
    expect(link.getAttribute("href")).toBe(STUDY.url);
    expect(link.textContent).toBe(STUDY.title);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(document.querySelector(".ai-sources-pub").textContent).toBe(STUDY.publisher);
    expect(document.querySelector(".ai-sources-all").getAttribute("href")).toBe("/sources");
  });

  it("renders nothing for a turn without sources (old turns, errors, greetings)", () => {
    const { html } = load();
    expect(html(undefined)).toBe("");
    expect(html([])).toBe("");
    expect(html("nope")).toBe("");
  });

  it("escapes every field and refuses non-https links", () => {
    const { html } = load();
    const out = html([
      { title: "<img src=x onerror=alert(1)>", publisher: "<b>x</b>", url: "https://example.org/a" },
      { title: "js", url: "javascript:alert(1)" },
      { title: "plain http", url: "http://example.org/" },
      { title: "quote", url: 'https://example.org/"onmouseover="x' },
    ]);
    document.body.innerHTML = out;
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    const links = document.querySelectorAll("a[data-source-link]");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.org/a");
  });

  it("caps the list at three", () => {
    document.body.innerHTML = load().html([STUDY, STUDY, STUDY, STUDY, STUDY]);
    expect(document.querySelectorAll(".ai-sources li")).toHaveLength(3);
  });
});

describe("citation link clicks", () => {
  it("open in the in-app browser inside the iOS shell", () => {
    load();
    const openExternal = vi.fn().mockReturnValue(true);
    window.RepCheckNative = { openExternal };
    document.body.innerHTML = window.RepCheckSources.html([STUDY]);
    const link = document.querySelector("a[data-source-link]");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(openExternal).toHaveBeenCalledWith(STUDY.url);
    expect(event.defaultPrevented).toBe(true);
  });

  it("are left alone in a browser, where openExternal declines", () => {
    load();
    window.RepCheckNative = { openExternal: vi.fn().mockReturnValue(false) };
    document.body.innerHTML = window.RepCheckSources.html([STUDY]);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    // jsdom cannot navigate; stop the default before it tries, after our
    // listener has had its say.
    document.addEventListener("click", (e) => { if (!e.defaultPrevented) { e.preventDefault(); e.__leftAlone = true; } }, { once: true });
    document.querySelector("a[data-source-link]").dispatchEvent(event);
    expect(event.__leftAlone).toBe(true);
  });
});

// Guideline 4.7.1: every AI reply can be reported, and says it is AI and not
// medical advice (1.4.1).
describe("report control under an AI reply", () => {
  function mountReply(text) {
    load();
    document.body.innerHTML =
      `<div class="cc-bubble cc-bubble-coach"><p>${text}</p>${window.RepCheckSources.html([STUDY], "coach")}</div>`;
    return document.querySelector(".cc-bubble");
  }

  it("shows the disclaimer and a Report button only when a feature is given", () => {
    load();
    expect(window.RepCheckSources.html([STUDY])).not.toContain("ai-report");
    const bubble = mountReply("Rest 3 minutes.");
    expect(bubble.querySelectorAll(".ai-disclaimer")).toHaveLength(1);
    expect(bubble.querySelector("[data-ai-report-open]")).not.toBeNull();
  });

  it("still offers Report on a reply with no sources", () => {
    load();
    expect(window.RepCheckSources.html([], "workout_chat")).toContain("data-ai-report-open");
  });

  it("posts the reply's own text -- not the footer -- with the chosen reason", async () => {
    const bubble = mountReply("Rest 3 minutes.");
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    window.fetch = fetchMock;
    bubble.querySelector("[data-ai-report-open]").click();
    expect(bubble.querySelectorAll("[data-ai-report-reason]")).toHaveLength(4);
    bubble.querySelector('[data-ai-report-reason="inaccurate"]').click();
    await vi.waitFor(() => expect(bubble.querySelector(".ai-report-done").textContent).toContain("Thanks"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai-report");
    expect(JSON.parse(options.body)).toEqual({ feature: "coach", reason: "inaccurate", reply: "Rest 3 minutes." });
  });

  it("says so when the report could not be sent", async () => {
    const bubble = mountReply("x");
    window.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    bubble.querySelector("[data-ai-report-open]").click();
    bubble.querySelector('[data-ai-report-reason="other"]').click();
    await vi.waitFor(() => expect(bubble.querySelector(".ai-report-done").textContent).toContain("Couldn't"));
  });

  it("Cancel puts the Report button back without duplicating the disclaimer", () => {
    const bubble = mountReply("x");
    bubble.querySelector("[data-ai-report-open]").click();
    bubble.querySelector("[data-ai-report-cancel]").click();
    expect(bubble.querySelector("[data-ai-report-open]")).not.toBeNull();
    expect(bubble.querySelectorAll(".ai-disclaimer")).toHaveLength(1);
  });
});
