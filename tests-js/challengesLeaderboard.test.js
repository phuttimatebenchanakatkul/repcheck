import { describe, it, expect, beforeEach } from "vitest";
import { loadChallengesLeaderboard } from "./support/loadChallengesLeaderboard.js";

describe("challenges.html leaderboard render", () => {
  let listEl, meEl, footEl;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="list"></div>
      <div id="me"></div>
      <div id="foot"></div>
    `;
    listEl = document.getElementById("list");
    meEl = document.getElementById("me");
    footEl = document.getElementById("foot");
  });

  it("pins your row above the list and excludes you from it", () => {
    const { renderLeaderboard } = loadChallengesLeaderboard();
    renderLeaderboard(listEl, meEl, footEl, {
      me: "u1",
      totalEntries: 3,
      myRank: { rank: 2, total_reps: 10, user_id: "u1" },
      leaderboard: [
        { user_id: "u2", name: "Mook", total_reps: 15 },
        { user_id: "u1", name: "You", total_reps: 10 },
        { user_id: "u3", name: "Arm", total_reps: 5 },
      ],
    });
    expect(meEl.innerHTML).toContain("You");
    expect(listEl.querySelectorAll(".ch-lb-row").length).toBe(2);
    expect(listEl.innerHTML).not.toContain("data-rank=\"2\"");
  });

  it("shows nothing in the list when you're the only entry", () => {
    const { renderLeaderboard, mascotCalls } = loadChallengesLeaderboard();
    renderLeaderboard(listEl, meEl, footEl, {
      me: "u1",
      totalEntries: 1,
      myRank: { rank: 1, total_reps: 10, user_id: "u1" },
      leaderboard: [{ user_id: "u1", name: "You", total_reps: 10 }],
    });
    expect(listEl.innerHTML).toBe("");
    expect(mascotCalls.length).toBe(0);
  });

  it("shows the podium mascot empty state when nobody -- you included -- has a score", () => {
    const { renderLeaderboard, mascotCalls } = loadChallengesLeaderboard();
    renderLeaderboard(listEl, meEl, footEl, {
      me: "u1",
      totalEntries: 0,
      myRank: null,
      leaderboard: [],
    });
    expect(mascotCalls).toEqual([
      { pose: "podium", title: "No attempts yet", sub: "Be the first to set a score." },
    ]);
    expect(listEl.innerHTML).toContain("No attempts yet");
    expect(meEl.innerHTML).toBe("");
  });

  it("escapes a hostile competitor name before it reaches innerHTML", () => {
    const { lbRow } = loadChallengesLeaderboard();
    const html = lbRow({ rank: 4, label: "<img src=x onerror=alert(1)>", reps: 7, kind: "is-rest", meta: "" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
