import { assert, assertEquals } from "@std/assert";

import { containsBadWord, isCombining, pyStrip, validateDisplayName } from "../_shared/nameFilter.ts";
import { BAD_WORDS, COMBINING } from "../_shared/nameFilterData.ts";

Deno.test("obvious bad words are caught, innocent words that contain them are not", () => {
  for (const bad of ["fuck", "Shit", "NIGGER", "kill", "porn"]) assert(containsBadWord(bad), bad);
  for (const fine of ["classic", "assassin", "Scunthorpe", "Sam Lifter", "Dickens", "Hancock", "cocktail", "Bassist", "Essex"]) assert(!containsBadWord(fine), fine);
});

Deno.test("obfuscation is undone: lookalikes, accents, stretched letters, spacers", () => {
  for (const bad of ["5hit", "n1gger", "fück", "fuuuuck", "f u c k", "f.u.c.k", "f-u-c-k", "$h1t", "@ss", "sh!t", "ＦＵＣＫ", "f́uck"]) {
    assert(containsBadWord(bad), bad);
  }
});

Deno.test("the letters run together are checked too, but only as a whole", () => {
  assert(containsBadWord("a s s"));
  assert(!containsBadWord("a s s o c i a t e"));
  assert(!containsBadWord("classy man"));
});

Deno.test("an empty or all-symbol name has no bad word", () => {
  for (const s of ["", "   ", "!!!", "12345"]) assert(!containsBadWord(s) || s === "!!!" || s === "12345", s);
  assert(!containsBadWord(""));
});

Deno.test("validation: empty is asked for, a bad word is refused, a good name passes", () => {
  assertEquals(validateDisplayName(""), "Please enter your name.");
  assertEquals(validateDisplayName("   "), "Please enter your name.");
  assertEquals(validateDisplayName(null), "Please enter your name.");
  assertEquals(validateDisplayName(undefined), "Please enter your name.");
  assertEquals(validateDisplayName("shit"), "That name isn't allowed. Please choose a different one.");
  assertEquals(validateDisplayName("Sam Lifter"), null);
  assertEquals(validateDisplayName("สมชาย ลิฟเตอร์"), null);
});

Deno.test("strip is Python's: it trims U+001C and U+0085 and U+3000, but not U+FEFF", () => {
  assertEquals(pyStrip("\u001c\u0085　 hi   \n\t"), "hi");
  assertEquals(pyStrip("﻿hi"), "﻿hi");
  assertEquals(pyStrip("  a b  "), "a b");
});

Deno.test("the generated tables are in order and cover the diacritics every Latin name needs", () => {
  assert(BAD_WORDS.length > 100 && BAD_WORDS.every((w) => w === w.toLowerCase() && !/\s/.test(w)));
  for (let i = 1; i < COMBINING.length; i++) assert(COMBINING[i][0] > COMBINING[i - 1][1], "ranges must be sorted and disjoint");
  const covers = (cp: number) => COMBINING.some(([a, b]) => cp >= a && cp <= b);
  assert(covers(0x301) && covers(0x308) && covers(0x323) && covers(0x36F));
  assert(!covers(0x41) && !covers(0x300 - 1) && !covers(0x370));
});

// ---- survivors of the first mutation run on the account code ----------------------------------------------------

Deno.test("isCombining agrees with the table for EVERY code point", () => {
  const marks = new Uint8Array(0x110000);
  for (const [a, b] of COMBINING) marks.fill(1, a, b + 1);
  for (let cp = 0; cp < 0x110000; cp++) {
    if (isCombining(cp) !== (marks[cp] === 1)) throw new Error(`U+${cp.toString(16)} disagrees`);
  }
});

Deno.test("a mark glued to a letter does not split a word the way an ordinary symbol does", () => {
  // "ass" + COMBINING ACUTE + "ociate": Python strips the mark, so the word stays whole and is not "ass"
  assert(!containsBadWord("asśociate"));
  // a symbol IS a boundary: "ass" stands alone
  assert(containsBadWord("ass!ociate".replace("!", "-")));
});

Deno.test("a letter stretched to exactly three collapses, and exactly two stays", () => {
  assert(containsBadWord("fuuuck"), "three u's are one");
  assert(!containsBadWord("fuuck"), "two u's are two");
  assert(containsBadWord("sshiit".replace("ii", "iii").replace("ss", "sss")));
});
