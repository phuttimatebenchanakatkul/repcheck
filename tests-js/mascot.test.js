// The shared empty-state mascot (static/mascot.js): the one block behind
// every "there's nothing here yet" screen -- the Hyrox leaderboard, both
// exercise pickers, the food search sheet, and challenges.
//
// The load-bearing test in here is the escaping one. What this replaced
// interpolated the raw search box into innerHTML, so a regression in
// emptyState()'s escaping is an XSS hole on four screens at once, not a
// cosmetic bug.
//
// Exercises the real static/mascot.js and static/i18n.js (see
// support/loadMascot.js).

import { describe, it, expect, beforeEach } from "vitest";
import { loadMascot, loadI18n, parse } from "./support/loadMascot.js";

let mascot;
beforeEach(() => { mascot = loadMascot(); });

describe("emptyState -- escaping the searched-for term", () => {
  // The regression guard. The call sites (nutrition.html, workouts.html)
  // hand emptyState() whatever was typed into a search box and assign the
  // result with innerHTML.
  it("escapes markup in the query instead of injecting it", () => {
    const html = mascot.emptyState({
      pose: "eat",
      title: 'Couldn\'t find "{query}"',
      query: '<img src=x onerror="alert(1)">',
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror=\"alert(1)\"");
    expect(html).toContain("&lt;img");
    expect(parse(html).querySelector("img")).toBeNull();
  });

  it("escapes &, quotes and apostrophes so the term can't break out of the span", () => {
    const html = mascot.emptyState({
      title: "{query}",
      query: `a & b " c ' d`,
    });

    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
    expect(html).toContain("&#39;");
    // ...and round-trips: the user still reads exactly what they typed.
    expect(parse(html).querySelector(".rc-empty-q").textContent).toBe(`a & b " c ' d`);
  });

  it("wraps the term in .rc-empty-q, replacing the literal {query} placeholder", () => {
    const el = parse(mascot.emptyState({
      title: 'Couldn\'t find "{query}"',
      query: "oats",
    }));

    const title = el.querySelector(".rc-empty-title");
    expect(title.querySelector(".rc-empty-q").textContent).toBe("oats");
    expect(title.textContent).toBe('Couldn\'t find "oats"');
  });

  it("substitutes an empty query rather than leaving {query} on screen", () => {
    const el = parse(mascot.emptyState({ title: "Couldn't find {query}", query: "" }));
    expect(el.querySelector(".rc-empty-title").textContent).toBe("Couldn't find ");
    expect(el.querySelector(".rc-empty-q").textContent).toBe("");
  });

  it("leaves a title with no placeholder untouched when a query is passed anyway", () => {
    const el = parse(mascot.emptyState({ title: "No times yet", query: "ignored" }));
    expect(el.querySelector(".rc-empty-title").textContent).toBe("No times yet");
    expect(el.querySelector(".rc-empty-q")).toBeNull();
  });

  // The three non-search screens (leaderboard, challenges) pass no query
  // at all; their titles must survive verbatim.
  it("skips substitution entirely when no query is given", () => {
    const html = mascot.emptyState({ title: "Literal {query} in copy" });
    expect(html).toContain("Literal {query} in copy");
    expect(html).not.toContain("rc-empty-q");
  });
});

describe("emptyState -- structure and optional parts", () => {
  it("renders the block: wrapper, art, title, sub", () => {
    const el = parse(mascot.emptyState({
      pose: "podium",
      title: "No attempts yet",
      sub: "Be the first to set a score.",
      label: "No attempts yet",
    }));

    expect(el.querySelector(".rc-empty")).not.toBeNull();
    expect(el.querySelector(".rc-empty svg.rc-empty-art")).not.toBeNull();
    expect(el.querySelector(".rc-empty-title").textContent).toBe("No attempts yet");
    expect(el.querySelector(".rc-empty-sub").textContent).toBe("Be the first to set a score.");
  });

  it("omits the sub div entirely when sub is missing or empty", () => {
    expect(mascot.emptyState({ pose: "eat", title: "Nothing" })).not.toContain("rc-empty-sub");
    expect(mascot.emptyState({ pose: "eat", title: "Nothing", sub: "" })).not.toContain("rc-empty-sub");
  });

  it("still renders a well-formed block for an unknown pose (no drawing, no crash)", () => {
    const el = parse(mascot.emptyState({ pose: "backflip", title: "No times yet" }));
    expect(el.querySelector(".rc-empty")).not.toBeNull();
    expect(el.querySelector("svg")).toBeNull();
    expect(el.querySelector(".rc-empty-title").textContent).toBe("No times yet");
  });

  it("survives being called with nothing at all", () => {
    const el = parse(mascot.emptyState());
    expect(el.querySelector(".rc-empty-title").textContent).toBe("");
    expect(el.querySelector("svg")).toBeNull();
  });
});

describe("art -- the drawing itself", () => {
  it("returns nothing for a pose that doesn't exist", () => {
    expect(mascot.art("backflip", "x")).toBe("");
    expect(mascot.art(undefined, "x")).toBe("");
  });

  it("exports exactly the four poses the app calls for", () => {
    expect([...mascot.poses].sort()).toEqual(["eat", "lift", "podium", "sprint"]);
  });

  it("draws every pose as an <svg> on the shared 190x150 viewBox", () => {
    mascot.poses.forEach((pose) => {
      const svg = parse(mascot.art(pose)).querySelector("svg");
      expect(svg, pose).not.toBeNull();
      expect(svg.getAttribute("viewBox"), pose).toBe("0 0 190 150");
      expect(svg.getAttribute("aria-hidden"), pose).toBe("true");
      expect(svg.innerHTML.length, pose).toBeGreaterThan(0);
    });
  });

  // A hex would be right on one theme and wrong on the other -- the whole
  // reason --rc-mascot-body/-detail exist (see style.css).
  it("paints every pose through CSS variables, never a hardcoded hex", () => {
    mascot.poses.forEach((pose) => {
      const markup = mascot.art(pose, pose);
      expect(markup.match(/#[0-9a-fA-F]{3,8}(?![\w-])/g), pose).toBeNull();
      const paints = markup.match(/(?:fill|stroke)="([^"]*)"/g) || [];
      paints.forEach((p) => {
        expect(p, `${pose}: ${p}`).toMatch(/(?:fill|stroke)="(?:var\(--[a-z-]+\)|none)"/);
      });
    });
  });

  // art() used to take a `label` and set role="img" + aria-label. Every
  // call site ended up passing text that was already rendered right below
  // the drawing, so screen readers read the same sentence twice. It is
  // decorative now, and takes no second argument -- an extra one is ignored
  // rather than leaking into the markup.
  it("ignores a stray second argument now that it takes no label", () => {
    const markup = mascot.art("eat", 'No foods match "<b>x</b>"');
    expect(markup).not.toContain("aria-label");
    expect(markup).not.toContain("<b>");
    expect(parse(markup).querySelector("svg").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("nextId -- one clipPath id per drawing", () => {
  // Both exercise pickers can have a lift mascot in the DOM at once, and
  // clip-path="url(#id)" resolves to the FIRST match in the document -- a
  // fixed id meant the second mascot silently borrowed the first's clip.
  it("gives two lift drawings different clipPath ids", () => {
    const first = parse(mascot.art("lift", "a"));
    const second = parse(mascot.art("lift", "b"));

    const idA = first.querySelector("clipPath").getAttribute("id");
    const idB = second.querySelector("clipPath").getAttribute("id");
    expect(idA).not.toBe(idB);
  });

  it("points each drawing's clip-path at its own defs", () => {
    [mascot.art("lift", "a"), mascot.art("lift", "b")].forEach((html) => {
      const el = parse(html);
      const id = el.querySelector("clipPath").getAttribute("id");
      const clipped = el.querySelector("[clip-path]");
      expect(clipped.getAttribute("clip-path")).toBe(`url(#${id})`);
    });
  });
});

describe("i18n -- the new empty-state copy", () => {
  // A key missing from `th` falls back to the English string silently, so
  // the only way a gap shows up is a Thai screen rendering English.
  const KEYS = [
    "hyrox.leaderboard.emptyTitle",
    "hyrox.leaderboard.emptySub",
    "nutrition.noMatchTitle",
    "nutrition.noMatchSub",
    "workouts.search.noMatchTitle",
    "workouts.search.noMatchSub",
    "challenges.emptyTitle",
    "challenges.emptySub",
  ];

  it("defines every new key in both en and th", () => {
    const { tIn } = loadI18n();
    KEYS.forEach((key) => {
      const en = tIn("en", key);
      const th = tIn("th", key);
      expect(en, key).not.toBe(key); // not falling through to the raw key
      expect(th, key).not.toBe(key);
      expect(th, `${key} looks untranslated`).not.toBe(en);
    });
  });

  it("keeps the literal {query} placeholder in both languages, for emptyState to fill", () => {
    const { tIn } = loadI18n();
    ["nutrition.noMatchTitle", "workouts.search.noMatchTitle"].forEach((key) => {
      expect(tIn("en", key), key).toContain("{query}");
      expect(tIn("th", key), key).toContain("{query}");
    });
  });

  it("renders the real Thai search-miss copy through emptyState with the term escaped", () => {
    const { tIn } = loadI18n();
    const el = parse(mascot.emptyState({
      pose: "eat",
      title: tIn("th", "nutrition.noMatchTitle"),
      sub: tIn("th", "nutrition.noMatchSub"),
      query: "<script>",
    }));

    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector(".rc-empty-q").textContent).toBe("<script>");
    expect(el.querySelector(".rc-empty-title").textContent).not.toContain("{query}");
  });
});

describe("emptyState -- the query is data, never a replacement pattern", () => {
  // String.replace() scans its replacement for $&, $`, $' and $$. The
  // replacement here is built from escapeHtml output, which contains a
  // literal & -- so a typed "$" landing just before one turned into a
  // substitution and echoed the surrounding sentence back at the user.
  // Verified failing before the split/join fix: query "$&" rendered
  // {query}amp;, and "$`" rendered the whole headline prefix.
  it("renders dollar sequences literally instead of expanding them", () => {
    ["$&", "$`", "$'", "$$", "100$'s", "$&$`"].forEach((q) => {
      const el = parse(mascot.emptyState({
        pose: "eat",
        title: 'Couldn\'t find "{query}"',
        query: q,
      }));
      expect(el.querySelector(".rc-empty-q").textContent, q).toBe(q);
      expect(el.querySelector(".rc-empty-title").textContent, q).not.toContain("{query}");
    });
  });

  // i18n's t() substitutes every occurrence; emptyState has to agree, or a
  // translation that restates the term renders a bare {query} on screen.
  it("substitutes every {query} in a title, not just the first", () => {
    const el = parse(mascot.emptyState({
      pose: "eat",
      title: '"{query}"? No {query} here.',
      query: "tofu",
    }));
    expect(el.querySelectorAll(".rc-empty-q").length).toBe(2);
    expect(el.querySelector(".rc-empty-title").textContent).not.toContain("{query}");
  });
});

describe("art -- the drawing is decorative", () => {
  // The headline and sub always render beside it and carry the message, so
  // an accessible name here just makes a screen reader say it twice.
  it("hides the svg from assistive tech rather than naming it", () => {
    const el = parse(mascot.art("sprint"));
    const svg = el.querySelector("svg");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
  });
});

describe("emptyState -- announced when it appears", () => {
  // These blocks get injected into an already-open sheet on a keystroke,
  // and the drawing is aria-hidden. Without a live region nothing tells a
  // screen-reader user the search missed.
  it("marks the block as a polite live region", () => {
    const el = parse(mascot.emptyState({ pose: "eat", title: "Nothing", sub: "Try again" }));
    expect(el.querySelector(".rc-empty").getAttribute("role")).toBe("status");
  });
});
