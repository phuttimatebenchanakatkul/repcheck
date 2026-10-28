import { assert, assertEquals, assertRejects } from "@std/assert";

import { AuthAdmin, Refused, Storage, SupabaseError, WeakPassword } from "../_shared/supabaseAdmin.ts";
import { fakeTransport, PROJECT } from "./support.ts";

const KEY = "service-key-123";
const ok = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });

function storage(answer?: Parameters<typeof fakeTransport>[0]) {
  const t = fakeTransport(answer);
  const sleeps: number[] = [];
  const transport = { ...t.transport, sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()) };
  return { store: new Storage(PROJECT, KEY, transport), requests: t.requests, sleeps };
}

function admin(answer?: Parameters<typeof fakeTransport>[0]) {
  const t = fakeTransport(answer);
  const sleeps: number[] = [];
  const transport = { ...t.transport, sleep: (ms: number) => (sleeps.push(ms), Promise.resolve()) };
  return { auth: new AuthAdmin(PROJECT, KEY, transport), requests: t.requests, sleeps };
}

Deno.test("a 429, a 5xx and a dropped connection are retried with a growing wait", async () => {
  const answers = [new Response("", { status: 429 }), new TypeError("connection reset"), new Response("", { status: 503 }), ok()];
  const { store, requests, sleeps } = storage(() => answers.shift()!);
  await store.upload("progress-photos", "u/a.jpg", new Uint8Array([1]), "image/jpeg");
  assertEquals(requests.length, 4);
  assertEquals(sleeps, [1000, 2000, 4000]);
});

Deno.test("it gives up after four attempts with an error that names no secret", async () => {
  const { store, requests, sleeps } = storage(() => new Response("", { status: 502 }));
  const e = await assertRejects(() => store.download("progress-photos", "u/a.jpg"), SupabaseError);
  assertEquals(requests.length, 4);
  assertEquals(sleeps, [1000, 2000, 4000], "no pointless wait after the last attempt");
  assert(!e.message.includes(KEY) && !e.message.includes("progress-photos"), e.message);
  assertEquals(e.message, "GET a.jpg kept failing: 502");
});

Deno.test("a real refusal is returned, not retried", async () => {
  const { auth, requests } = admin(() => ok({}, 400));
  await assertRejects(() => auth.setPassword("u1", "pw"), SupabaseError);
  assertEquals(requests.length, 1);
});

Deno.test("upload posts the bytes to the object with its type and the service key", async () => {
  const { store, requests } = storage();
  await store.upload("analyze-videos", "u1/clip.mp4", new Uint8Array([1, 2, 3]), "video/mp4");
  const [r] = requests;
  assertEquals([r.method, r.url], ["POST", `${PROJECT}/storage/v1/object/analyze-videos/u1/clip.mp4`]);
  assertEquals([r.headers["content-type"], r.headers["x-upsert"], r.headers["apikey"], r.headers["authorization"]], ["video/mp4", "true", KEY, `Bearer ${KEY}`]);
});

Deno.test("upload can refuse to overwrite", async () => {
  const { store, requests } = storage();
  await store.upload("analyze-videos", "u1/a", new Uint8Array(), "video/mp4", false);
  assertEquals(requests[0].headers["x-upsert"], "false");
});

Deno.test("a key is percent-encoded like Python's quote, keeping its folder slash", async () => {
  const { store, requests } = storage();
  await store.upload("progress-photos", "u1/my photo (1)!'*.jpg", new Uint8Array(), "image/jpeg");
  assertEquals(requests[0].url, `${PROJECT}/storage/v1/object/progress-photos/u1/my%20photo%20%281%29%21%27%2A.jpg`);
});

Deno.test("a file the bucket turns away raises Refused with Storage's reason", async () => {
  for (const code of ["413", "415"]) {
    const { store } = storage(() => ok({ statusCode: code, message: "too big", error: "x" }, 400));
    const e = await assertRejects(() => store.upload("b", "u/k", new Uint8Array(), "image/png"), Refused);
    assertEquals(e.message, "too big");
  }
  const { store } = storage(() => ok({ statusCode: 413, error: "Payload too large" }, 400));
  assertEquals((await assertRejects(() => store.upload("b", "u/k", new Uint8Array(), "image/png"), Refused)).message, "Payload too large");
  const { store: bare } = storage(() => ok({ statusCode: "413" }, 400));
  assertEquals((await assertRejects(() => bare.upload("b", "u/k", new Uint8Array(), "image/png"), Refused)).message, "file refused");
});

Deno.test("any other upload failure is a plain SupabaseError", async () => {
  for (const [status, body] of [[400, { statusCode: "400" }], [400, {}], [401, {}], [403, { statusCode: "413" }], [404, {}]] as const) {
    const { store } = storage(() => ok(body, status));
    const e = await assertRejects(() => store.upload("b", "u/k", new Uint8Array(), "image/png"), SupabaseError);
    assert(!(e instanceof Refused), `${status} ${JSON.stringify(body)}`);
    assertEquals(e.message, `uploading to b answered ${status}`);
  }
});

Deno.test("download returns the bytes and null for a missing object", async () => {
  const { store, requests } = storage(() => new Response(new Uint8Array([9, 8, 7])));
  assertEquals(await store.download("progress-photos", "u/a.jpg"), new Uint8Array([9, 8, 7]));
  assertEquals(requests[0].url, `${PROJECT}/storage/v1/object/authenticated/progress-photos/u/a.jpg`);
  for (const answer of [() => ok({}, 404), () => ok({ statusCode: "404" }, 400)]) {
    assertEquals(await storage(answer).store.download("b", "u/k"), null);
  }
});

Deno.test("download raises on anything else", async () => {
  for (const status of [400, 401, 403]) {
    const e = await assertRejects(() => storage(() => ok({}, status)).store.download("b", "u/k"), SupabaseError);
    assertEquals(e.message, `downloading from b answered ${status}`);
  }
});

Deno.test("sign asks for an expiry and returns a full URL or null", async () => {
  const { store, requests } = storage(() => ok({ signedURL: "/object/sign/b/u/k?token=abc" }));
  assertEquals(await store.sign("b", "u/k", 120.9), `${PROJECT}/storage/v1/object/sign/b/u/k?token=abc`);
  assertEquals(requests[0].body, { expiresIn: 120 });
  assertEquals((requests[0].headers["content-type"]), "application/json");
  await store.sign("b", "u/k");
  assertEquals(requests[1].body, { expiresIn: 300 });
  for (const answer of [() => ok({}, 404), () => ok({ statusCode: "404" }, 400)]) assertEquals(await storage(answer).store.sign("b", "u/k"), null);
});

Deno.test("a 200 without a signed URL is not mistaken for success", async () => {
  const e = await assertRejects(() => storage(() => ok({})).store.sign("b", "u/k"), SupabaseError);
  assertEquals(e.message, "signing a b object answered 200");
});

Deno.test("remove deletes in batches of a hundred and reports the keys it could not", async () => {
  const keys = Array.from({ length: 250 }, (_, i) => `u/${i}`);
  let call = 0;
  const { store, requests } = storage(() => ok({}, ++call === 2 ? 400 : 200));
  const failed = await store.remove("progress-photos", keys);
  assertEquals(requests.map((r) => (r.body as { prefixes: string[] }).prefixes.length), [100, 100, 50]);
  assertEquals(failed, keys.slice(100, 200));
  assertEquals([requests[0].method, requests[0].url], ["DELETE", `${PROJECT}/storage/v1/object/progress-photos`]);
});

Deno.test("remove with nothing to remove makes no call, and a batch the service keeps failing is reported not thrown", async () => {
  const { store, requests } = storage();
  assertEquals(await store.remove("b", []), []);
  assertEquals(requests.length, 0);
  const down = storage(() => new Response("", { status: 503 }));
  assertEquals(await down.store.remove("b", ["u/1", "u/2"]), ["u/1", "u/2"]);
});

Deno.test("a key that does not exist is not a failed removal", async () => {
  assertEquals(await storage(() => ok([], 200)).store.remove("b", ["u/gone"]), []);
});

Deno.test("deleting an Auth user treats gone as done and anything odd as an error", async () => {
  for (const status of [200, 404]) assertEquals(await admin(() => ok({}, status)).auth.deleteUser("u1"), true);
  for (const status of [400, 401, 403, 422]) {
    const e = await assertRejects(() => admin(() => ok({}, status)).auth.deleteUser("u1"), SupabaseError);
    assertEquals(e.message, `deleting an Auth user answered ${status}`);
  }
  const { auth, requests } = admin();
  await auth.deleteUser("abc");
  assertEquals([requests[0].method, requests[0].url], ["DELETE", `${PROJECT}/auth/v1/admin/users/abc`]);
});

Deno.test("set password puts only the password to that user with the service key", async () => {
  const { auth, requests } = admin();
  await auth.setPassword("u1", "correct horse");
  const [r] = requests;
  assertEquals([r.method, r.url, r.body], ["PUT", `${PROJECT}/auth/v1/admin/users/u1`, { password: "correct horse" }]);
  assertEquals([r.headers["apikey"], r.headers["authorization"], r.headers["content-type"]], [KEY, `Bearer ${KEY}`, "application/json"]);
});

Deno.test("a password the policy refuses is a WeakPassword and is not retried", async () => {
  const { auth, requests } = admin(() => ok({ error_code: "weak_password" }, 422));
  await assertRejects(() => auth.setPassword("u1", "123"), WeakPassword);
  assertEquals(requests.length, 1);
  assert(new WeakPassword("x") instanceof SupabaseError);
});

Deno.test("any other refusal is a plain SupabaseError that names neither the password nor the key", async () => {
  for (const [status, body] of [[422, { error_code: "other" }], [422, {}], [400, { error_code: "weak_password" }], [401, {}]] as const) {
    const e = await assertRejects(() => admin(() => ok(body, status)).auth.setPassword("u1", "hunter2"), SupabaseError);
    assert(!(e instanceof WeakPassword));
    assertEquals(e.message, `setting a password answered ${status}`);
  }
});

Deno.test("a 5xx while setting a password is retried and then succeeds", async () => {
  const answers = [new Response("", { status: 500 }), ok()];
  const { auth, requests } = admin(() => answers.shift()!);
  await auth.setPassword("u1", "pw");
  assertEquals(requests.length, 2);
});

Deno.test("a non-JSON error body is treated as empty", async () => {
  const e = await assertRejects(() => admin(() => new Response("<html>nope</html>", { status: 422 })).auth.setPassword("u1", "x"), SupabaseError);
  assert(!(e instanceof WeakPassword));
});
