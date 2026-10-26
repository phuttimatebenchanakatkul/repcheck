import { extractConst, extractFunction, lift, readRepoFile } from '@/testing/website';

import exercisesJson from '../../data/exercises.json';
import {
  CATEGORIES,
  EXERCISES,
  SETS_REPS_BUCKETS,
  blankSet,
  canBeUnilateral,
  collapseOneSided,
  defaultSuggestions,
  entryIsComplete,
  exerciseByName,
  isBodyweight,
  newSetCarryingWeight,
  newWorkoutEntry,
  repsSummary,
  searchExercises,
  setRepsDisplay,
  setUnilateral,
  setsRepsBucket,
  setsRepsText,
  showsUnilateralToggle,
  todaysSplit,
  topWeightKg,
  type CustomExerciseMeta,
} from '../workouts';
import type { SplitPlan, WorkoutEntry, WorkoutSet } from '../types';

const template = readRepoFile('templates', 'workouts.html');

class FrozenDate extends Date {
  constructor(...args: any[]) {
    if (args.length === 0) super(2026, 9, 28, 10, 0, 0); // a Wednesday
    else super(...(args as [any]));
  }
}

const UNILATERAL = new Set(EXERCISES.filter((e) => e.unilateral).map((e) => e.name));
const BODYWEIGHT = new Set(EXERCISES.filter((e) => e.bodyweight).map((e) => e.name));
const siteCustom: Record<string, { mode: string }> = {}; // one object, changed in place: the lifted functions hold on to it
let sitePlan: unknown = null;

const t = (key: string, vars: Record<string, string | number>) => `${key}|${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')}`;

const site = lift<{
  setRepsDisplay: (entry: unknown, s: unknown) => string | null;
  repsSummary: (entry: unknown) => string;
  newSetCarryingWeight: (sets: unknown[]) => Record<string, unknown>;
  topWeightKg: (entry: unknown) => number | null;
  entryIsComplete: (entry: unknown) => boolean;
  getSetsRepsBucket: (name: string) => { sets: number; repsLow: number; repsHigh: number };
  getSetsRepsText: (name: string) => string;
  canBeUnilateral: (name: string) => boolean;
  showsUnilateralToggle: (name: string) => boolean;
  getTodaysSplitInfo: () => { weekdayName: string; label: string; exercises: string[] } | null;
}>(
  template,
  [
    extractFunction(template, 'isBlank'),
    extractFunction(template, 'setRepsDisplay'),
    extractFunction(template, 'repsSummary'),
    extractFunction(template, 'newSetCarryingWeight'),
    extractFunction(template, 'topWeightKg'),
    extractFunction(template, 'entryIsComplete'),
    extractConst(template, 'SETS_REPS_BUCKETS'),
    extractConst(template, 'SETS_REPS_FALLBACK'),
    extractFunction(template, 'getSetsRepsBucket'),
    extractFunction(template, 'getSetsRepsText'),
    extractFunction(template, 'canBeUnilateral'),
    extractFunction(template, 'showsUnilateralToggle'),
    extractConst(template, 'WEEKDAY_KEYS'),
    extractConst(template, 'WEEKDAY_NAMES'),
    extractFunction(template, 'getTodaysSplitInfo'),
  ],
  ['setRepsDisplay', 'repsSummary', 'newSetCarryingWeight', 'topWeightKg', 'entryIsComplete', 'getSetsRepsBucket', 'getSetsRepsText', 'canBeUnilateral', 'showsUnilateralToggle', 'getTodaysSplitInfo'],
  {
    RepCheckI18n: { t },
    UNILATERAL_EXERCISES: UNILATERAL,
    customExerciseMeta: siteCustom,
    loadSplitPlan: () => sitePlan,
    Date: FrozenDate,
  },
);

/** Our null-for-blank sets as the website holds them: "" for blank. */
const toSite = (s: WorkoutSet) => ({ reps: s.reps ?? '', weightKg: s.weightKg ?? '', leftKg: s.leftKg ?? '', rightKg: s.rightKg ?? '', leftReps: s.leftReps ?? '', rightReps: s.rightReps ?? '' });
const entrySite = (e: Pick<WorkoutEntry, 'unilateral' | 'sets'>) => ({ unilateral: e.unilateral, sets: e.sets.map(toSite) });

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function randomSet(r: () => number): WorkoutSet {
  const maybe = (v: number) => (r() < 0.35 ? null : v);
  return { reps: maybe(Math.floor(r() * 20)), weightKg: maybe(Math.round(r() * 2000) / 10), leftKg: maybe(Math.round(r() * 1000) / 10), rightKg: maybe(Math.round(r() * 1000) / 10), leftReps: maybe(Math.floor(r() * 20)), rightReps: maybe(Math.floor(r() * 20)) };
}

function randomEntry(r: () => number): Pick<WorkoutEntry, 'unilateral' | 'sets'> {
  return { unilateral: r() < 0.5, sets: Array.from({ length: Math.floor(r() * 6) }, () => randomSet(r)) };
}

describe('the exercise library', () => {
  it('is the shipped JSON, in order, with every exercise in a known category', () => {
    expect(EXERCISES.length).toBe(exercisesJson.exercises.length);
    for (const e of EXERCISES) expect(CATEGORIES).toContain(e.category);
    expect(exerciseByName('Flat Bench Press')?.category).toBe('Chest');
    expect(exerciseByName('nope')).toBeUndefined();
  });

  it('bodyweight movements are reps-only', () => {
    expect(isBodyweight('Push-Up')).toBe(BODYWEIGHT.has('Push-Up'));
    expect(isBodyweight('Flat Bench Press')).toBe(false);
    expect(isBodyweight('not an exercise')).toBe(false);
  });
});

describe('logging sets: parity with the workouts page', () => {
  it('reps shown per set and the summary line agree on 300 random entries', () => {
    const r = rng(5);
    for (let i = 0; i < 300; i++) {
      const entry = randomEntry(r);
      entry.sets.forEach((s) => expect(setRepsDisplay(entry, s)).toBe(site.setRepsDisplay(entrySite(entry), toSite(s))));
      if (entry.sets.length) expect(repsSummary(entry, t)).toBe(site.repsSummary(entrySite(entry)));
    }
  });

  it('the weight carried into a new set agrees on 300 random sequences', () => {
    const r = rng(9);
    for (let i = 0; i < 300; i++) {
      const sets = Array.from({ length: Math.floor(r() * 6) }, () => randomSet(r));
      const mine = newSetCarryingWeight(sets);
      const theirs = site.newSetCarryingWeight(sets.map(toSite)) as Record<string, unknown>;
      expect({ reps: mine.reps ?? '', weightKg: mine.weightKg ?? '', leftKg: mine.leftKg ?? '', rightKg: mine.rightKg ?? '' }).toEqual({
        reps: '',
        weightKg: theirs.weightKg ?? '',
        leftKg: theirs.leftKg ?? '',
        rightKg: theirs.rightKg ?? '',
      });
      expect(mine.reps).toBeNull();
      expect(mine.leftReps).toBeNull();
    }
  });

  it('the top weight and completeness agree on 300 random entries', () => {
    const r = rng(13);
    for (let i = 0; i < 300; i++) {
      const entry = randomEntry(r);
      expect(topWeightKg(entry)).toBe(site.topWeightKg(entrySite(entry)));
      expect(entryIsComplete(entry)).toBe(site.entryIsComplete(entrySite(entry)));
    }
  });

  it('known cases', () => {
    const set = (over: Partial<WorkoutSet>): WorkoutSet => ({ ...blankSet(), ...over });
    expect(setRepsDisplay({ unilateral: false }, set({ reps: 10 }))).toBe('10');
    expect(setRepsDisplay({ unilateral: true }, set({ leftReps: 8, rightReps: 8 }))).toBe('8');
    expect(setRepsDisplay({ unilateral: true }, set({ leftReps: 8, rightReps: 6 }))).toBe('8/6');
    expect(setRepsDisplay({ unilateral: true }, set({ leftReps: 8 }))).toBe('8/-');
    expect(setRepsDisplay({ unilateral: true }, set({}))).toBeNull();
    expect(setRepsDisplay({ unilateral: false }, set({ reps: 0 }))).toBe('0');
    expect(entryIsComplete({ unilateral: false, sets: [] })).toBe(false);
    expect(entryIsComplete({ unilateral: false, sets: [set({ reps: 0 })] })).toBe(true);
    expect(entryIsComplete({ unilateral: true, sets: [set({ leftReps: 5 })] })).toBe(false);
    expect(topWeightKg({ unilateral: false, sets: [set({ weightKg: 0 }), set({ weightKg: 60 })] })).toBe(60);
    expect(topWeightKg({ unilateral: true, sets: [set({ weightKg: 99, leftKg: 20, rightKg: 25 })] })).toBe(25);
    expect(topWeightKg({ unilateral: false, sets: [set({})] })).toBeNull();
  });

  it('a new set carries the last weight through a blank one, and each side on its own', () => {
    const a = blankSet();
    const sets = [{ ...a, weightKg: 30, leftKg: 10 }, { ...a }, { ...a, rightKg: 12 }];
    expect(newSetCarryingWeight(sets)).toEqual({ ...a, weightKg: 30, leftKg: 10, rightKg: 12 });
    expect(newSetCarryingWeight([])).toEqual(a);
  });

  it('the summary pluralises and reads "logged" until a rep is entered', () => {
    const one = { unilateral: false, sets: [blankSet()] };
    const three = { unilateral: false, sets: [{ ...blankSet(), reps: 10 }, blankSet(), { ...blankSet(), reps: 8 }] };
    expect(repsSummary(one, t)).toBe('workouts.exercise.setsLogged|n=1,s=');
    expect(repsSummary(three, t)).toBe('workouts.exercise.setsReps|n=3,s=s,reps=10, -, 8');
  });
});

describe('one-sided and bodyweight exercises: parity', () => {
  it('every library exercise agrees with the website, and so does every custom mode', () => {
    for (const mode of [undefined, 'both', 'each', 'either']) {
      for (const key of Object.keys(siteCustom)) delete siteCustom[key];
      if (mode) siteCustom['My Move'] = { mode };
      const custom: CustomExerciseMeta = mode ? { 'My Move': { mode: mode as 'both' } } : {};
      for (const name of [...EXERCISES.map((e) => e.name), 'My Move', 'Unknown']) {
        expect([name, canBeUnilateral(name, custom)]).toEqual([name, site.canBeUnilateral(name)]);
        expect([name, showsUnilateralToggle(name, custom)]).toEqual([name, site.showsUnilateralToggle(name)]);
      }
    }
    for (const key of Object.keys(siteCustom)) delete siteCustom[key];
  });

  it('a custom exercise locked to "each side" can render each-side fields but not offer the switch back', () => {
    const custom: CustomExerciseMeta = { Lunge2: { mode: 'each' } };
    expect(canBeUnilateral('Lunge2', custom)).toBe(true);
    expect(showsUnilateralToggle('Lunge2', custom)).toBe(false);
    expect(showsUnilateralToggle('Lunge3', { Lunge3: { mode: 'either' } })).toBe(true);
    expect(canBeUnilateral('Lunge4', { Lunge4: { mode: 'both' } })).toBe(false);
  });
});

describe('prescribed sets and reps: parity', () => {
  it('every exercise in the library gets the website’s bucket', () => {
    for (const e of EXERCISES) {
      expect([e.name, setsRepsBucket(e.name)]).toEqual([e.name, site.getSetsRepsBucket(e.name)]);
      expect(setsRepsText(e.name)).toBe(site.getSetsRepsText(e.name));
    }
  });

  it('the order of the buckets is the behaviour: a specific lift beats the general pattern', () => {
    expect(setsRepsBucket('Flat Bench Press')).toMatchObject({ sets: 4, repsLow: 6 });
    expect(setsRepsBucket('Incline Bench Press')).toMatchObject({ sets: 4, repsLow: 8 });
    expect(setsRepsBucket('Lateral Raise')).toMatchObject({ repsLow: 12 });
    expect(setsRepsBucket('Plank')).toEqual({ sets: 3, repsLow: 10, repsHigh: 12 });
    expect(SETS_REPS_BUCKETS).toHaveLength(4);
  });

  it('reads as the website does', () => {
    expect(setsRepsText('Back Squat')).toBe('4 sets • 6-8 reps');
  });
});

describe("today's plan: parity", () => {
  const plan: SplitPlan = {
    splitType: 'ppl', daysPerWeek: 3, goal: null,
    days: [{ label: 'Push', exercises: ['Flat Bench Press', 'Overhead Press'] }, { label: 'Pull', exercises: [] }],
    schedule: { monday: 'Push', tuesday: 'Rest', wednesday: 'Pull', thursday: 'Ghost', friday: 'Push', saturday: '', sunday: 'Rest' },
    exercisePrescriptions: {},
  };
  const sitePlanOf = (p: SplitPlan) => ({ days: p.days, schedule: p.schedule });

  it.each([
    ['2026-10-26', 'a Monday with a day'],
    ['2026-10-27', 'a rest day'],
    ['2026-10-28', 'a day with no exercises'],
    ['2026-10-29', 'a schedule naming a day that does not exist'],
    ['2026-10-30', 'a Friday'],
    ['2026-10-31', 'an empty label'],
    ['2026-11-01', 'a Sunday rest'],
  ])('%s: %s', (day) => {
    // The website reads "today" from the clock (frozen to Wednesday 2026-10-28), so line the plan up with that weekday.
    const weekday = new Date(2026, 9, 28).getDay();
    const wanted = new Date(`${day}T00:00:00`).getDay();
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const rotated: SplitPlan = { ...plan, schedule: { ...plan.schedule, [names[weekday]]: plan.schedule[names[wanted]] ?? '' } };
    sitePlan = sitePlanOf(rotated);
    expect(todaysSplit(rotated, '2026-10-28')).toEqual(site.getTodaysSplitInfo());
  });

  it('no plan, or one without a schedule, is simply nothing', () => {
    sitePlan = null;
    expect(todaysSplit(null, '2026-10-28')).toBeNull();
    expect(todaysSplit(undefined, '2026-10-28')).toBeNull();
    expect(todaysSplit({ ...plan, schedule: undefined as never }, '2026-10-28')).toBeNull();
    expect(site.getTodaysSplitInfo()).toBeNull();
  });

  it('names the weekday and returns the day’s exercises', () => {
    expect(todaysSplit(plan, '2026-10-26')).toEqual({ weekdayName: 'Monday', label: 'Push', exercises: ['Flat Bench Press', 'Overhead Press'] });
    expect(todaysSplit(plan, '2026-10-27')).toBeNull();
  });
});

describe('searching exercises', () => {
  it('your own come before the library, favourites float above everything, at most 30', () => {
    const results = searchExercises('press', new Set(['Overhead Press']), ['My Press']);
    expect(results.slice(0, 2)).toEqual(['Overhead Press', 'My Press']);
    expect(searchExercises('press', new Set(), ['My Press'])[0]).toBe('My Press');
    expect(results.length).toBeLessThanOrEqual(30);
    expect(results.every((n) => n.toLowerCase().includes('press'))).toBe(true);
  });

  it('a custom exercise named like a library one shows once', () => {
    expect(searchExercises('flat bench', new Set(), ['Flat Bench Press']).filter((n) => n === 'Flat Bench Press')).toHaveLength(1);
  });

  it('is empty for a blank query and for no match', () => {
    expect(searchExercises('  ', new Set())).toEqual([]);
    expect(searchExercises('zzzzqqqq', new Set())).toEqual([]);
  });

  it('library order is kept among equals', () => {
    const results = searchExercises('squat', new Set());
    const libraryOrder = EXERCISES.map((e) => e.name).filter((n) => n.toLowerCase().includes('squat')).slice(0, 30);
    expect(results).toEqual(libraryOrder);
  });

  it('the default suggestions are the first move of each category, up to the limit', () => {
    const picks = defaultSuggestions(6);
    expect(picks).toHaveLength(6);
    expect(picks[0]).toBe(EXERCISES.find((e) => e.category === CATEGORIES[0])?.name);
    expect(defaultSuggestions(2)).toHaveLength(2);
  });
});

describe('a new exercise on a day', () => {
  const now = new Date(2026, 9, 26, 9, 15, 30);
  it('starts with one blank set, filed under the chosen day at the current time of day', () => {
    const entry = newWorkoutEntry('Flat Bench Press', { id: 'w1', day: '2026-10-20', now });
    expect(entry).toMatchObject({ id: 'w1', exercise: 'Flat Bench Press', unilateral: false, sets: [blankSet()] });
    const stamp = new Date(entry.addedAt);
    expect([stamp.getDate(), stamp.getHours(), stamp.getMinutes()]).toEqual([20, 9, 15]);
  });

  it('a custom exercise made "each side" starts in each-side mode; "both" and "either" do not', () => {
    const start = (mode: 'each' | 'both' | 'either') => newWorkoutEntry('Mine', { id: 'w', day: '2026-10-20', now, custom: { Mine: { mode } } }).unilateral;
    expect([start('each'), start('both'), start('either')]).toEqual([true, false, false]);
  });

  it('switching sides mode keeps what was typed in both groups of fields', () => {
    const entry = { ...newWorkoutEntry('Lunge', { id: 'w', day: '2026-10-20', now }), sets: [{ ...blankSet(), weightKg: 20, leftKg: 10 }] };
    const flipped = setUnilateral(setUnilateral(entry, true), false);
    expect(flipped.sets).toEqual(entry.sets);
    expect(setUnilateral(entry, true).unilateral).toBe(true);
  });
});

describe('collapseOneSided', () => {
  const eachSide = (exercise: string, sets: WorkoutSet[]): WorkoutEntry => ({ id: 'w', exercise, addedAt: 1, unilateral: true, sets });
  const set = (over: Partial<WorkoutSet>): WorkoutSet => ({ ...blankSet(), ...over });

  it('leaves an exercise that CAN be one-sided alone', () => {
    const entry = eachSide((EXERCISES.find((e) => e.unilateral) as { name: string }).name, [set({ leftKg: 10 })]);
    expect(collapseOneSided(entry)).toBe(entry);
  });

  it('leaves a both-sides entry alone', () => {
    const entry = { ...eachSide('Back Squat', [set({ weightKg: 100 })]), unilateral: false };
    expect(collapseOneSided(entry)).toBe(entry);
  });

  it('leaves a custom "each side" or "either" exercise alone', () => {
    const entry = eachSide('Mine', [set({ leftKg: 10 })]);
    expect(collapseOneSided(entry, { Mine: { mode: 'each' } })).toBe(entry);
    expect(collapseOneSided(entry, { Mine: { mode: 'either' } })).toBe(entry);
  });

  it('collapses one that cannot be, taking the left side first and then the right', () => {
    const entry = eachSide('Back Squat', [set({ leftKg: 60, rightKg: 70, leftReps: 8, rightReps: 7 }), set({ rightKg: 50, rightReps: 5 })]);
    const fixed = collapseOneSided(entry);
    expect(fixed.unilateral).toBe(false);
    expect(fixed.sets.map((s) => [s.weightKg, s.reps])).toEqual([[60, 8], [50, 5]]);
  });

  it('never overwrites a value already in the single fields, and keeps zero', () => {
    const entry = eachSide('Back Squat', [set({ weightKg: 0, reps: 0, leftKg: 60, leftReps: 8 })]);
    expect(collapseOneSided(entry).sets[0]).toMatchObject({ weightKg: 0, reps: 0 });
  });

  it('keeps the side fields too, so nothing is lost', () => {
    const entry = eachSide('Back Squat', [set({ leftKg: 60, rightKg: 70 })]);
    expect(collapseOneSided(entry).sets[0]).toMatchObject({ leftKg: 60, rightKg: 70 });
  });

  it('does not change the entry it was given', () => {
    const entry = eachSide('Back Squat', [set({ leftKg: 60 })]);
    collapseOneSided(entry);
    expect(entry.unilateral).toBe(true);
    expect(entry.sets[0].weightKg).toBeNull();
  });

  it('agrees with the website on a one-sided entry that cannot be', () => {
    const entry = eachSide('Back Squat', [set({ leftKg: 60, rightKg: 70, leftReps: null, rightReps: 7 })]);
    const fixed = collapseOneSided(entry);
    expect([fixed.sets[0].weightKg, fixed.sets[0].reps]).toEqual([60, 7]); // website: weight = left if filled, else right; reps likewise
  });
});

describe('survivors: search order, suggestions, plan rest days', () => {
  it('favourites float above everything else in a search, keeping the order of the rest', () => {
    const names = ['Alpha curl', 'Beta curl', 'Gamma curl', 'Delta curl'];
    expect(searchExercises('curl', new Set(['Gamma curl']), [], names)).toEqual(['Gamma curl', 'Alpha curl', 'Beta curl', 'Delta curl']);
    expect(searchExercises('curl', new Set(['Delta curl', 'Beta curl']), [], names)).toEqual(['Beta curl', 'Delta curl', 'Alpha curl', 'Gamma curl']);
  });

  it('a favourite that is the person’s own exercise also floats', () => {
    expect(searchExercises('row', new Set(['Zed row']), ['Aaa row', 'Zed row'], ['Library row'])).toEqual(['Zed row', 'Aaa row', 'Library row']);
  });

  it('the starter suggestions are six by default and skip anything not in the library', () => {
    expect(defaultSuggestions()).toHaveLength(6);
    expect(defaultSuggestions(3, ['Squat', 'Not an exercise at all', '', 'Deadlift', 'Plank'])).toEqual(['Squat', 'Deadlift', 'Plank']);
  });

  it('a plan day that is literally called "Rest" is still a rest day', () => {
    const plan: SplitPlan = { splitType: null, daysPerWeek: null, goal: null, days: [{ label: 'Rest', exercises: ['Squat'] }], schedule: { monday: 'Rest', tuesday: 'Rest' }, exercisePrescriptions: {} };
    expect(todaysSplit(plan, '2026-10-26')).toBeNull(); // a Monday
  });

  it('a weekday missing from the schedule is not a workout day', () => {
    const plan: SplitPlan = { splitType: null, daysPerWeek: null, goal: null, days: [{ label: 'Push', exercises: ['Squat'] }], schedule: { monday: 'Push' }, exercisePrescriptions: {} };
    expect(todaysSplit(plan, '2026-10-27')).toBeNull(); // a Tuesday
    expect(todaysSplit(plan, '2026-10-26')).toMatchObject({ label: 'Push' });
  });
});
