/**
 * The HYROX race tracker's rules: static/hyrox.js is the original (the station order, the weight standards, how a finished race is
 * flagged and ranked). A race is 8 × 1 km runs alternating with 8 stations, timed by tapping through them.
 *
 * The station order and weight standards are the official rulebook's as of the website's build; HYROX updates them by season.
 */
import { formatDistanceKm, formatWeightKg, type UnitPrefs } from './units';

export const CATEGORIES = ['open', 'pro'] as const;
export const FORMATS = ['singles', 'doubles'] as const;
export const GENDERS = ['men', 'women'] as const;
/** Half halves every run, every station distance and the wall-ball reps (the loads stay the standard). Singles only. */
export const SCALES = ['full', 'half'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Format = (typeof FORMATS)[number];
export type Gender = (typeof GENDERS)[number];
export type Scale = (typeof SCALES)[number];

export interface Segment {
  type: 'run' | 'station';
  key: string;
  title?: string;
}

/** The race, in order. */
export const STATIONS: readonly Segment[] = [
  { type: 'run', key: 'run1' },
  { type: 'station', key: 'skierg', title: 'SkiErg' },
  { type: 'run', key: 'run2' },
  { type: 'station', key: 'sledPush', title: 'Sled Push' },
  { type: 'run', key: 'run3' },
  { type: 'station', key: 'sledPull', title: 'Sled Pull' },
  { type: 'run', key: 'run4' },
  { type: 'station', key: 'burpeeBroadJump', title: 'Burpee Broad Jumps' },
  { type: 'run', key: 'run5' },
  { type: 'station', key: 'row', title: 'Rowing' },
  { type: 'run', key: 'run6' },
  { type: 'station', key: 'farmersCarry', title: 'Farmers Carry' },
  { type: 'run', key: 'run7' },
  { type: 'station', key: 'lunges', title: 'Sandbag Lunges' },
  { type: 'run', key: 'run8' },
  { type: 'station', key: 'wallBalls', title: 'Wall Balls' },
];

export const STATION_KEYS: readonly string[] = STATIONS.filter((s) => s.type === 'station').map((s) => s.key);

type ByGender<T> = Record<Gender, T>;
type ByGenderCategory = ByGender<Record<Category, number>>;

export interface StationSpec {
  distanceM?: number;
  /** A sled round is one 12.5 m segment. */
  splitM?: number;
  weightKg?: ByGenderCategory;
  perHandKg?: ByGenderCategory;
  sandbagKg?: ByGenderCategory;
  ballKg?: ByGender<number>;
  reps?: ByGender<number>;
  targetFt?: ByGender<number>;
}

/** Reference standards: raw numbers (kg, metres), so the person's unit can be applied when they are shown. */
export const STATION_SPECS: Record<string, StationSpec> = {
  skierg: { distanceM: 1000 },
  sledPush: { distanceM: 50, splitM: 12.5, weightKg: { men: { open: 152, pro: 202 }, women: { open: 102, pro: 152 } } },
  sledPull: { distanceM: 50, splitM: 12.5, weightKg: { men: { open: 103, pro: 152 }, women: { open: 78, pro: 103 } } },
  burpeeBroadJump: { distanceM: 80 },
  row: { distanceM: 1000 },
  farmersCarry: { distanceM: 200, perHandKg: { men: { open: 24, pro: 32 }, women: { open: 16, pro: 24 } } },
  lunges: { distanceM: 100, sandbagKg: { men: { open: 20, pro: 30 }, women: { open: 10, pro: 20 } } },
  wallBalls: { ballKg: { men: 6, women: 4 }, reps: { men: 100, women: 75 }, targetFt: { men: 9, women: 8 } },
};

/** The stations whose total is counted in rounds (laps of the person's lane), and split between a Doubles pair. */
export const ROUND_STATIONS: readonly string[] = ['sledPush', 'sledPull', 'farmersCarry', 'lunges'];

/** Matches the official sled-marker spacing: a reasonable lane for a small gym until the person says otherwise. */
export const DEFAULT_LANE_M = 12.5;
export const MIN_LANE_M = 1;
export const MAX_LANE_M = 500;

/**
 * Times at or under these are flagged as unrealistic (far outside what has been achieved even at elite level): kept in the history but
 * never a personal best or on a leaderboard. The server refuses anything faster too (api/social.py HYROX_MIN_PLAUSIBLE_SECONDS).
 */
export const FLAG_THRESHOLD_SECONDS: Record<string, number> = {
  'men|singles': 50 * 60,
  'women|singles': 53 * 60,
  'men|doubles': 47 * 60,
  'women|doubles': 51 * 60,
};

/** How many of your own times a personal-best board lists. */
export const PB_BOARD_LIMIT = 5;

export const RUN_DISTANCE_M = 1000;
export const runDistanceM = (scale: Scale): number => (scale === 'half' ? RUN_DISTANCE_M / 2 : RUN_DISTANCE_M);

/** A station's distance in metres, halved in a Half race; null for a station measured in reps (wall balls). */
export function scaledStationDistanceM(key: string, scale: Scale): number | null {
  const distance = STATION_SPECS[key]?.distanceM;
  if (typeof distance !== 'number') return null;
  return scale === 'half' ? distance / 2 : distance;
}

export function scaledWallBallReps(gender: Gender, scale: Scale): number {
  const reps = (STATION_SPECS.wallBalls.reps as ByGender<number>)[gender];
  return scale === 'half' ? Math.round(reps / 2) : reps;
}

/** The standard load at a station in kg (the sled, each hand, the sandbag), or null where there is none to carry. */
export function stationWeightKg(key: string, gender: Gender, category: Category): number | null {
  const spec = STATION_SPECS[key];
  if (!spec) return null;
  if (key === 'sledPush' || key === 'sledPull') return spec.weightKg?.[gender][category] ?? null;
  if (key === 'farmersCarry') return spec.perHandKg?.[gender][category] ?? null;
  if (key === 'lunges') return spec.sandbagKg?.[gender][category] ?? null;
  return null;
}

/** How many laps of the person's lane it takes to cover a station: "first line to last line and back counts as one". At least 1. */
export function roundsFor(key: string, scale: Scale, laneM: number): number | null {
  const distance = scaledStationDistanceM(key, scale);
  if (distance === null) return null;
  return Math.ceil(distance / laneM); // a positive distance over a positive lane: always at least one
}

/**
 * What to show as the number of rounds at a station: all of them in Singles; in Doubles the person's share, which starts as half of
 * the total (a Doubles pair does the same total as Singles, split between them).
 */
export function roundsToDo(key: string, format: Format | null, scale: Scale, laneM: number): number | null {
  const rounds = roundsFor(key, scale, laneM);
  if (rounds === null) return null;
  if (format !== 'doubles' || !ROUND_STATIONS.includes(key)) return rounds;
  return Math.round(rounds / 2); // half of the total, the way the website's even split rounds it (one round is one, never none)
}

/** Keeps a lane length the person typed inside what makes sense; null (the default lane) for anything that is not a number above zero. */
export function cleanLane(value: unknown): number | null {
  const v = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(MIN_LANE_M, Math.min(MAX_LANE_M, Math.round(v * 100) / 100));
}

export const laneOrDefault = (stored: number | null | undefined): number => (typeof stored === 'number' && stored > 0 ? stored : DEFAULT_LANE_M);

// -- titles and clocks --------------------------------------------------------------------------------------------------------------

export function runTitle(scale: Scale, units: UnitPrefs): string {
  return `${formatDistanceKm(runDistanceM(scale) / 1000, units)} Run`;
}

export function segmentTitle(segment: Segment, scale: Scale, units: UnitPrefs): string {
  return segment.type === 'run' ? runTitle(scale, units) : (segment.title ?? segment.key);
}

/** Distances at a station are always metres, as HYROX states them, whatever the person's km / mi preference. */
export const stationMeters = (m: number): string => `${m}m`;

export function formatWeight(kg: number, units: UnitPrefs): string {
  return formatWeightKg(kg, units);
}

/** m:ss, or h:mm:ss from an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** Always mm:ss, for short split times. */
export function formatClockPrecise(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** A run's key is run1..run8 (or "run" in a custom race): they share one pictogram. */
export const splitIconKey = (key: string): string => (key.indexOf('run') === 0 ? 'run' : key);

/** The profile's "male" / "female" mapped to this page's "men" / "women"; null when there is none. */
export function profileGender(gender: string | null | undefined): Gender | null {
  if (!gender) return null;
  return gender === 'female' ? 'women' : 'men';
}

// -- races ----------------------------------------------------------------------------------------------------------------------------

export interface Split {
  key: string;
  title: string;
  /** Seconds from the start of the race to the end of this segment. */
  atSeconds: number;
  /** What the database holds that this version does not manage: carried through unchanged. */
  extra?: Record<string, unknown>;
}

export interface Race {
  id: string;
  /** An ISO date-time (UTC). */
  date: string;
  /** "custom" is a race built by hand on the website; this app only reads those. */
  category: string;
  format: string | null;
  gender: string | null;
  scale: string;
  totalSeconds: number;
  splits: Split[];
  /** Faster than anyone has ever raced: kept, but never a personal best or on a board. */
  flagged: boolean;
  isNewPb: boolean;
  /** The AI's read of the race, once asked for: { overall, overallDetail[], tips[] }. */
  analysis: unknown;
  /** What the database holds that this version does not manage: carried through unchanged. */
  extra?: Record<string, unknown>;
}

export const flagKey = (format: string, gender: string): string => `${gender}|${format}`;

export function isFlagged(totalSeconds: number, format: Format, gender: Gender): boolean {
  return totalSeconds <= (FLAG_THRESHOLD_SECONDS[flagKey(format, gender)] ?? Infinity);
}

/** A personal best is scoped to one exact category, format, gender and length: a Pro Singles time is not comparable to an Open Doubles one. */
export const pbKey = (category: string, format: string | null, gender: string | null, scale: string | null | undefined): string => `${category}|${format}|${gender}|${scale || 'full'}`;

const countsForBests = (race: Race): boolean => !race.flagged && race.category !== 'custom';

const when = (race: Race): number => new Date(race.date).getTime() || 0;

/** Faster wins; at the same time the earlier race keeps the record (it was set first). */
const faster = (a: Race, b: Race): boolean => a.totalSeconds < b.totalSeconds || (a.totalSeconds === b.totalSeconds && when(a) < when(b));

export function personalBest(history: readonly Race[], category: string, format: string | null, gender: string | null, scale: string): Race | null {
  if (category === 'custom') return null;
  const key = pbKey(category, format, gender, scale);
  let best: Race | null = null;
  for (const race of history) {
    if (!countsForBests(race) || pbKey(race.category, race.format, race.gender, race.scale) !== key) continue;
    if (!best || faster(race, best)) best = race;
  }
  return best;
}

/** The fastest race in each combo the person has finished, fastest first. */
export function allPersonalBests(history: readonly Race[]): Race[] {
  const byKey = new Map<string, Race>();
  for (const race of history) {
    if (!countsForBests(race)) continue;
    const key = pbKey(race.category, race.format, race.gender, race.scale);
    const existing = byKey.get(key);
    if (!existing || faster(race, existing)) byKey.set(key, race);
  }
  return Array.from(byKey.values()).sort((a, b) => a.totalSeconds - b.totalSeconds);
}

export interface PbBoard {
  key: string;
  category: string;
  format: string | null;
  gender: string | null;
  scale: string;
  /** Fastest first. */
  entries: Race[];
  /** The newest race's time (ms), to break ties. */
  latest: number;
}

/** One board per combo, most races first (a board of one has nothing to compare), the most recently raced first among equals. */
export function pbBoards(history: readonly Race[]): PbBoard[] {
  const byKey = new Map<string, PbBoard>();
  for (const race of history) {
    if (!countsForBests(race)) continue;
    const key = pbKey(race.category, race.format, race.gender, race.scale);
    let board = byKey.get(key);
    if (!board) {
      board = { key, category: race.category, format: race.format, gender: race.gender, scale: race.scale || 'full', entries: [], latest: 0 };
      byKey.set(key, board);
    }
    board.entries.push(race);
    board.latest = Math.max(board.latest, when(race));
  }
  const boards = Array.from(byKey.values());
  for (const board of boards) board.entries.sort((a, b) => a.totalSeconds - b.totalSeconds || when(a) - when(b));
  return boards.sort((a, b) => b.entries.length - a.entries.length || b.latest - a.latest);
}

/** Every race, newest first. */
export const newestFirst = (history: readonly Race[]): Race[] => history.slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

/**
 * The record of a race just finished. Flagged times are saved but never a personal best; a new best is a time faster than the
 * previous best of the same combo (or the first of it).
 */
export function finishedRace(
  setup: { category: Category; format: Format; gender: Gender; scale: Scale },
  splits: Split[],
  totalSeconds: number,
  history: readonly Race[],
  id: string,
  date: string,
): Race {
  const flagged = isFlagged(totalSeconds, setup.format, setup.gender);
  const prior = personalBest(history, setup.category, setup.format, setup.gender, setup.scale);
  const isNewPb = !flagged && (!prior || totalSeconds < prior.totalSeconds);
  return { id, date, category: setup.category, format: setup.format, gender: setup.gender, scale: setup.scale, totalSeconds, splits, flagged, isNewPb, analysis: null };
}

export interface Duration {
  key: string;
  title: string;
  type: 'run' | 'station';
  seconds: number;
}

/** Splits are cumulative; the time spent ON a segment is the gap from the one before. */
export function segmentDurations(race: Pick<Race, 'splits'>): Duration[] {
  return race.splits.map((split, i) => ({
    key: split.key,
    title: split.title,
    type: split.key.indexOf('run') === 0 ? 'run' : 'station',
    seconds: i === 0 ? split.atSeconds : split.atSeconds - race.splits[i - 1].atSeconds,
  }));
}

/** Time on the runs and on the stations. */
export function breakdownTotals(durations: readonly Duration[]): { running: number; stations: number } {
  let running = 0;
  let stations = 0;
  for (const d of durations) {
    if (d.type === 'run') running += d.seconds;
    else stations += d.seconds;
  }
  return { running, stations };
}

/** The result as the leaderboard takes it, or null when it does not count there (flagged, half-length or custom). */
export function leaderboardResult(race: Race): { gender: string; category: string; format: string; total_seconds: number } | null {
  if (race.flagged || race.scale === 'half' || race.category === 'custom' || !race.gender || !race.format) return null;
  return { gender: race.gender, category: race.category, format: race.format, total_seconds: race.totalSeconds };
}

// -- the leaderboard --------------------------------------------------------------------------------------------------------------

/** The four boards: Open and Pro, Singles and Doubles (each is for one gender at a time). Singles first, as the website lists them. */
export const BOARD_TABS: readonly { category: Category; format: Format }[] = [
  { category: 'open', format: 'singles' },
  { category: 'pro', format: 'singles' },
  { category: 'open', format: 'doubles' },
  { category: 'pro', format: 'doubles' },
];

export interface BoardStanding {
  userId: string;
  name: string;
  bestSeconds: number;
}

export interface HyroxBoard {
  /** The fastest of everybody, best first (as many as the server sends: 50). */
  rows: BoardStanding[];
  /** How many athletes are on this board in all. */
  total: number;
  /** Where you stand, or null when you have not finished this race. */
  mine: { rank: number; bestSeconds: number; name: string } | null;
}

// -- the AI's read of a race ------------------------------------------------------------------------------------------------------

export type Rating = 'focus' | 'strong' | 'solid';

export interface Tip {
  key: string;
  tip: string;
  rating: Rating;
  detail: string[];
}

export interface RaceAnalysis {
  overall: string;
  overallDetail: string[];
  tips: Tip[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const words = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []);

/**
 * An analysis out of what is stored on a race (the website's own shape: overall, overallDetail, tips), or null when it is not one.
 * A tip with no text is dropped; an unknown rating is "solid".
 */
export function analysisFromJson(value: unknown): RaceAnalysis | null {
  if (!isRecord(value) || typeof value.overall !== 'string') return null;
  const tips: Tip[] = [];
  if (Array.isArray(value.tips)) {
    for (const entry of value.tips) {
      if (!isRecord(entry) || typeof entry.key !== 'string' || typeof entry.tip !== 'string' || !entry.tip.trim()) continue;
      const rating: Rating = entry.rating === 'focus' || entry.rating === 'strong' ? entry.rating : 'solid';
      tips.push({ key: entry.key, tip: entry.tip, rating, detail: words(entry.detail) });
    }
  }
  return { overall: value.overall, overallDetail: words(value.overallDetail), tips };
}

/** The tips grouped as the website does, the biggest gains first: where to gain time, then strengths, then what is already solid. */
export function tipGroups(tips: readonly Tip[]): { rating: Rating; tips: Tip[] }[] {
  return (['focus', 'strong', 'solid'] as const).map((rating) => ({ rating, tips: tips.filter((t) => t.rating === rating) })).filter((g) => g.tips.length > 0);
}

/** A tip's rating by station, to tint the breakdown's bars. */
export function ratingsByKey(analysis: RaceAnalysis | null): Record<string, Rating> {
  const out: Record<string, Rating> = {};
  for (const tip of analysis?.tips ?? []) out[tip.key] = tip.rating;
  return out;
}

/** Whether a race can be coached at all: not a flagged time (its splits are not a real performance), and not a hand-built race (no standard to coach against). */
export const canAnalyze = (race: Pick<Race, 'flagged' | 'category'>): boolean => !race.flagged && race.category !== 'custom';
