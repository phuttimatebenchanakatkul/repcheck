/**
 * The friends list renders a real row, with a real report/block button.
 *
 * App Store Guideline 1.2 requires the ability to block an abusive user, and
 * the friends list is the one screen where an unwanted account actually turns
 * up: /api/friends/add is mutual and asks nobody, so whoever has your friend
 * code puts their own display name in this list.
 *
 * Every other test covering that button reads templates/friends.html as TEXT.
 * That is the repo's documented tradeoff for inline JS with no module
 * boundary, and it is genuinely useful -- but it cannot see whether the
 * markup it finds ever reaches the DOM. It did not: an HTML comment added
 * inside the row's template literal contained a backtick, which ended the
 * literal, and every row rendered as the truncated comment with no avatar,
 * no name and no button. The whole suite stayed green.
 *
 * So this file executes the real function instead of reading it.
 */

import { describe, expect, it } from "vitest";
import { loadFriendsRow } from "./support/loadFriendsRow.js";

describe("the friend row", () => {
  it("renders one row per friend, with the report/block button", () => {
    const { listEl } = loadFriendsRow([
      { id: 7, name: "Mallory" },
      { id: 8, name: "Sam" },
    ]);

    expect(listEl.querySelectorAll(".fr-friend-row")).toHaveLength(2);
    expect(listEl.querySelectorAll(".fr-friend-more")).toHaveLength(2);
  });

  it("points the button at the friend's user id, not their name", () => {
    const { listEl } = loadFriendsRow([{ id: 7, name: "Mallory" }]);

    const button = listEl.querySelector(".fr-friend-more");
    expect(button.getAttribute("data-safety-user")).toBe("7");
    expect(button.getAttribute("aria-label")).toBe("More options");
  });

  it("shows the friend's name and initial", () => {
    const { listEl } = loadFriendsRow([{ id: 7, name: "mallory" }]);

    expect(listEl.querySelector(".fr-friend-name").textContent).toBe("mallory");
    expect(listEl.querySelector(".fr-friend-avatar").textContent).toBe("M");
  });

  it("escapes a name chosen by another account", () => {
    // f.name is whoever you added, not you -- an unescaped interpolation
    // here is exploitable against a friend who never touched the form.
    const { listEl } = loadFriendsRow([
      { id: 7, name: '<img src=x onerror="window.__pwned=1">' },
    ]);

    expect(listEl.querySelector("img")).toBeNull();
    expect(window.__pwned).toBeUndefined();
    expect(listEl.querySelector(".fr-friend-name").textContent).toBe(
      '<img src=x onerror="window.__pwned=1">'
    );
  });

  it("survives a friend whose name is blank instead of dropping every row", () => {
    // ""[0] is undefined and .toUpperCase() throws, which aborts the loop
    // for the whole list -- so one bad row used to cost the user every row,
    // including the button they would block that account with.
    const { listEl } = loadFriendsRow([
      { id: 7, name: "" },
      { id: 8, name: "Sam" },
    ]);

    expect(listEl.querySelectorAll(".fr-friend-row")).toHaveLength(2);
    expect(listEl.querySelectorAll(".fr-friend-more")).toHaveLength(2);
    expect(listEl.querySelector(".fr-friend-avatar").textContent).toBe("?");
  });

  it("renders the empty state when there are no friends", () => {
    const { listEl } = loadFriendsRow([]);

    expect(listEl.querySelectorAll(".fr-friend-row")).toHaveLength(0);
    expect(listEl.querySelector(".fr-empty")).not.toBeNull();
  });
});

describe("the friend row's report/block handler", () => {
  function clickOn(el) {
    return { target: { closest: (sel) => (el && el.matches(sel) ? el : null) } };
  }

  it("opens the safety sheet for the account whose row was tapped", () => {
    const opened = [];
    window.RepCheckSafety = { open: (arg) => opened.push(arg) };

    const { listEl, dispatch } = loadFriendsRow([
      { id: 7, name: "Mallory" },
      { id: 8, name: "Sam" },
    ]);
    const second = listEl.querySelectorAll(".fr-friend-more")[1];
    dispatch("click", clickOn(second));

    expect(opened).toEqual([{ userId: 8, name: "Sam" }]);
  });

  it("ignores a click that is not on the button", () => {
    const opened = [];
    window.RepCheckSafety = { open: (arg) => opened.push(arg) };

    const { listEl, dispatch } = loadFriendsRow([{ id: 7, name: "Mallory" }]);
    dispatch("click", clickOn(listEl.querySelector(".fr-friend-name")));

    expect(opened).toEqual([]);
  });

  it("does not throw when the safety sheet has not loaded", () => {
    // safety.js is a separate shell script; a load failure must leave the
    // page usable rather than throwing on every click anywhere in it.
    delete window.RepCheckSafety;

    const { listEl, dispatch } = loadFriendsRow([{ id: 7, name: "Mallory" }]);
    const button = listEl.querySelector(".fr-friend-more");

    expect(() => dispatch("click", clickOn(button))).not.toThrow();
  });

  it("reloads the list when a block or report lands", () => {
    // Blocking from this screen has to clear the row. The reload is what
    // makes that happen; an empty handler satisfies every source-level test.
    const { dispatch, listeners, reloads } = loadFriendsRow([{ id: 7, name: "Mallory" }]);

    expect(listeners.some((l) => l.type === "repcheck:safety-changed")).toBe(true);
    dispatch("repcheck:safety-changed", {});
    expect(reloads).toHaveLength(1);
  });
});
