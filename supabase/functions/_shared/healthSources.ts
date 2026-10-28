/** Citations for the health and training information the AI chats give (App Review Guideline 1.4.1).
 *
 * The catalog (chatData.ts) is fixed and hand-checked: the model never writes a URL, it can only pick ids from it, so a
 * reply cannot cite a study that does not exist. `promptInstruction()` is appended to each chat's system prompt and asks the
 * model to end with one machine-readable line naming catalog ids; `attachSources()` strips that line back off the reply and
 * turns it into the source objects the app shows under the bubble. When the model leaves the line out or names nothing
 * valid, a keyword match on the question and reply picks the sources instead, so a health answer is never shown bare.
 *
 * A port of health_sources.py. Its regular expressions are Python's: `\b` there is Unicode-aware (a Thai letter is a word
 * character) and `.` matches a carriage return, neither of which is true of JavaScript's, so they are written out here.
 */
import { type Source, SOURCES } from "./chatData.ts";
import { pyRstrip, pyStrip } from "./nameFilter.ts";

export { SOURCES };
export const SOURCES_BY_ID: ReadonlyMap<string, Source> = new Map(SOURCES.map((s) => [s.id, s]));

/** A reply cites at most this many: enough to back an answer, few enough that the list under a small chat bubble stays readable. */
export const MAX_SOURCES_PER_REPLY = 3;

// Python's \w: any letter or number in any script, and the underscore.
const W = "[\\p{L}\\p{N}_]";
/** Python's `\b` for this regex engine: between a word character and a non-word one. */
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const rule = (pattern: string) => new RegExp(pattern.replaceAll("\\b", B).replaceAll(".*", "[^\\n]*"), "iu");

/** (pattern, source ids). Checked in order against the question and the reply together; the first matches win, up to the cap.
 *  Specific topics come before broad ones so "how long should I rest between squat sets" cites the rest-interval studies,
 *  not the general strength position stand. */
const KEYWORD_RULES: [RegExp, string[]][] = ([
  ["\\b(pain|hurt|hurts|injur|sprain|strain|tendon|swollen|swelling|doctor|physio)", ["nhs_sports_injuries"]],
  ["\\brest(ing)?\\b.*\\b(set|sets|between)\\b|\\bbetween sets\\b|\\brest (time|period|interval)", ["schoenfeld_rest_2016", "grgic_rest_2017"]],
  ["\\bcreatine\\b", ["issn_creatine_2017"]],
  ["\\b(caffeine|pre-?workout|coffee)\\b", ["issn_caffeine_2021"]],
  ["\\b(hydrat|water intake|dehydrat|electrolyte|sweat)", ["acsm_fluid_2007"]],
  ["\\b(fat loss|lose fat|losing fat|lose weight|losing weight|weight loss|cut|cutting|deficit|lean out)\\b", ["helms_2014", "garthe_2011", "longland_2016"]],
  ["\\b(protein|macro|macros|calorie|calories|diet|nutrition|eat|eating)\\b", ["issn_protein_2017", "morton_protein_2018"]],
  ["\\b(sleep|recover|recovery|sore|soreness|doms|deload|fatigue)\\b", ["dupuy_recovery_2018", "aasm_sleep_2015"]],
  ["\\b(mobility|stretch|stretching|flexib|range of motion|warm[- ]?up)\\b", ["behm_stretching_2016", "alizadeh_rom_2023"]],
  ["\\bsquat", ["schoenfeld_squat_2010"]],
  ["\\b(volume|how many sets|sets per|frequency|times a week|per week|split)\\b", ["schoenfeld_volume_2017", "schoenfeld_frequency_2016"]],
  ["\\b(muscle growth|build muscle|building muscle|hypertroph|bulk|gain muscle|grow)\\b", ["schoenfeld_volume_2017", "schoenfeld_loading_2021"]],
  ["\\b(progressive overload|overload|progress|strength|stronger|reps?|one[- ]rep max|1rm|weight to use|form|technique)\\b", ["acsm_2009", "schoenfeld_loading_2021"]],
  ["\\b(cardio|walk|walking|running|steps|aerobic|activity|active)\\b", ["who_2020", "pag_2018"]],
] as [string, string[]][]).map(([pattern, ids]) => [rule(pattern), ids]);

/** The line the model is asked to end with. Tolerates the markdown a model tends to dress it in anyway:
 *  "**Sources:** a, b", "SOURCES: [a, b]", "Sources - a; b". */
// `^` and `$` are written as lookarounds because Python's MULTILINE ones see only "\n" as a line break, JavaScript's also "\r".
const SOURCES_LINE = /(?<![^\n])[ \t>*_-]*\**sources?\**[ \t]*\**[ \t]*[:-][ \t]*\**[ \t]*(?<ids>[^\n]*)(?![^\n])/giu;
const ID_TOKEN = /[a-z0-9_]+/g;
const ID_FORMAT = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;

/** The rule appended to every chatbot's system prompt. */
export function promptInstruction(): string {
  const catalog = SOURCES.map((s) => `- ${s.id}: ${s.title}`).join("\n");
  return (
    "\n\nCiting sources (required): end EVERY reply with one final line, " +
    "on its own, in exactly this form:\n" +
    "SOURCES: id1, id2\n" +
    `listing 1 to ${MAX_SOURCES_PER_REPLY} ids from the catalog below ` +
    "whose findings back the health, training or nutrition advice in " +
    "your reply. Use ONLY ids from this catalog -- never invent one, and " +
    "never write a URL, study title or author yourself anywhere in the " +
    "reply; the app turns the ids into links for the user. If the reply " +
    "gives no health, training or nutrition information at all (a " +
    "greeting, or declining an off-topic question), write SOURCES: none.\n" +
    "Do not mention this line or the catalog in the rest of your reply.\n" +
    `Catalog:\n${catalog}`
  );
}

export interface PublicSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
}

const publicSource = (s: Source): PublicSource => ({ id: s.id, title: s.title, publisher: s.publisher, url: s.url });

function keywordIds(text: string): string[] {
  const ids: string[] = [];
  for (const [pattern, ruleIds] of KEYWORD_RULES) {
    if (pattern.test(text)) for (const id of ruleIds) if (!ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, MAX_SOURCES_PER_REPLY);
}

/** Python's str.strip(chars): trims any of `chars` from both ends. */
const stripChars = (s: string, chars: string) => {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
};

/** Split the model's SOURCES line off `reply` and resolve it. Returns [cleanReply, sources], at most MAX_SOURCES_PER_REPLY long. */
export function attachSources(replyIn: unknown, question = ""): [string, PublicSource[]] {
  let reply = String(replyIn ?? "");
  let modelIds: string[] = [];
  let saidNone = false;
  const matches = [...reply.matchAll(SOURCES_LINE)];
  // Only a line that ENDS the reply is the citation line. Anywhere else, "Sources: eggs, chicken, Greek yogurt" is the answer
  // itself and has to stay in it.
  if (matches.length) {
    const last = matches[matches.length - 1];
    const end = last.index! + last[0].length;
    if (!pyStrip(reply.slice(end))) {
      const raw = stripChars(pyStrip(last.groups!.ids as string), "*[]()`. ").toLowerCase();
      saidNone = raw.startsWith("none") || raw === "n/a";
      modelIds = (raw.match(ID_TOKEN) ?? []).filter((t) => SOURCES_BY_ID.has(t));
      // ...and even a final line is only ours if it is written in ids (or says none). An answer can end on "Sources: eggs,
      // chicken", but a made-up "fake_study_2020" is still our format and still goes.
      const parts = raw.split(/[,;]/).map((p) => pyStrip(p)).filter(Boolean);
      const inIdFormat = parts.length > 0 && parts.every((p) => ID_FORMAT.test(p));
      if (modelIds.length || saidNone || inIdFormat) reply = pyRstrip(reply.slice(0, last.index!));
    }
  }
  let ids: string[] = [];
  for (const id of modelIds) if (!ids.includes(id)) ids.push(id);
  ids = ids.slice(0, MAX_SOURCES_PER_REPLY);
  if (!ids.length) ids = keywordIds(`${question}\n${reply}`);
  // The model gave advice but neither it nor the keywords named a topic: the general guidelines rather than nothing.
  if (!ids.length && !saidNone) ids = ["acsm_2009", "who_2020"];
  return [reply, ids.map((i) => publicSource(SOURCES_BY_ID.get(i)!))];
}
