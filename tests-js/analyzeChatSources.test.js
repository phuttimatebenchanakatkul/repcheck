// The Analyze chat lists the sources behind each reply, like the coach page
// and the workout chat (App Review Guideline 1.4.1). Drives the REAL widget
// and the REAL static/ai_sources.js through a form submit.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mountWidget } from "./support/loadAnalyzeChatWidget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI_SOURCES = readFileSync(path.join(__dirname, "..", "static", "ai_sources.js"), "utf8");

const SOURCE = {
  id: "schoenfeld_squat_2010",
  title: "Squatting kinematics and kinetics and their application to exercise performance",
  publisher: "Journal of Strength and Conditioning Research, 2010",
  url: "https://pubmed.ncbi.nlm.nih.gov/20182386/",
};

describe("Analyze chat citations", () => {
  beforeEach(() => {
    localStorage.clear();
    delete window.RepCheckSources;
    new Function(AI_SOURCES)();
    Element.prototype.scrollTo = Element.prototype.scrollTo || function () {};
  });

  it("links the reply's sources under the assistant bubble and keeps them on the turn", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, reply: "- **Brace** first.", sources: [SOURCE], limited: false, retry_after_seconds: 0 }),
    });
    mountWidget({ id: 7 });
    document.getElementById("ac-input").value = "How do I fix my squat depth?";
    document.getElementById("ac-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => {
      expect(document.querySelector("#ac-messages .ag-row-assistant .ai-sources a[data-source-link]")).not.toBeNull();
    });

    const link = document.querySelector("#ac-messages .ai-sources a[data-source-link]");
    expect(link.getAttribute("href")).toBe(SOURCE.url);
    expect(document.querySelector("#ac-messages .ag-row-user .ai-sources")).toBeNull();

    const stored = JSON.parse(localStorage.getItem("repcheck_analyze_chat_v1_7"));
    expect(stored.history[1].sources).toEqual([SOURCE]);
  });
});
