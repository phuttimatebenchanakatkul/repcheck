/** Packaged-food nutrition from a barcode or a name: the port of barcode_scanner.py's lookup half (the photo-decoding half is not ported; the app
 *  reads barcodes on the phone and sends the digits) and fatsecret_lookup.py.
 *
 *  Open Food Facts first (free, no account); FatSecret (see Settings.fatsecret) as the fallback for Thai and other regional products it lacks.
 *  Every figure is checked for the usual crowd-sourcing mistakes (kilojoules entered as calories, impossible amounts) before it is shown. */
import {
  FATSECRET_BARCODE_URL,
  FATSECRET_FOOD_URL,
  FATSECRET_TIMEOUT_SECONDS,
  FATSECRET_TOKEN_URL,
  KJ_PER_KCAL,
  LOOKUP_TIMEOUT_SECONDS,
  MAX_PLAUSIBLE_KCAL,
  MAX_PLAUSIBLE_MACRO_G,
  OPEN_FOOD_FACTS_SEARCH_URL,
  OPEN_FOOD_FACTS_URL,
} from "./foodData.ts";
import { PY_SPACE, pyStrip } from "./nameFilter.ts";
import { pyFloat, pyRound, pyRoundDigits, pyTruthy } from "./pyNumbers.ts";
import { pyStr } from "./pyText.ts";
import type { Settings } from "./settings.ts";

/** A failure the person should be told about (barcode_scanner.BarcodeScanError); the message is safe to show. */
export class LookupError extends Error {}
/** The barcode was read fine but no source has a usable product for it (a normal outcome: the app offers to create the food). */
export class ProductNotFound extends LookupError {}

const NOT_REACHED = "Couldn't reach the product database. Please try again.";
type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
/** Python would raise AttributeError on `.get` of anything else; nothing here catches that, so neither does this. */
function obj(v: unknown): Obj {
  if (!isObject(v)) throw new TypeError("not an object");
  return v;
}
const own = (o: Obj, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const text = (v: unknown): string => pyStrip(pyStr(pyTruthy(v) ? v : ""));
const roundInt = (x: number): number => {
  if (!Number.isFinite(x)) throw new RangeError("cannot round");
  return pyRound(x);
};

/** max(0.0, float(source.get(key))), or 0 when the key is missing, null or not a number. ("inf" text is infinity, as Python's float reads it.) */
export function num(source: Obj, key: string): number {
  const value = own(source, key);
  if (value === undefined || value === null) return 0;
  let n: number;
  if (typeof value === "number") n = value;
  else if (typeof value === "boolean") n = Number(value);
  else if (typeof value === "string" && /^\+?(inf|infinity)$/i.test(pyStrip(value))) n = Infinity;
  else n = pyFloat(value);
  return Number.isNaN(n) ? 0 : Math.max(0, n);
}

/** A name collapsed to single spaces and cut to `maxLen` characters at a word boundary, with an ellipsis. */
export function shortenName(nameIn: string, maxLen = 40): string {
  const name = pyStrip(nameIn.replace(new RegExp(`[${PY_SPACE}]+`, "g"), " "));
  const chars = [...name];
  if (chars.length <= maxLen) return name;
  const cut = chars.slice(0, maxLen - 1).join("");
  const at = cut.lastIndexOf(" ");
  return (at === -1 ? cut : cut.slice(0, at)) + "…";
}

/** Barcode digits as Python's `re.sub(r"\D", "", value)` leaves them: any script's decimal digits stay. */
export const barcodeDigits = (value: string): string => value.replace(/\P{Nd}/gu, "");

const AFTER = "(?![\\p{L}\\p{N}_])"; // Python's \b after a letter: the next character is not a word character
const SPACE = `[${PY_SPACE}]*`;
const AMOUNT = "([\\p{Nd}.]+)";
const unit = (pattern: string) => new RegExp(`${AMOUNT}${SPACE}${pattern}${AFTER}`, "iu");
const GRAMS = unit("g");
const FL_OZ = unit(`fl\\.?${SPACE}oz`);
const ML = unit("ml");
const OZ = unit("oz");

/** A positive number out of text like "30" or "1.5", else null. */
function positive(raw: string): number | null {
  const value = pyFloat(raw);
  return value > 0 ? value : null;
}

/** Open Food Facts' serving_size is free text ("30 g", "1 bar (45g)", "355 ml", "12 fl oz"): the grams in it, millilitres and ounces converted
 *  (a 355 ml can taken for 100 g would under-report a whole can by more than half), else 100. */
export function parseServingGrams(product: Obj): number {
  const raw = own(product, "serving_size");
  const servingSize = pyTruthy(raw) ? raw : "";
  if (typeof servingSize !== "string") throw new TypeError("serving_size");
  let match = GRAMS.exec(servingSize);
  if (match) {
    const grams = positive(match[1]);
    if (grams) return roundInt(grams);
  }
  // "fl oz" (volume) before plain "oz" (weight): "12 fl oz" must not be caught by the weight pattern first
  match = FL_OZ.exec(servingSize);
  if (match) {
    const flOz = positive(match[1]);
    if (flOz) return roundInt(flOz * 29.5735); // about 1 g per ml for typical (mostly water) drinks
  }
  match = ML.exec(servingSize);
  if (match) {
    const ml = positive(match[1]);
    if (ml) return roundInt(ml);
  }
  match = OZ.exec(servingSize);
  if (match) {
    const oz = positive(match[1]);
    if (oz) return roundInt(oz * 28.3495);
  }
  return 100;
}

/** The classic product API returns brands as a comma-separated text ("Ferrero, Nutella"); the search API as a list. */
export function brandName(product: Obj): string {
  const brands = own(product, "brands");
  if (Array.isArray(brands)) return brands.length ? pyStrip(pyStr(brands[0])) : "";
  return pyStrip(pyStrip(pyStr(pyTruthy(brands) ? brands : "")).split(",")[0]);
}

interface Per100g {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** Catches the two commonest data-entry mistakes: calories that are really kilojoules (corrected, when the macros prove it) and impossible values (refused). */
function sanitize(per100g: Per100g, foodName: string, source: string): Per100g {
  const macroKcal = per100g.protein * 4 + per100g.fat * 9 + per100g.carbs * 4;
  const reported = per100g.calories;
  if (macroKcal > 0 && reported > macroKcal * 3) {
    const corrected = reported / KJ_PER_KCAL;
    if (Math.abs(corrected - macroKcal) <= Math.max(macroKcal * 0.25, 20)) per100g.calories = corrected;
  }
  for (const key of ["protein", "fat", "carbs"] as const) {
    if (per100g[key] > MAX_PLAUSIBLE_MACRO_G) {
      throw new LookupError(`The nutrition data for "${foodName}" on ${source} looks incorrect (an implausible amount per 100g) -- try searching for it manually instead.`);
    }
  }
  if (per100g.calories > MAX_PLAUSIBLE_KCAL) {
    throw new LookupError(`The nutrition data for "${foodName}" on ${source} looks incorrect (an implausible calorie count) -- try searching for it manually instead.`);
  }
  return per100g;
}

export interface ScanResult {
  food_name: string;
  confidence: string;
  note: string;
  data_source: string;
  ingredients: { name: string; grams: number; calories: number; protein: number; fat: number; carbs: number }[];
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** A product from either source as the result the app shows, or a LookupError (ProductNotFound when there is nothing usable to show). */
export function validate(barcode: string, productIn: unknown, source = "Open Food Facts"): ScanResult {
  const product = obj(productIn);
  const name = text(own(product, "product_name"));
  const brand = brandName(product);
  const foodName = name && brand && !name.toLowerCase().includes(brand.toLowerCase())
    ? shortenName(`${brand} ${name}`)
    : shortenName(name || brand || `Product ${barcode}`);

  const rawNutriments = own(product, "nutriments");
  const nutriments = pyTruthy(rawNutriments) ? obj(rawNutriments) : {};
  let per100g: Per100g = {
    calories: num(nutriments, "energy-kcal_100g"),
    protein: num(nutriments, "proteins_100g"),
    fat: num(nutriments, "fat_100g"),
    carbs: num(nutriments, "carbohydrates_100g"),
  };
  if (!(per100g.calories || per100g.protein || per100g.fat || per100g.carbs)) {
    // the same as a total miss: the product exists but there is nothing usable, so the app's "create this food yourself" applies
    throw new ProductNotFound(`Found "${foodName}" but it has no nutrition data on ${source}.`);
  }
  per100g = sanitize(per100g, foodName, source);

  const grams = parseServingGrams(product);
  const scale = grams / 100;
  const totalProtein = pyRoundDigits(per100g.protein * scale, 1);
  const totalFat = pyRoundDigits(per100g.fat * scale, 1);
  const totalCarbs = pyRoundDigits(per100g.carbs * scale, 1);
  const totalCalories = roundInt(pyRoundDigits(per100g.calories * scale, 1));
  return {
    food_name: foodName,
    confidence: "high", // an exact barcode match, not a visual estimate
    note: `Nutrition from the product label (${source}), for a ${grams}g serving.`,
    // which database the figures came from, so the result screen can show the attribution its terms require (App Review 5.2.2)
    data_source: source,
    ingredients: [{
      name: foodName,
      grams,
      calories: roundInt(per100g.calories),
      protein: pyRoundDigits(per100g.protein, 1),
      fat: pyRoundDigits(per100g.fat, 1),
      carbs: pyRoundDigits(per100g.carbs, 1),
    }],
    calories: totalCalories,
    protein: totalProtein,
    fat: totalFat,
    carbs: totalCarbs,
  };
}

/** A request that did not give a usable JSON answer: no network, a timeout, an error status, or text that is not JSON. */
class HttpFailure extends Error {}

type Send = typeof fetch;

async function getJson(send: Send, url: URL, init: RequestInit, seconds: number): Promise<unknown> {
  try {
    const response = await send(url, { ...init, signal: AbortSignal.timeout(seconds * 1000) });
    if (!response.ok) throw new HttpFailure(`status ${response.status}`);
    return await response.json();
  } catch (e) {
    throw e instanceof HttpFailure ? e : new HttpFailure(e instanceof Error ? e.name : "failed");
  }
}

const withParams = (base: string, params: Record<string, string>): URL => {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
};

export class FoodLookup {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly send: Send,
    private readonly fatsecret: Settings["fatsecret"],
    /** Seconds since 1970 (the token cache's clock). */
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  /** Nutrition for a barcode: the person's own saved food is the caller's business; this asks Open Food Facts, then FatSecret. */
  async lookupBarcode(barcodeIn: unknown): Promise<ScanResult> {
    const barcode = barcodeDigits(pyStrip(pyStr(barcodeIn)));
    if (!barcode) throw new LookupError("No barcode value given.");
    try {
      return validate(barcode, await this.openFoodFactsProduct(barcode));
    } catch (e) {
      if (!(e instanceof LookupError)) throw e;
      const product = await this.fatSecretProduct(barcode);
      if (product === null) throw e;
      return validate(barcode, product, "FatSecret");
    }
  }

  private async openFoodFactsProduct(barcode: string): Promise<unknown> {
    let data: unknown;
    try {
      data = await getJson(
        this.send,
        withParams(OPEN_FOOD_FACTS_URL.replace("{barcode}", barcode), { fields: "product_name,brands,serving_size,nutriments" }),
        { headers: { "User-Agent": "RepCheck-App/1.0 (nutrition barcode lookup)" } },
        LOOKUP_TIMEOUT_SECONDS,
      );
    } catch (e) {
      if (e instanceof HttpFailure) throw new LookupError(NOT_REACHED);
      throw e;
    }
    const answer = obj(data);
    if (own(answer, "status") !== 1 || !pyTruthy(own(answer, "product"))) {
      throw new ProductNotFound(`No product found for barcode ${barcode}. It may not be in the Open Food Facts database yet.`);
    }
    return answer.product;
  }

  /** Foods by name from Open Food Facts, in the shape of a single lookup. Products with nothing usable are skipped, one entry per name is kept. */
  async search(queryIn: unknown, limit = 15): Promise<ScanResult[]> {
    const query = pyStrip(pyStr(pyTruthy(queryIn) ? queryIn : ""));
    if (!query) return [];
    let data: unknown;
    try {
      data = await getJson(
        this.send,
        withParams(OPEN_FOOD_FACTS_SEARCH_URL, { q: query, page_size: String(limit), fields: "code,product_name,brands,serving_size,nutriments" }),
        { headers: { "User-Agent": "RepCheck-App/1.0 (nutrition food search)" } },
        LOOKUP_TIMEOUT_SECONDS,
      );
    } catch (e) {
      if (e instanceof HttpFailure) throw new LookupError(NOT_REACHED);
      throw e;
    }
    const answer = obj(data);
    const hits = Object.hasOwn(answer, "hits") ? answer.hits : [];
    if (!Array.isArray(hits) && hits !== "" && !(isObject(hits) && !Object.keys(hits).length)) throw new TypeError("hits");
    const results: ScanResult[] = [];
    const seen = new Set<string>();
    for (const product of Array.isArray(hits) ? hits : []) {
      const code = pyStr(pyTruthy(obj(product).code) ? obj(product).code : "");
      let validated: ScanResult;
      try {
        validated = validate(code, product);
      } catch (e) {
        if (e instanceof LookupError) continue; // nothing usable on this one: skip it, do not fail the whole search
        throw e;
      }
      // the same product is often listed under several barcodes with near-identical data: keep the first (best-ranked) per name
      const key = pyStrip(validated.food_name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(validated);
      if (results.length >= limit) break;
    }
    return results;
  }

  // -- FatSecret ---------------------------------------------------------------------------------------------------------------

  private async accessToken(): Promise<string | null> {
    const creds = this.fatsecret;
    if (!creds) return null;
    const now = this.now();
    if (this.token && now < this.token.expiresAt - 60) return this.token.value;
    let data: Obj;
    try {
      const body = new URLSearchParams({ grant_type: "client_credentials", scope: "basic barcode" });
      const json = await getJson(
        this.send,
        new URL(FATSECRET_TOKEN_URL),
        {
          method: "POST",
          headers: { Authorization: `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
          body,
        },
        FATSECRET_TIMEOUT_SECONDS,
      );
      data = obj(json);
      if (!Object.hasOwn(data, "access_token")) return null;
    } catch (e) {
      if (e instanceof HttpFailure) return null;
      throw e;
    }
    const token = pyStr(data.access_token);
    const lifetime = pyFloat(pyTruthy(data.expires_in) ? data.expires_in : 86400);
    if (Number.isNaN(lifetime)) throw new TypeError("expires_in");
    this.token = { value: token, expiresAt: now + lifetime };
    return token;
  }

  /** A FatSecret product in Open Food Facts' shape, or null: no match, no keys, or any request failing is a soft fallback, never an error. */
  private async fatSecretProduct(barcode: string): Promise<Obj | null> {
    const token = await this.accessToken();
    if (!token) return null;
    const region = this.fatsecret!.region;
    const headers = { Authorization: `Bearer ${token}` };
    try {
      // FatSecret wants a GTIN-13: 13 digits, zero-padded on the left
      const gtin13 = barcode.padStart(13, "0");
      const found = obj(await getJson(this.send, withParams(FATSECRET_BARCODE_URL, { barcode: gtin13, region, format: "json" }), { headers }, FATSECRET_TIMEOUT_SECONDS));
      const idHolder = own(found, "food_id");
      const idValue = pyTruthy(idHolder) ? own(obj(idHolder), "value") : undefined;
      const foodId = pyStr(pyTruthy(idValue) ? idValue : "0");
      if (foodId === "0") return null; // "0" is FatSecret's documented sentinel for "no match", not a real id
      const answer = await getJson(this.send, withParams(FATSECRET_FOOD_URL, { food_id: foodId, region, format: "json" }), { headers }, FATSECRET_TIMEOUT_SECONDS);
      const food = pyTruthy(answer) ? own(obj(answer), "food") : undefined;
      if (!pyTruthy(food)) return null;
      return toOpenFoodFactsShape(obj(food));
    } catch (e) {
      if (e instanceof HttpFailure) return null;
      throw e;
    }
  }
}

/** A FatSecret food as the product Open Food Facts would give, per 100 g. */
export function toOpenFoodFactsShape(food: Obj): Obj | null {
  const container = own(food, "servings");
  const raw = pyTruthy(container) ? own(obj(container), "serving") : undefined;
  let servings: unknown[];
  if (!pyTruthy(raw)) servings = [];
  else if (isObject(raw)) servings = [raw]; // a single serving is not wrapped in a list
  else if (Array.isArray(raw)) servings = raw;
  else throw new TypeError("serving");
  if (!servings.length) return null;
  // prefer a serving given in grams (a real weight, not "1 bar" or "1 cup") so the scaling below means something
  const metric = servings.filter((s) => pyStr(Object.hasOwn(obj(s), "metric_serving_unit") ? obj(s).metric_serving_unit : "").toLowerCase() === "g");
  const serving = obj(metric.length ? metric[0] : servings[0]);
  const grams = num(serving, "metric_serving_amount") || 100;
  const scale = 100 / grams;
  return {
    product_name: text(own(food, "food_name")),
    brands: text(own(food, "brand_name")),
    serving_size: `${roundInt(grams)} g`,
    nutriments: {
      "energy-kcal_100g": num(serving, "calories") * scale,
      "proteins_100g": num(serving, "protein") * scale,
      "fat_100g": num(serving, "fat") * scale,
      "carbohydrates_100g": num(serving, "carbohydrate") * scale,
    },
  };
}
