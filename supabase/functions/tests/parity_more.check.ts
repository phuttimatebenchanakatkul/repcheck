/** Answers batches of inputs with the Edge Function code, for tests/test_edge_functions.py to compare with the Python's.
 *  `deno run --allow-read parity_more.check.ts <input.json>` where the JSON holds any of:
 *  {hashes: [[stored, password]], emails: [raw], images: [base64], userIds: [raw], codes: [raw], offsets: [raw], hyrox: [payload], days: [iso date],
 *   texts: [[raw, limit]], sources: [[reply, question]], requests: [[payload, takesContext]], analysisPrompts: [context], workoutPrompts: [context], instruction: true}.
 */
import { checkPasswordHash } from "../_shared/passwordHash.ts";
import { cleanEmail } from "../_shared/email.ts";
import { inspectImage, PhotoRejected } from "../_shared/photos.ts";
import { cleanText } from "../_shared/rows.ts";
import { buildAnalysisPrompt, buildWorkoutPrompt, ChatRejected, cleanRequest } from "../_shared/chats.ts";
import { attachSources, promptInstruction } from "../_shared/healthSources.ts";
import { cleanCode, cleanHyroxResult, offsetMinutes, parseUserId, Rejected, todaysExercise } from "../_shared/social.ts";

const input = JSON.parse(Deno.readTextFileSync(Deno.args[0]));

const hashes = (input.hashes ?? []).map(([stored, password]: [string, string]) => checkPasswordHash(stored, password));
const emails = (input.emails ?? []).map((raw: unknown) => cleanEmail(raw));
const images = (input.images ?? []).map((b64: string) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  try {
    return inspectImage(bytes);
  } catch (e) {
    if (!(e instanceof PhotoRejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const userIds = (input.userIds ?? []).map((raw: unknown) => parseUserId(raw));
const codes = (input.codes ?? []).map((raw: unknown) => {
  try {
    return cleanCode(raw);
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const offsets = (input.offsets ?? []).map((raw: unknown) => offsetMinutes(raw));
const hyrox = (input.hyrox ?? []).map((payload: Record<string, unknown>) => {
  try {
    return cleanHyroxResult(payload);
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    return `ERR:${e.status}:${e.message}`;
  }
});
const days = (input.days ?? []).map((iso: string) => todaysExercise(undefined, new Date(iso + "T05:00:00Z")));
const texts = (input.texts ?? []).map(([raw, limit]: [unknown, number]) => cleanText(raw, limit));
const sources = (input.sources ?? []).map(([reply, question]: [string, string]) => {
  const [text, found] = attachSources(reply, question);
  return [text, found.map((s) => s.id)];
});
const requests = (input.requests ?? []).map(([payload, takesContext]: [Record<string, unknown>, boolean]) => {
  try {
    return cleanRequest(payload, takesContext);
  } catch (e) {
    if (!(e instanceof ChatRejected)) throw e;
    return `ERR:${e.message}`;
  }
});
const analysisPrompts = (input.analysisPrompts ?? []).map((c: Record<string, unknown>) => buildAnalysisPrompt(c));
const workoutPrompts = (input.workoutPrompts ?? []).map((c: Record<string, unknown>) => buildWorkoutPrompt(c));
const instruction = input.instruction ? promptInstruction() : null;

console.log(JSON.stringify({ hashes, emails, images, userIds, codes, offsets, hyrox, days, texts, sources, requests, analysisPrompts, workoutPrompts, instruction }));
