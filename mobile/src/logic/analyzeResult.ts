/**
 * Reading an analysis the server sends and deciding what to show of it: the rules of templates/index.html (sectionsHtml,
 * fbItemHtml, relativeDateLabel) and templates/analyze_history.html, rule for rule. The server did the hard part already
 * (api/feedback.py splits the report into sections and picks their emphasis); this only parses, groups and labels.
 */
import { exerciseByName } from './workouts';

export type Tone = 'good' | 'ok' | 'bad';
export type SectionClass = 'summary' | 'positives' | 'negatives' | 'improvements' | 'injury' | 'progress';
export type Favored = 'stretch' | 'squeeze' | 'balanced';

export interface FormSection {
  heading: string;
  css_class: SectionClass;
  emphasis: 'featured' | 'muted';
  title_key: `analyze.section.${SectionClass}`;
  summary_html: string;
  detail_html: string | null;
}

export interface Analysis {
  id: number;
  exercise_label: string;
  overall_score: number | null;
  stretch_score: number | null;
  squeeze_score: number | null;
  favored: Favored | null;
  reps: number | null;
  sections: FormSection[];
  /** The whole report as the model wrote it (the analysis chat is told it). */
  feedback_text: string;
  created_at: string;
  /** When it was made, in milliseconds; NaN when the server's date cannot be read. */
  created_at_ms: number;
  /** A short-lived signed link; null when no clip was kept (or it could not be signed just now). */
  video_url: string | null;
}

export interface HistoryEntry {
  id: number;
  exercise_label: string;
  overall_score: number | null;
  reps: number | null;
  created_at: string;
  has_video: boolean;
}

const CLASSES: readonly SectionClass[] = ['summary', 'positives', 'negatives', 'improvements', 'injury', 'progress'];

/** Positives and "your next step" are what happened and what to do next: the two worth seeing without another tap. */
export const ALWAYS_VISIBLE: readonly SectionClass[] = ['positives', 'progress'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function parseSection(raw: unknown): FormSection | null {
  if (!isRecord(raw)) return null;
  const css = raw.css_class as SectionClass;
  if (!CLASSES.includes(css) || typeof raw.summary_html !== 'string') return null;
  return {
    heading: text(raw.heading),
    css_class: css,
    emphasis: raw.emphasis === 'muted' ? 'muted' : 'featured',
    title_key: `analyze.section.${css}`,
    summary_html: raw.summary_html,
    detail_html: typeof raw.detail_html === 'string' && raw.detail_html ? raw.detail_html : null,
  };
}

/** One analysis as the server answers (fresh, or from history). Null when it is not one; a bad section is skipped, not fatal. */
export function parseAnalysis(raw: unknown): Analysis | null {
  if (!isRecord(raw) || typeof raw.id !== 'number' || typeof raw.exercise_label !== 'string' || !raw.exercise_label) return null;
  const favored = raw.favored === 'stretch' || raw.favored === 'squeeze' || raw.favored === 'balanced' ? raw.favored : null;
  const reps = numberOrNull(raw.reps);
  return {
    id: raw.id,
    exercise_label: raw.exercise_label,
    overall_score: numberOrNull(raw.overall_score),
    stretch_score: numberOrNull(raw.stretch_score),
    squeeze_score: numberOrNull(raw.squeeze_score),
    favored,
    // The website hides a count of zero: an explicit 0 reads as "we watched and you did nothing" next to a grade.
    reps: reps !== null && reps > 0 ? reps : null,
    sections: (Array.isArray(raw.sections) ? raw.sections : []).map(parseSection).filter((s): s is FormSection => s !== null),
    feedback_text: text(raw.feedback_text),
    created_at: text(raw.created_at),
    created_at_ms: numberOrNull(raw.created_at_ms) ?? createdMs(text(raw.created_at)),
    video_url: typeof raw.video_url === 'string' && raw.video_url ? raw.video_url : null,
  };
}

export function parseHistory(raw: unknown): HistoryEntry[] {
  const entries = isRecord(raw) && Array.isArray(raw.entries) ? raw.entries : [];
  const out: HistoryEntry[] = [];
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.id !== 'number' || typeof entry.exercise_label !== 'string') continue;
    out.push({
      id: entry.id,
      exercise_label: entry.exercise_label,
      overall_score: numberOrNull(entry.overall_score),
      reps: numberOrNull(entry.reps),
      created_at: text(entry.created_at),
      has_video: entry.has_video === true,
    });
  }
  return out;
}

/** The score's colour: 80 and up good, 50 and up ok, below that bad. No score, no tone. */
export function scoreTone(score: number | null): Tone | null {
  if (score === null) return null;
  if (score >= 80) return 'good';
  if (score >= 50) return 'ok';
  return 'bad';
}

/** The one-line verdict under the score (the same buckets the server filters the sections by); none without a score. */
export function verdictKey(score: number | null): 'analyze.verdictGood' | 'analyze.verdictOk' | 'analyze.verdictBad' | null {
  const tone = scoreTone(score);
  return tone === null ? null : tone === 'good' ? 'analyze.verdictGood' : tone === 'ok' ? 'analyze.verdictOk' : 'analyze.verdictBad';
}

/** Which note to show about stretch against squeeze: "balanced", or "this set favours X, Y could use more focus". */
export function favoredNote(favored: Favored | null): { key: 'analyze.balancedNote' } | { key: 'analyze.favorsNote'; favored: 'analyze.stretch' | 'analyze.squeeze'; other: 'analyze.stretch' | 'analyze.squeeze' } | null {
  if (favored === 'balanced') return { key: 'analyze.balancedNote' };
  if (favored === 'stretch') return { key: 'analyze.favorsNote', favored: 'analyze.stretch', other: 'analyze.squeeze' };
  if (favored === 'squeeze') return { key: 'analyze.favorsNote', favored: 'analyze.squeeze', other: 'analyze.stretch' };
  return null;
}

/** What sits above the fold and what waits behind "Full report". Order within each is the server's. */
export function splitSections(sections: readonly FormSection[]): { primary: FormSection[]; secondary: FormSection[] } {
  return {
    primary: sections.filter((s) => ALWAYS_VISIBLE.includes(s.css_class)),
    secondary: sections.filter((s) => !ALWAYS_VISIBLE.includes(s.css_class)),
  };
}

const DAY_MS = 86_400_000;

/** The server's created_at as milliseconds; NaN when it is not a date. */
export function createdMs(createdAt: string): number {
  return new Date(createdAt).getTime();
}

export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'days'; n: number } | { kind: 'date'; ms: number };

/** Today / yesterday / N days ago for the first week, then a date. Whole 24-hour blocks, as the website counts them. */
export function relativeDay(createdAt: string, now: number): DayLabel | null {
  const ms = createdMs(createdAt);
  if (!Number.isFinite(ms)) return null;
  const days = Math.floor((now - ms) / DAY_MS);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'yesterday' };
  if (days < 7) return { kind: 'days', n: days };
  return { kind: 'date', ms };
}

export interface MonthGroup {
  /** "2026-9" (year, zero-based month) of the local date; "unknown" for an entry with no date. */
  key: string;
  /** Milliseconds of the group's first entry, for naming the month; null when unknown. */
  ms: number | null;
  entries: HistoryEntry[];
}

/** The history grouped by calendar month of the LOCAL date, in the order given (newest first), skipping months with nothing. */
export function groupByMonth(entries: readonly HistoryEntry[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const entry of entries) {
    const ms = createdMs(entry.created_at);
    const date = Number.isFinite(ms) ? new Date(ms) : null;
    const key = date ? `${date.getFullYear()}-${date.getMonth()}` : 'unknown';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, ms: date ? ms : null, entries: [entry] });
  }
  return groups;
}

/** The how-to video for a library exercise, else a YouTube search for its form. */
export function tutorialLink(exerciseLabel: string): { url: string; known: boolean } {
  const video = exerciseByName(exerciseLabel)?.video;
  if (video) return { url: `https://www.youtube.com/watch?v=${encodeURIComponent(video)}`, known: true };
  return { url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exerciseLabel} proper form tutorial`)}`, known: false };
}

/** The status lines cycled while the clip is graded, in order. */
export const STATUS_KEYS = [
  'analyze.status1',
  'analyze.status2',
  'analyze.status3',
  'analyze.status4',
  'analyze.status5',
  'analyze.status6',
  'analyze.status7',
] as const;

/**
 * The line to show after `elapsedMs`, a new one every 2.2 s as on the website. The website wraps round to the first line;
 * grading can take minutes, and "Loading video..." coming back after "Drafting your form report..." reads as a restart, so
 * this stays on the last line once it is reached.
 */
export const STATUS_STEP_MS = 2200;
export function statusKeyAt(elapsedMs: number, stepMs = STATUS_STEP_MS): (typeof STATUS_KEYS)[number] {
  const index = Math.floor(Math.max(0, elapsedMs) / stepMs);
  return STATUS_KEYS[Math.min(index, STATUS_KEYS.length - 1)];
}
