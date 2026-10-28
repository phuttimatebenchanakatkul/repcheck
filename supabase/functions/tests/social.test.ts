import { assert, assertEquals } from "@std/assert";

import type { Params, Row } from "../_shared/db.ts";
import * as social from "../_shared/social.ts";
import { cleanText, lock, overLimitMessage } from "../_shared/rows.ts";
import { intParam } from "../api/routes/social.ts";
import { app, bearer, FakeDb, USER } from "./support.ts";

const OTHER = "11111111-2222-4333-8444-555555555555";
const THIRD = "99999999-8888-4777-8666-555555555555";
const tx = (db: FakeDb) => db.transaction((t) => Promise.resolve(t));
const profile = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: null, deleted_at: null, created_at: new Date("2020-01-01") };

/** A script that answers by what the SQL is about; anything not listed answers nothing. */
type Answer = Row[] | number | Error | ((params: Params) => Row[] | number);
function script(answers: Record<string, Answer>) {
  return (sql: string, params: Params): Row[] | number | Error => {
    for (const [needle, answer] of Object.entries(answers)) {
      if (sql.includes(needle)) return typeof answer === "function" ? answer(params) : answer;
    }
    return [];
  };
}

Deno.test("the ceilings, vocabularies and floors are the website's", () => {
  assertEquals([social.FRIEND_CODE_GUESS_LIMIT, social.FRIEND_CODE_GUESS_WINDOW, social.MAX_FRIEND_CODE_CHARS], [30, 3600, 32]);
  assertEquals([social.CHALLENGE_LIMIT, social.HYROX_RESULT_LIMIT, social.CHALLENGE_SECONDS], [200, 500, 25]);
  assertEquals(social.REPORT_REASONS, ["offensive_name", "impersonation", "spam", "other"]);
  assertEquals(social.AI_REPORT_FEATURES, ["coach", "workout_chat", "analyze_chat"]);
  assertEquals(social.AI_REPORT_REASONS, ["harmful", "inaccurate", "offensive", "other"]);
  assertEquals([social.MAX_AI_REPORT_TEXT, social.MAX_OPEN_AI_REPORTS_PER_USER], [4000, 20]);
  assertEquals(social.HYROX_MIN_PLAUSIBLE_SECONDS, { "men|singles": 3000, "women|singles": 3180, "men|doubles": 2820, "women|doubles": 3060 });
  assertEquals([social.HYROX_MAX_SECONDS, social.HYROX_LEADERBOARD_ROWS], [86400, 50]);
  assertEquals(social.CHALLENGE_ORDER, ["pushups", "situps", "pullups"]);
  assertEquals(social.CHALLENGE_EXERCISES, { pushups: "Push-ups", situps: "Sit-ups", pullups: "Pull-ups" });
});

Deno.test("a user id is a uuid in canonical form, or nothing", () => {
  const canon = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
  for (const good of [canon, canon.toUpperCase(), ` ${canon} `, `{${canon}}`, `urn:uuid:${canon}`, canon.replaceAll("-", ""), "7c9e66797425-40de944b-e07fc1f90ae7"]) assertEquals(social.parseUserId(good), canon, good);
  for (const bad of [null, undefined, 5, [], {}, true, "", "abc", canon.slice(1), canon + "0", "g" + canon.slice(1), "7c9e6679-7425-40de-944b-e07fc1f90ae7-extra", "7c9e6679 7425 40de 944b e07fc1f90ae7"]) {
    assertEquals(social.parseUserId(bad), null, String(bad));
  }
});

Deno.test("a code is trimmed and upper-cased; something that cannot be a code is refused cleanly", () => {
  assertEquals(social.cleanCode("  rc-ab12cd "), "RC-AB12CD");
  for (const bad of [5, [], {}, true, "", "   ", null, undefined]) {
    try {
      social.cleanCode(bad);
      throw new Error("accepted " + String(bad));
    } catch (e) {
      assert(e instanceof social.Rejected, String(bad));
      assertEquals([e.message, e.status], ["Enter a friend code.", 400]);
    }
  }
});

Deno.test("the offset is clamped to real timezones and a bad one means UTC", () => {
  for (const [raw, expected] of [["420", 420], ["+420", 420], [" -300 ", -300], ["900", 840], ["-900", -840], ["840", 840], ["841", 840], ["-840", -840], ["-841", -840], ["0", 0], ["x", 0], ["", 0], ["4.5", 0], [null, 0], [undefined, 0], [420, 420], [5.5, 0], ["1e3", 0], ["٤٢٠", 0]] as [unknown, number][]) {
    assertEquals(social.offsetMinutes(raw), expected, String(raw));
  }
});

Deno.test("the rotation: pushups on the epoch, then sit-ups, pull-ups, around, and the same for days before it", () => {
  const at = (iso: string) => social.todaysExercise(undefined, new Date(iso + "T12:00:00Z"));
  assertEquals([at("2026-01-01"), at("2026-01-02"), at("2026-01-03"), at("2026-01-04"), at("2026-01-05")], ["pushups", "situps", "pullups", "pushups", "situps"]);
  assertEquals([at("2025-12-31"), at("2025-12-30"), at("2025-12-29")], ["pullups", "situps", "pushups"]);
  assertEquals(social.todaysExercise(["a", "b"], new Date("2026-01-02T00:00:00Z")), "b");
  const five = ["a", "b", "c", "d", "e"];
  assertEquals([0, 1, 2, 3, 4, 5, 6, 9].map((n) => social.todaysExercise(five, new Date(Date.UTC(2026, 0, 1 + n)))), ["a", "b", "c", "d", "e", "a", "b", "e"]);
  assertEquals(social.todaysExercise(five, new Date(Date.UTC(2025, 11, 31))), "e");
  assertEquals(at("2026-12-31"), social.CHALLENGE_ORDER[(364) % 3]);
  assertEquals(social.todaysExercise(undefined, new Date("2026-01-01T23:59:59.999Z")), "pushups", "by UTC date, not by 24 hours");
  assertEquals(social.todaysExercise(undefined, new Date("2026-01-02T00:00:00.000Z")), "situps");
});

Deno.test("a HYROX result is cleaned to four values, judged for its time before its combination", () => {
  assertEquals(social.cleanHyroxResult({ gender: " men ", category: "open", format: "singles", total_seconds: 3600.5 }), ["men", "open", "singles", 3600.5]);
  assertEquals(social.cleanHyroxResult({ gender: "women", category: "pro", format: "doubles", total_seconds: " 3100 " })[3], 3100);
  assertEquals(social.cleanHyroxResult({ gender: "men", category: "open", format: "singles", total_seconds: "1e4" })[3], 10000);
  assertEquals(social.cleanHyroxResult({ gender: "men", category: "open", format: "singles", total_seconds: "3_600.5" })[3], 3600.5, "Python groups digits with underscores");
  assertEquals(social.cleanHyroxResult({ gender: "men", category: "open", format: "singles", total_seconds: ".5e4" })[3], 5000);
  assertEquals(social.cleanHyroxResult({ gender: "men", category: "open", format: "singles", total_seconds: "3600." })[3], 3600);
  const refused = (payload: Record<string, unknown>, message: string) => {
    try {
      social.cleanHyroxResult(payload);
    } catch (e) {
      assert(e instanceof social.Rejected);
      assertEquals([e.message, e.status], [message, 400]);
      return;
    }
    throw new Error("accepted " + JSON.stringify(payload));
  };
  const base = { gender: "men", category: "open", format: "singles" };
  for (const bad of [undefined, null, "", "  ", "abc", "inf", "nan", "NaN", Infinity, NaN, true, false, [], {}, "0x10", "_1", "1_", "1__0", "--5", "1e", ".", "3600 s"]) {
    refused({ ...base, total_seconds: bad }, "Invalid time.");
  }
  refused({ gender: "x", category: "open", format: "singles", total_seconds: "abc" }, "Invalid time.");
  refused({ ...base, gender: "x", total_seconds: 3600 }, "Invalid gender, category, or format.");
  refused({ ...base, category: "elite", total_seconds: 3600 }, "Invalid gender, category, or format.");
  refused({ ...base, format: "relay", total_seconds: 3600 }, "Invalid gender, category, or format.");
  refused({ total_seconds: 3600 }, "Invalid gender, category, or format.");
  for (const [gender, format, floor] of [["men", "singles", 3000], ["women", "singles", 3180], ["men", "doubles", 2820], ["women", "doubles", 3060]] as const) {
    social.cleanHyroxResult({ gender, category: "open", format, total_seconds: floor });
    refused({ gender, category: "open", format, total_seconds: floor - 0.001 }, "That time isn't a plausible race finish.");
  }
  social.cleanHyroxResult({ ...base, total_seconds: 86400 });
  refused({ ...base, total_seconds: 86400.001 }, "That time isn't a plausible race finish.");
});

Deno.test("a combination must be exactly known", () => {
  assert(social.hyroxCombo("men", "open", "singles") && social.hyroxCombo("women", "pro", "doubles"));
  for (const bad of [["Men", "open", "singles"], ["men", "elite", "singles"], ["men", "open", "relay"], ["", "", ""], ["men ", "open", "singles"]]) assert(!social.hyroxCombo(bad[0], bad[1], bad[2]), bad.join("|"));
});

Deno.test("a rejection carries its status and extra fields", () => {
  const r = new social.Rejected("no", 429, { retry_after: 7 });
  assertEquals([r.message, r.status, r.extra], ["no", 429, { retry_after: 7 }]);
  assertEquals(new social.Rejected("plain").status, 400);
});

Deno.test("helpers: the lock, the ceiling message and clean text", async () => {
  const db = new FakeDb(() => 1);
  await lock(await tx(db), "challenges", USER);
  assertEquals([db.calls[0].sql, db.calls[0].params], ["select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [`challenges:${USER}`]]);
  assertEquals(overLimitMessage(1234), "You've reached the maximum of 1,234 saved items here. Delete some to add more.");
  assertEquals(cleanText("  a\u0000b\u007fc\td  ", 10), "abcd");
  assertEquals(cleanText("abcdef", 3), "abc");
  assertEquals(cleanText("a b" + String.fromCharCode(31) + "c", 10), "a bc", "a space is text, the unit separator is not");
  assertEquals(cleanText(String.fromCharCode(32) + "x" + String.fromCharCode(32), 10), "x", "a space at the ends is trimmed");
  assertEquals(cleanText(null, 5), "");
  assertEquals(cleanText(42, 5), "42");
  assertEquals(cleanText("\u{1F3CB}".repeat(5), 3), "\u{1F3CB}".repeat(3), "clipped by characters");
  assertEquals(cleanText("　 x 　", 5), "x");
});

Deno.test("intParam reads an integer the way Flask's type=int does", () => {
  for (const [raw, expected] of [["5", 5], ["10", 10], ["27", 27], [" 5 ", 5], ["+5", 5], ["-5", -5], ["0", 0], ["5.5", null], ["x", null], ["", null], [null, null], ["1e3", null]] as [string | null, number | null][]) {
    assertEquals(intParam(raw), expected, String(raw));
  }
});

// ---- the queries -----------------------------------------------------------------------------------------------------------

Deno.test("hidden ids are blocks in both directions, and the lists leave them out", async () => {
  const db = new FakeDb(script({
    "union select user_id": [{ other: OTHER }, { other: THIRD }],
    "from public.friends f": [{ id: OTHER, name: "Hidden" }, { id: "aaaaaaaa-0000-4000-8000-000000000000", name: "Visible" }],
  }));
  assertEquals([...await social.hiddenIds(await tx(db), USER)], [OTHER, THIRD]);
  assertEquals(db.calls[0].params, [USER]);
  assertEquals(await social.friends(await tx(db), USER), [{ id: "aaaaaaaa-0000-4000-8000-000000000000", name: "Visible" }]);
  assert(db.calls.at(-1)!.sql.includes("order by p.name, p.id"));
});

Deno.test("blocked accounts are only the caller's own, newest first", async () => {
  const db = new FakeDb(script({ "from public.blocked_users b": [{ id: OTHER, name: "A" }] }));
  assertEquals(await social.blockedAccounts(await tx(db), USER), [{ id: OTHER, name: "A" }]);
  assert(db.calls[0].sql.includes("where b.user_id = $1 order by b.created_at desc, p.id"));
  assertEquals(db.calls[0].params, [USER]);
});

Deno.test("block, unblock and the existence check are scoped to the caller", async () => {
  const db = new FakeDb(script({ "select 1 as one from public.profiles": [{ one: 1 }] }));
  await social.block(await tx(db), USER, OTHER);
  await social.unblock(await tx(db), USER, OTHER);
  assert(await social.profileExists(await tx(db), OTHER));
  assertEquals(db.calls.map((c) => c.params), [[USER, OTHER], [USER, OTHER], [OTHER]]);
  assert(db.calls[0].sql.includes("on conflict do nothing"));
  assert(db.calls[1].sql.startsWith("delete from public.blocked_users where user_id = $1 and blocked_id = $2"));
  assert(!(await social.profileExists(await tx(new FakeDb(() => [])), OTHER)));
});

Deno.test("add by code: the lock first, a hit makes both directions, a miss is counted", async () => {
  const hit = new FakeDb(script({ "from public.profiles where friend_code": [{ id: OTHER, name: "Pat" }] }));
  assertEquals(await social.addByCode(await tx(hit), USER, " rc-x ", 1000), { friend: { id: OTHER, name: "Pat" } });
  assert(hit.calls[0].sql.includes("pg_advisory_xact_lock") && hit.calls[0].params[0] === `friendcode:${USER}`);
  assertEquals(hit.calls.filter((c) => c.sql.startsWith("insert into public.friends")).map((c) => c.params), [[USER, OTHER], [OTHER, USER]]);
  assertEquals(hit.calls.find((c) => c.sql.includes("where friend_code"))!.params, ["RC-X"]);
  assert(!hit.calls.some((c) => c.sql.includes("insert into public.auth_throttle")), "a hit costs nothing");

  const miss = new FakeDb(script({}));
  const r = await social.addByCode(await tx(miss), USER, "RC-NOPE", 5000);
  assert("rejected" in r && r.rejected.status === 404 && r.rejected.message === "No user found with that code.");
  const counted = miss.calls.find((c) => c.sql.includes("insert into public.auth_throttle"))!;
  assertEquals(counted.params, [`friendcode:${USER}`, 5000, 3600]);
});

Deno.test("add by code: own code, a blocked person and a too-long code", async () => {
  const own = await social.addByCode(await tx(new FakeDb(script({ "from public.profiles where friend_code": [{ id: USER, name: "Me" }] }))), USER, "RC-ME", 1);
  assert("rejected" in own && own.rejected.message === "That's your own code." && own.rejected.status === 400);
  const blocked = new FakeDb(script({ "from public.profiles where friend_code": [{ id: OTHER, name: "Pat" }], "union select user_id": [{ other: OTHER }] }));
  const b = await social.addByCode(await tx(blocked), USER, "RC-P", 1);
  assert("rejected" in b && b.rejected.message === "No user found with that code." && b.rejected.status === 404, "exactly an unknown code");
  assert(!blocked.calls.some((c) => c.sql.startsWith("insert into public.friends")));
  assert(!blocked.calls.some((c) => c.sql.includes("insert into public.auth_throttle")), "a blocked person is not a miss");
  const long = new FakeDb(script({ "from public.profiles where friend_code": [{ id: OTHER, name: "Pat" }] }));
  const l = await social.addByCode(await tx(long), USER, "A".repeat(33), 1);
  assert("rejected" in l && l.rejected.status === 404);
  assert(!long.calls.some((c) => c.sql.includes("where friend_code")), "the table is never asked about it");
  const ok32 = new FakeDb(script({}));
  await social.addByCode(await tx(ok32), USER, "A".repeat(32), 1);
  assert(ok32.calls.some((c) => c.sql.includes("where friend_code")), "32 characters is still looked up");
  const bad = await social.addByCode(await tx(new FakeDb()), USER, 5, 1);
  assert("rejected" in bad && bad.rejected.message === "Enter a friend code.");
});

Deno.test("add by code: the thirtieth wrong guess in an hour is the last; the wait is what is left of the hour", async () => {
  const now = 10_000;
  const state = (count: number, start: number) => new FakeDb(script({ "select window_start, count from public.auth_throttle": [{ window_start: start, count }] }));
  const full = await social.addByCode(await tx(state(30, now - 600)), USER, "RC-X", now);
  assert("rejected" in full);
  assertEquals([full.rejected.status, full.rejected.extra, full.rejected.message], [429, { retry_after: 3000 }, "Too many friend codes tried. Please wait about 50 minutes and try again."]);
  const roomy = await social.addByCode(await tx(state(29, now - 600)), USER, "RC-X", now);
  assert("rejected" in roomy && roomy.rejected.status === 404, "29 guesses used: the 30th is allowed");
  const fresh = await social.addByCode(await tx(state(99, now - 3600)), USER, "RC-X", now);
  assert("rejected" in fresh && fresh.rejected.status === 404, "the window has elapsed");
  assertEquals(await social.guessWait(await tx(state(30, now - 3599.5)), USER, now), 1, "never less than a second");
  assertEquals(await social.guessWait(await tx(new FakeDb()), USER, now), 0);
});

Deno.test("report: the reason is one of four, one open report per pair, and the reporter blocks the reported", async () => {
  const fresh = new FakeDb(script({}));
  await social.reportUser(await tx(fresh), USER, OTHER, " spam ");
  assertEquals(fresh.calls.find((c) => c.sql.startsWith("insert into public.content_reports"))!.params, [USER, OTHER, "spam"]);
  assert(fresh.calls.some((c) => c.sql.startsWith("insert into public.blocked_users")));
  for (const odd of ["rude", "", 5, null, undefined, "SPAM"]) {
    const d = new FakeDb(script({}));
    await social.reportUser(await tx(d), USER, OTHER, odd);
    assertEquals(d.calls.find((c) => c.sql.startsWith("insert into public.content_reports"))!.params[2], "other", String(odd));
  }
  const again = new FakeDb(script({ "from public.content_reports": [{ id: 1 }] }));
  await social.reportUser(await tx(again), USER, OTHER, "spam");
  assert(!again.calls.some((c) => c.sql.startsWith("insert into public.content_reports")), "the same complaint twice is one");
  assert(again.calls.some((c) => c.sql.startsWith("insert into public.blocked_users")), "but the block is still made");
});

Deno.test("AI reply reports: clipped, deduplicated, capped at twenty open", async () => {
  const fresh = new FakeDb(script({ "count(*)": [{ n: "0" }] }));
  assert(await social.reportAiReply(await tx(fresh), USER, "workout_chat", "harmful", "  " + "x".repeat(5000)));
  const insert = fresh.calls.find((c) => c.sql.startsWith("insert into public.ai_reports"))!;
  assertEquals([insert.params[1], insert.params[2], String(insert.params[3]).length], ["workout_chat", "harmful", 4000]);
  assert(fresh.calls[0].sql.includes("pg_advisory_xact_lock") && fresh.calls[0].params[0] === `ai_reports:${USER}`);
  const odd = new FakeDb(script({ "count(*)": [{ n: "0" }] }));
  await social.reportAiReply(await tx(odd), USER, "other", "weird", "reply");
  assertEquals(odd.calls.find((c) => c.sql.startsWith("insert"))!.params.slice(1, 3), ["coach", "other"]);
  const dup = new FakeDb(script({ "reply_text = $2": [{ one: 1 }] }));
  assert(await social.reportAiReply(await tx(dup), USER, "coach", "other", "same"));
  assert(!dup.calls.some((c) => c.sql.startsWith("insert")), "the same text twice is one report");
  const capped = new FakeDb(script({ "count(*)": [{ n: "20" }] }));
  assertEquals(await social.reportAiReply(await tx(capped), USER, "coach", "other", "new"), false);
  const below = new FakeDb(script({ "count(*)": [{ n: "19" }] }));
  assertEquals(await social.reportAiReply(await tx(below), USER, "coach", "other", "new"), true);
});

Deno.test("activity dates: each source shifted into the caller's day, merged and sorted", async () => {
  const db = new FakeDb(script({
    "from public.challenge_submissions": [{ day: new Date("2026-10-27T00:00:00Z") }, { day: new Date("2026-10-28T00:00:00Z") }],
    "from public.hyrox_results": [{ day: new Date("2026-10-28T00:00:00Z") }],
    "from public.progress_photos": [{ day: new Date("2026-10-26T00:00:00Z") }, { day: null }],
  }));
  assertEquals(await social.activityDates(await tx(db), USER, "420"), {
    "2026-10-26": ["checkin_photo"],
    "2026-10-27": ["challenge"],
    "2026-10-28": ["challenge", "hyrox"],
  });
  const instants = db.calls.filter((c) => c.sql.includes("make_interval"));
  assertEquals(instants.length, 3);
  for (const c of instants) assertEquals(c.params, [420, USER]);
  assertEquals(db.calls.find((c) => c.sql.includes("progress_photos"))!.params, [USER]);
  assert(db.calls.find((c) => c.sql.includes("progress_photos"))!.sql.includes("select distinct date as day"));
});

Deno.test("a challenge: the ceiling and the daily attempt are checked under the lock, then it is made", async () => {
  const ok = new FakeDb(script({ "count(*) as n from public.challenges": [{ n: "199" }], "insert into public.challenges": [{ id: 42 }] }));
  assertEquals(await social.createChallenge(await tx(ok), USER, "pushups"), 42);
  assert(ok.calls[0].sql.includes("pg_advisory_xact_lock") && ok.calls[0].params[0] === `challenges:${USER}`);
  assertEquals(ok.calls.at(-1)!.params, [USER, "pushups", 25]);
  const full = new FakeDb(script({ "count(*) as n from public.challenges": [{ n: "200" }] }));
  try {
    await social.createChallenge(await tx(full), USER, "pushups");
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof social.Rejected);
    assertEquals([e.status, e.message], [429, "You've reached the maximum of 200 saved items here. Delete some to add more."]);
  }
  const done = new FakeDb(script({ "count(*) as n from public.challenges": [{ n: "0" }], "from public.challenge_submissions s": [{ one: 1 }] }));
  try {
    await social.createChallenge(await tx(done), USER, "pushups");
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof social.Rejected);
    assertEquals([e.status, e.message, e.extra], [429, "You've already recorded today's attempt — come back tomorrow.", { limitReached: true }]);
  }
});

Deno.test("a challenge is visible to its creator, to friends, and to nobody hidden", async () => {
  const row = { id: 7, creator_id: OTHER, exercise: "pushups", duration_seconds: 25, created_at: new Date() };
  assertEquals((await social.visibleChallenge(await tx(new FakeDb(script({ "select * from public.challenges": [{ ...row, creator_id: USER }] }))), USER, 7))!.id, 7);
  assertEquals(await social.visibleChallenge(await tx(new FakeDb()), USER, 7), null);
  const friend = new FakeDb(script({ "select * from public.challenges": [row], "select 1 as one from public.friends": [{ one: 1 }] }));
  assertEquals((await social.visibleChallenge(await tx(friend), USER, 7))!.id, 7);
  assertEquals(friend.calls.at(-1)!.params, [USER, OTHER]);
  const stranger = new FakeDb(script({ "select * from public.challenges": [row] }));
  assertEquals(await social.visibleChallenge(await tx(stranger), USER, 7), null);
  const hidden = new FakeDb(script({ "select * from public.challenges": [row], "union select user_id": [{ other: OTHER }], "select 1 as one from public.friends": [{ one: 1 }] }));
  assertEquals(await social.visibleChallenge(await tx(hidden), USER, 7), null, "a friend who is also blocked is hidden");
});

Deno.test("challenges list: the caller's and friends', blocked accounts out of both halves, boards in order", async () => {
  const when = new Date("2026-10-28T10:00:00Z");
  const db = new FakeDb(script({
    "union select user_id": [{ other: THIRD }],
    "from public.challenges c join": [
      { id: 9, creator_id: OTHER, exercise: "situps", duration_seconds: 25, created_at: when, creator_name: "Pat" },
      { id: 8, creator_id: THIRD, exercise: "pushups", duration_seconds: 25, created_at: when, creator_name: "Blocked" },
    ],
    "from public.challenge_submissions s": [
      { challenge_id: 9, user_id: OTHER, reps: 20, notes: "a", created_at: when, name: "Pat" },
      { challenge_id: 9, user_id: THIRD, reps: 99, notes: "b", created_at: when, name: "Blocked" },
      { challenge_id: 9, user_id: USER, reps: 5, notes: "c", created_at: when, name: "Sam" },
    ],
  }));
  assertEquals(await social.visibleChallenges(await tx(db), USER), [{
    id: 9,
    creator_id: OTHER,
    exercise: "situps",
    duration_seconds: 25,
    created_at: "2026-10-28T10:00:00.000Z",
    creator_name: "Pat",
    leaderboard: [
      { user_id: OTHER, reps: 20, notes: "a", created_at: "2026-10-28T10:00:00.000Z", name: "Pat" },
      { user_id: USER, reps: 5, notes: "c", created_at: "2026-10-28T10:00:00.000Z", name: "Sam" },
    ],
  }]);
  const boards = db.calls.find((c) => c.sql.includes("from public.challenge_submissions s"))!;
  assertEquals(boards.params, [[9]], "only the visible challenge's board is asked for");
  assert(boards.sql.includes("order by s.reps desc, s.created_at asc, s.user_id"));
  const none = new FakeDb(script({}));
  assertEquals(await social.visibleChallenges(await tx(none), USER), []);
  assert(!none.calls.some((c) => c.sql.includes("challenge_submissions")), "no challenges, no board query");
});

Deno.test("a submission only ever improves", async () => {
  const db = new FakeDb(() => 1);
  await social.saveSubmission(await tx(db), 9, USER, 14, "good");
  assertEquals(db.calls[0].params, [9, USER, 14, "good"]);
  assert(db.calls[0].sql.includes("where excluded.reps > challenge_submissions.reps"));
});

Deno.test("the reps board: the caller and friends, or everyone; blocked left out in the query; ranks by position", async () => {
  const when = new Date("2026-10-28T10:00:00Z");
  const rows = [
    { user_id: OTHER, name: "Pat", total_reps: "40", last_at: when },
    { user_id: USER, name: "Sam", total_reps: "30", last_at: when },
  ];
  const friendsScope = new FakeDb(script({ "select friend_id from public.friends": [{ friend_id: OTHER }], "from public.challenge_submissions s": rows, "union select user_id": [{ other: THIRD }] }));
  const board = await social.repsBoard(await tx(friendsScope), USER, "friends");
  assertEquals(board.map((r) => [r.user_id, r.total_reps]), [[OTHER, 40], [USER, 30]]);
  const q = friendsScope.calls.find((c) => c.sql.includes("sum(s.reps)"))!;
  assertEquals(q.params, [[THIRD], [USER, OTHER]]);
  assert(q.sql.includes("s.user_id = any($2::uuid[])"));
  const globalScope = new FakeDb(script({ "from public.challenge_submissions s": rows }));
  await social.repsBoard(await tx(globalScope), USER, "global");
  const g = globalScope.calls.find((c) => c.sql.includes("sum(s.reps)"))!;
  assertEquals(g.params, [[]]);
  assert(!g.sql.includes("$2"));
  const odd = new FakeDb(script({ "from public.challenge_submissions s": [] }));
  await social.repsBoard(await tx(odd), USER, "whatever");
  assert(odd.calls.find((c) => c.sql.includes("sum(s.reps)"))!.sql.includes("$2"), "anything but global is friends");
  assertEquals(social.myRank(board, USER, "total_reps"), { rank: 2, total_reps: 30, name: "Sam" });
  assertEquals(social.myRank(board, OTHER, "total_reps"), { rank: 1, total_reps: 40, name: "Pat" }, "first place is a rank too");
  assertEquals(social.myRank(board, THIRD, "total_reps"), null);
});

Deno.test("a HYROX result is made under the lock, up to five hundred", async () => {
  const ok = new FakeDb(script({ "count(*) as n from public.hyrox_results": [{ n: "499" }], "insert into public.hyrox_results": [{ id: 5 }] }));
  assertEquals(await social.createHyroxResult(await tx(ok), USER, "men", "open", "singles", 3601.5), 5);
  assertEquals(ok.calls.at(-1)!.params, [USER, "men", "open", "singles", 3601.5]);
  assert(ok.calls[0].params[0] === `hyrox_results:${USER}`);
  try {
    await social.createHyroxResult(await tx(new FakeDb(script({ "count(*)": [{ n: "500" }] }))), USER, "men", "open", "singles", 3601);
    throw new Error("accepted");
  } catch (e) {
    assert(e instanceof social.Rejected);
    assertEquals([e.status, e.message], [429, "You've reached the maximum of 500 saved items here. Delete some to add more."]);
  }
});

Deno.test("the HYROX board: the floor and ceiling in the query, hidden accounts out, fastest first", async () => {
  const db = new FakeDb(script({
    "union select user_id": [{ other: THIRD }],
    "from public.hyrox_results r": [{ user_id: OTHER, name: "Pat", best_seconds: 3100 }, { user_id: USER, name: "Sam", best_seconds: 3500.5 }],
  }));
  const rows = await social.hyroxBoard(await tx(db), USER, "women", "open", "doubles");
  assertEquals(rows.map((r) => r.best_seconds), [3100, 3500.5]);
  assertEquals(db.calls.find((c) => c.sql.includes("min(r.total_seconds)"))!.params, ["women", "open", "doubles", 3060, 86400, [THIRD]]);
  assertEquals(social.myRank(rows, USER, "best_seconds"), { rank: 2, best_seconds: 3500.5, name: "Sam" });
});

// ---- the routes ----------------------------------------------------------------------------------------------------------------

const withProfile = (answers: Parameters<typeof script>[0] = {}) => new FakeDb(script({ "select id, name, friend_code": [profile], ...answers }));

Deno.test("every social route demands a token", async () => {
  const call = app();
  for (
    const [method, path] of [["GET", "/api/friends"], ["POST", "/api/friends/add"], ["GET", "/api/safety/blocks"], ["POST", "/api/safety/block"], ["DELETE", "/api/safety/block"], ["POST", "/api/safety/report"],
      ["POST", "/api/ai-report"], ["GET", "/api/activity/dates"], ["GET", "/api/challenges"], ["POST", "/api/challenges"], ["GET", "/api/challenges/today"], ["GET", "/api/leaderboard"], ["POST", "/api/hyrox/results"], ["GET", "/api/hyrox/leaderboard"]]
  ) assertEquals((await call(path, { method })).status, 401, `${method} ${path}`);
});

Deno.test("routes that write about the caller need a profile first", async () => {
  const headers = await bearer();
  for (const [method, path] of [["POST", "/api/friends/add"], ["POST", "/api/safety/block"], ["POST", "/api/safety/report"], ["POST", "/api/ai-report"], ["POST", "/api/challenges"], ["POST", "/api/hyrox/results"]]) {
    const r = await app(new FakeDb())(path, { method, headers, json: {} });
    assertEquals([r.status, (await r.json()).error], [404, "No profile yet. Create it first."], path);
  }
  const friends = await app(new FakeDb())("/api/friends", { headers });
  assertEquals(friends.status, 404);
});

Deno.test("GET /api/friends: the caller's code and friends", async () => {
  const db = new FakeDb(script({ "select friend_code": [{ friend_code: "RC-ABC123" }], "from public.friends f": [{ id: OTHER, name: "Pat" }] }));
  const r = await app(db)("/api/friends", { headers: await bearer() });
  assertEquals(await r.json(), { ok: true, code: "RC-ABC123", friends: [{ id: OTHER, name: "Pat" }] });
});

Deno.test("POST /api/friends/add: a friend, a miss that is counted, and a throttle with Retry-After", async () => {
  const headers = await bearer();
  const hit = withProfile({ "from public.profiles where friend_code": [{ id: OTHER, name: "Pat" }] });
  const ok = await app(hit)("/api/friends/add", { method: "POST", headers, json: { code: "rc-x" } });
  assertEquals([ok.status, await ok.json()], [200, { ok: true, friend: { id: OTHER, name: "Pat" } }]);
  assert(hit.calls.some((c) => c.params[1] === "feature:friend_added"), "the add is counted");

  const miss = withProfile();
  const m = await app(miss)("/api/friends/add", { method: "POST", headers, json: { code: "RC-NOPE" } });
  assertEquals([m.status, (await m.json()).error], [404, "No user found with that code."]);
  assert(miss.calls.some((c) => c.sql.includes("insert into public.auth_throttle")), "the miss was recorded");

  const now = Math.floor(Date.now() / 1000);
  const throttled = withProfile({ "select window_start, count from public.auth_throttle": [{ window_start: now - 60, count: 30 }] });
  const t = await app(throttled)("/api/friends/add", { method: "POST", headers, json: { code: "RC-X" } });
  const body = await t.json();
  assertEquals([t.status, body.ok], [429, false]);
  assert(!("retry_after" in body), "the wait is a header, not a field");
  assert(Math.abs(Number(t.headers.get("Retry-After")) - 3540) <= 2);

  const noCode = await app(withProfile())("/api/friends/add", { method: "POST", headers, json: {} });
  assertEquals([noCode.status, (await noCode.json()).error], [400, "Enter a friend code."]);
});

Deno.test("blocking: an id that is not a uuid, not an account, yourself, and the happy path", async () => {
  const headers = await bearer();
  const post = (db: FakeDb, body: unknown) => app(db)("/api/safety/block", { method: "POST", headers, json: body });
  for (const body of [{}, { user_id: 5 }, { user_id: "nope" }]) assertEquals((await post(withProfile(), body)).status, 404, JSON.stringify(body));
  assertEquals((await post(withProfile(), { user_id: OTHER })).status, 404, "no such account");
  const self = await post(withProfile({ "select 1 as one from public.profiles": [{ one: 1 }] }), { user_id: USER });
  assertEquals([self.status, (await self.json()).error], [400, "You can't block yourself."]);
  const db = withProfile({ "select 1 as one from public.profiles": [{ one: 1 }] });
  const ok = await post(db, { user_id: OTHER.toUpperCase() });
  assertEquals([ok.status, await ok.json()], [200, { ok: true, blocked: { id: OTHER } }]);
  assert(db.calls.some((c) => c.sql.startsWith("insert into public.blocked_users") && c.params[1] === OTHER));
  assert(db.calls.some((c) => c.params[1] === "feature:block_user"));
});

Deno.test("unblocking needs only a uuid, not a living account; the block list is the caller's", async () => {
  const headers = await bearer();
  const db = new FakeDb(() => 1);
  const ok = await app(db)("/api/safety/block", { method: "DELETE", headers, json: { user_id: OTHER } });
  assertEquals([ok.status, await ok.json()], [200, { ok: true }]);
  assertEquals(db.calls.length, 1, "no existence check");
  const bad = await app(new FakeDb())("/api/safety/block", { method: "DELETE", headers, json: { user_id: "x" } });
  assertEquals([bad.status, (await bad.json()).error], [400, "Which account?"]);
  const list = await app(new FakeDb(script({ "from public.blocked_users b": [{ id: OTHER, name: "A" }] })))("/api/safety/blocks", { headers });
  assertEquals(await list.json(), { ok: true, blocked: [{ id: OTHER, name: "A" }] });
});

Deno.test("reporting an account files the report, blocks them, and says only the id", async () => {
  const headers = await bearer();
  const db = withProfile({ "select 1 as one from public.profiles": [{ one: 1 }] });
  const r = await app(db)("/api/safety/report", { method: "POST", headers, json: { user_id: OTHER, reason: "spam" } });
  assertEquals([r.status, await r.json()], [200, { ok: true, blocked: { id: OTHER } }]);
  assertEquals(db.calls.find((c) => c.sql.startsWith("insert into public.content_reports"))!.params, [USER, OTHER, "spam"]);
  assert(db.calls.some((c) => c.params[1] === "feature:report_user"));
  const self = await app(withProfile({ "select 1 as one from public.profiles": [{ one: 1 }] }))("/api/safety/report", { method: "POST", headers, json: { user_id: USER } });
  assertEquals([self.status, (await self.json()).error], [400, "You can't report yourself."]);
  const gone = await app(withProfile())("/api/safety/report", { method: "POST", headers, json: { user_id: OTHER } });
  assertEquals(gone.status, 404);
});

Deno.test("reporting an AI reply: needs a reply, caps at twenty open, counts the report", async () => {
  const headers = await bearer();
  for (const body of [{}, { reply: "" }, { reply: "   " }, { reply: 5 }]) {
    const r = await app(withProfile())("/api/ai-report", { method: "POST", headers, json: body });
    assertEquals([r.status, (await r.json()).error], [400, "Nothing to report."], JSON.stringify(body));
  }
  const db = withProfile({ "count(*)": [{ n: "0" }] });
  const ok = await app(db)("/api/ai-report", { method: "POST", headers, json: { reply: "bad advice", feature: "coach", reason: "harmful" } });
  assertEquals([ok.status, await ok.json()], [200, { ok: true }]);
  assert(db.calls.some((c) => c.params[1] === "feature:report_ai_reply"));
  const capped = await app(withProfile({ "count(*)": [{ n: "20" }] }))("/api/ai-report", { method: "POST", headers, json: { reply: "x" } });
  assertEquals([capped.status, (await capped.json()).error], [429, "You have too many reports waiting for review."]);
});

Deno.test("GET /api/activity/dates passes the caller's offset", async () => {
  const db = new FakeDb(script({ "from public.challenge_submissions": [{ day: new Date("2026-10-28T00:00:00Z") }] }));
  const r = await app(db)("/api/activity/dates?tz_offset_minutes=420", { headers: await bearer() });
  assertEquals(await r.json(), { ok: true, dates: { "2026-10-28": ["challenge"] } });
  assertEquals(db.calls.find((c) => c.sql.includes("make_interval"))!.params[0], 420);
  const none = new FakeDb(() => []);
  await app(none)("/api/activity/dates", { headers: await bearer() });
  assertEquals(none.calls.find((c) => c.sql.includes("make_interval"))!.params[0], 0);
});

Deno.test("challenges: listing carries `me`; creating makes today's; today says whether it was attempted", async () => {
  const headers = await bearer();
  const list = await app(new FakeDb(() => []))("/api/challenges", { headers });
  assertEquals(await list.json(), { ok: true, challenges: [], me: USER });
  const db = withProfile({ "count(*) as n from public.challenges": [{ n: "0" }], "insert into public.challenges": [{ id: 3 }] });
  const created = await app(db)("/api/challenges", { method: "POST", headers });
  const body = await created.json();
  assertEquals([created.status, body.ok, body.id, body.exercise], [200, true, 3, social.todaysExercise()]);
  const again = await app(withProfile({ "count(*) as n from public.challenges": [{ n: "0" }], "from public.challenge_submissions s": [{ one: 1 }] }))("/api/challenges", { method: "POST", headers });
  const refusal = await again.json();
  assertEquals([again.status, refusal.limitReached, refusal.error], [429, true, "You've already recorded today's attempt — come back tomorrow."]);
  const today = await app(new FakeDb(script({ "from public.challenge_submissions s": [{ one: 1 }] })))("/api/challenges/today", { headers });
  assertEquals(await today.json(), { ok: true, exercise: social.todaysExercise(), label: social.CHALLENGE_EXERCISES[social.todaysExercise()], attempted: true });
  const open = await app(new FakeDb())("/api/challenges/today", { headers });
  assertEquals((await open.json()).attempted, false);
});

Deno.test("GET /api/leaderboard: scope, limit and the caller's rank", async () => {
  const when = new Date("2026-10-28T10:00:00Z");
  const rows = Array.from({ length: 5 }, (_, i) => ({ user_id: i === 3 ? USER : `00000000-0000-4000-8000-00000000000${i}`, name: `P${i}`, total_reps: String(50 - i), last_at: when }));
  const make = () => new FakeDb(script({ "from public.challenge_submissions s": rows }));
  const all = await (await app(make())("/api/leaderboard?scope=global", { headers: await bearer() })).json();
  assertEquals([all.ok, all.scope, all.me, all.leaderboard.length, all.totalEntries, all.myRank], [true, "global", USER, 5, 5, { rank: 4, total_reps: 47, name: "P3" }]);
  const some = await (await app(make())("/api/leaderboard?limit=2", { headers: await bearer() })).json();
  assertEquals([some.scope, some.leaderboard.length, some.totalEntries], ["friends", 2, 5]);
  for (const [limit, count] of [["0", 5], ["x", 5], ["-1", 4], ["10", 5]] as const) {
    const r = await (await app(make())(`/api/leaderboard?limit=${limit}`, { headers: await bearer() })).json();
    assertEquals(r.leaderboard.length, count, `limit=${limit}`);
  }
});

Deno.test("POST /api/hyrox/results: a good one is stored; a bad one says why", async () => {
  const headers = await bearer();
  const db = withProfile({ "count(*) as n from public.hyrox_results": [{ n: "0" }], "insert into public.hyrox_results": [{ id: 8 }] });
  const ok = await app(db)("/api/hyrox/results", { method: "POST", headers, json: { gender: "men", category: "open", format: "singles", total_seconds: 3700 } });
  assertEquals([ok.status, await ok.json()], [200, { ok: true, id: 8 }]);
  const bad = await app(withProfile())("/api/hyrox/results", { method: "POST", headers, json: { gender: "men", category: "open", format: "singles", total_seconds: 100 } });
  assertEquals([bad.status, (await bad.json()).error], [400, "That time isn't a plausible race finish."]);
  const full = await app(withProfile({ "count(*)": [{ n: "500" }] }))("/api/hyrox/results", { method: "POST", headers, json: { gender: "men", category: "open", format: "singles", total_seconds: 3700 } });
  assertEquals(full.status, 429);
});

Deno.test("GET /api/hyrox/leaderboard: a known combination, fifty rows, the caller's own place", async () => {
  const headers = await bearer();
  const bad = await app(new FakeDb())("/api/hyrox/leaderboard?gender=men&category=open", { headers });
  assertEquals([bad.status, (await bad.json()).error], [400, "Invalid gender, category, or format."]);
  const rows = Array.from({ length: 60 }, (_, i) => ({ user_id: i === 55 ? USER : `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, name: `P${i}`, best_seconds: 3000 + i }));
  const r = await (await app(new FakeDb(script({ "from public.hyrox_results r": rows })))("/api/hyrox/leaderboard?gender=men&category=open&format=singles", { headers })).json();
  assertEquals([r.ok, r.leaderboard.length, r.totalEntries, r.me], [true, 50, 60, { rank: 56, best_seconds: 3055, name: "P55" }]);
});
