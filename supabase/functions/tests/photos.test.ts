import { assert, assertEquals } from "@std/assert";

import * as photos from "../_shared/photos.ts";
import { PhotoRejected } from "../_shared/photos.ts";
import { Router, createHandler } from "../_shared/app.ts";
import { json } from "../_shared/http.ts";
import { jpeg, png, webp } from "./images.ts";
import { app, bearer, FakeDb, fakeTransport, PROJECT, services, USER } from "./support.ts";

const rejected = (fn: () => unknown, message: string, status = 400) => {
  try {
    fn();
  } catch (e) {
    assert(e instanceof PhotoRejected, String(e));
    assertEquals([e.message, e.status], [message, status]);
    return;
  }
  throw new Error("accepted");
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

Deno.test("constants are the website's", () => {
  assertEquals([photos.PHOTO_LIMIT, photos.MAX_PHOTO_BYTES, photos.BUCKET, [...photos.ANGLES]], [500, 12 * 1024 * 1024, "progress-photos", ["front", "back"]]);
});

Deno.test("a check-in date is a real day, no later than tomorrow, no earlier than the account", () => {
  assertEquals(photos.checkDate(today(), null), today());
  assertEquals(photos.checkDate(addDays(1), null), addDays(1), "the client's day can run a day ahead");
  assertEquals(photos.checkDate(` ${today()}\n`, null), today(), "trimmed");
  rejected(() => photos.checkDate(addDays(2), null), "Invalid date.");
  rejected(() => photos.checkDate("2020-01-01", "2020-01-02"), "Invalid date.");
  assertEquals(photos.checkDate("2020-01-02", "2020-01-02"), "2020-01-02", "the day the account was made is allowed");
  for (const bad of ["", null, undefined, "2026-13-01", "2026-02-30", "2026-2-3", "26-02-03", "2026/02/03", "today", "2026-02-03T00:00:00", "２０２６-０２-０３", "0000-00-00", "2026-02-03x"]) {
    rejected(() => photos.checkDate(bad, null), "Invalid date.");
  }
  assertEquals(photos.checkDate("2024-02-29", null), "2024-02-29", "a leap day");
  rejected(() => photos.checkDate("2025-02-29", null), "Invalid date.");
});

Deno.test("an account's day is the UTC date it was created", () => {
  assertEquals(photos.accountDay({ created_at: new Date("2026-10-28T23:30:00Z") }), "2026-10-28");
  assertEquals(photos.accountDay({ created_at: new Date("2026-10-28T23:30:00-05:00") }), "2026-10-29");
});

Deno.test("images are recognised by their bytes and named by what they are", () => {
  assertEquals(photos.inspectImage(png()), [".png", "image/png"]);
  assertEquals(photos.inspectImage(jpeg()), [".jpg", "image/jpeg"]);
  for (const kind of ["VP8X", "VP8L", "VP8 "] as const) assertEquals(photos.inspectImage(webp(kind)), [".webp", "image/webp"], kind);
  for (const marker of [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC9, 0xCF]) assertEquals(photos.inspectImage(jpeg(8, 8, { marker })), [".jpg", "image/jpeg"], String(marker));
});

Deno.test("nothing, too much, and what is not a picture", () => {
  rejected(() => photos.inspectImage(new Uint8Array()), "No photo uploaded.");
  rejected(() => photos.inspectImage(new Uint8Array(photos.MAX_PHOTO_BYTES + 1)), "That photo is too large. Please keep it under 12 MB.", 413);
  const exactly = new Uint8Array(photos.MAX_PHOTO_BYTES);
  rejected(() => photos.inspectImage(exactly), "That file isn't a readable image.");
  for (const junk of ["not an image at all", "<svg xmlns='http://www.w3.org/2000/svg'/>", "%PDF-1.4 ....", "\u0089PNG", ""]) {
    if (junk) rejected(() => photos.inspectImage(new TextEncoder().encode(junk)), "That file isn't a readable image.");
  }
  rejected(() => photos.inspectImage(new Uint8Array([0xFF, 0xD8])), "That file isn't a readable image.");
});

Deno.test("formats Pillow can read but this app does not take are 'unsupported', not 'unreadable'", () => {
  const pad = (head: number[]) => new Uint8Array([...head, ...new Array(20).fill(0)]);
  const t = (s: string) => [...s].map((c) => c.charCodeAt(0));
  for (const head of [t("GIF89a"), t("GIF87a"), t("BM"), [0x49, 0x49, 0x2A, 0], [0x4D, 0x4D, 0, 0x2A], [0, 0, 1, 0], [0, 0, 0, 0x18, ...t("ftypheic")]]) {
    rejected(() => photos.inspectImage(pad(head)), "Unsupported image format.");
  }
});

Deno.test("a PNG must be whole: signature, a good IHDR first, every CRC right, an IEND", () => {
  rejected(() => photos.inspectImage(png(2, 2, { badCrc: true })), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(png(2, 2, { noEnd: true })), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(png(2, 2, { firstChunk: "IDAT" })), "That file isn't a readable image.");
  const whole = png();
  rejected(() => photos.inspectImage(whole.slice(0, whole.length - 5)), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(whole.slice(0, 20)), "That file isn't a readable image.");
  const damaged = whole.slice();
  damaged[20] ^= 1; // a byte inside IHDR: its CRC no longer matches
  rejected(() => photos.inspectImage(damaged), "That file isn't a readable image.");
  const nosig = whole.slice();
  nosig[1] = 0x51;
  rejected(() => photos.inspectImage(nosig), "That file isn't a readable image.");
});

Deno.test("a JPEG must reach a frame header with a size; a WebP must be a whole RIFF with a first chunk it knows", () => {
  rejected(() => photos.inspectImage(jpeg(2, 2, { noFrame: true })), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(jpeg(0, 5)), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(jpeg().slice(0, 25)), "That file isn't a readable image.");
  const w = webp();
  rejected(() => photos.inspectImage(w.slice(0, w.length - 4)), "That file isn't a readable image.");
  const odd = w.slice();
  odd.set([...("ABCD")].map((c) => c.charCodeAt(0)), 12);
  rejected(() => photos.inspectImage(odd), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(webp("VP8L").map((b, i) => (i === 20 ? 0 : b))), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(webp("VP8 ").map((b, i) => (i === 23 ? 0 : b))), "That file isn't a readable image.");
});

Deno.test("a picture bigger than Pillow would open is refused, one at the line is not", () => {
  const limit = photos.MAX_PIXELS;
  assertEquals(limit, 178_956_970);
  assertEquals(photos.inspectImage(png(13_377, 13_377))[0], ".png"); // 178,944,129 pixels
  rejected(() => photos.inspectImage(png(13_378, 13_378)), "That file isn't a readable image."); // 178,970,884
  rejected(() => photos.inspectImage(png(0, 5)), "That file isn't a readable image.");
  rejected(() => photos.inspectImage(png(5, 0)), "That file isn't a readable image.");
  assertEquals(photos.inspectImage(webp("VP8X", 16_384, 10_922))[0], ".webp");
});

Deno.test("a new name is 32 hex digits and the extension; the key is the person's folder and that", () => {
  assert(/^[0-9a-f]{32}\.png$/.test(photos.newName(".png")));
  assert(photos.newName(".png") !== photos.newName(".png"));
  assertEquals(photos.objectKey(USER, "abc.jpg"), `${USER}/abc.jpg`);
  assertEquals(photos.overLimitMessage(), "You've reached the maximum of 500 saved items here. Delete some to add more.");
});

Deno.test("recording a photo takes the person's lock first and refuses at the ceiling", async () => {
  const sqls: string[] = [];
  const full = new FakeDb((sql) => {
    sqls.push(sql);
    return sql.includes("count(*)") ? [{ n: "500" }] : [];
  });
  assertEquals(await full.transaction((tx) => photos.insertIfRoom(tx, USER, "2026-10-28", "front", "a.png")), null);
  assert(sqls[0].includes("pg_advisory_xact_lock(hashtextextended($1::text, 0))"));
  assertEquals(full.calls[0].params, [`progress_photos:${USER}`]);
  assert(!sqls.some((s) => s.startsWith("insert")), "nothing is inserted at the ceiling");
  const room = new FakeDb((sql) => sql.includes("count(*)") ? [{ n: "499" }] : sql.startsWith("insert") ? [{ id: 7 }] : []);
  assertEquals(await room.transaction((tx) => photos.insertIfRoom(tx, USER, "2026-10-28", "back", "b.jpg")), 7);
  assertEquals(room.calls.at(-1)!.params, [USER, "2026-10-28", "back", "b.jpg"]);
});

// ---- the routes ---------------------------------------------------------------------------------------------------

function form(fields: Record<string, string | undefined>, file?: { bytes: Uint8Array; name?: string; type?: string }): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v);
  if (file) f.set("photo", new File([file.bytes as BlobPart], file.name ?? "x.png", { type: file.type ?? "image/png" }));
  return f;
}

const profile = { id: USER, name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, ai_consent_at: null, deleted_at: null, created_at: new Date("2020-01-01T00:00:00Z") };

function world(options: { profile?: boolean; photos?: number | number[]; insertId?: number; dbFailsOnInsert?: boolean; storage?: (url: string, init: RequestInit) => Response | Error } = {}) {
  let countCalls = 0;
  const db = new FakeDb((sql) => {
    if (sql.includes("from public.profiles")) return options.profile === false ? [] : [profile];
    if (sql.includes("count(*)")) {
      const counts = Array.isArray(options.photos) ? options.photos : [options.photos ?? 0];
      return [{ n: String(counts[Math.min(countCalls++, counts.length - 1)]) }];
    }
    if (sql.startsWith("insert into public.progress_photos")) {
      if (options.dbFailsOnInsert) return new Error("database down");
      return [{ id: options.insertId ?? 11 }];
    }
    return [];
  });
  const t = fakeTransport(options.storage ?? (() => new Response("{}")));
  return { db, t, call: app(db, {}, undefined, t.transport) };
}

const upload = async (call: ReturnType<typeof world>["call"], fields: Record<string, string | undefined>, file?: Parameters<typeof form>[1]) =>
  call("/api/checkin/photo", { method: "POST", headers: await bearer(), body: form(fields, file) });

Deno.test("POST photo: a good upload is stored under the person's folder with its true type and recorded", async () => {
  const w = world();
  const r = await upload(w.call, { angle: "front", date: today() }, { bytes: png(), name: "mine.JPG", type: "image/jpeg" });
  assertEquals([r.status, await r.json()], [200, { ok: true, id: 11 }]);
  const put = w.t.requests[0];
  assertEquals(put.method, "POST");
  assert(new RegExp(`/storage/v1/object/progress-photos/${USER}/[0-9a-f]{32}\\.png$`).test(put.url), put.url);
  assertEquals([put.headers["content-type"], put.headers["x-upsert"]], ["image/png", "false"]);
  const insert = w.db.calls.find((c) => c.sql.startsWith("insert into public.progress_photos"))!;
  assertEquals(insert.params.slice(0, 3), [USER, today(), "front"]);
  assert(new RegExp("^[0-9a-f]{32}\\.png$").test(String(insert.params[3])));
  assert(put.url.endsWith(String(insert.params[3])), "the row names the file that was stored");
});

Deno.test("POST photo: angle, file, profile and date are checked, in that order, before anything is stored", async () => {
  const w = world();
  const bad = async (fields: Record<string, string | undefined>, file: Parameters<typeof form>[1] | undefined, status: number, message: string) => {
    const r = await upload(w.call, fields, file);
    assertEquals([r.status, (await r.json()).error], [status, message], JSON.stringify(fields));
  };
  await bad({ date: today() }, { bytes: png() }, 400, "angle must be 'front' or 'back'.");
  await bad({ angle: "side", date: today() }, { bytes: png() }, 400, "angle must be 'front' or 'back'.");
  await bad({ angle: "FRONT", date: today() }, { bytes: png() }, 400, "angle must be 'front' or 'back'.");
  await bad({ angle: "front", date: today() }, undefined, 400, "No photo uploaded.");
  await bad({ angle: "front", date: "nope" }, { bytes: png() }, 400, "Invalid date.");
  await bad({ angle: "front", date: addDays(5) }, { bytes: png() }, 400, "Invalid date.");
  await bad({ angle: "front", date: "2019-12-31" }, { bytes: png() }, 400, "Invalid date.");
  await bad({ angle: "front" }, { bytes: png() }, 400, "Invalid date.");
  await bad({ angle: "front", date: today() }, { bytes: new Uint8Array() }, 400, "No photo uploaded.");
  await bad({ angle: "front", date: today() }, { bytes: new TextEncoder().encode("hello") }, 400, "That file isn't a readable image.");
  await bad({ angle: "front", date: today() }, { bytes: new Uint8Array(photos.MAX_PHOTO_BYTES + 1) }, 413, "That photo is too large. Please keep it under 12 MB.");
  assertEquals(w.t.requests.length, 0, "no storage call for any of them");
  const none = world({ profile: false });
  const r = await upload(none.call, { angle: "front", date: today() }, { bytes: png() });
  assertEquals([r.status, (await r.json()).error], [404, "No profile yet. Create it first."]);
});

Deno.test("POST photo: not a form at all is just a missing photo", async () => {
  const w = world();
  const r = await w.call("/api/checkin/photo", { method: "POST", headers: await bearer(), json: { angle: "front" } });
  assertEquals([r.status, (await r.json()).error], [400, "angle must be 'front' or 'back'."]);
});

Deno.test("POST photo: too large is a 413 before the body is read, by header and by count", async () => {
  const w = world();
  const huge = await w.call("/api/checkin/photo", { method: "POST", headers: { ...(await bearer()), "Content-Length": String(photos.MAX_PHOTO_BYTES + 64 * 1024 + 1), "Content-Type": "multipart/form-data; boundary=x" }, body: "x" });
  assertEquals([huge.status, (await huge.json()).error], [413, "That request is too large."]);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(photos.MAX_PHOTO_BYTES));
      c.enqueue(new Uint8Array(64 * 1024 + 1));
      c.close();
    },
  });
  const chunked = await w.call("/api/checkin/photo", { method: "POST", headers: { ...(await bearer()), "Content-Type": "multipart/form-data; boundary=x" }, body: stream, duplex: "half" } as RequestInit);
  assertEquals(chunked.status, 413);
  assertEquals(w.t.requests.length, 0);
});

Deno.test("POST photo: at the ceiling is a 429, early and again under the lock", async () => {
  const early = world({ photos: 500 });
  const r = await upload(early.call, { angle: "front", date: today() }, { bytes: png() });
  assertEquals([r.status, (await r.json()).error], [429, "You've reached the maximum of 500 saved items here. Delete some to add more."]);
  assertEquals(early.t.requests.length, 0, "the cheap check refuses before storing");
  const raced = world({ photos: [499, 500] }); // room when looked at, none by the time the lock is held
  const r2 = await upload(raced.call, { angle: "back", date: today() }, { bytes: png() });
  assertEquals(r2.status, 429);
  assertEquals(raced.t.requests.map((q) => q.method), ["POST", "DELETE"], "the file is stored, found to have no room, and taken away again");
  assertEquals((raced.t.requests[1].body as { prefixes: string[] }).prefixes.length, 1);
});

Deno.test("POST photo: a refused or failed storage is told apart, and a failed record leaves no orphan file", async () => {
  const refused = world({ storage: () => new Response(JSON.stringify({ statusCode: "413", message: "too big" }), { status: 400 }) });
  const a = await upload(refused.call, { angle: "front", date: today() }, { bytes: png() });
  assertEquals([a.status, (await a.json()).error], [400, "That photo can't be saved. Please try a different one."]);
  const down = world({ storage: () => new Response("", { status: 503 }) });
  const b = await upload(down.call, { angle: "front", date: today() }, { bytes: png() });
  assertEquals([b.status, (await b.json()).error], [502, "We couldn't save your photo. Please try again."]);
  const orphan = world({ dbFailsOnInsert: true });
  const logged = console.error;
  console.error = () => {};
  try {
    const c = await upload(orphan.call, { angle: "front", date: today() }, { bytes: png() });
    assertEquals(c.status, 500);
  } finally {
    console.error = logged;
  }
  assertEquals(orphan.t.requests.map((q) => q.method), ["POST", "DELETE"], "the stored file is removed when the row could not be written");
});

Deno.test("GET photos: the caller's own, newest first, as plain days", async () => {
  const db = new FakeDb(() => [{ id: 3, date: new Date("2026-10-28T00:00:00Z"), angle: "back" }, { id: 2, date: new Date("2026-10-21T00:00:00Z"), angle: "front" }]);
  const r = await app(db)("/api/checkin/photos", { headers: await bearer() });
  assertEquals(await r.json(), { ok: true, photos: [{ id: 3, date: "2026-10-28", angle: "back" }, { id: 2, date: "2026-10-21", angle: "front" }] });
  assertEquals(db.calls[0].params, [USER]);
  assert(db.calls[0].sql.includes("order by date desc, angle asc"));
});

Deno.test("GET photo: a short-lived link to the caller's own file, 404 for anyone else's or a missing file", async () => {
  const row = { id: 3, date: new Date(), angle: "front", filename: "abc.png" };
  const ok = world();
  ok.db.calls.length = 0;
  const found = new FakeDb(() => [row]);
  const t = fakeTransport(() => new Response(JSON.stringify({ signedURL: "/object/sign/progress-photos/x?token=t" })));
  const r = await app(found, {}, undefined, t.transport)("/api/checkin/photo/3", { headers: await bearer() });
  assertEquals(await r.json(), { ok: true, url: `${PROJECT}/storage/v1/object/sign/progress-photos/x?token=t`, expires_in: 300 });
  assertEquals(found.calls[0].params, [3, USER], "scoped to the caller in SQL");
  assertEquals(t.requests[0].url, `${PROJECT}/storage/v1/object/sign/progress-photos/${USER}/abc.png`);
  assertEquals(t.requests[0].body, { expiresIn: 300 });
  const notMine = await app(new FakeDb(() => []))("/api/checkin/photo/3", { headers: await bearer() });
  assertEquals([notMine.status, (await notMine.json()).error], [404, "Not found."]);
  const gone = await app(new FakeDb(() => [row]), {}, undefined, fakeTransport(() => new Response("{}", { status: 404 })).transport)("/api/checkin/photo/3", { headers: await bearer() });
  assertEquals(gone.status, 404);
  const down = await app(new FakeDb(() => [row]), {}, undefined, fakeTransport(() => new Response("{}", { status: 401 })).transport)("/api/checkin/photo/3", { headers: await bearer() });
  assertEquals([down.status, (await down.json()).error], [502, "We couldn't load your photo. Please try again."]);
  const notNumber = await app()("/api/checkin/photo/abc", { headers: await bearer() });
  assertEquals(notNumber.status, 404);
});

Deno.test("DELETE photo: the file goes first, and if it will not go the row stays", async () => {
  const row = { id: 3, date: new Date(), angle: "front", filename: "abc.png" };
  const db = new FakeDb((sql) => sql.startsWith("select") ? [row] : 1);
  const t = fakeTransport();
  const r = await app(db, {}, undefined, t.transport)("/api/checkin/photo/3", { method: "DELETE", headers: await bearer() });
  assertEquals([r.status, await r.json()], [200, { ok: true }]);
  assertEquals(t.requests[0].body, { prefixes: [`${USER}/abc.png`] });
  assertEquals(db.calls.at(-1)!.params, [3, USER]);
  assert(db.calls.at(-1)!.sql.startsWith("delete from public.progress_photos"));

  const stuck = new FakeDb((sql) => sql.startsWith("select") ? [row] : 1);
  const bad = await app(stuck, {}, undefined, fakeTransport(() => new Response("", { status: 400 })).transport)("/api/checkin/photo/3", { method: "DELETE", headers: await bearer() });
  assertEquals([bad.status, (await bad.json()).error], [502, "We couldn't delete your photo. Please try again."]);
  assert(!stuck.calls.some((c) => c.sql.startsWith("delete")), "the row must stay when the file could not be removed");

  const none = await app(new FakeDb(() => []))("/api/checkin/photo/3", { method: "DELETE", headers: await bearer() });
  assertEquals([none.status, (await none.json()).error], [404, "Not found."]);
});

Deno.test("every photo route demands a token", async () => {
  const call = app();
  for (const [method, path] of [["POST", "/api/checkin/photo"], ["GET", "/api/checkin/photos"], ["GET", "/api/checkin/photo/3"], ["DELETE", "/api/checkin/photo/3"]]) {
    assertEquals((await call(path, { method })).status, 401, `${method} ${path}`);
  }
});

// ---- the router's path parameters ---------------------------------------------------------------------------------------------

Deno.test("path parameters: <int:x> is digits only, <x> is anything but a slash, and both are handed to the route", async () => {
  const router = new Router()
    .get("/api/a/<int:id>", ({ params }) => json({ id: params.id }), { auth: false })
    .get("/api/b/<name>", ({ params }) => json({ name: params.name }), { auth: false })
    .get("/api/c/<int:one>/d/<two>", ({ params }) => json(params), { auth: false })
    .delete("/api/a/<int:id>", () => json({ ok: true }), { auth: false });
  const handler = createHandler(services(), router);
  const get = async (path: string, method = "GET") => {
    const r = await handler(new Request(`${PROJECT}/functions/v1${path}`, { method }));
    return [r.status, await r.json()];
  };
  assertEquals(await get("/api/a/42"), [200, { id: "42" }]);
  assertEquals((await get("/api/a/4x"))[0], 404);
  assertEquals((await get("/api/a/-4"))[0], 404);
  assertEquals((await get("/api/a/"))[0], 404);
  assertEquals((await get("/api/a/4/5"))[0], 404);
  assertEquals((await get("/api/a/42", "POST"))[0], 405);
  assertEquals((await get("/api/a/42", "DELETE"))[0], 200);
  assertEquals(await get("/api/b/hello%20there"), [200, { name: "hello there" }]);
  assertEquals((await get("/api/b/a/b"))[0], 404);
  assertEquals(await get("/api/c/7/d/x.y"), [200, { one: "7", two: "x.y" }]);
  assertEquals((await get("/api/a.b/1"))[0], 404, "a dot in the route's text is a dot, not any character");
});
