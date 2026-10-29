/** Google Gemini over its REST API: the one place the Edge Functions talk to the model.
 *
 * Routes and chat code see only the `Gemini` interface, so tests hand in a fake (no network, no cost). The real client
 * tries up to three times when the model says "busy, try again" (HTTP 429 or 5xx) and throws on anything that is not an answer;
 * callers turn that into their own "unreachable" reply.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;

export interface Image {
  data: Uint8Array;
  mimeType: string;
}

export interface Turn {
  role: "user" | "model";
  text: string;
  /** Pictures sent with the text, inline. */
  images?: readonly Image[];
}

export interface GenerateRequest {
  model?: string;
  /** The standing instructions; the photo reviews send none. */
  system?: string;
  contents: readonly Turn[];
  /** How long one attempt may take (default 60 s). */
  timeoutMs?: number;
  /** How many times to try when the model says "busy" (default 3). A check-in a person is waiting on tries once. */
  attempts?: number;
  /** Block medium-and-above harassment, hate, sexual and dangerous content (App Review 4.7.1). The three free-text chats ask for it. */
  safe?: boolean;
  /** Make the model answer in JSON of this shape (the REST API's schema, type names in upper case: "OBJECT", "STRING"). */
  responseSchema?: Record<string, unknown>;
  /** Answer in JSON without a schema (the race analysis asks for this). */
  json?: boolean;
  /** How adventurous the wording is (the race analysis uses 0.4); the model's own default when omitted. */
  temperature?: number;
}

export interface Gemini {
  /** Whether there is a key at all (without one every chat answers its "unreachable" reply, as the website did). */
  readonly configured: boolean;
  /** The reply text, or null when the model gave nothing (blocked, or an empty answer). Throws when it could not be reached. */
  generate(request: GenerateRequest): Promise<string | null>;
}

export class GeminiError extends Error {}

const CATEGORIES = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"];

/** Capacity spikes ("this model is currently experiencing high demand", HTTP 503) are common and pass in seconds, so a few
 *  tries are worth making before the person is told the coach is unreachable. Only answers that say "try again" are retried. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS = 3;

/** Bytes as base64, in pieces (one String.fromCharCode over a whole photo overflows the call stack). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class GeminiClient implements Gemini {
  readonly configured: boolean;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly send: typeof fetch = (...a) => fetch(...a),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    /** The model every request uses unless it names another. Set the GEMINI_MODEL secret to move to a newer one without a code change. */
    private readonly model: string = GEMINI_MODEL,
  ) {
    this.configured = !!apiKey;
  }

  async generate(request: GenerateRequest): Promise<string | null> {
    if (!this.apiKey) throw new GeminiError("no Gemini key");
    const body: Record<string, unknown> = {
      contents: request.contents.map((t) => ({
        role: t.role,
        parts: [{ text: t.text }, ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: toBase64(i.data) } }))],
      })),
    };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    const config: Record<string, unknown> = {};
    if (request.temperature !== undefined) config.temperature = request.temperature;
    if (request.json || request.responseSchema) config.responseMimeType = "application/json";
    if (request.responseSchema) config.responseSchema = request.responseSchema;
    if (Object.keys(config).length) body.generationConfig = config;
    const attempts = request.attempts ?? ATTEMPTS;
    if (request.safe) body.safetySettings = CATEGORIES.map((category) => ({ category, threshold: "BLOCK_MEDIUM_AND_ABOVE" }));
    let response: Response | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        response = await this.send(`${ENDPOINT}/${request.model ?? this.model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(request.timeoutMs ?? TIMEOUT_MS),
        });
      } catch (e) {
        throw new GeminiError(e instanceof Error ? e.name : "unreachable"); // no network, or it timed out: not retried
      }
      if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === attempts) break;
      await this.sleep(attempt * 1000);
    }
    const answer = response as Response; // the loop always runs at least once and either sets it or throws
    if (!answer.ok) throw new GeminiError(`Gemini answered ${answer.status}`);
    let data: { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] };
    try {
      data = await answer.json();
    } catch {
      throw new GeminiError("Gemini sent something that is not JSON");
    }
    // What the official SDKs call `response.text`: the first candidate's text parts joined, thoughts left out.
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts) return null;
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text as string).join("");
    return text || null;
  }
}
