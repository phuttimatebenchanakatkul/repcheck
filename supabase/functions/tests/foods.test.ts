import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import { FOOD_SYSTEM_PROMPT } from "../_shared/foodData.ts";
import { FoodLookup, LookupError, ProductNotFound } from "../_shared/foodLookup.ts";
import { analyzeFoodPhoto, FoodAnalysisError, noteInstruction } from "../_shared/foodPhoto.ts";
import type { Gemini } from "../_shared/gemini.ts";
import { fromEnv } from "../_shared/settings.ts";
import { app, bearer, FakeDb, FakeGemini, PROJECT } from "./support.ts";
import { type World, worldFetch } from "./food_runners.ts";
import { pyRoundDigits } from "../_shared/pyNumbers.ts";
import { MAX_PHOTO_BYTES } from "../_shared/photos.ts";

// ---- fixtures ----------------------------------------------------------------------------------------------------------------

const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const profileRow = { id: "u", name: "Sam", friend_code: "RC-ABC123", onboarding_completed: false, deleted_at: null, created_at: new Date() };
const GOOD = JSON.stringify({
  food_name: "Pad Thai", confidence: "HIGH", note: " Estimated. ",
  ingredients: [{ name: "Rice Noodles", grams: 200, calories: 360, protein: 6, fat: 0.6, carbs: 80 }, { name: "Shrimp", grams: 50.4, calories: 99, protein: 24, fat: 0.3, carbs: 0.2 }],
});
const NUTELLA = {
  status: 1,
  product: { product_name: "Nutella", brands: "Ferrero, Nutella", serving_size: "15 g", nutriments: { "energy-kcal_100g": 539, proteins_100g: 6.3, fat_100g: 30.9, carbohydrates_100g: 57.5 } },
};
const world = (extra: World = {}): World => ({ off: { "3017620422003": { status: 200, body: NUTELLA } }, ...extra });
const lookup = (w: World, calls: string[] = []) => new FoodLookup(worldFetch(w, calls), null);

function foodDb(options: { profile?: boolean; consent?: boolean; allowed?: boolean; own?: boolean; count?: number; existing?: boolean; raceOnInsert?: boolean } = {}) {
  return new FakeDb((sql) => {
    if (sql.includes("select id, name, friend_code")) return options.profile === false ? [] : [{ ...profileRow, ai_consent_at: options.consent === false ? null : new Date() }];
    if (sql.includes("insert into public.rate_limits")) return options.allowed === false ? [] : [{ window_start: 1000 }];
    if (sql.includes("select window_start from public.rate_limits")) return [{ window_start: Math.floor(Date.now() / 1000) - 600 }];
    if (sql.includes("from public.custom_food_servings")) return [{ custom_food_id: 5, label: "1 cup", grams: 240 }];
    if (sql.includes("select * from public.custom_foods") && sql.includes("barcode = $2")) {
      return options.own ? [{ id: 5, name: "My Spread", emoji: "x", calories: 500, protein: 5, fat: 30, carbs: 50, barcode: "3017620422003", serving_label: "1 tbsp", serving_grams: 15 }] : [];
    }
    if (sql.includes("select * from public.custom_foods")) return [{ id: 5, name: "Cake", emoji: "x", calories: 300, protein: 3, fat: 10, carbs: 50, barcode: null, serving_label: "1 slice", serving_grams: 80 }];
    if (sql.includes("count(*)")) return [{ n: options.count ?? 0 }];
    if (sql.startsWith("select 1 from public.custom_foods")) return options.existing ? [{ x: 1 }] : [];
    if (sql.includes("insert into public.custom_foods")) return options.raceOnInsert ? Object.assign(new Error("duplicate key"), { code: "23505" }) : [{ id: 9 }];
    if (sql.includes("insert into public.custom_exercises")) return [{ id: 4, name: "Hang", emoji: null, mode: "both" }];
    if (sql.includes("from public.custom_exercises")) return [{ id: 4, name: "Hang", emoji: "x", mode: "each", created_text: "2026-10-29T01:02:03.123456" }, { id: 3, name: "Pull", emoji: null, mode: "both", created_text: "2026-10-28T00:00:00.000000" }];
    return 1;
  });
}
const spent = (db: FakeDb) => db.calls.some((c) => c.sql.includes("insert into public.rate_limits"));
const refunded = (db: FakeDb) => db.calls.some((c) => c.sql.includes("greatest(count - 1, 0)"));
const counted = (db: FakeDb, event: string) => db.calls.some((c) => c.params[1] === `feature:${event}`);

const call = async (db: FakeDb, path: string, init: RequestInit & { json?: unknown } = {}, model: Gemini = new FakeGemini(() => GOOD), food: FoodLookup = lookup(world()), env: Record<string, string> = {}) =>
  app(db, env, undefined, undefined, model, food)(path, { ...init, headers: { ...(await bearer()), ...(init.headers as Record<string, string> | undefined) } });

const photoForm = (fields: Record<string, string | Blob> = { image: new File([PNG], "meal.png", { type: "image/png" }) }) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
};

// ---- every route needs a sign-in --------------------------------------------------------------------------------------------

Deno.test("every food route demands a token", async () => {
  for (
    const [method, path] of [
      ["POST", "/api/analyze-food"], ["POST", "/api/lookup-barcode"], ["GET", "/api/search-food-online"], ["GET", "/api/custom-foods"], ["POST", "/api/custom-foods"],
      ["DELETE", "/api/custom-foods/1"], ["GET", "/api/custom-exercises"], ["POST", "/api/custom-exercises"], ["DELETE", "/api/custom-exercises/1"],
    ]
  ) assertEquals((await app()(path, { method })).status, 401, path);
});

// ---- the food photo ---------------------------------------------------------------------------------------------------------

Deno.test("analyze-food: no profile is a 404 and no consent the usual 403, before the photo is even read", async () => {
  const none = await call(foodDb({ profile: false }), "/api/analyze-food", { method: "POST", body: photoForm() });
  assertEquals([none.status, (await none.json()).error], [404, "No profile yet. Create it first."]);
  const db = foodDb({ consent: false });
  const refused = await call(db, "/api/analyze-food", { method: "POST", body: photoForm() });
  assertEquals([refused.status, (await refused.json()).needs_ai_consent], [403, true]);
  assert(!spent(db));
});

Deno.test("analyze-food: the photo is checked before anything is spent", async () => {
  const refuse = async (body: BodyInit | null, check = (_: Response) => {}) => {
    const db = foodDb();
    const r = await call(db, "/api/analyze-food", { method: "POST", body });
    check(r);
    assert(!spent(db));
    return [r.status, (await r.json()).error];
  };
  assertEquals(await refuse(null), [400, "Please provide a photo."]);
  assertEquals(await refuse(photoForm({ note: "no image here" })), [400, "Please provide a photo."]);
  assertEquals(await refuse(photoForm({ image: "text, not a file" })), [400, "Please provide a photo."]);
  assertEquals(await refuse(photoForm({ image: new File([PNG], "", { type: "image/png" }) })), [400, "Please provide a photo."], "a file with no name");
  assertEquals(await refuse(photoForm({ image: new File([new TextEncoder().encode("not an image at all")], "x.png", { type: "image/png" }) })), [400, "That file isn't a readable image."]);
  assertEquals((await refuse(photoForm({ image: new File([new Uint8Array(13 * 1024 * 1024)], "big.png") })))[0], 413);
});

Deno.test("analyze-food: a photo goes to the model with the prompt, the person's note after it, and the estimate comes back summed", async () => {
  const model = new FakeGemini(() => GOOD);
  const db = foodDb();
  const r = await call(db, "/api/analyze-food", { method: "POST", body: photoForm({ image: new File([PNG], "meal.png", { type: "image/jpeg" }), note: "  \x00about 250 g of noodles  " }) }, model);
  const out = await r.json();
  assertEquals(r.status, 200);
  assertEquals([out.ok, out.food_name, out.confidence, out.note], [true, "Pad Thai", "high", "Estimated."]);
  assertEquals(out.ingredients[1], { name: "Shrimp", grams: 50, calories: 99, protein: 24, fat: 0.3, carbs: 0.2 });
  assertEquals([out.calories, out.protein, out.fat, out.carbs], [Math.round(360 * 2 + 99 * 0.5), 12 + 12, 1.2 + 0.15, 160 + 0.1].map((x, i) => i === 0 ? x : Math.round(x * 10) / 10));
  assert(spent(db) && counted(db, "food_scan") && !refunded(db));
  const turn = model.requests[0].contents[0];
  assertEquals([model.requests[0].model, turn.text, turn.images?.length, turn.images?.[0].mimeType], [undefined, FOOD_SYSTEM_PROMPT, 1, "image/png"], "the real type of the bytes, not the client's word");
  assertEquals(turn.after, noteInstruction("about 250 g of noodles"));
});

Deno.test("analyze-food: no note, no extra part", async () => {
  const model = new FakeGemini(() => GOOD);
  await call(foodDb(), "/api/analyze-food", { method: "POST", body: photoForm({ image: new File([PNG], "m.png"), note: "   " }) }, model);
  assertEquals(model.requests[0].contents[0].after, undefined);
});

Deno.test("analyze-food: the daily allowance answers 429 with how long to wait", async () => {
  const model = new FakeGemini(() => GOOD);
  const r = await call(foodDb({ allowed: false }), "/api/analyze-food", { method: "POST", body: photoForm() }, model);
  assertEquals(r.status, 429);
  const body = await r.json();
  assertEquals([body.ok, body.error], [false, "You've used your 1 food scans for today — try again in about 24 hours."]);
  assert(Number(r.headers.get("Retry-After")) >= 24 * 3600 - 610 && Number(r.headers.get("Retry-After")) <= 24 * 3600 - 600);
  assertEquals(model.requests.length, 0);
  const exemptDb = foodDb({ allowed: false });
  assertEquals((await call(exemptDb, "/api/analyze-food", { method: "POST", body: photoForm() }, new FakeGemini(() => GOOD), undefined, { REVIEW_ACCOUNT_EMAILS: "lifter@example.com" })).status, 200);
  assert(!spent(exemptDb));
});

Deno.test("analyze-food: whatever goes wrong with the model is one friendly 502, and the use is given back", async () => {
  for (const reply of [null, "not json", "[]", "null", new Error("down")]) {
    const db = foodDb();
    const warned = console.warn;
    console.warn = () => {};
    try {
      const r = await call(db, "/api/analyze-food", { method: "POST", body: photoForm() }, new FakeGemini(() => reply));
      assertEquals([r.status, (await r.json()).error], [502, "Couldn't analyze that photo. Please try again."], String(reply));
    } finally {
      console.warn = warned;
    }
    assert(spent(db) && refunded(db) && !counted(db, "food_scan"), String(reply));
  }
  const noKey = new FakeGemini(() => GOOD, false);
  assertEquals((await call(foodDb(), "/api/analyze-food", { method: "POST", body: photoForm() }, noKey)).status, 502);
  assertEquals(noKey.requests.length, 0);
});

Deno.test("analyzeFoodPhoto: a photo that shows no food is an empty estimate, not an error", async () => {
  const out = await analyzeFoodPhoto(new FakeGemini(() => '{"food_name": "Unknown", "confidence": "low", "note": "No food.", "ingredients": []}'), PNG, "image/png", null);
  assertEquals([out.food_name, out.ingredients, out.calories], ["Unknown", [], 0]);
  let thrown: unknown;
  try {
    await analyzeFoodPhoto(new FakeGemini(() => null, false), PNG, "image/png", null);
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof FoodAnalysisError);
});

// ---- barcodes ---------------------------------------------------------------------------------------------------------------

Deno.test("lookup-barcode: digits only, at most 20, and a barcode is required", async () => {
  for (const body of [{}, { barcode: "" }, { barcode: "abc" }, { barcode: null }, { barcode: "-- --" }]) {
    const r = await call(foodDb(), "/api/lookup-barcode", { method: "POST", json: body });
    assertEquals([r.status, (await r.json()).error], [400, "No barcode value given."], JSON.stringify(body));
  }
  const calls: string[] = [];
  await call(foodDb(), "/api/lookup-barcode", { method: "POST", json: { barcode: "3017-6204-22003 " + "9".repeat(30) } }, undefined, lookup(world(), calls));
  assertEquals(calls, [`off:${"3017620422003" + "9".repeat(7)}`]);
});

Deno.test("lookup-barcode: a product comes back as the label's figures for a serving", async () => {
  const out = await (await call(foodDb(), "/api/lookup-barcode", { method: "POST", json: { barcode: "3017620422003" } })).json();
  assertEquals(out, {
    ok: true, food_name: "Ferrero Nutella", confidence: "high", note: "Nutrition from the product label (Open Food Facts), for a 15g serving.", data_source: "Open Food Facts",
    ingredients: [{ name: "Ferrero Nutella", grams: 15, calories: 539, protein: 6.3, fat: 30.9, carbs: 57.5 }], calories: 81, protein: 0.9, fat: 4.6, carbs: 8.6,
  });
});

Deno.test("lookup-barcode: a person's own food for the barcode wins, and no outside request is made", async () => {
  const calls: string[] = [];
  const out = await (await call(foodDb({ own: true }), "/api/lookup-barcode", { method: "POST", json: { barcode: "3017620422003" } }, undefined, lookup(world(), calls))).json();
  assertEquals([out.ok, out.confidence, out.custom_food_id, out.food_name, calls], [true, "custom", 5, "My Spread", []]);
  assertEquals(out.servings, [{ label: "1 tbsp", grams: 15 }, { label: "1 cup", grams: 240 }]);
});

Deno.test("lookup-barcode: a barcode nobody knows is a normal 200 that lets the app offer to create the food; a failing database is a 502", async () => {
  const warned = console.warn;
  console.warn = () => {};
  try {
    const unknown = await call(foodDb(), "/api/lookup-barcode", { method: "POST", json: { barcode: "1234567890123" } }, undefined, lookup({ off: { "1234567890123": { status: 200, body: { status: 0 } } } }));
    assertEquals(unknown.status, 200);
    assertEquals(await unknown.json(), { ok: false, not_found: true, barcode: "1234567890123", error: "No product found for barcode 1234567890123. It may not be in the Open Food Facts database yet." });
    for (const status of [500, 404]) { // (404 too: Open Food Facts answers an unknown product that way, and the old server reported it as unreachable)
      const down = await call(foodDb(), "/api/lookup-barcode", { method: "POST", json: { barcode: "3017620422003" } }, undefined, lookup({ off: { "3017620422003": { status, body: {} } } }));
      assertEquals([down.status, (await down.json()).error], [502, "Couldn't reach the product database. Please try again."], String(status));
    }
  } finally {
    console.warn = warned;
  }
});

// ---- the second source: FatSecret -------------------------------------------------------------------------------------------

const THAI = {
  creds: true,
  off: { "8850987000014": { status: 200, body: { status: 0 } } },
  fs_token: { status: 200, body: { access_token: "tok", expires_in: 3600 } },
  fs_barcode: { "8850987000014": { status: 200, body: { food_id: { value: "4455" } } } },
  fs_food: {
    "4455": { status: 200, body: { food: { food_name: "Mama Noodles", brand_name: "Mama", servings: { serving: { metric_serving_unit: "g", metric_serving_amount: "60", calories: "270", protein: "6", fat: "12", carbohydrate: "34" } } } } },
  },
} satisfies World;

Deno.test("FatSecret is asked only when Open Food Facts has nothing, and its product is scaled to 100 g and credited", async () => {
  const calls: string[] = [];
  const out = await new FoodLookup(worldFetch(THAI, calls), { clientId: "id", clientSecret: "secret", region: "TH" }).lookupBarcode("8850987000014");
  assertEquals(calls, ["off:8850987000014", "fs_token", "fs_barcode:8850987000014:TH", "fs_food:4455:TH"]);
  assertEquals([out.data_source, out.food_name, out.note], ["FatSecret", "Mama Noodles", "Nutrition from the product label (FatSecret), for a 60g serving."]);
  assertEquals(out.ingredients[0], { name: "Mama Noodles", grams: 60, calories: 450, protein: 10, fat: 20, carbs: 56.7 });
  const none = await new FoodLookup(worldFetch({ ...THAI, creds: false }, []), null).lookupBarcode("8850987000014").catch((e) => e);
  assert(none instanceof ProductNotFound, "without keys, FatSecret is never asked and the Open Food Facts answer stands");
});

Deno.test("FatSecret: the token is fetched once and reused until a minute before it runs out; the calls carry it, the region and the keys", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  let now = 1000;
  const send = ((input: URL | string, init: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url: url.href, init });
    if (url.hostname === "oauth.fatsecret.com") return Promise.resolve(new Response(JSON.stringify({ access_token: `tok${requests.length}`, expires_in: 3600 })));
    if (url.pathname.includes("barcode")) return Promise.resolve(new Response(JSON.stringify({ food_id: { value: "0" } })));
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as unknown as typeof fetch;
  const lookupFs = new FoodLookup(send, { clientId: "id", clientSecret: "se cret", region: "US" }, () => now);
  const miss = (code: string) => lookupFs.lookupBarcode(code).catch(() => null);
  await miss("111");
  await miss("222");
  const tokenCalls = () => requests.filter((r) => r.url.startsWith("https://oauth.fatsecret.com")).length;
  assertEquals(tokenCalls(), 1, "reused");
  now += 3600 - 61;
  await miss("333");
  assertEquals(tokenCalls(), 1, "still good, with 61 seconds left");
  now += 1;
  await miss("444");
  assertEquals(tokenCalls(), 2, "refreshed a minute before it would run out");
  const token = requests.find((r) => r.url.startsWith("https://oauth.fatsecret.com"))!;
  assertEquals([token.init.method, (token.init.headers as Record<string, string>).Authorization], ["POST", `Basic ${btoa("id:se cret")}`]);
  assertEquals(String(token.init.body), "grant_type=client_credentials&scope=basic+barcode");
  const barcodeCall = requests.find((r) => r.url.includes("barcode/find-by-id"))!;
  assertEquals(barcodeCall.url, "https://platform.fatsecret.com/rest/food/barcode/find-by-id/v1?barcode=0000000000111&region=US&format=json");
  assertEquals((barcodeCall.init.headers as Record<string, string>).Authorization, "Bearer tok2", "the first token handed out");
  const offCall = requests.find((r) => r.url.includes("openfoodfacts"))!;
  assertEquals(offCall.url, "https://world.openfoodfacts.org/api/v2/product/111.json?fields=product_name%2Cbrands%2Cserving_size%2Cnutriments");
  assertEquals((offCall.init.headers as Record<string, string>)["User-Agent"], "RepCheck-App/1.0 (nutrition barcode lookup)");
  assert(offCall.init.signal instanceof AbortSignal, "every outside request has a time limit");
});

// ---- online search ----------------------------------------------------------------------------------------------------------

Deno.test("search-food-online: names from Open Food Facts, deduplicated, twelve at most, and the search text cleaned", async () => {
  const hits = Array.from({ length: 20 }, (_, i) => ({ code: `${i}`, product_name: i < 3 ? "Nutella" : `Spread ${i}`, nutriments: { "energy-kcal_100g": 500, fat_100g: 30 } }));
  const w: World = { search: { nutella: { status: 200, body: { hits } } } };
  const calls: string[] = [];
  const r = await call(foodDb(), "/api/search-food-online?q=%20nu%00tella%20", { method: "GET" }, undefined, lookup(w, calls));
  const out = await r.json();
  assertEquals(calls, ["search:nutella:12"]);
  assertEquals([out.ok, out.results.length, out.results[0].food_name, out.results[1].food_name], [true, 12, "Nutella", "Spread 3"]);
  const none = await (await call(foodDb(), "/api/search-food-online", { method: "GET" }, undefined, lookup({}))).json();
  assertEquals(none, { ok: true, results: [] });
  const warned = console.warn;
  console.warn = () => {};
  try {
    const down = await call(foodDb(), "/api/search-food-online?q=x", { method: "GET" }, undefined, lookup({ search: { x: { status: 503, body: {} } } }));
    assertEquals([down.status, (await down.json()).error], [502, "Couldn't reach the product database. Please try again."]);
  } finally {
    console.warn = warned;
  }
  assert(LookupError.prototype instanceof Error);
});

// ---- a person's own foods and exercises -------------------------------------------------------------------------------------

Deno.test("custom foods: the list carries each food's extra servings", async () => {
  const out = await (await call(foodDb(), "/api/custom-foods", { method: "GET" })).json();
  assertEquals(out, { ok: true, foods: [{ id: 5, name: "Cake", emoji: "x", calories: 300, protein: 3, fat: 10, carbs: 50, barcode: null, servingLabel: "1 slice", servingGrams: 80, servings: [{ label: "1 cup", grams: 240 }] }] });
});

Deno.test("custom foods: a new food has its calories worked out from its macros, whatever the client says", async () => {
  const db = foodDb();
  const r = await call(db, "/api/custom-foods", { method: "POST", json: { name: "  Cake\x00 ", protein: 5, fat: 10, carbs: "20.5", calories: 1, barcode: "12-34", servings: [{ label: "cup", grams: 240 }] } });
  const out = await r.json();
  assertEquals(out.ok, true);
  assertEquals(out.food, { id: 9, name: "Cake", emoji: "\u{1F37D}️", calories: 192, protein: 5, fat: 10, carbs: 20.5, barcode: "1234", servingLabel: "1 serving", servingGrams: 100, servings: [{ label: "cup", grams: 240 }] });
  assert(db.calls.some((c) => c.sql.includes("pg_advisory_xact_lock")), "under the person's lock");
  const insert = db.calls.find((c) => c.sql.includes("insert into public.custom_foods"))!;
  assertEquals(insert.params, ["7c9e6679-7425-40de-944b-e07fc1f90ae7", "Cake", "\u{1F37D}️", 192, 5, 10, 20.5, "1234", "1 serving", 100]);
});

Deno.test("custom foods: no profile is a 404; the ceiling a 429; a barcode already saved a 409, however it is caught", async () => {
  const post = (db: FoodDbType, body: unknown = { name: "x", barcode: "123" }) => call(db, "/api/custom-foods", { method: "POST", json: body });
  type FoodDbType = FakeDb;
  const noProfile = await post(foodDb({ profile: false }));
  assertEquals([noProfile.status, (await noProfile.json()).error], [404, "No profile yet. Create it first."]);
  const full = await post(foodDb({ count: 500 }));
  assertEquals([full.status, (await full.json()).error], [429, "You've reached the maximum of 500 saved items here. Delete some to add more."]);
  assertEquals((await post(foodDb({ count: 499 }))).status, 200);
  const dup = await post(foodDb({ existing: true }));
  assertEquals([dup.status, (await dup.json()).error], [409, "You already have a custom food saved for this barcode."]);
  const raced = await post(foodDb({ raceOnInsert: true }));
  assertEquals([raced.status, (await raced.json()).error], [409, "You already have a custom food saved for this barcode."]);
});

Deno.test("custom foods and exercises: deleting is by id and scoped to the caller", async () => {
  for (const path of ["/api/custom-foods/5", "/api/custom-exercises/4"]) {
    const db = foodDb();
    const r = await call(db, path, { method: "DELETE" });
    assertEquals([r.status, await r.json()], [200, { ok: true }]);
    const del = db.calls.find((c) => c.sql.startsWith("delete from"))!;
    assertEquals(del.params, ["7c9e6679-7425-40de-944b-e07fc1f90ae7", Number(path.split("/").pop())]);
  }
  assertEquals((await call(foodDb(), "/api/custom-foods/abc", { method: "DELETE" })).status, 404);
});

Deno.test("custom exercises: listed newest first with the time as Python writes it; a name is required; the mode is one of three", async () => {
  const list = await (await call(foodDb(), "/api/custom-exercises", { method: "GET" })).json();
  assertEquals(list.ok, true);
  assertEquals(list.exercises.map((e: { created_at: string }) => e.created_at), ["2026-10-29T01:02:03.123456+00:00", "2026-10-28T00:00:00+00:00"]);
  const noName = await call(foodDb(), "/api/custom-exercises", { method: "POST", json: { name: "  " } });
  assertEquals([noName.status, (await noName.json()).error], [400, "Enter a name for the exercise."]);
  const made = await call(foodDb(), "/api/custom-exercises", { method: "POST", json: { name: "Hang", mode: "sideways" } });
  const madeBody = await made.json();
  assertEquals([madeBody.ok, madeBody.exercise], [true, { id: 4, name: "Hang", emoji: null, mode: "both" }]);
  const full = await call(foodDb({ count: 500 }), "/api/custom-exercises", { method: "POST", json: { name: "Hang" } });
  assertEquals(full.status, 429);
  const noProfile = await call(foodDb({ profile: false }), "/api/custom-exercises", { method: "POST", json: { name: "Hang" } });
  assertEquals(noProfile.status, 404);
});

Deno.test("settings: FatSecret needs both keys, and the region defaults to TH", () => {
  const env = (e: Record<string, string>) => fromEnv((n) => ({ SUPABASE_URL: PROJECT, ...e })[n]).fatsecret;
  assertEquals(env({}), null);
  assertEquals(env({ FATSECRET_CLIENT_ID: "a" }), null);
  assertEquals(env({ FATSECRET_CLIENT_SECRET: "b" }), null);
  assertEquals(env({ FATSECRET_CLIENT_ID: " a ", FATSECRET_CLIENT_SECRET: " b " }), { clientId: "a", clientSecret: "b", region: "TH" });
  assertEquals(env({ FATSECRET_CLIENT_ID: "a", FATSECRET_CLIENT_SECRET: "b", FATSECRET_REGION: " us " })?.region, "us");
  assertStringIncludes(FOOD_SYSTEM_PROMPT, "nutrition estimation assistant");
});

// ---- limits the mutation run found nobody was holding -----------------------------------------------------------------------

/** A multipart body of exactly `total` bytes holding one "image" file of zeros. */
function multipartOfSize(total: number): { body: Uint8Array; type: string } {
  const enc = new TextEncoder();
  const head = enc.encode('--edge\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n');
  const tail = enc.encode("\r\n--edge--\r\n");
  const body = new Uint8Array(total);
  body.set(head, 0);
  body.set(tail, total - tail.length);
  return { body, type: "multipart/form-data; boundary=edge" };
}

Deno.test("analyze-food: a request of 64 KiB over the largest photo is read, one byte more is a 413", async () => {
  const limit = MAX_PHOTO_BYTES + 64 * 1024;
  const send = async (total: number) => {
    const { body, type } = multipartOfSize(total);
    const r = await call(foodDb(), "/api/analyze-food", { method: "POST", body: body as unknown as BodyInit, headers: { "Content-Type": type } });
    return [r.status, (await r.json()).error];
  };
  assertEquals(await send(limit), [413, "That photo is too large. Please keep it under 12 MB."], "the photo inside is over its own limit, but the request was read");
  assertEquals((await send(limit + 1))[0], 413);
  assertEquals(await send(limit + 1), [413, "That request is too large."]);
  assertEquals(await send(MAX_PHOTO_BYTES), [400, "That file isn't a readable image."]);
});

Deno.test("analyze-food: the person's note is cut to 300 characters; the search text to 100", async () => {
  const model = new FakeGemini(() => GOOD);
  await call(foodDb(), "/api/analyze-food", { method: "POST", body: photoForm({ image: new File([PNG], "m.png"), note: "n".repeat(400) }) }, model);
  assertEquals(model.requests[0].contents[0].after, noteInstruction("n".repeat(300)));
  const calls: string[] = [];
  await call(foodDb(), `/api/search-food-online?q=${"q".repeat(150)}`, { method: "GET" }, undefined, lookup({}, calls));
  assertEquals(calls, [`search:${"q".repeat(100)}:12`]);
});

Deno.test("a search without a limit asks for fifteen, as the old one did", async () => {
  const calls: string[] = [];
  await lookup({}, calls).search("x").catch(() => null);
  assertEquals(calls, ["search:x:15"]);
});

Deno.test("a food photo answer in a fence is read from inside it", async () => {
  const out = await analyzeFoodPhoto(new FakeGemini(() => "Here you go:\n```json\n" + GOOD + "\n```\nEnjoy."), PNG, "image/png", null);
  assertEquals(out.food_name, "Pad Thai");
});

Deno.test("an outside request gets eight seconds, not eight milliseconds", async () => {
  const slow = ((_url: unknown, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify(NUTELLA))), 100);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "TimeoutError"));
      });
    })) as unknown as typeof fetch;
  const out = await new FoodLookup(slow, null).lookupBarcode("3017620422003");
  assertEquals(out.food_name, "Ferrero Nutella");
});

Deno.test("a FatSecret token with no stated lifetime is kept for a day, less the minute", async () => {
  let tokens = 0;
  let now = 5000;
  const send = ((input: URL | string) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth.fatsecret.com") {
      tokens++;
      return Promise.resolve(new Response(JSON.stringify({ access_token: "t" })));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as unknown as typeof fetch;
  const lookupFs = new FoodLookup(send, { clientId: "a", clientSecret: "b", region: "TH" }, () => now);
  await lookupFs.lookupBarcode("1").catch(() => null);
  now += 86400 - 61;
  await lookupFs.lookupBarcode("1").catch(() => null);
  assertEquals(tokens, 1);
  now += 1;
  await lookupFs.lookupBarcode("1").catch(() => null);
  assertEquals(tokens, 2, "refreshed at exactly a minute before the day was up");
});

Deno.test("rounding zero gives zero, not minus zero", () => {
  assert(Object.is(pyRoundDigits(0, 1), 0));
  assert(Object.is(pyRoundDigits(-0.04, 1), -0));
  assert(Object.is(pyRoundDigits(0.04, 1), 0));
});
