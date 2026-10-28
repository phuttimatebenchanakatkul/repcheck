/** Google Gemini over its REST API: the one place the Edge Functions talk to the model.
 *
 * Routes and chat code see only the `Gemini` interface, so tests hand in a fake (no network, no cost). The real client
 * tries up to three times when the model says "busy, try again" (HTTP 429 or 5xx) and throws on anything that is not an answer;
 * callers turn that into their own "unreachable" reply.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;

export interface Turn {
  role: "user" | "model";
  text: string;
}

export interface GenerateRequest {
  model?: string;
  system: string;
  contents: readonly Turn[];
  /** Block medium-and-above harassment, hate, sexual and dangerous content (App Review 4.7.1). The three free-text chats ask for it. */
  safe?: boolean;
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
      contents: request.contents.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      systemInstruction: { parts: [{ text: request.system }] },
    };
    if (request.safe) body.safetySettings = CATEGORIES.map((category) => ({ category, threshold: "BLOCK_MEDIUM_AND_ABOVE" }));
    let response: Response | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        response = await this.send(`${ENDPOINT}/${request.model ?? this.model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new GeminiError(e instanceof Error ? e.name : "unreachable"); // no network, or it timed out: not retried
      }
      if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === ATTEMPTS) break;
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
