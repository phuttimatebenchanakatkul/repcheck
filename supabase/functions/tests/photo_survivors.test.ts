import { assert, assertEquals } from "@std/assert";

import { readFormBounded } from "../_shared/http.ts";
import { MAX_PASSWORD_CHARS, migrate, Outcome } from "../_shared/legacy.ts";
import { checkPasswordHash } from "../_shared/passwordHash.ts";
import { inspectImage, jpegSize, MAX_PIXELS, pngSize, webpSize } from "../_shared/photos.ts";
import { AuthAdmin } from "../_shared/supabaseAdmin.ts";
import { app, FakeDb, fakeTransport, PROJECT } from "./support.ts";
import { jpeg, png, webp } from "./images.ts";

const readable = "That file isn't a readable image.";
const refused = (bytes: Uint8Array, message: string) => {
  try {
    inspectImage(bytes);
  } catch (e) {
    assertEquals((e as Error).message, message);
    return;
  }
  throw new Error("accepted");
};
const t = (s: string) => [...s].map((c) => c.charCodeAt(0));

// ---- sizes are read from the right bytes ----------------------------------------------------------------------------

Deno.test("a PNG's size is its IHDR's two 32-bit numbers, every byte of them", () => {
  assertEquals(pngSize(png(0x01020304, 0x05060708)), [0x01020304, 0x05060708]);
  assertEquals(pngSize(png(1, 1)), [1, 1]);
});

Deno.test("a JPEG's size is read from its frame header, whichever kind of frame it is, every byte of it", () => {
  for (const marker of [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF]) {
    assertEquals(jpegSize(jpeg(0x0102, 0x0304, { marker })), [0x0102, 0x0304], marker.toString(16));
  }
  assertEquals(jpegSize(jpeg(1, 1)), [1, 1]);
});

Deno.test("a WebP's size is read from the right place for each of its three kinds, every byte of it", () => {
  assertEquals(webpSize(webp("VP8X", 0x0A0B0D, 0x0D0E10)), [0x0A0B0D, 0x0D0E10]);
  assertEquals(webpSize(webp("VP8X", 1, 1)), [1, 1]);
  assertEquals(webpSize(webp("VP8L", 0x1234, 0x2ABC)), [0x1234, 0x2ABC]);
  assertEquals(webpSize(webp("VP8L", 1, 1)), [1, 1]);
  assertEquals(webpSize(webp("VP8L", 16384, 16384)), [16384, 16384]);
  assertEquals(webpSize(webp("VP8 ", 0x1234, 0x2ABC)), [0x1234, 0x2ABC]);
  assertEquals(webpSize(webp("VP8 ", 0x3FFF, 0x3FFF)), [0x3FFF, 0x3FFF]);
});

Deno.test("a WebP bigger than 64 KB (so its RIFF size uses a third byte) is still read whole", () => {
  assertEquals(inspectImage(webp("VP8X", 2, 2, 70_000)), [".webp", "image/webp"]);
  assertEquals(inspectImage(webp("VP8L", 2, 2, 300_000)), [".webp", "image/webp"]);
});

// ---- a file is only taken once the bytes the checker reads are all there --------------------------------------------

Deno.test("a PNG is taken from the moment its IEND chunk's header is there, and not a byte sooner", () => {
  const whole = png(7, 9);
  for (let n = 0; n <= whole.length; n++) {
    const got = pngSize(whole.slice(0, n));
    assertEquals(got !== null, n >= whole.length - 4, `prefix of ${n}`);
  }
});

Deno.test("a JPEG is taken from the moment its frame header's size bytes are there, and not a byte sooner", () => {
  const whole = jpeg(7, 9);
  const frame = whole.findIndex((b, i) => b === 0xFF && whole[i + 1] === 0xC0);
  for (let n = 0; n <= whole.length; n++) {
    assertEquals(jpegSize(whole.slice(0, n)) !== null, n >= frame + 9, `prefix of ${n}`);
  }
});

Deno.test("a WebP is taken only when the whole file its RIFF header promises is there", () => {
  for (const kind of ["VP8X", "VP8L", "VP8 "] as const) {
    const whole = webp(kind, 7, 9, 5);
    for (let n = 0; n <= whole.length; n++) assertEquals(webpSize(whole.slice(0, n)) !== null, n === whole.length, `${kind} prefix of ${n}`);
  }
});

Deno.test("a WebP's first chunk must be big enough to hold its size, to the byte", () => {
  const withChunkSize = (kind: "VP8X" | "VP8L" | "VP8 ", size: number) => {
    const b = webp(kind, 7, 9);
    new DataView(b.buffer).setUint32(16, size, true);
    return b;
  };
  assertEquals(webpSize(withChunkSize("VP8X", 9)), null);
  assertEquals(webpSize(withChunkSize("VP8X", 10)), [7, 9]);
  assertEquals(webpSize(withChunkSize("VP8L", 4)), null);
  assertEquals(webpSize(withChunkSize("VP8L", 5)), [7, 9]);
  assertEquals(webpSize(withChunkSize("VP8 ", 9)), null);
  assertEquals(webpSize(withChunkSize("VP8 ", 10)), [7, 9]);
});

// ---- the JPEG marker walk -------------------------------------------------------------------------------------------

Deno.test("a JPEG may have fill bytes, restart markers and empty segments before its frame header", () => {
  const cases: [string, number[]][] = [
    ["a fill byte", [0xFF]],
    ["two fill bytes", [0xFF, 0xFF]],
    ["a TEM marker", [0xFF, 0x01]],
    ["each restart marker", [0xFF, 0xD0, 0xFF, 0xD1, 0xFF, 0xD2, 0xFF, 0xD3, 0xFF, 0xD4, 0xFF, 0xD5, 0xFF, 0xD6, 0xFF, 0xD7]],
    ["an empty comment", [0xFF, 0xFE, 0x00, 0x02]],
    ["a comment of ten bytes", [0xFF, 0xFE, 0x00, 0x0C, ...new Array(10).fill(0x41)]],
    ["a Huffman table, which is not a frame", [0xFF, 0xC4, 0x00, 0x05, 0, 0, 0]],
    ["a JPEG-extension marker, which is not a frame", [0xFF, 0xC8, 0x00, 0x04, 0, 0]],
    ["an arithmetic-conditioning marker, which is not a frame", [0xFF, 0xCC, 0x00, 0x04, 0, 0]],
  ];
  for (const [what, before] of cases) assertEquals(jpegSize(jpeg(0x0102, 0x0304, { before })), [0x0102, 0x0304], what);
});

Deno.test("a JPEG with a broken segment before its frame is refused", () => {
  for (
    const [what, before] of [
      ["a segment shorter than its own length bytes", [0xFF, 0xFE, 0x00, 0x01]],
      ["a segment length of zero", [0xFF, 0xFE, 0x00, 0x00]],
      ["a byte that is not a marker", [0x12, 0x34]],
      ["the end of the image before any frame", [0xFF, 0xD9]],
      ["a segment running off the end", [0xFF, 0xFE, 0xFF, 0xFF]],
    ] as [string, number[]][]
  ) assertEquals(jpegSize(jpeg(5, 5, { before })), null, what);
  const shortFrame = jpeg(5, 5, { noFrame: true, before: [0xFF, 0xC0, 0x00, 0x07, 8, 0, 5, 0, 5] });
  assertEquals(jpegSize(shortFrame), null, "a frame header too short to hold a size");
});

// ---- what is a picture, what is unsupported, how big may it be -------------------------------------------------------

Deno.test("another picture format needs 12 bytes to be recognised, and every byte of its signature", () => {
  const pad = (head: number[], total: number) => new Uint8Array([...head, ...new Array(Math.max(0, total - head.length)).fill(0x41)].slice(0, total));
  for (const head of [t("GIF89a"), t("GIF87a"), t("BM"), [0x49, 0x49, 0x2A, 0], [0x4D, 0x4D, 0, 0x2A], [0, 0, 1, 0]]) {
    refused(pad(head, 12), "Unsupported image format.");
    refused(pad(head, 11), readable);
  }
  refused(pad([0, 0, 0, 0x18, ...t("ftypheic")], 12), "Unsupported image format.");
  refused(pad([0, 0, 0, 0x18, ...t("ftypheic")], 11), readable);
  for (const near of [[1, 0, 1, 0], [0, 1, 1, 0], [0, 0, 2, 0], [0, 0, 1, 1], t("GIF88a"), t("GIF89b"), t("bM"), [0x49, 0x49, 0x2B, 0], [0x4D, 0x4D, 1, 0x2A]]) refused(pad(near, 40), readable);
});

Deno.test("a picture exactly as many pixels as Pillow would open is taken, one more is not; one pixel is a picture", () => {
  assertEquals(MAX_PIXELS, 178_956_970);
  assertEquals(inspectImage(png(MAX_PIXELS, 1))[0], ".png");
  refused(png(MAX_PIXELS + 1, 1), readable);
  assertEquals(inspectImage(png(1, MAX_PIXELS))[0], ".png");
  refused(png(1, MAX_PIXELS + 1), readable);
  assertEquals(inspectImage(png(1, 1))[0], ".png");
  assertEquals(inspectImage(jpeg(1, 1))[0], ".jpg");
  assertEquals(inspectImage(webp("VP8X", 1, 1))[0], ".webp");
  refused(jpeg(0, 1), readable);
  refused(jpeg(1, 0), readable);
});

Deno.test("a PNG needs its signature in full to be a PNG, but a short file is never taken for one", () => {
  const whole = png();
  for (let i = 0; i < 8; i++) {
    const broken = whole.slice();
    broken[i] ^= 0x20;
    refused(broken, readable);
  }
  refused(whole.slice(0, 8), readable);
  refused(whole.slice(0, 7), readable);
  refused(new Uint8Array([0xFF, 0xD8, 0xFF]), readable);
  refused(new Uint8Array(t("RIFF\0\0\0\0WEBP")), readable);
});

// ---- the upload reader ------------------------------------------------------------------------------------------------

Deno.test("the upload reader takes exactly its limit, by declared length and by count, and refuses one byte more", async () => {
  const limit = 100;
  const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("https://x.test/", { method: "POST", body, headers });
  await readFormBounded(post(new Uint8Array(limit), { "content-length": String(limit) }), limit);
  for (const bad of [post(new Uint8Array(limit + 1)), post("x", { "content-length": String(limit + 1) })]) {
    let status = 0;
    try {
      await readFormBounded(bad, limit);
    } catch (e) {
      status = (e as { response: Response }).response.status;
    }
    assertEquals(status, 413);
  }
  const chunked = (n: number) => post(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(n)); c.close(); } }), {});
  (await readFormBounded(Object.assign(chunked(limit)), limit)).has("x");
  let over = 0;
  try {
    await readFormBounded(chunked(limit + 1), limit);
  } catch (e) {
    over = (e as { response: Response }).response.status;
  }
  assertEquals(over, 413);
  assertEquals((await readFormBounded(post("hello"), limit)).has("anything"), false, "not a form at all is no fields, not an error");
});

// ---- legacy sign-in ---------------------------------------------------------------------------------------------------

Deno.test("hashes with an empty salt, an empty method, or a stored cost nobody could pay are handled, not crashed on", () => {
  assert(!checkPasswordHash("$salt$00", "x"), "no method");
  assert(!checkPasswordHash("scrypt:2097152:8:1$salt$" + "00".repeat(64), "x"), "a cost that would need 2 GiB is refused, not attempted");
  assert(!checkPasswordHash("scrypt:1024:8:1$$" + "00".repeat(64), "x"), "an empty salt is a salt, and this is not its hash");
  assert(!checkPasswordHash("a$b", "x"));
});

Deno.test("the longest password is 1000 characters and a one-character password is a password", async () => {
  assertEquals(MAX_PASSWORD_CHARS, 1000);
  const hash = "scrypt:1024:8:1$zUm3XfAsbJxLUeIY$a18ef5112238cd07ebc46df249418a7316d0a0e696272940f00a220fb9f0d976a8be156b44af105f99a2b77d4d273ec0c92817d0b81af3c981eaaf47a0cca6f2";
  const db = new FakeDb((sql, params) => sql.startsWith("insert") ? [{ window_start: 1 }] : sql.includes("legacy_password_hashes h") ? [{ id: "123e4567-e89b-12d3-a456-426614174000", password_hash: hash }] : 1);
  const admin = new AuthAdmin(PROJECT, "k", fakeTransport().transport);
  assertEquals(await migrate(db, admin, "sam@example.com", "x", "1.2.3.4", 1_800_000_000), [Outcome.MIGRATED, 0]);
});

Deno.test("a limit and a refused password both say ok:false", async () => {
  const limited = new FakeDb((sql) => sql.includes("returning") ? [] : sql.startsWith("select window_start") ? [{ window_start: Math.floor(Date.now() / 1000) }] : []);
  const r = await app(limited)("/api/auth/legacy-login", { method: "POST", json: { email: "a@b.co", password: "x" } });
  assertEquals((await r.json()).ok, false);
  const hash = "scrypt:1024:8:1$zUm3XfAsbJxLUeIY$a18ef5112238cd07ebc46df249418a7316d0a0e696272940f00a220fb9f0d976a8be156b44af105f99a2b77d4d273ec0c92817d0b81af3c981eaaf47a0cca6f2";
  const db = new FakeDb((sql) => sql.startsWith("insert") ? [{ window_start: 1 }] : sql.includes("legacy_password_hashes h") ? [{ id: "123e4567-e89b-12d3-a456-426614174000", password_hash: hash }] : 1);
  const weak = await app(db, {}, undefined, fakeTransport(() => new Response(JSON.stringify({ error_code: "weak_password" }), { status: 422 })).transport)(
    "/api/auth/legacy-login",
    { method: "POST", json: { email: "sam@example.com", password: "x" } },
  );
  assertEquals((await weak.json()).ok, false);
});

// ---- the last survivors -------------------------------------------------------------------------------------------------

Deno.test("a WebP whose first chunk claims more bytes than the file has is refused, even when the RIFF size is right", () => {
  const b = webp("VP8X", 7, 9);
  new DataView(b.buffer).setUint32(16, 1000, true);
  assertEquals(webpSize(b), null);
});

Deno.test("a lossy WebP needs all three bytes of its start code", () => {
  for (const at of [23, 24, 25]) {
    const b = webp("VP8 ", 7, 9);
    b[at] ^= 0xFF;
    assertEquals(webpSize(b), null, `byte ${at}`);
  }
  assertEquals(webpSize(webp("VP8 ", 7, 9)), [7, 9]);
});

Deno.test("a JPEG frame header of exactly eight bytes of length is a frame header", () => {
  const eight = jpeg(5, 5, { noFrame: true, before: [0xFF, 0xC0, 0x00, 0x08, 8, 0, 5, 0, 6] });
  assertEquals(jpegSize(eight), [6, 5]);
  const seven = jpeg(5, 5, { noFrame: true, before: [0xFF, 0xC0, 0x00, 0x07, 8, 0, 5, 0, 6] });
  assertEquals(jpegSize(seven), null);
});

Deno.test("a stored scrypt cost that would need gigabytes is refused at once, not attempted", () => {
  const started = performance.now();
  assert(!checkPasswordHash("scrypt:2097152:8:1$salt$" + "00".repeat(64), "x"));
  assert(!checkPasswordHash("scrypt:67108864:16:1$salt$" + "00".repeat(64), "x"));
  assert(performance.now() - started < 250, "it must not start hashing");
});
