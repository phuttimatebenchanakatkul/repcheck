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
