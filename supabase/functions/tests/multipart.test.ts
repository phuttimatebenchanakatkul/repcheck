import { assert, assertEquals } from "@std/assert";

import { readBytesBounded } from "../_shared/http.ts";
import { parseMultipart, partNamed, textOf } from "../_shared/multipart.ts";

/** A seeded random number generator, so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

async function encode(form: FormData): Promise<{ body: Uint8Array; type: string }> {
  const r = new Response(form);
  return { body: new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type")! };
}

Deno.test("parseMultipart agrees with the platform's own parser on randomly built forms (names with quotes and accents, binary files holding CRLF and boundary-like runs)", async () => {
  const next = rng(7);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const names = ["video", "exercise", "note", "a b", 'q"uote', "naïve", "日本語", "back\\slash", "line\nbreak"];
  for (let round = 0; round < 400; round++) {
    const form = new FormData();
    const expected: [string, string | undefined, string | undefined, Uint8Array][] = [];
    for (let i = 0, n = 1 + Math.floor(next() * 4); i < n; i++) {
      const name = pick(names) + (next() < 0.3 ? String(i) : "");
      if (next() < 0.5) {
        const text = [...Array(Math.floor(next() * 30))].map(() => pick(["a", "é", "\r\n", "--", "\n", " ", "-", "\u{1F3CB}", "\r"])).join("");
        form.append(name, text);
      } else {
        const bytes = new Uint8Array(Math.floor(next() * 400));
        for (let k = 0; k < bytes.length; k++) bytes[k] = next() < 0.1 ? pick([13, 10, 45]) : Math.floor(next() * 256);
        form.append(name, new File([bytes], pick(["set.mp4", "clip é.mov", 'we"ird.mp4', ""]), { type: pick(["video/mp4", "application/octet-stream", ""]) }));
      }
    }
    const { body, type } = await encode(form);
    const ours = parseMultipart(body, type);
    const theirs = [...(await new Response(body as unknown as BodyInit, { headers: { "content-type": type } }).formData()).entries()];
    assertEquals(ours.length, theirs.length, `round ${round}`);
    for (const [k, [name, value]] of theirs.entries()) {
      assertEquals(ours[k].name, name, `round ${round} part ${k}`);
      if (typeof value === "string") {
        assertEquals([ours[k].filename, textOf(ours[k])], [undefined, value.replaceAll("\r\n", "\n").replaceAll("\r", "\n") === value ? value : textOf(ours[k])], `round ${round} text ${k}`);
        assertEquals(new TextDecoder().decode(ours[k].data), value, `round ${round} text bytes ${k}`);
      } else {
        assertEquals(new Uint8Array(await value.arrayBuffer()), ours[k].data, `round ${round} file ${k}`);
        assertEquals(ours[k].filename, value.name, `round ${round} filename ${k}`);
      }
    }
    expected.length = 0;
  }
});

Deno.test("parseMultipart: the parts are views of the body, not copies", async () => {
  const form = new FormData();
  form.set("video", new File([new Uint8Array(1000).fill(7)], "a.mp4"));
  const { body, type } = await encode(form);
  const [part] = parseMultipart(body, type);
  assertEquals(part.data.buffer, body.buffer);
  assertEquals([part.data.length, part.data[0]], [1000, 7]);
});

Deno.test("parseMultipart: not multipart, no boundary, a preamble, an unclosed body and bare parts are all handled without throwing", () => {
  const enc = new TextEncoder();
  assertEquals(parseMultipart(enc.encode("hello"), "text/plain"), []);
  assertEquals(parseMultipart(enc.encode("hello"), "multipart/form-data"), []);
  assertEquals(parseMultipart(enc.encode("hello"), "multipart/form-data; boundary=zz"), []);
  const ok = (s: string, type = "multipart/form-data; boundary=BB") => parseMultipart(enc.encode(s), type).map((p) => [p.name, p.filename, textOf(p)]);
  assertEquals(ok('preamble text\r\n--BB\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--BB--\r\n'), [["a", undefined, "1"]]);
  assertEquals(ok('--BB\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--BB\r\nContent-Disposition: form-data; name="b"\r\n\r\n2'), [["a", undefined, "1"]], "the part that never closes is dropped");
  assertEquals(ok('--BB   \r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--BB--'), [["a", undefined, "1"]], "spaces after the boundary");
  assertEquals(ok('--BB\r\nContent-Type: text/plain\r\n\r\nnameless\r\n--BB--'), [], "a part with no name is skipped");
  assertEquals(ok('--BB\r\nContent-Disposition: form-data; name=plain; filename=f.mp4\r\n\r\nx\r\n--BB--'), [["plain", "f.mp4", null]], "unquoted values");
  assertEquals(ok('--q q\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--q q--', 'multipart/form-data; boundary="q q"'), [["a", undefined, "1"]], "a quoted boundary");
  assertEquals(partNamed(parseMultipart(enc.encode('--BB\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--BB--'), "multipart/form-data; boundary=BB"), "zzz"), undefined);
  assertEquals(textOf(undefined), null);
});

Deno.test("readBytesBounded: filled once at the declared size, refused past the limit by header and by stream, and a liar is caught", async () => {
  const post = (body: BodyInit | Uint8Array | null, headers: Record<string, string> = {}) => new Request("https://x.example/", { method: "POST", body: body as BodyInit, headers });
  const data = new Uint8Array(5000).fill(3);
  assertEquals(await readBytesBounded(post(data), 6000), data);
  assertEquals(await readBytesBounded(post(null), 10), new Uint8Array(0));
  const refused = async (r: Request, limit: number) => {
    try {
      await readBytesBounded(r, limit);
    } catch (e) {
      return ((e as { response?: Response }).response ?? (e as { res?: Response }).res)?.status ?? "threw";
    }
    return "read";
  };
  assertEquals(await refused(post(data), 4999), 413);
  assertEquals(await refused(post(data, { "content-length": "999999" }), 6000), 413, "refused by its header before any is read");
  // a chunked body declares nothing, so the stream itself is measured
  const chunked = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(3000)); c.enqueue(new Uint8Array(3000)); c.close(); } });
  assertEquals(await refused(new Request("https://x.example/", { method: "POST", body: chunked(), duplex: "half" } as RequestInit), 5000), 413);
  const got = await readBytesBounded(new Request("https://x.example/", { method: "POST", body: chunked(), duplex: "half" } as RequestInit), 7000);
  assertEquals(got.length, 6000);
  assert(got.every((b) => b === 0));
});

Deno.test("parseMultipart: a body that ends on its last delimiter, with no closing dashes, still gives the part before it", () => {
  const enc = new TextEncoder();
  const parts = parseMultipart(enc.encode('--BB\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--BB'), "multipart/form-data; boundary=BB");
  assertEquals(parts.map((p) => [p.name, textOf(p)]), [["a", "1"]]);
});

Deno.test("readBytesBounded: a declared length of exactly the limit is read, one over is refused, and one byte more than declared is caught", async () => {
  const sized = (bytes: number, declared: number) => new Request("https://x.example/", { method: "POST", body: new Uint8Array(bytes) as unknown as BodyInit, headers: { "content-length": String(declared) } });
  const status = async (r: Request, limit: number) => {
    try {
      await readBytesBounded(r, limit);
      return "read";
    } catch (e) {
      return (e as { response: Response }).response.status;
    }
  };
  assertEquals(await status(sized(100, 100), 100), "read");
  assertEquals(await status(sized(101, 101), 100), 413, "one over the limit by its header");
  assertEquals(await status(sized(101, 100), 100), 413, "one more byte than it said it would send");
  assertEquals((await readBytesBounded(sized(60, 100), 100)).length, 60, "less than declared is just what arrived");
});
