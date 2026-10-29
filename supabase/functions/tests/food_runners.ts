/** One function per kind of case in the food golden file (scripts/edge_golden_food.py): used by golden_food.test.ts against the Python's answers
 *  and by parity_more.check.ts, which runs the same inputs through both languages side by side. The product databases are a scripted "world":
 *  the answers Open Food Facts and FatSecret would give for each request, or a dropped connection. */
import {
  FATSECRET_BARCODE_URL,
  FATSECRET_FOOD_URL,
  FATSECRET_TOKEN_URL,
  OPEN_FOOD_FACTS_SEARCH_URL,
} from "../_shared/foodData.ts";
import { brandName, FoodLookup, LookupError, num, parseServingGrams, ProductNotFound, shortenName, validate } from "../_shared/foodLookup.ts";
import { validate as validatePhoto } from "../_shared/foodPhoto.ts";
import * as foods from "../_shared/foods.ts";
import type { Tx } from "../_shared/db.ts";
import { cleanText } from "../_shared/rows.ts";
import { pyStrip } from "../_shared/nameFilter.ts";

type Entry = "net" | "timeout" | { status: number; body: unknown } | null | undefined;
export interface World {
  off?: Record<string, Entry>;
  search?: Record<string, Entry>;
  fs_token?: Entry;
  fs_barcode?: Record<string, Entry>;
  fs_food?: Record<string, Entry>;
  creds?: boolean;
  region?: string | null;
}

function answer(entry: Entry): Promise<Response> {
  if (entry === null || entry === undefined) return Promise.resolve(new Response(JSON.stringify({ status: 0 }), { status: 404 }));
  if (entry === "net") return Promise.reject(new TypeError("down"));
  if (entry === "timeout") return Promise.reject(new DOMException("slow", "TimeoutError"));
  const body = typeof entry.body === "string" && entry.body.startsWith("TEXT:") ? entry.body : JSON.stringify(entry.body);
  return Promise.resolve(new Response(body, { status: entry.status }));
}

/** A fetch that answers from the world and writes down what was asked, in the words the Python side uses. */
export function worldFetch(world: World, calls: string[]): typeof fetch {
  return ((input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const param = (name: string) => url.searchParams.get(name);
    if (url.href.startsWith("https://world.openfoodfacts.org/api/v2/product/")) {
      const code = decodeURIComponent(url.pathname.split("/").pop()!).slice(0, -5);
      calls.push(`off:${code}`);
      return answer(world.off?.[code]);
    }
    if (url.origin + url.pathname === OPEN_FOOD_FACTS_SEARCH_URL) {
      calls.push(`search:${param("q")}:${param("page_size")}`);
      return answer(world.search?.[param("q")!]);
    }
    if (url.origin + url.pathname === FATSECRET_BARCODE_URL) {
      calls.push(`fs_barcode:${param("barcode")}:${param("region")}`);
      return answer(world.fs_barcode?.[param("barcode")!]);
    }
    if (url.origin + url.pathname === FATSECRET_FOOD_URL) {
      calls.push(`fs_food:${param("food_id")}:${param("region")}`);
      return answer(world.fs_food?.[param("food_id")!]);
    }
    if (url.origin + url.pathname === FATSECRET_TOKEN_URL && init?.method === "POST") {
      calls.push("fs_token");
      return answer(world.fs_token);
    }
    throw new Error("unexpected request " + url.href);
  }) as typeof fetch;
}

export const lookupFor = (world: World, calls: string[]): FoodLookup =>
  new FoodLookup(worldFetch(world, calls), world.creds ? { clientId: "id", clientSecret: "secret", region: pyStrip(world.region ?? "") || "TH" } : null);

async function outcome(fn: () => unknown): Promise<unknown[]> {
  try {
    return ["ok", await fn()];
  } catch (e) {
    if (e instanceof ProductNotFound) return ["notfound", e.message];
    if (e instanceof LookupError) return ["error", e.message];
    return ["crash"];
  }
}

function fakeTx(count: number, existing: boolean): Tx {
  const answerFor = (sql: string, params: readonly unknown[]): unknown[] | number => {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.includes("pg_advisory_xact_lock")) return 1;
    if (s.includes("count(*)")) return [{ n: count }];
    if (s.startsWith("select 1")) return existing ? [{ x: 1 }] : [];
    if (s.startsWith("insert into public.custom_foods ")) return [{ id: 7 }];
    if (s.startsWith("insert into public.custom_food_servings")) return 1;
    if (s.startsWith("insert into public.custom_exercises")) return [{ id: 3, name: params[1], emoji: params[2], mode: params[3] }];
    throw new Error("unexpected sql " + s);
  };
  const tx: Tx = {
    // deno-lint-ignore no-explicit-any
    all: (sql, params = []) => Promise.resolve(answerFor(sql, params) as any),
    // deno-lint-ignore no-explicit-any
    one: (sql, params = []) => Promise.resolve((Array.isArray(answerFor(sql, params)) ? (answerFor(sql, params) as unknown[])[0] ?? null : null) as any),
    exec: (sql, params = []) => Promise.resolve(Number(answerFor(sql, params) === 1 ? 1 : 0)),
    savepoint: (fn) => fn(tx),
  };
  return tx;
}

async function made(fn: (tx: Tx, user: string, payload: Record<string, unknown>) => Promise<unknown>, payload: Record<string, unknown>, kw: { count?: number; existing?: boolean }) {
  try {
    return ["ok", await fn(fakeTx(kw.count ?? 0, kw.existing ?? false), "user", payload)];
  } catch (e) {
    if (e instanceof foods.Rejected) return ["rejected", e.status, e.message];
    throw e;
  }
}

// deno-lint-ignore no-explicit-any
export const FOOD_RUNNERS: Record<string, (input: any) => unknown | Promise<unknown>> = {
  validate: ([barcode, product, source]: [string, unknown, string]) => outcome(() => validate(barcode, product, source)),
  serving: (product: Record<string, unknown>) => outcome(() => parseServingGrams(product)),
  brand: (product: Record<string, unknown>) => outcome(() => brandName(product)),
  shorten: ([name, max]: [string, number]) => ["ok", shortenName(name, max)],
  num: ([source, key]: [Record<string, unknown>, string]) => (num(source, key) === Infinity ? "inf" : num(source, key)), // JSON cannot carry infinity
  lookups: async ([raw, world]: [unknown, World]) => {
    const calls: string[] = [];
    const result = await outcome(() => lookupFor(world, calls).lookupBarcode(raw));
    return [result, calls];
  },
  searches: async ([query, limit, world]: [unknown, number, World]) => {
    const calls: string[] = [];
    const result = await outcome(() => lookupFor(world, calls).search(query, limit));
    return [result, calls];
  },
  photo: (parsed: unknown) => {
    try {
      return ["ok", validatePhoto(parsed)];
    } catch {
      return ["crash"];
    }
  },
  macro: (v: unknown) => foods.macro(v),
  grams: ([v, d]: [unknown, number]) => foods.grams(v, d),
  clean: ([v, n]: [unknown, number]) => cleanText(v, n),
  digits: (v: unknown) => foods.digitsOnly(v),
  createFood: ([payload, kw]: [Record<string, unknown>, { count?: number; existing?: boolean }]) => made(foods.createFood, payload, kw),
  createExercise: ([payload, kw]: [Record<string, unknown>, { count?: number; existing?: boolean }]) => made(foods.createExercise, payload, kw),
  asScan: (food: foods.Food) => foods.foodAsScanResult(food),
};
