/** Google Gemini over its REST API: the one place the Edge Functions talk to the model.
 *
 * Routes and chat code see only the `Gemini` interface, so tests hand in a fake (no network, no cost). The real client
 * tries up to three times when the model says "busy, try again" (HTTP 429 or 5xx) and throws on anything that is not an answer;
 * callers turn that into their own "unreachable" reply.
 */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
const API = "https://generativelanguage.googleapis.com";
const ENDPOINT = `${API}/v1beta/models`;
const TIMEOUT_MS = 60_000;

export interface Image {
  data: Uint8Array;
  mimeType: string;
}

/** A video already uploaded to Gemini's file store, with the stretch of it to look at and how densely to sample it. */
export interface VideoPart {
  fileUri: string;
  mimeType: string;
  /** Seconds as the REST API writes them ("5s", "65.5s"). */
  startOffset: string;
  endOffset: string;
  fps: number;
}

/** A clip held in Gemini's file store. `durationSeconds` is what Gemini measured, or null when it did not say. */
export interface GeminiFile {
  name: string;
  uri: string;
  mimeType: string;
  durationSeconds: number | null;
}

export interface Turn {
  role: "user" | "model";
  text: string;
  /** Videos from the file store, placed BEFORE the text (the form grader shows the lift, then asks about it). */
  videos?: readonly VideoPart[];
  /** Pictures sent with the text, inline. */
  images?: readonly Image[];
  /** More text after the pictures (the food scan's note from the person). */
  after?: string;
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
  /** How long the model may reason first ("LOW" for the form grader: deeper thinking doubled the wait for the same answer). */
  thinkingLevel?: string;
}

export interface Gemini {
  /** Whether there is a key at all (without one every chat answers its "unreachable" reply, as the website did). */
  readonly configured: boolean;
  /** The reply text, or null when the model gave nothing (blocked, or an empty answer). Throws when it could not be reached. */
  generate(request: GenerateRequest): Promise<string | null>;
  /** Put a clip in Gemini's file store and wait until it can be read. Throws GeminiFileRejected when Gemini cannot read it, GeminiError otherwise. */
  upload(data: Uint8Array, mimeType: string, timeoutMs: number): Promise<GeminiFile>;
  /** Remove a stored clip. Never throws: the store drops files after two days anyway. */
  deleteFile(name: string): Promise<void>;
}

export class GeminiError extends Error {}
/** Gemini took the clip and then said it cannot read it (not a video, damaged, or a format it does not know). */
export class GeminiFileRejected extends GeminiError {}

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
        parts: [...(t.videos ?? []).map((v) => ({ fileData: { fileUri: v.fileUri, mimeType: v.mimeType }, videoMetadata: { startOffset: v.startOffset, endOffset: v.endOffset, fps: v.fps } })), { text: t.text }, ...(t.images ?? []).map((i) => ({ inlineData: { mimeType: i.mimeType, data: toBase64(i.data) } })), ...(t.after ? [{ text: t.after }] : [])],
      })),
    };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    const config: Record<string, unknown> = {};
    if (request.temperature !== undefined) config.temperature = request.temperature;
    if (request.thinkingLevel) config.thinkingConfig = { thinkingLevel: request.thinkingLevel };
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

  /** One request of the file upload, tried twice when Gemini says "busy". */
  private async fileCall(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await this.send(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        throw new GeminiError(e instanceof Error ? e.name : "unreachable");
      }
      if (response.ok || !RETRY_STATUSES.has(response.status) || attempt === 2) break;
      await this.sleep(1000);
    }
    return response as Response;
  }

  async upload(data: Uint8Array, mimeType: string, timeoutMs: number): Promise<GeminiFile> {
    if (!this.apiKey) throw new GeminiError("no Gemini key");
    const key = { "x-goog-api-key": this.apiKey };
    const start = await this.fileCall(`${API}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        ...key,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(data.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: "set" } }),
    }, timeoutMs);
    const target = start.headers.get("x-goog-upload-url");
    if (!start.ok || !target) throw new GeminiError(`Gemini answered ${start.status} to the upload`);
    const sent = await this.fileCall(target, {
      method: "POST",
      headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
      body: data as unknown as BodyInit,
    }, timeoutMs);
    if (!sent.ok) throw new GeminiError(`Gemini answered ${sent.status} to the upload`);
    let file = await readFile(sent);
    // A video is processed before it can be read; this takes a few seconds. One poll a second, as many seconds as the caller allows.
    for (let polls = 0; file.state === "PROCESSING" && polls < Math.ceil(timeoutMs / 1000); polls++) {
      await this.sleep(1000);
      const again = await this.fileCall(`${API}/v1beta/${file.name}`, { method: "GET", headers: key }, timeoutMs);
      if (!again.ok) throw new GeminiError(`Gemini answered ${again.status} to the file check`);
      file = await readFile(again, true);
    }
    if (file.state === "FAILED") throw new GeminiFileRejected("Gemini could not read the file");
    if (file.state !== "ACTIVE") throw new GeminiError("Gemini did not finish reading the file in time");
    return { name: file.name, uri: file.uri, mimeType: file.mimeType, durationSeconds: file.durationSeconds };
  }

  async deleteFile(name: string): Promise<void> {
    if (!this.apiKey) return;
    try {
      await this.send(`${API}/v1beta/${name}`, { method: "DELETE", headers: { "x-goog-api-key": this.apiKey }, signal: AbortSignal.timeout(10_000) });
    } catch { /* it expires by itself */ }
  }
}

interface FileInfo extends GeminiFile {
  state: string;
}

/** What Gemini says about a stored file: `{file: {...}}` after an upload, the bare object when asked about it. */
async function readFile(response: Response, bare = false): Promise<FileInfo> {
  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    throw new GeminiError("Gemini sent something that is not JSON");
  }
  const file = (bare ? data : data.file) as Record<string, unknown> | undefined;
  if (!file || typeof file.name !== "string" || typeof file.uri !== "string") throw new GeminiError("Gemini sent an unreadable file record");
  const length = (file.videoMetadata as { videoDuration?: unknown } | undefined)?.videoDuration;
  const seconds = typeof length === "string" ? /^(\d+(?:\.\d+)?)s$/.exec(length) : null;
  return {
    name: file.name,
    uri: file.uri,
    mimeType: typeof file.mimeType === "string" ? file.mimeType : "video/mp4",
    durationSeconds: seconds ? Number(seconds[1]) : null,
    state: typeof file.state === "string" ? file.state : "ACTIVE",
  };
}
