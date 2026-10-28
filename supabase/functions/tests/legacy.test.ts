import { assert, assertEquals } from "@std/assert";

import { cleanEmail, MAX_EMAIL } from "../_shared/email.ts";
import {
  CALLER_ATTEMPTS,
  CALLER_WINDOW,
  callerKey,
  EMAIL_ATTEMPTS,
  EMAIL_WINDOW,
  emailKey,
  MAX_PASSWORD_CHARS,
  migrate,
  Outcome,
} from "../_shared/legacy.ts";
import { checkPasswordHash, dummyHash } from "../_shared/passwordHash.ts";
import { clear, take } from "../_shared/throttle.ts";
import { callerAddress } from "../api/routes/legacy.ts";
import { AuthAdmin } from "../_shared/supabaseAdmin.ts";
import { app, FakeDb, fakeTransport, PROJECT } from "./support.ts";

// Hashes written by Werkzeug's generate_password_hash (3.1), with the passwords they were made from.
const VECTORS: [string, string][] = [
  ["old-password-1", "scrypt:32768:8:1$jG9tzm50OwcoCAWB$e23b30f057ac0c7ff0728868264e7a0d590ea80885fec59923e0eefef5dc91de801e0ac05fb72c10eb7e71c1c9924496e3d8fc0adbbab5c016438dda6e095035"],
  ["pässwörd-☃-\u{1F3CB}", "scrypt:32768:8:1$VrCRD5jDdZbYCVYi$022ef03548c51383357262563c529ad841ef46ae92362b13bef7bf4e841b2171c6f3a2be58686f364c43167cf224c0edd0bcbbc16dbcb385699f8f8504974f57"],
  ["x", "scrypt:1024:8:1$zUm3XfAsbJxLUeIY$a18ef5112238cd07ebc46df249418a7316d0a0e696272940f00a220fb9f0d976a8be156b44af105f99a2b77d4d273ec0c92817d0b81af3c981eaaf47a0cca6f2"],
  ["x", "pbkdf2:sha256:1000$R0nP95nuxQ8y64cN$204d48250ad5a0e61d69c179129caa39cef6af8c4235e1902509f036661bc271"],
  ["x", "pbkdf2:sha1:1000$01Js5QYXJsV0bXeS$1cc87c9c01a2aa09f40dcabe4180171518f5d8dd"],
  ["a longer pass phrase with spaces", "pbkdf2:sha512:1000$KgxLbDjYA66s40wY$a7f6acefd7ee509fd2c49f125fb8f22c9c7ea0784d37e55099d2eef9e1739b92cc89076f97e64017a2c5d9ee70513087ef0ab25391c510f20c66fa16a135c156"],
  ["x", "pbkdf2:sha384:1000$vJXCdMcLZTB4lXTQ$c7cba068849c8b1627420cf444f099764ce659d06ce153d38dfc25aec8c32c4438f335af1ab8713d23129160ae560c1a"],
  ["x", "pbkdf2:sha224:1000$spSbiwKV7fV7IgrS$f3b32ca1a759e0be06d2ac44d32f703d74894eb54623ad02b8690ee0"],
];

Deno.test("hashes the website wrote verify, and only with their own password", () => {
  for (const [password, hash] of VECTORS) {
    assert(checkPasswordHash(hash, password), hash.slice(0, 24));
    assert(!checkPasswordHash(hash, password + "x"), "wrong password: " + hash.slice(0, 24));
    assert(!checkPasswordHash(hash, ""), "empty password");
  }
});

Deno.test("a stored value this cannot read is simply not a match", () => {
  const good = VECTORS[2][1];
  const [method, salt, hex] = good.split("$");
  for (
    const bad of [
      "", "plain", "$$", "x$y", `${method}$${salt}`, `md5$${salt}$${hex}`, `scrypt$${salt}$${hex}`, `scrypt:1024:8$${salt}$${hex}`, `scrypt:1024:8:1:9$${salt}$${hex}`,
      `scrypt:0:8:1$${salt}$${hex}`, `scrypt:-1:8:1$${salt}$${hex}`, `scrypt:1e3:8:1$${salt}$${hex}`, `scrypt:99999999999999:8:1$${salt}$${hex}`,
      `scrypt:1073741824:8:1$${salt}$${hex}`, `pbkdf2:md5:1000$${salt}$${hex}`, `pbkdf2:sha256$${salt}$${hex}`, `pbkdf2:sha256:0$${salt}$${hex}`,
      `pbkdf2:sha256:abc$${salt}$${hex}`, `${method}$${salt}$${hex.slice(0, -2)}`, `${method}$${salt}$${hex}00`, `${method}$${salt}$${hex.toUpperCase()}`,
      `${method}$${salt}$`, `${method}$$${hex}`,
    ]
  ) assert(!checkPasswordHash(bad, "x"), bad.slice(0, 40));
  assert(checkPasswordHash(good, "x"));
});

Deno.test("the salt is used as the text between the dollar signs, and the hash may itself contain a dollar sign's worth of anything after the second", () => {
  const [method, salt, hex] = VECTORS[2][1].split("$");
  assert(!checkPasswordHash(`${method}$${salt}x$${hex}`, "x"));
  assert(!checkPasswordHash(`${method}$${salt}$${hex}$extra`, "x"));
});

Deno.test("the dummy hash is a real scrypt hash, computed once, that matches nothing a person could type", () => {
  const dummy = dummyHash();
  assert(/^scrypt:32768:8:1\$[^$]+\$[0-9a-f]{128}$/.test(dummy), dummy);
  assertEquals(dummyHash(), dummy);
  assert(checkPasswordHash(dummy, "a password nobody has"));
  assert(!checkPasswordHash(dummy, "x"));
});

// ---- email ----------------------------------------------------------------------------------------------------------

Deno.test("an address is trimmed, lower-cased and must look like one", () => {
  assertEquals(cleanEmail("  Sam@Example.COM \n"), "sam@example.com");
  for (const bad of [null, undefined, 5, {}, [], "", "   ", "sam", "sam@", "@example.com", "sam@example", "sam@@example.com", "sam @example.com", "sam@exa mple.com", "a\u0000@b.co", "a\u007f@b.co", "a\u001f@b.co"]) {
    assertEquals(cleanEmail(bad), null, String(bad));
  }
  assertEquals(cleanEmail("a@b.c"), "a@b.c");
  const long = "a".repeat(MAX_EMAIL - 6) + "@b.com";
  assertEquals(cleanEmail(long), long);
  assertEquals(cleanEmail("a" + long), null, "one over");
  assertEquals(MAX_EMAIL, 254);
  assertEquals(cleanEmail(" sam@example.com　"), "sam@example.com");
  assertEquals(cleanEmail("sam@exa\u0085mple.com"), null, "Python's \\s includes NEL");
  assertEquals(cleanEmail("sam@exa﻿mple.com"), "sam@exa﻿mple.com", "and does not include U+FEFF");
});

// ---- the throttle -----------------------------------------------------------------------------------------------------

Deno.test("throttle: a try is taken in one statement; refused says how long to wait; clear forgets the key", async () => {
  const taken = new FakeDb(() => [{ window_start: 100 }]);
  assertEquals(await taken.transaction((tx) => take(tx, "k", 10, 900, 100)), [true, 0]);
  assertEquals(taken.calls[0].params, ["k", 100, 900, 10]);
  assert(taken.calls[0].sql.includes("auth_throttle.count < $4::integer") && taken.calls[0].sql.includes("then 1 else auth_throttle.count + 1"));
  const full = new FakeDb((sql) => sql.includes("returning") ? [] : [{ window_start: 100 }]);
  assertEquals(await full.transaction((tx) => take(tx, "k", 10, 900, 160)), [false, 840]);
  assertEquals(await new FakeDb(() => []).transaction((tx) => take(tx, "k", 10, 900, 160)), [false, 900]);
  assertEquals(await full.transaction((tx) => take(tx, "k", 10, 900, 5000)), [false, 1], "never less than a second");
  const cleared = new FakeDb(() => 1);
  await cleared.transaction((tx) => clear(tx, "k"));
  assertEquals([cleared.calls[0].sql, cleared.calls[0].params], ["delete from public.auth_throttle where key = $1", ["k"]]);
});

// ---- migrate ----------------------------------------------------------------------------------------------------------

const UID = "123e4567-e89b-12d3-a456-426614174000";
const OLD = "old-password-1";
const HASH = VECTORS[0][1];
const NOW = 1_800_000_000;

function world(options: { hashes?: Record<string, [string, string]>; blocked?: string[]; passwordAnswer?: () => Response } = {}) {
  const log: string[] = [];
  const db = new FakeDb((sql, params) => {
    if (sql.includes("auth_throttle") && sql.startsWith("insert")) {
      log.push(`take ${params[0]}`);
      return options.blocked?.includes(String(params[0])) ? [] : [{ window_start: params[1] }];
    }
    if (sql.includes("select window_start from public.auth_throttle")) return [{ window_start: NOW - 60 }];
    if (sql.includes("legacy_password_hashes h")) {
      log.push(`lookup ${params[0]}`);
      const found = options.hashes?.[String(params[0])];
      return found ? [{ id: found[0], password_hash: found[1] }] : [];
    }
    if (sql.startsWith("delete from public.legacy_password_hashes")) log.push(`delete ${params[0]}`);
    if (sql.startsWith("delete from public.auth_throttle")) log.push(`clear ${params[0]}`);
    return 1;
  });
  const t = fakeTransport(options.passwordAnswer ?? (() => new Response("{}")));
  const admin = new AuthAdmin(PROJECT, "k", t.transport);
  return { db, admin, t, log, run: (email: unknown, password: unknown, caller: string | null = "1.2.3.4") => migrate(db, admin, email, password, caller, NOW) };
}

const known = { "sam@example.com": [UID, HASH] as [string, string] };

Deno.test("legacy: the right password is set in Supabase, the old hash and the tries are cleared", async () => {
  const w = world({ hashes: known });
  assertEquals(await w.run("sam@example.com", OLD), [Outcome.MIGRATED, 0]);
  assertEquals(w.t.requests.length, 1);
  assertEquals([w.t.requests[0].method, w.t.requests[0].url, w.t.requests[0].body], ["PUT", `${PROJECT}/auth/v1/admin/users/${UID}`, { password: OLD }]);
  assertEquals(w.log, ["take legacyip:1.2.3.4", "take legacy:sam@example.com", "lookup sam@example.com", `delete ${UID}`, "clear legacy:sam@example.com"]);
});

Deno.test("legacy: the address is matched in any case and trimmed", async () => {
  const w = world({ hashes: known });
  assertEquals((await w.run("  SAM@Example.com ", OLD))[0], Outcome.MIGRATED);
  assertEquals(w.log[1], "take legacy:sam@example.com");
});

Deno.test("legacy: a wrong password is a mismatch, changes nothing and keeps the tries counted", async () => {
  const w = world({ hashes: known });
  assertEquals(await w.run("sam@example.com", "wrong"), [Outcome.MISMATCH, 0]);
  assertEquals(w.t.requests.length, 0);
  assert(!w.log.some((l) => l.startsWith("delete") || l.startsWith("clear")));
  assertEquals(w.log.slice(0, 2), ["take legacyip:1.2.3.4", "take legacy:sam@example.com"]);
});

Deno.test("legacy: an unknown address and an account with no old hash are the same mismatch", async () => {
  const w = world({ hashes: {} });
  assertEquals(await w.run("nobody@example.com", OLD), [Outcome.MISMATCH, 0]);
  assertEquals(w.t.requests.length, 0);
});

Deno.test("legacy: a malformed try is a mismatch that never reaches Supabase or the account lookup", async () => {
  for (
    const [email, password] of [
      [null, OLD], ["sam@example.com", null], ["sam@example.com", ""], ["not an address", OLD], [5, OLD], ["sam@example.com", 5], ["sam@example.com", "p".repeat(MAX_PASSWORD_CHARS + 1)], [undefined, undefined],
    ]
  ) {
    const w = world({ hashes: known });
    assertEquals(await w.run(email, password), [Outcome.MISMATCH, 0], JSON.stringify([email, password]));
    assertEquals(w.t.requests.length, 0);
    assertEquals(w.log, ["take legacyip:1.2.3.4"], "only the caller's budget is spent, and no lookup");
  }
});

Deno.test("legacy: the longest allowed password is tried, in code points", async () => {
  const w = world({ hashes: known });
  assertEquals((await w.run("sam@example.com", "\u{1F3CB}".repeat(MAX_PASSWORD_CHARS)))[0], Outcome.MISMATCH);
  assert(w.log.includes("lookup sam@example.com"), "1000 emoji is within the limit");
  const over = world({ hashes: known });
  await over.run("sam@example.com", "\u{1F3CB}".repeat(MAX_PASSWORD_CHARS + 1));
  assert(!over.log.includes("lookup sam@example.com"));
});

Deno.test("legacy: a password the project refuses is a reset, and the old hash stays", async () => {
  const w = world({ hashes: known, passwordAnswer: () => new Response(JSON.stringify({ error_code: "weak_password" }), { status: 422 }) });
  assertEquals(await w.run("sam@example.com", OLD), [Outcome.RESET_REQUIRED, 0]);
  assert(!w.log.some((l) => l.startsWith("delete") || l.startsWith("clear")));
});

Deno.test("legacy: an outage setting the password is an error, not a mismatch, and the tries were already committed", async () => {
  const w = world({ hashes: known, passwordAnswer: () => new Response("", { status: 503 }) });
  let thrown = false;
  try {
    await w.run("sam@example.com", OLD);
  } catch {
    thrown = true;
  }
  assert(thrown);
  assertEquals(w.db.transactions, 3, "the caller's try, the address's try and the lookup each committed on their own");
});

Deno.test("legacy: both budgets are spent before the account is looked up or anything is hashed", async () => {
  const w = world({ hashes: known });
  await w.run("sam@example.com", "wrong");
  assertEquals(w.log, ["take legacyip:1.2.3.4", "take legacy:sam@example.com", "lookup sam@example.com"]);
});

Deno.test("legacy: the budgets are the website's login limits per address and a wider one per caller", () => {
  assertEquals([EMAIL_ATTEMPTS, EMAIL_WINDOW, CALLER_ATTEMPTS, CALLER_WINDOW], [10, 900, 30, 900]);
  assertEquals(emailKey("a@b.co"), "legacy:a@b.co");
  assertEquals(callerKey("1.2.3.4"), "legacyip:1.2.3.4");
  assertEquals(callerKey(null), "legacyip:unknown");
  assertEquals(callerKey(""), "legacyip:unknown");
  assertEquals(callerKey("x".repeat(100)), "legacyip:" + "x".repeat(64));
});

Deno.test("legacy: the budgets passed to the throttle are the limits, and the caller's is spent first", async () => {
  const w = world({ hashes: known });
  await w.run("sam@example.com", "wrong");
  const takes = w.db.calls.filter((c) => c.sql.startsWith("insert into public.auth_throttle"));
  assertEquals(takes.map((c) => c.params), [["legacyip:1.2.3.4", NOW, 900, 30], ["legacy:sam@example.com", NOW, 900, 10]]);
});

Deno.test("legacy: a caller over budget is limited before anything else happens, and is told how long", async () => {
  const w = world({ hashes: known, blocked: ["legacyip:1.2.3.4"] });
  assertEquals(await w.run("sam@example.com", OLD), [Outcome.LIMITED, 60 > 840 ? 0 : 840]);
  assertEquals(w.log, ["take legacyip:1.2.3.4"]);
});

Deno.test("legacy: an address over budget is limited even with the right password", async () => {
  const w = world({ hashes: known, blocked: ["legacy:sam@example.com"] });
  assertEquals((await w.run("sam@example.com", OLD))[0], Outcome.LIMITED);
  assertEquals(w.t.requests.length, 0);
  assert(!w.log.includes("lookup sam@example.com"));
});

Deno.test("legacy: a malformed try still spends the caller's budget, and a missing caller still gets a bucket", async () => {
  const w = world();
  await w.run("nope", "x", null);
  assertEquals(w.log, ["take legacyip:unknown"]);
});

Deno.test("POST /api/auth/legacy-login: needs no token, and every failure to match is the same 401", async () => {
  const bodies = new Set<string>();
  for (const body of [{ email: "nobody@example.com", password: OLD }, { email: "sam@example.com", password: "wrong" }, {}, { email: 5, password: [] }]) {
    const db = new FakeDb((sql, params) => sql.startsWith("insert") ? [{ window_start: 1 }] : sql.includes("legacy_password_hashes h") ? (params[0] === "sam@example.com" ? [{ id: UID, password_hash: HASH }] : []) : 1);
    const r = await app(db)("/api/auth/legacy-login", { method: "POST", json: body });
    assertEquals(r.status, 401);
    bodies.add(JSON.stringify(await r.json()));
  }
  assertEquals([...bodies], [JSON.stringify({ ok: false, error: "That email and password don't match." })]);
});

Deno.test("POST /api/auth/legacy-login: success, a limit with Retry-After, and a refused password", async () => {
  const db = new FakeDb((sql) => sql.startsWith("insert") ? [{ window_start: 1 }] : sql.includes("legacy_password_hashes h") ? [{ id: UID, password_hash: HASH }] : 1);
  const ok = await app(db)("/api/auth/legacy-login", { method: "POST", json: { email: "sam@example.com", password: OLD } });
  assertEquals([ok.status, await ok.json()], [200, { ok: true }]);

  const limited = new FakeDb((sql) => sql.includes("returning") ? [] : sql.startsWith("select window_start") ? [{ window_start: Math.floor(Date.now() / 1000) - 100 }] : []);
  const r = await app(limited)("/api/auth/legacy-login", { method: "POST", json: { email: "sam@example.com", password: OLD } });
  const body = await r.json();
  assertEquals([r.status, body.error], [429, "Too many tries. Please wait a few minutes and try again."]);
  assert(Math.abs(Number(r.headers.get("Retry-After")) - 800) <= 2, String(r.headers.get("Retry-After")));
  assert(!JSON.stringify(body).includes("legacy"), "it never says which budget");

  const weak = await app(db, {}, undefined, fakeTransport(() => new Response(JSON.stringify({ error_code: "weak_password" }), { status: 422 })).transport)(
    "/api/auth/legacy-login",
    { method: "POST", json: { email: "sam@example.com", password: OLD } },
  );
  assertEquals([weak.status, (await weak.json()).reset_required], [409, true]);
});

Deno.test("POST /api/auth/legacy-login: a body that is not an object is just a mismatch", async () => {
  const db = new FakeDb(() => [{ window_start: 1 }]);
  for (const body of ["[]", '"x"', "null", "{bad"]) {
    const r = await app(db)("/api/auth/legacy-login", { method: "POST", body });
    assertEquals(r.status, 401, body);
  }
});

Deno.test("the caller is the address the proxy appended, not a header the caller wrote", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });
  assertEquals(callerAddress(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" })), "1.2.3.4");
  assertEquals(callerAddress(req({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  assertEquals(callerAddress(req({ "x-forwarded-for": " 6.6.6.6 ,  1.2.3.4 , " })), "1.2.3.4");
  assertEquals(callerAddress(req({ "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assertEquals(callerAddress(req({ "x-forwarded-for": "", "x-real-ip": "9.9.9.9" })), "9.9.9.9");
  assertEquals(callerAddress(req({})), null);
});
