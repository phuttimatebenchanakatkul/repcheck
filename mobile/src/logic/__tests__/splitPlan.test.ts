import {
  MAX_REPS,
  MAX_SETS,
  MONDAY_FIRST,
  REST,
  SELF_BUILD_DAY_LABELS,
  addCustomDay,
  applyDayCount,
  assignDay,
  canProceedFromType,
  chooseMode,
  chooseType,
  dayFor,
  generateRequest,
  isEdited,
  isSelfBuilt,
  newWizard,
  parseGenerated,
  planFromGenerated,
  prescriptionFor,
  prescriptionKey,
  removeCustomDay,
  removeDayExercise,
  resetPrescription,
  setDayExerciseList,
  setDayExercises,
  setPrescription,
  standardPrescription,
  type Wizard,
} from '../splitPlan';
import type { SplitPlan } from '../types';
import { setsRepsBucket } from '../workouts';

const self = (type: Wizard['type'] = 'ppl'): Wizard => chooseType(chooseMode(newWizard(), 'self'), type as never);

describe('choosing how to build', () => {
  it('the AI path goes straight to the questions only the person can answer: no split is asked for', () => {
    const w = chooseMode(newWizard(), 'ai');
    expect(w).toMatchObject({ mode: 'ai', type: 'ai_suggest' });
    expect(isSelfBuilt(w)).toBe(false);
  });

  it('switching from AI to self-built forgets the AI sentinel but keeps a real choice', () => {
    expect(chooseMode(chooseMode(newWizard(), 'ai'), 'self').type).toBeNull();
    expect(chooseMode({ ...newWizard(), type: 'ppl' }, 'self').type).toBe('ppl');
  });

  it('self-built, and the custom type, both count as the person’s own design', () => {
    expect(isSelfBuilt(chooseMode(newWizard(), 'self'))).toBe(true);
    expect(isSelfBuilt({ ...newWizard(), mode: 'ai', type: 'custom' })).toBe(true);
    expect(isSelfBuilt({ ...newWizard(), mode: 'ai', type: 'ppl' })).toBe(false);
  });
});

describe('self-built: day names', () => {
  it('a template seeds the day list, and switching templates reseeds it and drops the picked exercises', () => {
    const w = self('ppl');
    expect(w.customDays).toEqual(['Push', 'Pull', 'Legs']);
    const picked = setDayExercises(w, 'Push', ['Bench']);
    const upper = chooseType(picked, 'upper_lower');
    expect(upper.customDays).toEqual(['Upper', 'Lower']);
    expect(upper.customDayExercises).toEqual({});
  });

  it('choosing the same template again keeps what was picked', () => {
    const picked = setDayExercises(self('ppl'), 'Push', ['Bench']);
    expect(chooseType(picked, 'ppl').customDayExercises).toEqual({ Push: ['Bench'] });
  });

  it('"custom" keeps whatever days there are', () => {
    const w = chooseType(self('ppl'), 'custom');
    expect(w.customDays).toEqual(['Push', 'Pull', 'Legs']);
  });

  it('a template outside self-built mode does not seed days', () => {
    expect(chooseType(chooseMode(newWizard(), 'ai'), 'ppl').customDays).toEqual([]);
  });

  it('growing cycles through the template’s names and numbers the repeats', () => {
    const w = applyDayCount(self('ppl'), 6, 'Custom');
    expect(w.customDays).toEqual(['Push', 'Pull', 'Legs', 'Push 2', 'Pull 2', 'Legs 2']);
    expect(w.daysPerWeek).toBe(6);
    expect(applyDayCount(self('ppl'), 7, 'Custom').customDays[6]).toBe('Push 3');
  });

  it('growing never repeats a name that is already there (exercises are keyed by day name)', () => {
    let w = self('ppl');
    w = addCustomDay(w, 'Push 2');
    const grown = applyDayCount(w, 7, 'Custom');
    expect(new Set(grown.customDays).size).toBe(grown.customDays.length);
    expect(grown.customDays).toHaveLength(7);
  });

  it('with no template the generic label is used', () => {
    const w = applyDayCount(chooseType(chooseMode(newWizard(), 'self'), 'custom'), 3, 'Custom');
    expect(w.customDays).toEqual(['Custom', 'Custom 2', 'Custom 3']);
  });

  it('shrinking drops days from the end and the exercises picked for them', () => {
    let w = self('ppl');
    w = setDayExercises(setDayExercises(w, 'Pull', ['Row']), 'Legs', ['Squat']);
    const smaller = applyDayCount(w, 2, 'Custom');
    expect(smaller.customDays).toEqual(['Push', 'Pull']);
    expect(smaller.customDayExercises).toEqual({ Pull: ['Row'] });
    expect(smaller.daysPerWeek).toBe(2);
  });

  it('the same count changes nothing', () => {
    const w = self('ppl');
    expect(applyDayCount(w, 3, 'Custom')).toBe(w);
  });

  it('a day typed by hand is added, trimmed and capped; blanks, duplicates and an eighth day are ignored', () => {
    let w = chooseType(chooseMode(newWizard(), 'self'), 'custom');
    w = addCustomDay(w, '  Chest Day ');
    expect(w.customDays).toEqual(['Chest Day']);
    expect(addCustomDay(w, 'Chest Day')).toBe(w);
    expect(addCustomDay(w, '   ')).toBe(w);
    expect(addCustomDay(w, 'x'.repeat(100)).customDays[1]).toHaveLength(60);
    const full = applyDayCount(w, 7, 'Custom');
    expect(addCustomDay(full, 'One more')).toBe(full);
  });

  it('removing a day drops its exercises; a bad index changes nothing', () => {
    const w = setDayExercises(self('ppl'), 'Pull', ['Row']);
    const removed = removeCustomDay(w, 1);
    expect(removed.customDays).toEqual(['Push', 'Legs']);
    expect(removed.customDayExercises).toEqual({});
    expect(removeCustomDay(w, 9)).toBe(w);
    expect(removeCustomDay(w, -1)).toBe(w);
  });

  it('picking no exercises for a day removes its entry', () => {
    const w = setDayExercises(self('ppl'), 'Push', ['Bench']);
    expect(setDayExercises(w, 'Push', []).customDayExercises).toEqual({});
    expect(setDayExercises(w, 'Push', ['Bench', 'Dips']).customDayExercises).toEqual({ Push: ['Bench', 'Dips'] });
  });
});

describe('when the split step may be left', () => {
  it('nothing chosen: no', () => {
    expect(canProceedFromType(newWizard())).toBe(false);
  });

  it('the AI path with a real type: yes', () => {
    expect(canProceedFromType({ ...newWizard(), mode: 'ai', type: 'ppl' })).toBe(true);
  });

  it('the custom type needs at least one day', () => {
    expect(canProceedFromType({ ...newWizard(), mode: 'ai', type: 'custom' })).toBe(false);
    expect(canProceedFromType({ ...newWizard(), mode: 'ai', type: 'custom', customDays: ['A'] })).toBe(true);
  });

  it('self-built needs a day AND an exercise on every day', () => {
    let w = self('ppl');
    expect(canProceedFromType(w)).toBe(false);
    w = setDayExercises(setDayExercises(w, 'Push', ['Bench']), 'Pull', ['Row']);
    expect(canProceedFromType(w)).toBe(false);
    w = setDayExercises(w, 'Legs', ['Squat']);
    expect(canProceedFromType(w)).toBe(true);
    expect(canProceedFromType({ ...w, customDays: [] })).toBe(false);
  });
});

describe('what is asked of the server', () => {
  it('the AI path sends the type sentinel, the location, goal, days and the coaching profile', () => {
    const w: Wizard = { ...chooseMode(newWizard(), 'ai'), location: 'gym', goal: 'build muscle', daysPerWeek: 4 };
    expect(generateRequest(w, { gender: 'female', goal_weight_kg: 60, current_weight_kg: 66 })).toEqual({
      split_type: 'ai_suggest', days_per_week: 4, custom_days: [], goal: 'build muscle', custom_days_exercises: {}, location: 'gym',
      gender: 'female', goal_weight_kg: 60, current_weight_kg: 66,
    });
  });

  it('a self-built split always takes the no-AI path, with its own days and picks, no goal, no profile', () => {
    let w = setDayExercises(setDayExercises(setDayExercises(self('ppl'), 'Push', ['Bench']), 'Pull', ['Row']), 'Legs', ['Squat']);
    w = { ...w, goal: 'ignored', daysPerWeek: 99 };
    const body = generateRequest(w, { gender: 'male' });
    expect(body).toMatchObject({ split_type: 'custom', days_per_week: 3, custom_days: ['Push', 'Pull', 'Legs'], goal: '', location: null });
    expect(body.custom_days_exercises).toEqual({ Push: ['Bench'], Pull: ['Row'], Legs: ['Squat'] });
    expect('gender' in body).toBe(false);
  });

  it('days per week never exceeds seven for a self-built split', () => {
    const w = { ...self('ppl'), customDays: Array.from({ length: 9 }, (_, i) => `D${i}`) };
    expect(generateRequest(w).days_per_week).toBe(7);
  });

  it('a non-AI template sends no coaching profile', () => {
    const w: Wizard = { ...newWizard(), mode: 'ai', type: 'ppl', daysPerWeek: 3 };
    expect('gender' in generateRequest(w, { gender: 'male' })).toBe(false);
  });
});

describe('parseGenerated', () => {
  const good = {
    days: [{ label: 'Push', exercises: ['Flat Bench Press', 7, 'Dips'] }, { label: 'Pull', exercises: ['Pull-Up'] }],
    schedule: { monday: 'Push', tuesday: 'Rest', wednesday: 'Pull', thursday: 'Nonsense', friday: 5 },
    rationale: 'Rest between pushes.',
    split_type: 'upper_lower',
  };

  it('keeps well-formed days, drops non-text exercises, and fills the week: unknown labels and missing days are Rest', () => {
    const parsed = parseGenerated(good);
    expect(parsed?.days).toEqual([{ label: 'Push', exercises: ['Flat Bench Press', 'Dips'] }, { label: 'Pull', exercises: ['Pull-Up'] }]);
    expect(Object.keys(parsed?.schedule ?? {})).toEqual([...MONDAY_FIRST]);
    expect(parsed?.schedule).toEqual({ monday: 'Push', tuesday: REST, wednesday: 'Pull', thursday: REST, friday: REST, saturday: REST, sunday: REST });
    expect(parsed).toMatchObject({ rationale: 'Rest between pushes.', splitType: 'upper_lower' });
  });

  it.each([[null], ['x'], [{}], [{ days: 'no' }], [{ days: [] }], [{ days: [{ label: '  ', exercises: [] }, null] }]])('is null for %p', (raw) => {
    expect(parseGenerated(raw)).toBeNull();
  });

  it('a day with no exercise list has none; a blank rationale or a non-text split type is null', () => {
    const parsed = parseGenerated({ days: [{ label: 'A' }], schedule: {}, rationale: '  ', split_type: 3 });
    expect(parsed).toMatchObject({ days: [{ label: 'A', exercises: [] }], rationale: null, splitType: null });
  });

  it('a missing schedule is a week of rest', () => {
    expect(Object.values(parseGenerated({ days: [{ label: 'A', exercises: [] }] })?.schedule ?? {})).toEqual(Array(7).fill(REST));
  });
});

describe('sets and reps', () => {
  it('the standard is the bucket’s set count and the low end of its reps', () => {
    for (const name of ['Flat Bench Press', 'Bicep Curl', 'Lateral Raise', 'Plank']) {
      const bucket = setsRepsBucket(name);
      expect(standardPrescription(name)).toEqual({ sets: bucket.sets, reps: bucket.repsLow });
    }
  });

  it('the key cannot collide when a day name contains the separator', () => {
    expect(prescriptionKey('Push::Legs', 'Bench')).not.toBe(prescriptionKey('Push', 'Legs::Bench'));
    expect(prescriptionKey('A', 'B')).toBe('["A","B"]');
  });

  it('what the person set wins, the standard fills the rest', () => {
    const std = standardPrescription('Flat Bench Press');
    expect(prescriptionFor({}, 'Push', 'Flat Bench Press')).toEqual(std);
    const set = setPrescription({}, 'Push', 'Flat Bench Press', { sets: 5 });
    expect(prescriptionFor(set, 'Push', 'Flat Bench Press')).toEqual({ sets: 5, reps: std.reps });
    expect(prescriptionFor(set, 'Pull', 'Flat Bench Press')).toEqual(std); // another day is its own
  });

  it('a value must be a whole number above zero and is held to the editor’s maximum', () => {
    const std = standardPrescription('Plank');
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: 99, reps: 99 }), 'D', 'Plank')).toEqual({ sets: MAX_SETS, reps: MAX_REPS });
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: 0, reps: -3 }), 'D', 'Plank')).toEqual(std);
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: Number.NaN, reps: Number.POSITIVE_INFINITY }), 'D', 'Plank')).toEqual({ sets: std.sets, reps: MAX_REPS === 50 ? std.reps : std.reps });
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: 4.9 }), 'D', 'Plank').sets).toBe(4);
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: 1 }), 'D', 'Plank').sets).toBe(1);
    expect(prescriptionFor(setPrescription({}, 'D', 'Plank', { sets: 20, reps: 50 }), 'D', 'Plank')).toEqual({ sets: 20, reps: 50 });
  });

  it('setting one number keeps the other as it was, edited or not', () => {
    const once = setPrescription({}, 'D', 'Plank', { sets: 6 });
    const twice = setPrescription(once, 'D', 'Plank', { reps: 12 });
    expect(prescriptionFor(twice, 'D', 'Plank')).toEqual({ sets: 6, reps: 12 });
  });

  it('does not change the map it was given', () => {
    const before = {};
    setPrescription(before, 'D', 'Plank', { sets: 6 });
    expect(before).toEqual({});
  });

  it('reset puts the standard back (and removes the entry); other exercises stay', () => {
    let p = setPrescription({}, 'D', 'Plank', { sets: 6 });
    p = setPrescription(p, 'D', 'Squat', { sets: 7 });
    const back = resetPrescription(p, 'D', 'Plank');
    expect(prescriptionFor(back, 'D', 'Plank')).toEqual(standardPrescription('Plank'));
    expect(prescriptionKey('D', 'Plank') in back).toBe(false);
    expect(prescriptionFor(back, 'D', 'Squat').sets).toBe(7);
  });

  it('knows which number was edited', () => {
    const std = standardPrescription('Plank');
    const p = setPrescription({}, 'D', 'Plank', { sets: std.sets + 1, reps: std.reps });
    expect(isEdited(p, 'D', 'Plank')).toEqual({ sets: true, reps: false });
    expect(isEdited({}, 'D', 'Plank')).toEqual({ sets: false, reps: false });
  });
});

describe('the plan', () => {
  const generated = parseGenerated({ days: [{ label: 'Push', exercises: ['Dips'] }, { label: 'Pull', exercises: ['Pull-Up'] }], schedule: { monday: 'Push', wednesday: 'Pull' }, split_type: 'ppl' }) as NonNullable<ReturnType<typeof parseGenerated>>;
  const wizard: Wizard = { ...chooseMode(newWizard(), 'ai'), goal: 'strength', daysPerWeek: 2, location: 'home' };

  it('is saved as the split the AI chose, with the schedule and numbers the person ended with', () => {
    const plan = planFromGenerated(wizard, generated, assignDay(generated.schedule, 'friday', 'Push'), { a: { sets: 1, reps: 2 } });
    expect(plan).toMatchObject({ splitType: 'ppl', daysPerWeek: 2, goal: 'strength' });
    expect(plan.schedule.friday).toBe('Push');
    expect(plan.exercisePrescriptions).toEqual({ a: { sets: 1, reps: 2 } });
  });

  it('never saves the ai_suggest sentinel, and a self-built plan records its template', () => {
    expect(planFromGenerated(wizard, { ...generated, splitType: null }, generated.schedule, {}).splitType).toBeNull();
    const built = planFromGenerated({ ...self('ppl'), daysPerWeek: 3 }, { ...generated, splitType: null }, generated.schedule, {});
    expect(built.splitType).toBe('ppl');
    expect(built.goal).toBeNull();
  });

  it('days per week falls back to the number of days generated', () => {
    expect(planFromGenerated({ ...wizard, daysPerWeek: null }, generated, generated.schedule, {}).daysPerWeek).toBe(2);
  });

  it('copies the schedule and the numbers (editing the plan later cannot change the generated one)', () => {
    const plan = planFromGenerated(wizard, generated, generated.schedule, {});
    plan.schedule.monday = 'Rest';
    expect(generated.schedule.monday).toBe('Push');
  });

  it('assigning a day changes one weekday and nothing else', () => {
    const next = assignDay(generated.schedule, 'tuesday', 'Pull');
    expect(next.tuesday).toBe('Pull');
    expect(next.monday).toBe('Push');
    expect(generated.schedule.tuesday).toBe(REST);
  });

  const plan: SplitPlan = { splitType: 'ppl', daysPerWeek: 2, goal: null, days: generated.days, schedule: generated.schedule, exercisePrescriptions: {} };

  it('finds a weekday’s day; rest days, missing labels and dangling labels have none', () => {
    expect(dayFor(plan, 'monday')?.label).toBe('Push');
    expect(dayFor(plan, 'tuesday')).toBeNull();
    expect(dayFor(plan, 'sunday')).toBeNull();
    expect(dayFor({ ...plan, schedule: { monday: 'Gone' } }, 'monday')).toBeNull();
  });

  it('removes one exercise from one day', () => {
    const two: SplitPlan = { ...plan, days: [{ label: 'Push', exercises: ['A', 'B', 'C'] }, { label: 'Pull', exercises: ['A'] }] };
    const next = removeDayExercise(two, 'Push', 1);
    expect(next.days[0].exercises).toEqual(['A', 'C']);
    expect(next.days[1].exercises).toEqual(['A']);
    expect(two.days[0].exercises).toEqual(['A', 'B', 'C']);
  });

  it('a picked list keeps the order of what stays and adds the new ones at the end', () => {
    const two: SplitPlan = { ...plan, days: [{ label: 'Push', exercises: ['A', 'B', 'C'] }, { label: 'Pull', exercises: ['Z'] }] };
    const next = setDayExerciseList(two, 'Push', ['C', 'X', 'A']);
    expect(next.days[0].exercises).toEqual(['A', 'C', 'X']);
    expect(next.days[1].exercises).toEqual(['Z']);
  });

  it('the day names a template offers are the ones the server uses', () => {
    expect(SELF_BUILD_DAY_LABELS.ppl).toEqual(['Push', 'Pull', 'Legs']);
    expect(Object.keys(SELF_BUILD_DAY_LABELS)).toEqual(['ppl', 'upper_lower', 'full_body', 'bro_split']);
  });
});

describe('survivors: limits, collisions, indexes, odd schedules', () => {
  it('the editor’s limits are the website’s', () => {
    expect(MAX_SETS).toBe(20);
    expect(MAX_REPS).toBe(50);
  });

  it('growing past a template when names are taken lands on the next free number every time', () => {
    let w = self('ppl');
    w = addCustomDay(addCustomDay(w, 'Push 2'), 'Push 3');
    const grown = applyDayCount(w, 7, 'Custom');
    expect(grown.customDays).toEqual(['Push', 'Pull', 'Legs', 'Push 2', 'Push 3', 'Legs 2', 'Push 4']);
    const tight = applyDayCount(addCustomDay(addCustomDay(self('full_body'), 'Full Body 2'), 'Full Body 3'), 4, 'Custom');
    expect(tight.customDays).toEqual(['Full Body', 'Full Body 2', 'Full Body 3', 'Full Body 4']);
  });

  it('a single-template split cycles its one name', () => {
    expect(applyDayCount(self('full_body'), 3, 'Custom').customDays).toEqual(['Full Body', 'Full Body 2', 'Full Body 3']);
  });

  it('the first and last day can be removed; an index one past the end cannot', () => {
    const w = self('ppl');
    expect(removeCustomDay(w, 0).customDays).toEqual(['Pull', 'Legs']);
    expect(removeCustomDay(w, 2).customDays).toEqual(['Push', 'Pull']);
    expect(removeCustomDay(w, 3)).toBe(w);
  });

  it('a self-built split with a single day that has an exercise may proceed', () => {
    const w = setDayExercises({ ...self('ppl'), customDays: ['Only'] }, 'Only', ['Squat']);
    expect(canProceedFromType(w)).toBe(true);
  });

  it('a schedule that is missing, null or not an object is a week of rest, not a crash', () => {
    for (const schedule of [null, 'monday', 5, undefined]) {
      expect(Object.values(parseGenerated({ days: [{ label: 'A', exercises: [] }], schedule })?.schedule ?? {})).toEqual(Array(7).fill(REST));
    }
  });

  it('a day that is literally named Rest is still a rest day', () => {
    const plan: SplitPlan = { splitType: null, daysPerWeek: null, goal: null, days: [{ label: 'Rest', exercises: ['Squat'] }], schedule: { monday: 'Rest' }, exercisePrescriptions: {} };
    expect(dayFor(plan, 'monday')).toBeNull();
  });
});
