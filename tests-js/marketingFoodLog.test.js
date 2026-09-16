// The pre-launch site's feature 02 is a working food log, not a screen
// recording: a visitor searches marketing/app.js's copy of the food library,
// sets an amount in servings/grams/ounces, and adds it to the day.
//
// It is a demo, but the arithmetic is the app's own, and that is the whole
// point -- a landing page that quotes wrong calories for jasmine rice is
// worse than one that shows a video. These tests pin it to food_library.py's
// per-100g values and to templates/nutrition.html's behaviour:
//   * a dish's "1 serving" is its recipe's total grams; a raw ingredient has
//     no inherent serving and falls back to the 100g its macros are anchored
//     to                                              (openLogAmountModal)
//   * switching units CONVERTS the amount rather than resetting it, so
//     "1 serving" of pad thai becomes "360 g", not "1 g"  (lq-unit-seg)
//   * the ring plots the macro split by calories (4/9/4), not by grams
//                                                        (donutChartHtml)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMarketingFoodLog } from "./support/loadMarketingFoodLog.js";

let page;

beforeEach(() => {
  page = loadMarketingFoodLog();
  page.showFoodLog();
});

describe("the day, before anything is logged", () => {
  it("opens on an empty day against the same goal the check-in screen shows", () => {
    expect(page.text("#nl-left")).toBe("1,802");
    expect(page.text("#nl-eaten")).toBe("0 of 1,802");
    expect(page.text("#nl-mac-p")).toBe("0 / 135g");
    expect(page.entries()).toEqual([]);
  });

  it("leaves the ring empty with a butt cap, so 0 kcal does not paint a dot", () => {
    // A round cap on a zero-length dash still renders a dot at 12 o'clock,
    // which reads as "something is already logged" on an untouched day.
    const fill = page.$("#nl-ring-fill");
    expect(fill.getAttribute("stroke-dasharray")).toMatch(/^0 /);
    expect(fill.style.strokeLinecap).toBe("butt");
  });
});

describe("searching the library", () => {
  it("filters on the food's name", () => {
    page.openSearch();
    expect(page.search("rice")).toEqual(["Jasmine Rice, cooked"]);
    expect(page.search("tom yum")).toEqual(["Tom Yum Soup, Shrimp"]);
  });

  it("says so rather than showing an empty sheet when nothing matches", () => {
    page.openSearch();
    page.search("zzzz");
    expect(page.text(".nl-none")).toContain("No match");
  });

  it("takes the top match on Enter, the way the app's search does", () => {
    page.openSearch();
    page.search("almond");
    page.pressEnterInSearch();
    expect(page.text("#nl-food-name")).toBe("Almonds");
    expect(page.sheetOpen()).toBe("amount");
  });
});

describe("the amount editor", () => {
  it("anchors a dish's serving to its recipe total and a raw ingredient's to 100g", () => {
    page.openSearch();
    page.search("pad thai");
    page.pickFirstResult();
    expect(page.text("#nl-serving-hint")).toBe("1 serving = 360g");
    // 126 kcal per 100g * 360g
    expect(page.text("#nl-donut-kcal")).toBe("454");

    page.openSearch();
    page.search("jasmine");
    page.pickFirstResult();
    expect(page.text("#nl-serving-hint")).toBe("1 serving = 100g");
    expect(page.text("#nl-donut-kcal")).toBe("129");
  });

  it("converts the amount when the unit changes instead of resetting it", () => {
    page.openSearch();
    page.search("pad thai");
    page.pickFirstResult();

    page.setUnit("g");
    expect(page.amountValue()).toBe("360");
    expect(page.text("#nl-donut-kcal")).toBe("454");

    page.setUnit("oz");
    expect(Number(page.amountValue())).toBeCloseTo(12.7, 1);
    expect(page.text("#nl-donut-kcal")).toBe("454");

    page.setUnit("serving");
    expect(Number(page.amountValue())).toBeCloseTo(1, 2);
  });

  it("splits the ring by calories, not by grams", () => {
    page.openSearch();
    page.search("avocado");
    page.pickFirstResult();
    // 100g of avocado: 2g protein, 15g fat, 8.5g carbs -> 8 / 135 / 34 kcal.
    // By grams, fat would be 59% of the ring; by calories it is 76%.
    expect(page.text("#nl-pct-f")).toBe("76%");
    expect(page.text("#nl-g-f")).toBe("15g");
    expect(page.text("#nl-pct-p")).toBe("5%");
  });

  it("scales every macro with the amount", () => {
    page.openSearch();
    page.search("chicken breast");
    page.pickFirstResult();
    page.setUnit("g");
    page.setAmount(180);
    // 165 kcal / 31g protein per 100g
    expect(page.text("#nl-donut-kcal")).toBe("297");
    expect(page.text("#nl-g-p")).toBe("56g");
  });

  it("treats a cleared or nonsense amount as zero rather than NaN", () => {
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setAmount("");
    expect(page.text("#nl-donut-kcal")).toBe("0");
    expect(page.text("#nl-pct-p")).toBe("0%");
  });

  it("caps an absurd amount instead of showing a number the ring can't draw", () => {
    // Uncapped, this used to read as a multi-billion-kcal figure while the
    // ring and macro bars stayed correctly clamped at a full circle / 100%
    // -- the number and the picture visibly disagreeing.
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setUnit("g");
    page.setAmount(999999999);

    // 89 kcal/100g * 20000g cap
    expect(page.text("#nl-donut-kcal")).toBe("17800");
    expect(page.amountValue()).toBe("20000");
  });
});

describe("adding to the day", () => {
  function logPadThai() {
    page.openSearch();
    page.search("pad thai");
    page.pickFirstResult();
    page.setUnit("g");
    page.setAmount(180);
    page.add();
  }

  it("closes the sheet, lists the entry and moves the ring and the bars", () => {
    logPadThai();

    expect(page.sheetOpen()).toBe(null);
    expect(page.entries()).toEqual([
      { name: "Pad Thai", detail: "180 g · 17P / 7F / 25C", calories: "227" },
    ]);
    expect(page.text("#nl-left")).toBe("1,575");
    expect(page.text("#nl-eaten")).toBe("227 of 1,802");
    expect(page.text("#nl-count")).toBe("1 food · 227 kcal");
    expect(page.text("#nl-mac-p")).toBe("17 / 135g");
    expect(page.$("#nl-bar-p").style.width).toBe("12.4%");
    expect(page.$("#nl-ring-fill").style.strokeLinecap).toBe("round");
  });

  it("records a serving as a serving, with the grams it worked out to", () => {
    page.openSearch();
    page.search("pad thai");
    page.pickFirstResult();
    page.add();
    expect(page.entries()[0].detail).toBe("1 serving · 360 g · 33P / 14F / 50C");
  });

  it("says what went in", () => {
    logPadThai();
    expect(page.text("#nl-toast")).toBe("Pad Thai added · 227 kcal");
    expect(page.$("#nl-toast").classList.contains("is-on")).toBe(true);
  });

  it("turns the ring over when the day goes past the goal", () => {
    page.openSearch();
    page.search("almond");
    page.pickFirstResult();
    page.setAmount(4); // 4 * 579 kcal
    page.add();

    expect(page.text(".nl-ring-center .ring-label")).toBe("KCAL OVER");
    expect(page.text("#nl-left")).toBe("514");
    expect(page.$("#nl-ring-fill").classList.contains("is-over")).toBe(true);
    // The bars stop at full rather than overflowing their track.
    expect(page.$("#nl-bar-f").style.width).toBe("100%");
  });

  it("takes an entry back out again", () => {
    logPadThai();
    page.removeEntry(0);
    expect(page.entries()).toEqual([]);
    expect(page.text("#nl-left")).toBe("1,802");
    expect(page.text("#nl-count")).toBe("Nothing logged");
    expect(page.$("#nl-ring-fill").style.strokeLinecap).toBe("butt");
  });
});

describe("a day with more than one food in it", () => {
  function log(name) {
    page.openSearch();
    page.search(name);
    page.pickFirstResult();
    page.add();
  }

  it("sums the day and pluralises the count", () => {
    log("banana");
    log("almond");

    expect(page.entries().map((e) => e.name)).toEqual(["Banana", "Almonds"]);
    // 89 + 579 per 100g serving
    expect(page.text("#nl-count")).toBe("2 foods · 668 kcal");
    expect(page.text("#nl-eaten")).toBe("668 of 1,802");
  });

  it("removes the row you asked for, not the one that used to be there", () => {
    // The remove buttons carry an index into the log, so a stale index after
    // a re-render takes out the wrong food.
    log("banana");
    log("almond");
    page.removeEntry(0);

    expect(page.entries().map((e) => e.name)).toEqual(["Almonds"]);
    expect(page.text("#nl-count")).toBe("1 food · 579 kcal");
  });

  it("opens the next search clean instead of on the last thing you logged", () => {
    // Capture the unfiltered count on a fresh page rather than hard-coding
    // the library size here -- that number is someone else's edit to make,
    // and the pytest guard covers it against food_library.py already.
    const unfiltered = loadMarketingFoodLog();
    unfiltered.showFoodLog();
    unfiltered.openSearch();
    const fullCount = unfiltered.search("").length;

    log("banana");
    page.openSearch();

    expect(page.queryValue()).toBe("");
    expect(page.search("").length).toBe(fullCount);
  });

  it("counts servings in the plural too", () => {
    page.openSearch();
    page.search("pad thai");
    page.pickFirstResult();
    page.setAmount(2);
    page.add();

    expect(page.entries()[0].detail).toBe("2 servings · 720 g · 67P / 28F / 99C");
  });
});

describe("getting out of a sheet", () => {
  it("closes on the ×, on Escape, and steps back from the amount to the search", () => {
    page.openSearch();
    page.close();
    expect(page.sheetOpen()).toBe(null);

    page.openSearch();
    page.pressEscape();
    expect(page.sheetOpen()).toBe(null);

    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    expect(page.sheetOpen()).toBe("amount");
    page.back();
    expect(page.sheetOpen()).toBe("search");
  });

  it("releases the hover hold once the sheet is gone", () => {
    const isFoodLogShowing = () =>
      document.querySelector('.screen[data-screen="1"]').classList.contains("is-active");

    page.openSearch();
    page.pressEscape();
    document.querySelector('.feature[data-feature="3"]').dispatchEvent(new MouseEvent("mouseenter"));

    expect(isFoodLogShowing()).toBe(false);
  });
});

describe("the keyboard", () => {
  // This screen used to call .focus() to keep the keyboard on the open sheet.
  // The walkthrough opens those same sheets on a loop, so on the live site
  // document.activeElement travelled BODY -> BUTTON.cta-blue -> INPUT.nl-input
  // while the reader was doing nothing but scrolling: focus somewhere nobody
  // put it, and -- because a focused text input changes what Page Down, Home
  // and End do, and the canvas host's own page-key handler stands down as
  // soon as anything is focused -- the page keys taken away with it.
  //
  // So: the caret is a class, and the mock controls are out of the tab order.
  it("draws the caret on the field the open sheet is asking about", () => {
    page.openSearch();
    expect(page.$("#nl-query").classList.contains("is-faux-focus")).toBe(true);

    page.search("banana");
    page.pickFirstResult();
    expect(page.$("#nl-query").classList.contains("is-faux-focus")).toBe(false);
    expect(page.$("#nl-amount").classList.contains("is-faux-focus")).toBe(true);
  });

  it("clears the caret when every sheet is closed", () => {
    page.openSearch();
    page.close();
    expect(page.screen.querySelectorAll(".is-faux-focus")).toHaveLength(0);

    page.openSearch();
    page.pressEscape();
    expect(page.screen.querySelectorAll(".is-faux-focus")).toHaveLength(0);

    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.add();
    expect(page.screen.querySelectorAll(".is-faux-focus")).toHaveLength(0);
  });

  it("leaves focus exactly where the reader left it, through the whole flow", () => {
    // The regression this file exists to stop coming back. Park focus on a
    // real page control -- the waitlist field is the one a reader actually
    // has -- and walk the food log end to end without it budging.
    const outside = document.createElement("input");
    outside.type = "email";
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setUnit("g");
    page.setAmount("");
    page.add(); // the rejected-amount path, which also used to focus
    page.setAmount(120);
    page.add();
    page.close();
    page.removeEntry(0);

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("drops focus a click left inside a sheet, rather than stranding it on nothing", () => {
    // tabindex="-1" keeps these out of the TAB order; it does not stop a mouse
    // click focusing a text field. Close that sheet and it goes
    // visibility:hidden with focus still inside it, which is focus on nothing.
    // The other half of the pair -- focus OUTSIDE the sheets is never touched
    // -- is the test above; this is the branch that acts.
    page.openSearch();
    page.$("#nl-query").focus();           // what a click does
    expect(document.activeElement.id).toBe("nl-query");

    page.close();
    expect(document.activeElement).toBe(document.body);

    // Same through the amount sheet, which closes via Add rather than the ×.
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.$("#nl-amount").focus();
    page.add();
    expect(document.activeElement).toBe(document.body);

    // And via Escape.
    page.openSearch();
    page.$("#nl-query").focus();
    page.pressEscape();
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps every mock control out of the tab order", () => {
    // A drawing of the app, not a form the page is offering: a reader tabbing
    // the page should reach the nav, the waitlist and the footer, not nine
    // fake app controls in between. tabindex="-1" leaves them clickable and
    // programmatically focusable, which is all the demo needs.
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.add();

    const focusable = Array.from(
      page.screen.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")
    );
    expect(focusable.length).toBeGreaterThan(8);

    const inOrder = focusable
      .filter((el) => el.getAttribute("tabindex") !== "-1")
      .map((el) => el.id || el.className || el.tagName);
    expect(inOrder).toEqual([]);
  });

  it("announces which unit is selected, from the first paint", () => {
    // The segment is a colour change otherwise -- the same hole the feature
    // switcher's aria-pressed pass closed next door.
    expect(page.unitsPressed()).toEqual(["true", "false", "false"]);

    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setUnit("g");

    expect(page.unitsPressed()).toEqual(["false", "true", "false"]);
    expect(page.unitsPressed().filter((v) => v === "true").length).toBe(1);
  });
});

describe("the ring geometry itself", () => {
  it("draws the split it reports, and no dot for a macro that is not there", () => {
    page.openSearch();
    page.search("chicken breast");
    page.pickFirstResult();

    const circumference = 2 * Math.PI * 46;
    const len = (key) => parseFloat(page.seg(key).getAttribute("stroke-dasharray"));
    const offset = (key) => parseFloat(page.seg(key).getAttribute("stroke-dashoffset"));

    // Chicken breast has no carbs at all: a round cap on a zero-length dash
    // would paint a dot claiming otherwise.
    expect(len("c")).toBe(0);
    expect(page.seg("c").style.strokeLinecap).toBe("butt");
    expect(len("p") + len("f")).toBeCloseTo(circumference, 6);
    // Each segment starts where the previous one ended.
    expect(offset("p")).toBe(0);
    expect(offset("f")).toBeCloseTo(-len("p"), 6);
  });

  it("fills the ring at most once, and comes back under the goal", () => {
    // Over-goal is a latch shape: the class and the label have to come back
    // off, and the arc must not run past a full circle.
    const circumference = 2 * Math.PI * 52;
    page.openSearch();
    page.search("almond");
    page.pickFirstResult();
    page.setAmount(4);
    page.add();

    expect(parseFloat(page.$("#nl-ring-fill").getAttribute("stroke-dasharray"))).toBeCloseTo(circumference, 6);

    page.removeEntry(0);
    expect(page.text(".nl-ring-center .ring-label")).toBe("KCAL LEFT");
    expect(page.$("#nl-ring-fill").classList.contains("is-over")).toBe(false);
  });
});

describe("refusing to log nothing", () => {
  it("leaves the day alone when the amount is empty", () => {
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setAmount("");
    page.add();

    expect(page.entries()).toEqual([]);
    expect(page.sheetOpen()).toBe("amount");
    expect(page.text("#nl-toast")).toBe("");
  });

  it("nudges the amount card and marks the field, rather than doing nothing visible", () => {
    // A bare `return` on a bad amount used to look exactly like a broken
    // button: no toast, no shake, nothing. Tapping Add now points at what
    // needs fixing -- with the caret class, not with .focus(), because the
    // walkthrough takes this path too.
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setAmount("");
    page.add();

    expect(page.$(".nl-amount").classList.contains("is-nudging")).toBe(true);
    expect(page.$("#nl-amount").classList.contains("is-faux-focus")).toBe(true);
  });

  it("treats a negative amount as nothing", () => {
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.setAmount(-5);

    expect(page.text("#nl-donut-kcal")).toBe("0");
    page.add();
    expect(page.entries()).toEqual([]);
  });

  it("does nothing on Enter when nothing matched", () => {
    page.openSearch();
    page.search("zzzz");
    page.pressEnterInSearch();

    expect(page.sheetOpen()).toBe("search");
    expect(page.entries()).toEqual([]);
  });

  it("ignores Escape when no sheet is open", () => {
    expect(page.sheetOpen()).toBe(null);
    expect(() => page.pressEscape()).not.toThrow();
    expect(page.sheetOpen()).toBe(null);
  });
});

describe("timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drops the toast on its own after a few seconds", () => {
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.add();

    expect(page.$("#nl-toast").classList.contains("is-on")).toBe(true);
    vi.advanceTimersByTime(2300);
    expect(page.$("#nl-toast").classList.contains("is-on")).toBe(false);
  });
});

describe("a name nlEsc() actually has to escape", () => {
  it("carries an apostrophe through search, the amount sheet and the log unmangled", () => {
    page.openSearch();
    expect(page.search("general tso")).toEqual(["General Tso's Chicken"]);

    page.pickFirstResult();
    expect(page.text("#nl-food-name")).toBe("General Tso's Chicken");

    page.add();
    expect(page.entries()[0].name).toBe("General Tso's Chicken");

    page.removeEntry(0);
    expect(page.entries()).toEqual([]);
  });
});

describe("the feature switcher", () => {
  it("holds the food log against a stray hover while a sheet is open", () => {
    // Hovering the feature list is how you browse the six screens, but it
    // must not swap the screen out from under a visitor mid-interaction --
    // a cursor crossing the list on the way to the handset is not a request.
    const other = document.querySelector('.feature[data-feature="3"]');
    const isFoodLogShowing = () =>
      document.querySelector('.screen[data-screen="1"]').classList.contains("is-active");

    page.openSearch();
    other.dispatchEvent(new MouseEvent("mouseenter"));
    expect(isFoodLogShowing()).toBe(true);
    expect(page.sheetOpen()).toBe("search");

    // A click is deliberate, so it still switches -- and takes the sheet
    // with it, so the hold cannot outlive the interaction that earned it.
    other.click();
    expect(isFoodLogShowing()).toBe(false);
    expect(page.sheetOpen()).toBe(null);

    // Back to plain browsing: hover moves through the screens as before.
    document.querySelector('.feature[data-feature="1"]').dispatchEvent(new MouseEvent("mouseenter"));
    expect(isFoodLogShowing()).toBe(true);
    document.querySelector('.feature[data-feature="5"]').dispatchEvent(new MouseEvent("mouseenter"));
    expect(isFoodLogShowing()).toBe(false);
  });

  it("keeps the day's log across a switch, so nothing the visitor added is lost", () => {
    page.openSearch();
    page.search("banana");
    page.pickFirstResult();
    page.add();

    document.querySelector('.feature[data-feature="3"]').click();
    document.querySelector('.feature[data-feature="1"]').click();
    expect(page.entries()).toHaveLength(1);
    expect(page.text("#nl-eaten")).toBe("89 of 1,802");
  });
});

describe("the walkthrough that drives this screen", () => {
  // The regression that put the focus rules in this file came from the LOOP,
  // not from a visitor: nlDemoPlay opens and closes the same sheets on a
  // nine-second cycle, and it used to focus them. Testing the functions it
  // calls is not the same as testing the loop, so drive the real thing.
  let looping;

  beforeEach(() => {
    // Fake timers FIRST, then mount: the outer beforeEach already started a
    // walkthrough on real timers, and those callbacks never fire once the
    // clock is swapped. Re-mounting under the fake clock is what puts the
    // loop's own setTimeouts where advanceTimersByTime can reach them.
    vi.useFakeTimers();
    looping = loadMarketingFoodLog();
    looping.showFoodLog();
  });
  afterEach(() => vi.useRealTimers());

  it("walks the whole flow without ever moving focus", () => {
    page = looping;
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();

    const caretAt = () => {
      const el = page.screen.querySelector(".is-faux-focus");
      return el ? el.id : null;
    };
    const seen = [];
    let everLogged = 0;
    const note = () => {
      const state = page.sheetOpen() + "/" + caretAt();
      if (seen[seen.length - 1] !== state) seen.push(state);
      everLogged = Math.max(everLogged, page.entries().length);
      expect(document.activeElement).toBe(outside);
    };

    // showFoodLog() in the outer beforeEach already started the loop.
    note();
    for (let t = 0; t < 10000; t += 100) {
      vi.advanceTimersByTime(100);
      note();
    }

    // The loop really ran: search sheet with the caret on the query, then the
    // amount sheet with it on the amount, then a logged day with neither.
    expect(seen).toContain("search/nl-query");
    expect(seen).toContain("amount/nl-amount");
    expect(seen).toContain("null/null");
    // Checked across the walk, not at the end: the cycle empties the day again
    // at 9.2s so the reader always joins it on an empty ring.
    expect(everLogged).toBeGreaterThan(0);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

describe("a reader who asked for reduced motion", () => {
  // The branch nothing else in tests-js reaches: no typing, no loop, just the
  // finished day held. It still runs nlPick -> nlOpen("amount") -> nlAdd ->
  // nlClose, so it is a path where a stray caret class could be left behind on
  // a sheet that is now visibility:hidden.
  let still;

  beforeEach(() => {
    still = loadMarketingFoodLog({ reducedMotion: true });
    still.showFoodLog();
  });

  it("holds the finished day, with no sheet, no caret and no focus taken", () => {
    expect(still.entries()).toHaveLength(1);
    expect(still.text("#nl-left")).not.toBe("1,802");
    expect(still.sheetOpen()).toBe(null);
    expect(still.screen.querySelectorAll(".is-faux-focus")).toHaveLength(0);
    expect(document.activeElement).toBe(document.body);
  });

  it("does not log the same food again every time the screen is reached", () => {
    document.querySelector('.feature[data-feature="3"]').click();
    still.showFoodLog();
    document.querySelector('.feature[data-feature="3"]').click();
    still.showFoodLog();

    expect(still.entries()).toHaveLength(1);
  });
});
