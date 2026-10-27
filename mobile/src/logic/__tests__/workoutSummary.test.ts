import fs from 'fs';
import path from 'path';

import { addDays, toIsoDate } from '../dates';
import { DEFAULT_UNITS, kgToDisplay, weightUnitLabel, type UnitPrefs } from '../units';
import { EXERCISES, isBodyweight } from '../workouts';
import type { WorkoutSet } from '../types';
import { EXERCISE_HISTORY_SESSIONS, MAX_EXERCISES_IN_HISTORY, buildWorkoutSummary, dayLabelFor, describeSet, exerciseHistorySection, recentDaysOverview, type LoggedWorkout } from '../workoutSummary';

const TODAY = '2026-10-27';
const words = (key: 'workouts.plan.today' | 'workouts.day.yesterday') => (key === 'workouts.plan.today' ? 'Today' : 'Yesterday');
const LB: UnitPrefs = { ...DEFAULT_UNITS, weight: 'lb' };

const set = (over: Partial<WorkoutSet> = {}): WorkoutSet => ({ reps: null, weightKg: null, leftKg: null, rightKg: null, leftReps: null, rightReps: null, ...over });
const entry = (id: string, exercise: string, day: string, sets: WorkoutSet[], over: Partial<LoggedWorkout> = {}): LoggedWorkout => ({
  id, exercise, day, addedAt: new Date(`${day}T08:00:00`).getTime(), unilateral: false, sets, ...over,
});

describe('describing a set', () => {
  const lift = { exercise: 'Flat Bench Press', unilateral: false };

  it('weight and reps in the person’s units, a missing weight left out, a missing rep count no set at all', () => {
    expect(describeSet(lift, set({ reps: 8, weightKg: 60 }), DEFAULT_UNITS)).toBe('60kg x 8 reps');
    expect(describeSet(lift, set({ reps: 8, weightKg: 62.5 }), DEFAULT_UNITS)).toBe('62.5kg x 8 reps');
    expect(describeSet(lift, set({ reps: 8, weightKg: 60 }), LB)).toBe(`${kgToDisplay(60, LB)}lb x 8 reps`);
    expect(describeSet(lift, set({ reps: 8 }), DEFAULT_UNITS)).toBe('x 8 reps');
    expect(describeSet(lift, set({ reps: 0, weightKg: 60 }), DEFAULT_UNITS)).toBe('60kg x 0 reps');
    expect(describeSet(lift, set({ weightKg: 60 }), DEFAULT_UNITS)).toBeNull();
  });

  it('a bodyweight movement has no weight', () => {
    const bodyweight = EXERCISES.find((e) => e.bodyweight)!.name;
    expect(isBodyweight(bodyweight)).toBe(true);
    expect(describeSet({ exercise: bodyweight, unilateral: false }, set({ reps: 12, weightKg: 20 }), DEFAULT_UNITS)).toBe('12 reps (bodyweight)');
  });

  it('each side: left and right, a side with no reps shown as a dash, nothing at all with neither', () => {
    const each = { exercise: 'Dumbbell Curl', unilateral: true };
    expect(describeSet(each, set({ leftReps: 10, leftKg: 12, rightReps: 9, rightKg: 12 }), DEFAULT_UNITS)).toBe('L 12kg x 10 reps, R 12kg x 9 reps');
    expect(describeSet(each, set({ leftReps: 10 }), DEFAULT_UNITS)).toBe('L x 10 reps, R x - reps');
    expect(describeSet(each, set({ rightReps: 7, rightKg: 8 }), DEFAULT_UNITS)).toBe('L x - reps, R 8kg x 7 reps');
    expect(describeSet(each, set({ leftKg: 12, rightKg: 12 }), DEFAULT_UNITS)).toBeNull();
    expect(weightUnitLabel(DEFAULT_UNITS)).toBe('kg');
  });
});

describe('naming a day', () => {
  it('today, yesterday, then a date in the person’s language', () => {
    expect(dayLabelFor(TODAY, TODAY, words, 'en-US')).toBe('Today');
    expect(dayLabelFor('2026-10-26', TODAY, words, 'en-US')).toBe('Yesterday');
    expect(dayLabelFor('2026-10-25', TODAY, words, 'en-US')).toBe('Sunday, Oct 25');
    expect(dayLabelFor('2026-10-25', TODAY, words, 'th-TH')).toMatch(/อาทิตย์/);
  });
});

describe('the overview and the history', () => {
  it('lists the last seven calendar days with entries, oldest first, and nothing for the rest', () => {
    const entries = [
      entry('a', 'Squat', '2026-10-27', []),
      entry('b', 'Bench', '2026-10-27', [], { addedAt: 1 }),
      entry('c', 'Row', '2026-10-21', []),
      entry('d', 'Old', '2026-10-20', []),
      entry('e', 'Future', '2026-10-28', []),
    ];
    expect(recentDaysOverview(entries, TODAY, words, 'en-US')).toBe('Wednesday, Oct 21 (2026-10-21): Row\nToday (2026-10-27): Bench, Squat');
  });

  it('says so when the week is empty or nothing was ever logged', () => {
    expect(recentDaysOverview([], TODAY, words, 'en-US')).toBe('(No workouts logged in the last 7 days.)');
    expect(exerciseHistorySection([], TODAY, DEFAULT_UNITS, words, 'en-US')).toBe('(No exercises logged yet.)');
  });

  it('recites each exercise’s last four sessions, newest first, most recently trained exercise first', () => {
    const sets = [set({ reps: 5, weightKg: 100 })];
    const entries = [
      ...[0, 1, 2, 3, 4, 5].map((n) => entry(`s${n}`, 'Squat', addDays(TODAY, -n * 2), sets)),
      entry('b', 'Bench', addDays(TODAY, -1), [set({ reps: 8, weightKg: 60 }), set({ reps: 7, weightKg: 60 })]),
    ];
    const text = exerciseHistorySection(entries, TODAY, DEFAULT_UNITS, words, 'en-US');
    const lines = text.split('\n');
    expect(lines[0]).toBe('Squat:');
    expect(lines.filter((l) => l.startsWith('- ')).length).toBe(EXERCISE_HISTORY_SESSIONS + 1);
    expect(lines[1]).toBe('- Today (2026-10-27): 100kg x 5 reps');
    expect(lines).toContain('Bench:');
    expect(lines).toContain('- Yesterday (2026-10-26): 60kg x 8 reps; 60kg x 7 reps');
    expect(text).not.toContain(addDays(TODAY, -8));
  });

  it('a session with no usable sets says so', () => {
    expect(exerciseHistorySection([entry('a', 'Squat', TODAY, [set({ weightKg: 5 })])], TODAY, DEFAULT_UNITS, words, 'en-US')).toBe('Squat:\n- Today (2026-10-27): no sets recorded');
  });

  it('several sessions of one exercise on a day come newest first', () => {
    const entries = [entry('a', 'Squat', TODAY, [set({ reps: 1 })], { addedAt: 100 }), entry('b', 'Squat', TODAY, [set({ reps: 2 })], { addedAt: 200 })];
    expect(exerciseHistorySection(entries, TODAY, DEFAULT_UNITS, words, 'en-US').split('\n').slice(1)).toEqual(['- Today (2026-10-27): x 2 reps', '- Today (2026-10-27): x 1 reps']);
  });

  it('three sessions of one exercise on a day come newest first however they arrive', () => {
    const [a, b, c] = [1, 2, 3].map((n) => entry(`s${n}`, 'Squat', TODAY, [set({ reps: n })], { addedAt: n * 100 }));
    for (const order of [[a, b, c], [c, b, a], [b, c, a], [a, c, b]]) {
      expect(exerciseHistorySection(order, TODAY, DEFAULT_UNITS, words, 'en-US').split('\n').slice(1)).toEqual([
        '- Today (2026-10-27): x 3 reps',
        '- Today (2026-10-27): x 2 reps',
        '- Today (2026-10-27): x 1 reps',
      ]);
    }
  });

  it('and across days, newest day first however they arrive', () => {
    const days = ['2026-10-20', '2026-10-24', '2026-10-22'].map((day, i) => entry(`d${i}`, 'Squat', day, [set({ reps: i + 1 })]));
    const lines = exerciseHistorySection([days[0], days[1], days[2]], TODAY, DEFAULT_UNITS, words, 'en-US').split('\n').slice(1);
    expect(lines.map((l) => l.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1])).toEqual(['2026-10-24', '2026-10-22', '2026-10-20']);
  });

  it('keeps only the thirty exercises trained most recently', () => {
    const entries = Array.from({ length: MAX_EXERCISES_IN_HISTORY + 5 }, (_, i) => entry(`e${i}`, `Move ${i}`, addDays(TODAY, -i), [set({ reps: 1 })]));
    const text = exerciseHistorySection(entries, TODAY, DEFAULT_UNITS, words, 'en-US');
    expect(text.split('\n').filter((l) => l.endsWith(':')).length).toBe(MAX_EXERCISES_IN_HISTORY);
    expect(text).toContain('Move 0:');
    expect(text).toContain(`Move ${MAX_EXERCISES_IN_HISTORY - 1}:`);
    expect(text).not.toContain(`Move ${MAX_EXERCISES_IN_HISTORY}:`);
  });

  it('the summary is the two sections under their headings', () => {
    const text = buildWorkoutSummary([entry('a', 'Squat', TODAY, [set({ reps: 5, weightKg: 100 })])], TODAY, DEFAULT_UNITS, words, 'en-US');
    expect(text).toBe('Workouts logged in the last 7 days:\nToday (2026-10-27): Squat\n\nExercise history (last 4 sessions each):\nSquat:\n- Today (2026-10-27): 100kg x 5 reps');
  });
});

describe('against the website’s own buildRecentWorkoutSummary', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../../templates/workouts.html'), 'utf8');
  const from = source.indexOf('function dayLabelFor(iso) {');
  const to = source.indexOf('function renderMessages() {', from);
  const body = source.slice(from, to);

  /** Runs the website's functions against `log` (date -> entries) in the person's units and language. */
  function website(log: Record<string, unknown[]>, units: UnitPrefs, locale: string): string {
    const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stubs = {
      toIsoDate: toIso,
      RepCheckI18n: { t: (key: string) => (key === 'workouts.plan.today' ? 'Today' : 'Yesterday'), locale: () => locale },
      RepCheckUnits: { weightUnitLabel: () => weightUnitLabel(units), kgToDisplay: (kg: number) => kgToDisplay(kg, units) },
      isBlank: (v: unknown) => v === '' || v === null || v === undefined,
      isBodyweight,
      log,
    };
    // eslint-disable-next-line no-new-func
    const run = new Function(...Object.keys(stubs), `${body}; return buildRecentWorkoutSummary();`);
    return run(...Object.values(stubs)) as string;
  }

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 9, 27, 12, 0, 0));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  /** A seeded history in which no two exercises were last trained on the same day (the website's tie order is arbitrary). */
  function history(seed: number): LoggedWorkout[] {
    let state = seed;
    const next = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const names = ['Squat', 'Flat Bench Press', 'Deadlift', 'Dumbbell Curl', EXERCISES.find((e) => e.bodyweight)!.name, 'Lat Pulldown', 'Hammer Curl', 'Leg Press'];
    const out: LoggedWorkout[] = [];
    names.forEach((name, k) => {
      const sessions = 1 + Math.floor(next() * 7);
      for (let n = 0; n < sessions; n++) {
        // Exercise k was last trained k days ago, so no two share a latest day; older sessions are three days apart.
        const day = addDays(TODAY, -(k + n * 3));
        const unilateral = name.includes('Curl') && next() < 0.5;
        const count = Math.floor(next() * 4);
        const sets = Array.from({ length: count }, () =>
          unilateral
            ? set({ leftReps: next() < 0.2 ? null : 5 + Math.floor(next() * 8), rightReps: next() < 0.2 ? null : 5 + Math.floor(next() * 8), leftKg: next() < 0.2 ? null : Math.round(next() * 300) / 10, rightKg: next() < 0.2 ? null : Math.round(next() * 300) / 10 })
            : set({ reps: next() < 0.15 ? null : 1 + Math.floor(next() * 15), weightKg: next() < 0.2 ? null : Math.round(next() * 2000) / 10 }),
        );
        out.push(entry(`${name}-${n}`, name, day, sets, { unilateral, addedAt: new Date(`${day}T0${6 + Math.floor(next() * 3)}:00:00`).getTime() + n }));
      }
    });
    return out;
  }

  const asLog = (entries: LoggedWorkout[]) => {
    const log: Record<string, unknown[]> = {};
    for (const e of entries) (log[e.day] ??= []).push({ exercise: e.exercise, addedAt: e.addedAt, unilateral: e.unilateral, sets: e.sets });
    return log;
  };

  it.each([[1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12]])('seed %i, kilograms and pounds, English and Thai', (seed) => {
    const entries = history(seed);
    for (const units of [DEFAULT_UNITS, LB]) {
      for (const locale of ['en-US', 'th-TH']) {
        expect(buildWorkoutSummary(entries, TODAY, units, words, locale)).toBe(website(asLog(entries), units, locale));
      }
    }
  });

  it.each([[21], [22], [23], [24], [25], [26]])('seed %i, however the entries happen to be ordered', (seed) => {
    const entries = history(seed);
    // A different but fixed order each time: reversed, then dealt like cards.
    const reversed = entries.slice().reverse();
    const dealt = [...entries.filter((_, i) => i % 3 === 0), ...entries.filter((_, i) => i % 3 === 1), ...entries.filter((_, i) => i % 3 === 2)];
    for (const order of [reversed, dealt]) {
      expect(buildWorkoutSummary(order, TODAY, DEFAULT_UNITS, words, 'en-US')).toBe(website(asLog(order), DEFAULT_UNITS, 'en-US'));
      expect(buildWorkoutSummary(order, TODAY, DEFAULT_UNITS, words, 'en-US')).toBe(buildWorkoutSummary(entries, TODAY, DEFAULT_UNITS, words, 'en-US'));
    }
  });

  it('an empty log', () => {
    expect(buildWorkoutSummary([], TODAY, DEFAULT_UNITS, words, 'en-US')).toBe(website({}, DEFAULT_UNITS, 'en-US'));
  });

  it('the website’s thirty-exercise cap and four-session cap', () => {
    const entries = Array.from({ length: 36 }, (_, i) => entry(`e${i}`, `Move ${i}`, addDays(TODAY, -i), [set({ reps: 5, weightKg: 40 })]));
    entries.push(...[1, 2, 3, 4, 5].map((n) => entry(`m0-${n}`, 'Move 0', addDays(TODAY, -n * 40), [set({ reps: n })])));
    expect(buildWorkoutSummary(entries, TODAY, DEFAULT_UNITS, words, 'en-US')).toBe(website(asLog(entries), DEFAULT_UNITS, 'en-US'));
  });

  it('knows today as the website does', () => {
    expect(toIsoDate(new Date())).toBe(TODAY);
  });
});
