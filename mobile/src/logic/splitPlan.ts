/**
 * Building a weekly split: the wizard's rules (templates/workouts.html "Split planner wizard") and what it asks the server. Pure state
 * transitions, so every step can be tested without a screen. A plan is the SplitPlan in types.ts: its `days` (a label and exercises
 * each), a `schedule` (weekday -> a day's label, or "Rest") and optional per-exercise sets/reps.
 */
import type { SplitDay, SplitPlan } from './types';
import { setsRepsBucket } from './workouts';

export const SPLIT_TYPES = ['ppl', 'upper_lower', 'full_body', 'bro_split', 'custom'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];
export type Location = 'gym' | 'home' | 'hybrid';
export const LOCATIONS: readonly Location[] = ['gym', 'home', 'hybrid'];

/** Monday first, the order the week is shown in. The keys are the ones a schedule uses. */
export const MONDAY_FIRST = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = (typeof MONDAY_FIRST)[number];
export const REST = 'Rest';

/** Day names a readymade template starts a self-built split with (they mirror split_planner.py's SPLIT_DAY_TYPES). */
export const SELF_BUILD_DAY_LABELS: Record<string, readonly string[]> = {
  ppl: ['Push', 'Pull', 'Legs'],
  upper_lower: ['Upper', 'Lower'],
  full_body: ['Full Body'],
  bro_split: ['Chest', 'Back', 'Legs', 'Shoulders', 'Arms'],
};

export const MAX_DAYS = 7;
export const MAX_SETS = 20;
export const MAX_REPS = 50;

export interface Wizard {
  /** "ai": the AI builds it. "self": the person names the days and picks the exercises. */
  mode: 'ai' | 'self' | null;
  /** The split type; "ai_suggest" once the AI path is chosen (the AI picks the real one). */
  type: SplitType | 'ai_suggest' | null;
  location: Location | null;
  customDays: string[];
  customDayExercises: Record<string, string[]>;
  goal: string;
  daysPerWeek: number | null;
}

export const newWizard = (): Wizard => ({ mode: null, type: null, location: null, customDays: [], customDayExercises: {}, goal: '', daysPerWeek: null });

/** The AI path or the self-built (custom) path ends with "generate": neither asks goal or days. */
export const isSelfBuilt = (w: Wizard): boolean => w.mode === 'self' || w.type === 'custom';

/** Choosing the mode: "ai" goes straight to the questions only the person can answer (the AI chooses the split). */
export function chooseMode(w: Wizard, mode: 'ai' | 'self'): Wizard {
  return { ...w, mode, type: mode === 'ai' ? 'ai_suggest' : w.type === 'ai_suggest' ? null : w.type };
}

/** Picking a split type. A self-built split uses a template only as a starting list of day names (never sent to the AI), so switching reseeds it. */
export function chooseType(w: Wizard, type: SplitType): Wizard {
  if (w.mode === 'self' && type !== 'custom' && w.type !== type) {
    return { ...w, type, customDays: [...(SELF_BUILD_DAY_LABELS[type] ?? [])], customDayExercises: {} };
  }
  return { ...w, type };
}

/**
 * Grows or shrinks the day list to `n` days. Growing cycles through the type's own day names (a PPL grown to 6 repeats Push / Pull /
 * Legs as "Push 2"...) or a generic label, and never repeats a name already in the list, because exercises are keyed by day name.
 * Shrinking drops days from the end along with their picked exercises.
 */
export function applyDayCount(w: Wizard, n: number, genericLabel: string): Wizard {
  const current = w.customDays.slice();
  const exercises = { ...w.customDayExercises };
  if (n === current.length) return w;
  if (n < current.length) {
    for (const name of current.splice(n)) delete exercises[name];
  } else {
    const base = (w.type && SELF_BUILD_DAY_LABELS[w.type]) || [genericLabel];
    let cursor = current.length;
    while (current.length < n) {
      const name = base[cursor % base.length];
      const cycle = Math.floor(cursor / base.length) + 1;
      let label = cycle > 1 ? `${name} ${cycle}` : name;
      let bump = cycle;
      while (current.includes(label)) {
        bump += 1;
        label = `${name} ${bump}`;
      }
      current.push(label);
      cursor += 1;
    }
  }
  return { ...w, customDays: current, customDayExercises: exercises, daysPerWeek: current.length };
}

/** A day typed by hand. Blank is ignored; a name already used is refused (exercises are keyed by day name). */
export function addCustomDay(w: Wizard, name: string): Wizard {
  const label = name.trim().slice(0, 60);
  if (!label || w.customDays.includes(label) || w.customDays.length >= MAX_DAYS) return w;
  return { ...w, customDays: [...w.customDays, label] };
}

export function removeCustomDay(w: Wizard, index: number): Wizard {
  if (index < 0 || index >= w.customDays.length) return w;
  const removed = w.customDays[index];
  const { [removed]: _gone, ...rest } = w.customDayExercises;
  return { ...w, customDays: w.customDays.filter((_, i) => i !== index), customDayExercises: rest };
}

/** The exercises picked for a day; none picked removes the entry. */
export function setDayExercises(w: Wizard, day: string, names: readonly string[]): Wizard {
  const { [day]: _old, ...rest } = w.customDayExercises;
  return { ...w, customDayExercises: names.length ? { ...rest, [day]: [...names] } : rest };
}

/** May the person leave the split-type step? A self-built split needs at least one hand-picked exercise on EVERY day (no guessed pool). */
export function canProceedFromType(w: Wizard): boolean {
  if (!w.type) return false;
  if (w.mode === 'self') return w.customDays.length > 0 && w.customDays.every((day) => (w.customDayExercises[day] ?? []).length > 0);
  if (w.type === 'custom') return w.customDays.length > 0;
  return true;
}

export interface CoachingProfile {
  gender?: string | null;
  goal_weight_kg?: number | null;
  current_weight_kg?: number | null;
}

/** The body for POST /api/generate-split. Self-built always takes the server's no-AI path ("custom"), whatever template seeded the days. */
export function generateRequest(w: Wizard, profile: CoachingProfile = {}): Record<string, unknown> {
  const selfBuilt = isSelfBuilt(w);
  return {
    split_type: w.mode === 'self' ? 'custom' : w.type,
    days_per_week: selfBuilt ? Math.min(w.customDays.length, MAX_DAYS) : w.daysPerWeek,
    custom_days: w.customDays,
    goal: selfBuilt ? '' : w.goal,
    custom_days_exercises: w.customDayExercises,
    location: w.location,
    ...(w.type === 'ai_suggest' ? profile : {}),
  };
}

export interface Generated {
  days: SplitDay[];
  schedule: Record<string, string>;
  rationale: string | null;
  /** The split the AI actually chose, on the suggest path. */
  splitType: string | null;
}

/** The server's plan, checked: days with names, a schedule that points only at them (or Rest), seven weekdays. */
export function parseGenerated(body: unknown): Generated | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.days)) return null;
  const days: SplitDay[] = [];
  for (const d of raw.days) {
    const day = d as { label?: unknown; exercises?: unknown } | null;
    if (!day || typeof day.label !== 'string' || !day.label.trim()) continue;
    days.push({ label: day.label, exercises: Array.isArray(day.exercises) ? day.exercises.filter((e): e is string => typeof e === 'string') : [] });
  }
  if (days.length === 0) return null;
  const labels = new Set(days.map((d) => d.label));
  const source = raw.schedule && typeof raw.schedule === 'object' ? (raw.schedule as Record<string, unknown>) : {};
  const schedule: Record<string, string> = {};
  for (const weekday of MONDAY_FIRST) {
    const value = source[weekday];
    schedule[weekday] = typeof value === 'string' && labels.has(value) ? value : REST;
  }
  return {
    days,
    schedule,
    rationale: typeof raw.rationale === 'string' && raw.rationale.trim() ? raw.rationale : null,
    splitType: typeof raw.split_type === 'string' ? raw.split_type : null,
  };
}

// -- sets and reps per exercise ----------------------------------------------------------------------------------------------------

export interface Prescription {
  sets: number;
  reps: number;
}
export type Prescriptions = SplitPlan['exercisePrescriptions'];

/** JSON of [label, name]: a plain "label::name" string could collide ("Push::Legs"/"Bench" vs "Push"/"Legs::Bench"). */
export const prescriptionKey = (label: string, name: string): string => JSON.stringify([label, name]);

/** The standard for an exercise: its bucket's set count and the low end of its rep range. */
export function standardPrescription(name: string): Prescription {
  const bucket = setsRepsBucket(name);
  return { sets: bucket.sets, reps: bucket.repsLow };
}

/** What a day's exercise prescribes: the person's own numbers where they set them, the standard otherwise. */
export function prescriptionFor(prescriptions: Prescriptions, label: string, name: string): Prescription {
  const stored = prescriptions[prescriptionKey(label, name)];
  const standard = standardPrescription(name);
  return { sets: stored?.sets ?? standard.sets, reps: stored?.reps ?? standard.reps };
}

/** Changes sets or reps for an exercise on a day (it applies on every weekday that day appears). A value must be a whole number above zero; it is held to the editor's maximum. Anything else changes nothing. */
export function setPrescription(prescriptions: Prescriptions, label: string, name: string, patch: Partial<Prescription>): Prescriptions {
  const current = prescriptionFor(prescriptions, label, name);
  const next = { ...current };
  for (const [prop, max] of [['sets', MAX_SETS], ['reps', MAX_REPS]] as const) {
    const value = patch[prop];
    if (value !== undefined && Number.isFinite(value) && Math.trunc(value) > 0) next[prop] = Math.min(Math.trunc(value), max);
  }
  return { ...prescriptions, [prescriptionKey(label, name)]: next };
}

export function resetPrescription(prescriptions: Prescriptions, label: string, name: string): Prescriptions {
  const { [prescriptionKey(label, name)]: _gone, ...rest } = prescriptions;
  return rest;
}

export function isEdited(prescriptions: Prescriptions, label: string, name: string): { sets: boolean; reps: boolean } {
  const p = prescriptionFor(prescriptions, label, name);
  const std = standardPrescription(name);
  return { sets: p.sets !== std.sets, reps: p.reps !== std.reps };
}

// -- the plan itself --------------------------------------------------------------------------------------------------------------------

export function planFromGenerated(w: Wizard, generated: Generated, schedule: Record<string, string>, prescriptions: Prescriptions): SplitPlan {
  return {
    // The split the AI actually chose, not the "ai_suggest" sentinel: a saved plan looks like any other.
    splitType: generated.splitType ?? (w.type === 'ai_suggest' ? null : w.type),
    daysPerWeek: w.daysPerWeek ?? generated.days.length,
    goal: w.goal || null,
    days: generated.days,
    schedule: { ...schedule },
    exercisePrescriptions: { ...prescriptions },
  };
}

/** Puts a day (or Rest) on a weekday. */
export function assignDay(schedule: Record<string, string>, weekday: Weekday, label: string): Record<string, string> {
  return { ...schedule, [weekday]: label };
}

/** Whether a weekday has a workout: a label that is not Rest and that a day actually exists for. */
export function dayFor(plan: Pick<SplitPlan, 'days' | 'schedule'>, weekday: string): SplitDay | null {
  const label = plan.schedule[weekday];
  if (!label || label === REST) return null;
  return plan.days.find((d) => d.label === label) ?? null;
}

export function removeDayExercise(plan: SplitPlan, label: string, index: number): SplitPlan {
  return { ...plan, days: plan.days.map((d) => (d.label === label ? { ...d, exercises: d.exercises.filter((_, i) => i !== index) } : d)) };
}

/** Sets the exercise list of a day to `names`, keeping the order of what was already there and adding the new ones at the end. */
export function setDayExerciseList(plan: SplitPlan, label: string, names: readonly string[]): SplitPlan {
  return {
    ...plan,
    days: plan.days.map((d) => {
      if (d.label !== label) return d;
      const kept = d.exercises.filter((e) => names.includes(e));
      return { ...d, exercises: [...kept, ...names.filter((n) => !kept.includes(n))] };
    }),
  };
}
