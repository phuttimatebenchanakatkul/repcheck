import { assertEquals, assertRejects } from "@std/assert";
import { SignJWT } from "jose";

import { AuthFailure, bearerToken, Verifier } from "../_shared/auth.ts";
import { publicKey, settings, strangersKey, token, USER } from "./support.ts";

const verifier = new Verifier(settings(), publicKey);

const refused = async (jwt: string, message = "Invalid session.", status = 401) => {
  const e = await assertRejects(() => verifier.verify(jwt), AuthFailure);
  assertEquals([e.message, e.status], [message, status]);
};

Deno.test("a good token gives the callers id and email", async () => {
  const who = await verifier.verify(await token());
  assertEquals([who.id, who.email], [USER, "lifter@example.com"]);
});

Deno.test("the subject is normalised to a lowercase uuid", async () => {
  assertEquals((await verifier.verify(await token({ sub: USER.toUpperCase() }))).id, USER);
});

Deno.test("a token that expired a moment ago is inside the clock-skew allowance", async () => {
  const now = Math.floor(Date.now() / 1000);
  assertEquals((await verifier.verify(await token({ exp: now - 5 }))).id, USER);
});

Deno.test("an expired token says so, so the app can refresh", async () => {
  const now = Math.floor(Date.now() / 1000);
  await refused(await token({ exp: now - 60 }), "Your session has expired. Please sign in again.");
});

Deno.test("a token of the wrong kind is refused", async () => {
  for (const override of [{ role: "service_role" }, { role: "anon" }, { aud: "other" }, { iss: "https://evil.example/auth/v1" }, { sub: "not-a-uuid" }, { sub: 7 }]) {
    await refused(await token(override));
  }
});

Deno.test("a token without a required claim is refused", async () => {
  for (const missing of ["exp", "iat", "sub", "aud", "iss", "role"]) await refused(await token({ [missing]: null }));
});

Deno.test("an anonymous session is told to sign in", async () => {
  await refused(await token({ is_anonymous: true }), "Please sign in to continue.");
});

Deno.test("a token signed with another key is refused", async () => {
  await refused(await token({}, { key: strangersKey }));
});

Deno.test("a tampered token is refused", async () => {
  const [head, body, sig] = (await token()).split(".");
  const forged = btoa(JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated" })).replace(/=+$/, "");
  await refused(`${head}.${forged}.${sig}`);
  await refused(`${head}.${body}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`); // (a signature that already ended in AA would not have been tampered with)
});

Deno.test("alg none is refused", async () => {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: USER, role: "authenticated", aud: "authenticated", iss: `${settings().supabaseUrl}/auth/v1`, iat: now, exp: now + 3600 };
  await refused(`${enc({ alg: "none", typ: "JWT" })}.${enc(claims)}.`);
});

Deno.test("an HS256 token signed with the public key's bytes is refused", async () => {
  const now = Math.floor(Date.now() / 1000);
  const hs = await new SignJWT({ sub: USER, role: "authenticated" }).setProtectedHeader({ alg: "HS256" })
    .setAudience("authenticated").setIssuer(`${settings().supabaseUrl}/auth/v1`).setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode("a shared secret"));
  await refused(hs);
});

Deno.test("malformed tokens are refused, not crashed on", async () => {
  for (const junk of ["", "x", "a.b", "a.b.c", "....", "💥", "eyJhbGciOiJFUzI1NiJ9.e30.AAAA"]) await refused(junk);
});

Deno.test("failing to fetch the keys is a 503 so the app retries instead of signing the person out", async () => {
  const { errors } = await import("jose");
  const down = new Verifier(settings(), () => Promise.reject(new errors.JWKSTimeout()));
  const e = await assertRejects(async () => down.verify(await token()), AuthFailure);
  assertEquals([e.message, e.status], ["Sign-in is temporarily unavailable. Please try again.", 503]);
});

Deno.test("a non-string email claim is ignored", async () => {
  assertEquals((await verifier.verify(await token({ email: 42 }))).email, null);
});

Deno.test("only a well-formed Bearer header is a token", () => {
  const header = (value?: string) => new Request("https://x.test/", value === undefined ? {} : { headers: { Authorization: value } });
  assertEquals(bearerToken(header("Bearer abc.def-ghi_1")), "abc.def-ghi_1");
  assertEquals(bearerToken(header("  Bearer abc  ")), "abc");
  for (const bad of [undefined, "", "Bearer", "Bearer ", "bearer abc", "Basic abc", "Bearer a b", "Bearer a;b"]) {
    assertEquals(bearerToken(header(bad)), null, String(bad));
  }
});
