// DOM-level coverage for the personal-best board on the Hyrox history
// screen: getPbBoards() (which races can rank against which) and
// renderPbBoard() (the Challenges-style top-5 leaderboard built from them).
//
// This card replaced the old flat "Personal bests" list (renderPersonalBests,
// one row per combo) when the hero's "View history" link became "Personal
// bests": the screen now leads with a ranked board and keeps the unfiltered
// History list underneath it. The rules worth pinning are all about what
// does NOT reach the board -- custom races, flagged times, and Half races
// mixed in with Full ones -- because every one of them fails silently (a
// wrong row, ranked above a real PB) rather than throwing.
//
// Both methods are exercised on bare HyroxApp instances (see
// loadHyroxApp.js): they read this.history/this.pbBoardKey and nothing
// else, so full construction (localStorage, render(), i18n bootstrap) is
// unnecessary. The i18n/mascot globals they reach for are stubbed below.
import { beforeEach, describe, expect, it } from "vitest";
import { makeBareHyroxApp } from "./support/loadHyroxApp.js";

beforeEach(() => {
  // Echo the key back so assertions can target keys, not English copy --
  // that every key used here exists in BOTH locales is already pinned by
  // tests/test_i18n_key_parity.py.
  globalThis.RepCheckI18n = {
    t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    locale: () => "en-US",
  };
  globalThis.RepCheckMascot = {
    emptyState: (opts) => `<div class="mascot-empty" data-pose="${opts.pose}">${opts.title}</div>`,
  };
});

let raceSeq = 0;
function race(fields) {
  raceSeq += 1;
  return {
    id: `r${raceSeq}`,
    date: `2026-01-0${(raceSeq % 9) + 1}T10:00:00.000Z`,
    gender: "men",
    category: "open",
    format: "singles",
    scale: "full",
    totalSeconds: 4000,
    ...fields,
  };
}

function app(history, fields = {}) {
  return makeBareHyroxApp({ history, pbBoardKey: null, ...fields });
}

function rowsOf(card) {
  return [...card.querySelectorAll(".hx-pb-lb-row")];
}

function timesOf(card) {
  return rowsOf(card).map((r) => r.querySelector(".hx-pb-lb-time").textContent.trim());
}

describe("getPbBoards", () => {
  it("groups races that share a combo into one board, fastest first", () => {
    const boards = app([
      race({ totalSeconds: 4200 }),
      race({ totalSeconds: 3900 }),
      race({ totalSeconds: 4100 }),
    ]).getPbBoards();

    expect(boards).toHaveLength(1);
    expect(boards[0].entries.map((r) => r.totalSeconds)).toEqual([3900, 4100, 4200]);
  });

  it("excludes custom races -- two one-off station mixes share no standard to rank against", () => {
    const boards = app([
      race({ category: "open", totalSeconds: 4200 }),
      race({ category: "custom", format: null, gender: null, totalSeconds: 900 }),
    ]).getPbBoards();

    expect(boards).toHaveLength(1);
    expect(boards[0].category).toBe("open");
    expect(boards[0].entries.map((r) => r.totalSeconds)).toEqual([4200]);
  });

  it("excludes flagged (physically impossible) times, which would otherwise take rank 1", () => {
    const boards = app([
      race({ totalSeconds: 4200 }),
      race({ totalSeconds: 600, flagged: true }),
    ]).getPbBoards();

    expect(boards[0].entries.map((r) => r.totalSeconds)).toEqual([4200]);
  });

  it("keeps Half races on their own board -- half the distance would win every Full ranking", () => {
    const boards = app([
      race({ scale: "full", totalSeconds: 4200 }),
      race({ scale: "half", totalSeconds: 2100 }),
    ]).getPbBoards();

    expect(boards).toHaveLength(2);
    const half = boards.find((b) => b.scale === "half");
    expect(half.entries.map((r) => r.totalSeconds)).toEqual([2100]);
  });

  it("treats a record written before Half existed (no scale field) as Full", () => {
    const legacy = race({ totalSeconds: 4200 });
    delete legacy.scale;
    const boards = app([legacy, race({ scale: "full", totalSeconds: 4300 })]).getPbBoards();

    expect(boards).toHaveLength(1);
    expect(boards[0].scale).toBe("full");
  });

  it("separates category, format and gender the same way pbKeyFor does", () => {
    const boards = app([
      race({ category: "open", format: "singles", gender: "men" }),
      race({ category: "pro", format: "singles", gender: "men" }),
      race({ category: "open", format: "doubles", gender: "men" }),
      race({ category: "open", format: "singles", gender: "women" }),
    ]).getPbBoards();

    expect(boards).toHaveLength(4);
  });

  it("orders boards by race count, so the default tab has the most to rank", () => {
    // A one-race board is a single row with no gap to compare against --
    // the least useful thing to land on, however recently it was raced.
    const boards = app([
      race({ category: "open", date: "2026-01-01T10:00:00.000Z" }),
      race({ category: "open", date: "2026-01-02T10:00:00.000Z" }),
      race({ category: "pro", date: "2026-03-01T10:00:00.000Z" }),
    ]).getPbBoards();

    expect(boards.map((b) => b.category)).toEqual(["open", "pro"]);
  });

  it("breaks a race-count tie by most recently raced", () => {
    const boards = app([
      race({ category: "open", date: "2026-01-01T10:00:00.000Z" }),
      race({ category: "pro", date: "2026-03-01T10:00:00.000Z" }),
    ]).getPbBoards();

    expect(boards.map((b) => b.category)).toEqual(["pro", "open"]);
  });

  it("survives a record with an unparseable date instead of poisoning the order", () => {
    // new Date("").getTime() is NaN, and NaN in the tie-break sort would make
    // the comparator non-deterministic -- the `|| 0` floor is what stops it.
    const boards = app([
      race({ category: "open", date: "not-a-date" }),
      race({ category: "pro", date: "2026-03-01T10:00:00.000Z" }),
    ]).getPbBoards();

    expect(boards).toHaveLength(2);
    expect(boards.every((b) => Number.isFinite(b.latest))).toBe(true);
    expect(boards.map((b) => b.category)).toEqual(["pro", "open"]);
  });

  it("returns no boards at all when every race is ineligible", () => {
    const boards = app([
      race({ category: "custom" }),
      race({ flagged: true }),
    ]).getPbBoards();

    expect(boards).toEqual([]);
  });
});

describe("renderPbBoard", () => {
  it("ranks only the top 5, fastest first, even when more races exist", () => {
    const card = app([
      race({ totalSeconds: 4500 }),
      race({ totalSeconds: 4400 }),
      race({ totalSeconds: 4300 }),
      race({ totalSeconds: 4200 }),
      race({ totalSeconds: 4100 }),
      race({ totalSeconds: 4000 }),
      race({ totalSeconds: 3900 }),
    ]).renderPbBoard();

    expect(timesOf(card)).toEqual(["1:05:00", "1:06:40", "1:08:20", "1:10:00", "1:11:40"]);
  });

  it("says how many races the top 5 was drawn from, but only when some are cut", () => {
    const many = app(Array.from({ length: 7 }, (_, i) => race({ totalSeconds: 4000 + i })));
    const foot = many.renderPbBoard().querySelector(".hx-pb-lb-foot");
    expect(foot.textContent).toContain("hyrox.pb.boardShowingTop");
    expect(foot.textContent).toContain('"shown":5');
    expect(foot.textContent).toContain('"n":7');

    // 5 or fewer: the board already shows everything, so a "top 5 of 5"
    // line would only be a fact about the limit.
    const few = app(Array.from({ length: 5 }, (_, i) => race({ totalSeconds: 4000 + i })));
    expect(few.renderPbBoard().querySelector(".hx-pb-lb-foot")).toBeNull();
  });

  it("marks the top three as podium rows and the rest as is-rest", () => {
    const card = app(Array.from({ length: 5 }, (_, i) => race({ totalSeconds: 4000 + i * 10 }))).renderPbBoard();
    const kinds = rowsOf(card).map((r) => (r.classList.contains("is-podium") ? "podium" : "rest"));

    expect(kinds).toEqual(["podium", "podium", "podium", "rest", "rest"]);
  });

  it("hides the # prefix on non-podium ranks, same as the Challenges board", () => {
    const card = app(Array.from({ length: 5 }, (_, i) => race({ totalSeconds: 4000 + i * 10 }))).renderPbBoard();
    const ranks = rowsOf(card).map((r) => r.querySelector(".hx-pb-lb-rank").textContent.trim());

    expect(ranks).toEqual(["#1", "#2", "#3", "4", "5"]);
  });

  it("labels rank 1 as the PB and every other row with its gap to it", () => {
    const card = app([
      race({ totalSeconds: 4000 }),
      race({ totalSeconds: 4042 }),
    ]).renderPbBoard();
    const metas = rowsOf(card).map((r) => r.querySelector(".hx-pb-lb-meta").textContent.trim());

    // A +00:00 gap against itself would be noise on the row that IS the best.
    expect(metas[0]).toBe("hyrox.pb.boardPbTag");
    expect(metas[1]).toBe("+00:42");
  });

  it("makes every row open that race's own detail modal", () => {
    const card = app([race({ id: "abc", totalSeconds: 4000 })]).renderPbBoard();
    const row = rowsOf(card)[0];

    expect(row.dataset.action).toBe("show-race-detail");
    expect(row.dataset.id).toBe("abc");
    // div[role=button] needs both to be keyboard-reachable; handleKeydown()
    // replays Enter/Space on exactly this selector.
    expect(row.getAttribute("role")).toBe("button");
    expect(row.getAttribute("tabindex")).toBe("0");
  });

  it("shows a tab per combo once there is more than one, defaulting to the fullest board", () => {
    const card = app([
      race({ category: "open", date: "2026-01-01T10:00:00.000Z", totalSeconds: 4200 }),
      race({ category: "open", date: "2026-01-02T10:00:00.000Z", totalSeconds: 4260 }),
      // Raced more recently, but a single race -- must not win the default
      // over the two-race board next to it.
      race({ category: "pro", date: "2026-03-01T10:00:00.000Z", totalSeconds: 4400 }),
    ]).renderPbBoard();

    const tabs = [...card.querySelectorAll(".hx-lb-tab")];
    expect(tabs).toHaveLength(2);
    expect(tabs[0].classList.contains("is-active")).toBe(true);
    expect(tabs.filter((tab) => tab.classList.contains("is-active"))).toHaveLength(1);
    expect(tabs[0].dataset.action).toBe("set-pb-board");
    // The active tab's board is the one rendered, not just the one highlighted.
    expect(timesOf(card)).toEqual(["1:10:00", "1:11:00"]);
  });

  it("names the combo in plain text instead of a one-option tab bar", () => {
    const card = app([race({ totalSeconds: 4200 })]).renderPbBoard();

    expect(card.querySelectorAll(".hx-lb-tab")).toHaveLength(0);
    expect(card.querySelector(".hx-pb-lb-solo")).not.toBeNull();
  });

  it("renders the selected tab's board when one is picked", () => {
    const instance = app([
      race({ category: "open", date: "2026-01-01T10:00:00.000Z", totalSeconds: 4200 }),
      race({ category: "pro", date: "2026-03-01T10:00:00.000Z", totalSeconds: 4400 }),
    ]);
    const openKey = instance.getPbBoards().find((b) => b.category === "open").key;
    instance.pbBoardKey = openKey;

    expect(timesOf(instance.renderPbBoard())).toEqual(["1:10:00"]);
  });

  it("falls back to the default board when the selected one no longer exists", () => {
    // The race behind the selected tab was just deleted from History --
    // the board must not render empty.
    const instance = app([race({ totalSeconds: 4200 })], { pbBoardKey: "pro|doubles|women|full" });
    const card = instance.renderPbBoard();

    expect(timesOf(card)).toEqual(["1:10:00"]);
  });

  it("distinguishes a Half board's tab from the Full one it would otherwise duplicate", () => {
    const card = app([
      race({ scale: "full", totalSeconds: 4200 }),
      race({ scale: "half", totalSeconds: 2100 }),
    ]).renderPbBoard();
    const labels = [...card.querySelectorAll(".hx-lb-tab")].map((tab) => tab.textContent.trim());

    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    expect(labels.some((l) => l.includes("hyrox.scale.half.title"))).toBe(true);
  });

  it("escapes the combo label instead of letting a stored record inject markup", () => {
    // Regression: renderPbBoard builds its tabs as template literals assigned
    // via innerHTML, and comboLabel() routes through RepCheckI18n.t(), which
    // substitutes vars with split/join and does NOT escape. A record whose
    // category is not one of the fixed ids (setCategory takes whatever
    // data-value it gets, and records also arrive via account sync) reaches
    // that interpolation verbatim. Verified live against the real English
    // dictionary before the fix: one injected <img> per poisoned field.
    const evil = '"><img src=x onerror=alert(1)>';
    // t() is stubbed to substitute the way the real one does, or this test
    // passes for the wrong reason (a stub that drops vars injects nothing).
    globalThis.RepCheckI18n.t = (key, vars) => {
      let out = key === "hyrox.finishLabel" ? "{gender} {category} {format}" : key;
      if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
      return out;
    };

    const card = app([
      race({ category: evil, totalSeconds: 4200 }),
      race({ category: "open", totalSeconds: 4300 }),
    ]).renderPbBoard();

    expect(card.querySelectorAll("img")).toHaveLength(0);
    // The label still shows the raw text, just as text rather than markup.
    expect(card.textContent).toContain("<img src=x");
  });

  it("escapes the board key before it lands in a double-quoted attribute", () => {
    // escapeHtml() alone does not escape the double quote, so the key -- which
    // is built from the same untrusted category/format/gender -- would break
    // out of data-key="..." and become new attributes.
    const evil = '" onmouseover="alert(1)';
    const card = app([
      race({ category: evil, totalSeconds: 4200 }),
      race({ category: "open", totalSeconds: 4300 }),
    ]).renderPbBoard();

    const tabs = [...card.querySelectorAll(".hx-lb-tab")];
    expect(tabs).toHaveLength(2);
    expect(tabs.some((tab) => tab.hasAttribute("onmouseover"))).toBe(false);
    // The key still round-trips intact, so selecting that tab still works.
    expect(tabs.some((tab) => tab.dataset.key.includes(evil))).toBe(true);
  });

  it("shows the sprinting mascot -- not an empty list -- when nothing is rankable yet", () => {
    const card = app([race({ category: "custom" })]).renderPbBoard();

    expect(rowsOf(card)).toHaveLength(0);
    const empty = card.querySelector(".mascot-empty");
    expect(empty).not.toBeNull();
    expect(empty.dataset.pose).toBe("sprint");
    expect(empty.textContent).toContain("hyrox.pb.boardEmptyTitle");
  });

  it("always returns a card, so the history screen never appends null", () => {
    expect(app([]).renderPbBoard().classList.contains("hx-card")).toBe(true);
  });
});

// The wiring between a tab tap and a re-rendered board, plus the screen that
// stacks the board on top of the History list. Live QA exercises both, but
// nothing pinned them: handleClick's dispatch line and renderHistory's two
// appendChild calls are exactly the kind of one-liner a later refactor drops
// without any test going red.
describe("setPbBoard", () => {
  it("stores the key and re-renders", () => {
    const instance = app([race({})]);
    let renders = 0;
    instance.render = () => { renders += 1; };

    instance.setPbBoard("open|singles|men|full");

    expect(instance.pbBoardKey).toBe("open|singles|men|full");
    expect(renders).toBe(1);
  });

  it("ignores a missing key instead of blanking the selection", () => {
    // A trigger rendered without data-key would otherwise wipe pbBoardKey to
    // undefined and silently bounce the user back to the default board.
    const instance = app([race({})], { pbBoardKey: "open|singles|men|full" });
    let renders = 0;
    instance.render = () => { renders += 1; };

    instance.setPbBoard(undefined);

    expect(instance.pbBoardKey).toBe("open|singles|men|full");
    expect(renders).toBe(0);
  });

  it("is what the click dispatcher routes a tab tap to", () => {
    const instance = app([race({})]);
    instance.render = () => {};
    const tab = document.createElement("button");
    tab.dataset.action = "set-pb-board";
    tab.dataset.key = "pro|doubles|women|half";
    document.body.appendChild(tab);

    instance.handleClick({ target: tab });

    expect(instance.pbBoardKey).toBe("pro|doubles|women|half");
    tab.remove();
  });
});

describe("renderHistory", () => {
  it("puts the board first and the full History list under it", () => {
    const screen = app([
      race({ totalSeconds: 4200 }),
      race({ category: "custom", format: null, gender: null, totalSeconds: 1420 }),
      race({ totalSeconds: 1800, flagged: true }),
    ]).renderHistory();

    const cards = [...screen.querySelectorAll(".hx-card")];
    expect(cards[0].querySelector(".hx-pb-lb-list")).not.toBeNull();
    // Every race is in History, including the two the board cannot rank --
    // that is the whole point of keeping the list unfiltered beneath it.
    expect(screen.querySelectorAll(".hx-history-row")).toHaveLength(3);
    expect(screen.querySelectorAll(".hx-pb-lb-row")).toHaveLength(1);
  });

  it("still renders the board card when no race is rankable", () => {
    // renderPbBoard() always returns a card (never null), so the history
    // screen must not need a null guard the way it did for the old list.
    const screen = app([race({ category: "custom", format: null, gender: null })]).renderHistory();

    expect(screen.querySelector(".mascot-empty")).not.toBeNull();
    expect(screen.querySelectorAll(".hx-history-row")).toHaveLength(1);
  });
});
