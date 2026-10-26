import type { NutritionEntry, SplitPlan, WorkoutEntry } from '../../logic/types';
import {
  MAX_REPS,
  goalsFromRow,
  goalsToRow,
  nutritionEntryToRow,
  nutritionRowToEntry,
  settingsFromRow,
  settingsToRow,
  splitPlanFromRow,
  splitPlanToRow,
  toMs,
  toTimestamp,
  weightFromRow,
  weightToRow,
  workoutEntryToRow,
  workoutRowsToEntry,
  workoutSetFromRow,
  workoutSetToRow,
  type Row,
} from '../mappers';

const U = 'user-1';
const T0 = Date.UTC(2026, 9, 26, 12, 30, 0);

const nutritionRow = (over: Partial<Row<'nutrition_entries'>> = {}): Row<'nutrition_entries'> =>
  ({
    user_id: U, id: 'n1', log_date: '2026-10-26', food: 'Chicken breast', added_at: toTimestamp(T0), source: null,
    grams: 150, unit: 'g', base_calories: 165, base_carbs: 0, base_fat: 3.6, base_protein: 31, ingredients: null, extra: {},
    created_at: toTimestamp(T0), updated_at: toTimestamp(T0), ...over,
  }) as Row<'nutrition_entries'>;

describe('timestamps', () => {
  it('round-trips epoch ms through timestamptz text', () => {
    expect(toMs(toTimestamp(T0))).toBe(T0);
    expect(toTimestamp(T0)).toBe('2026-10-26T12:30:00.000Z');
  });
  it.each([[null], [undefined], ['not a date'], [12345], ['']])('reads %p as 0 rather than NaN', (value) => {
    expect(toMs(value)).toBe(0);
  });
});

describe('food log rows', () => {
  it('reads a simple entry', () => {
    expect(nutritionRowToEntry(nutritionRow())).toEqual({
      id: 'n1', food: 'Chicken breast', addedAt: T0, grams: 150, unit: 'g', baseCalories: 165, baseCarbs: 0, baseFat: 3.6, baseProtein: 31,
    });
  });

  it('keeps a zero base value (0 g of carbs is a value, not a gap)', () => {
    expect(nutritionRowToEntry(nutritionRow()).baseCarbs).toBe(0);
  });

  it('omits what the row does not have, rather than inventing zeros', () => {
    const entry = nutritionRowToEntry(nutritionRow({ grams: null, unit: null, base_calories: null, base_carbs: null, base_fat: null, base_protein: null }));
    expect(entry).toEqual({ id: 'n1', food: 'Chicken breast', addedAt: T0 });
  });

  it('ignores a unit it does not know', () => {
    expect(nutritionRowToEntry(nutritionRow({ unit: 'stone' })).unit).toBeUndefined();
  });

  it('reads a dish from its ingredients and ignores the simple columns', () => {
    const entry = nutritionRowToEntry(
      nutritionRow({
        grams: 999,
        base_calories: 999,
        ingredients: [
          { name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 },
          { name: 'Milk', grams: '50', unit: 'ml', baseCalories: 60 },
          'junk',
          { grams: 5 },
          null,
        ],
      }),
    );
    expect(entry.grams).toBeUndefined();
    expect(entry.baseCalories).toBeUndefined();
    expect(entry.ingredients).toEqual([
      { name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 },
      { name: 'Milk', grams: 50, unit: 'ml', baseCalories: 60, baseCarbs: 0, baseFat: 0, baseProtein: 0 },
    ]);
  });

  it('an empty ingredients array is still a dish (no simple fields come back)', () => {
    const entry = nutritionRowToEntry(nutritionRow({ ingredients: [] }));
    expect(entry.ingredients).toEqual([]);
    expect(entry.grams).toBeUndefined();
  });

  it('carries source and extra through', () => {
    const entry = nutritionRowToEntry(nutritionRow({ source: 'photo', extra: { weird: 1 } }));
    expect(entry.source).toBe('photo');
    expect(entry.extra).toEqual({ weird: 1 });
  });

  it('does not attach an empty extra, or a non-object one', () => {
    expect(nutritionRowToEntry(nutritionRow({ extra: {} })).extra).toBeUndefined();
    expect(nutritionRowToEntry(nutritionRow({ extra: [1, 2] })).extra).toBeUndefined();
    expect(nutritionRowToEntry(nutritionRow({ extra: 'x' })).extra).toBeUndefined();
  });

  it('writes a simple entry as a whole row with NULL ingredients', () => {
    const entry: NutritionEntry = { id: 'n1', food: 'Egg', addedAt: T0, grams: 50, baseCalories: 143, baseCarbs: 0.7, baseFat: 9.5, baseProtein: 12.6 };
    expect(nutritionEntryToRow(U, '2026-10-26', entry)).toEqual({
      user_id: U, id: 'n1', log_date: '2026-10-26', food: 'Egg', added_at: '2026-10-26T12:30:00.000Z', source: null,
      grams: 50, unit: 'g', base_calories: 143, base_carbs: 0.7, base_fat: 9.5, base_protein: 12.6, ingredients: null, extra: {},
    });
  });

  it('writes a dish with every simple column NULL, so converting a food to a dish leaves no stale values behind', () => {
    const entry: NutritionEntry = {
      id: 'n2', food: 'Burrito', addedAt: T0, grams: 300, unit: 'oz', baseCalories: 200, baseCarbs: 1, baseFat: 2, baseProtein: 3,
      ingredients: [{ name: 'Rice', grams: 100, baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 }],
    };
    const row = nutritionEntryToRow(U, '2026-10-26', entry);
    expect(row).toMatchObject({ grams: null, unit: null, base_calories: null, base_carbs: null, base_fat: null, base_protein: null });
    expect(row.ingredients).toEqual([{ name: 'Rice', grams: 100, unit: 'g', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 }]);
  });

  it('writes NULL for a value that is missing or not finite', () => {
    const row = nutritionEntryToRow(U, '2026-10-26', { id: 'x', food: 'Mystery', addedAt: T0, grams: Number.NaN, baseCalories: Number.POSITIVE_INFINITY });
    expect(row).toMatchObject({ grams: null, base_calories: null, base_carbs: null, base_fat: null, base_protein: null });
  });

  it('an entry with an empty ingredient list is written as a simple one', () => {
    expect(nutritionEntryToRow(U, '2026-10-26', { id: 'x', food: 'F', addedAt: T0, grams: 10, ingredients: [] }).ingredients).toBeNull();
  });

  it('preserves the extra and source it was given', () => {
    const row = nutritionEntryToRow(U, '2026-10-26', { id: 'x', food: 'F', addedAt: T0, source: 'barcode', extra: { a: 1 } });
    expect(row.source).toBe('barcode');
    expect(row.extra).toEqual({ a: 1 });
  });

  it('a row survives read -> write -> read unchanged', () => {
    const original = nutritionRowToEntry(nutritionRow({ source: 'ai', extra: { k: 'v' } }));
    const again = nutritionRowToEntry(nutritionEntryToRow(U, '2026-10-26', original) as unknown as Row<'nutrition_entries'>);
    expect(again).toEqual(original);
  });

  it('a dish survives read -> write -> read unchanged', () => {
    const row = nutritionRow({ ingredients: [{ name: 'Rice', grams: 100, unit: 'ml', baseCalories: 130, baseCarbs: 28, baseFat: 0.3, baseProtein: 2.7 }] });
    const original = nutritionRowToEntry(row);
    const again = nutritionRowToEntry(nutritionEntryToRow(U, '2026-10-26', original) as unknown as Row<'nutrition_entries'>);
    expect(again).toEqual(original);
  });
});

const setRow = (over: Partial<Row<'workout_sets'>> = {}): Row<'workout_sets'> =>
  ({ user_id: U, entry_id: 'w1', position: 0, reps: 8, weight_kg: 60, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {}, ...over }) as Row<'workout_sets'>;

describe('workout rows', () => {
  it('reads a set, keeping nulls as nulls', () => {
    expect(workoutSetFromRow(setRow())).toEqual({ reps: 8, weightKg: 60, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
  });

  it('reads an each-side set', () => {
    expect(workoutSetFromRow(setRow({ reps: null, weight_kg: null, left_kg: 20, right_kg: 22.5, left_reps: 10, right_reps: 9 }))).toEqual({
      reps: null, weightKg: null, leftKg: 20, rightKg: 22.5, leftReps: 10, rightReps: 9,
    });
  });

  it('assembles an entry from its own sets only, in position order', () => {
    const entry = workoutRowsToEntry(
      { user_id: U, id: 'w1', log_date: '2026-10-26', exercise: 'Bench press', added_at: toTimestamp(T0), unilateral: false, extra: {} } as Row<'workout_entries'>,
      [setRow({ position: 2, reps: 6 }), setRow({ position: 0, reps: 10 }), setRow({ entry_id: 'other', position: 1, reps: 99 }), setRow({ position: 1, reps: 8 })],
    );
    expect(entry.sets.map((s) => s.reps)).toEqual([10, 8, 6]);
    expect(entry).toMatchObject({ id: 'w1', exercise: 'Bench press', addedAt: T0, unilateral: false });
    expect(entry.extra).toBeUndefined();
  });

  it('does not reorder the caller’s rows', () => {
    const rows = [setRow({ position: 1 }), setRow({ position: 0 })];
    workoutRowsToEntry({ id: 'w1', exercise: 'x', added_at: toTimestamp(T0), unilateral: null, extra: {} } as unknown as Row<'workout_entries'>, rows);
    expect(rows.map((r) => r.position)).toEqual([1, 0]);
  });

  it('a null unilateral reads as false', () => {
    expect(workoutRowsToEntry({ id: 'w1', exercise: 'x', added_at: toTimestamp(T0), unilateral: null, extra: {} } as unknown as Row<'workout_entries'>, []).unilateral).toBe(false);
  });

  it('writes the entry row and carries extra', () => {
    const entry: WorkoutEntry = { id: 'w1', exercise: 'Squat', addedAt: T0, unilateral: true, sets: [], extra: { a: 1 } };
    expect(workoutEntryToRow(U, '2026-10-26', entry)).toEqual({
      user_id: U, id: 'w1', log_date: '2026-10-26', exercise: 'Squat', added_at: '2026-10-26T12:30:00.000Z', unilateral: true, extra: { a: 1 },
    });
  });

  it('writes a set by position with the numbers cleaned for the integer and non-negative columns', () => {
    expect(workoutSetToRow(U, 'w1', 3, { reps: 7.6, weightKg: 52.5, leftKg: null, rightKg: null, leftReps: null, rightReps: null })).toEqual({
      user_id: U, entry_id: 'w1', position: 3, reps: 8, weight_kg: 52.5, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {},
    });
  });

  it('turns negative, non-finite and absurd figures into NULL or the cap, never an out-of-range write', () => {
    const row = workoutSetToRow(U, 'w1', 0, { reps: -3, weightKg: -1, leftKg: Number.NaN, rightKg: Number.POSITIVE_INFINITY, leftReps: 1e9, rightReps: 12 });
    expect(row).toMatchObject({ reps: null, weight_kg: null, left_kg: null, right_kg: null, left_reps: MAX_REPS, right_reps: 12 });
  });

  it('keeps zero as a value', () => {
    expect(workoutSetToRow(U, 'w1', 0, { reps: 0, weightKg: 0, leftKg: null, rightKg: null, leftReps: null, rightReps: null })).toMatchObject({ reps: 0, weight_kg: 0 });
  });

  it('a set survives a round trip including its extra', () => {
    const set = { reps: 5, weightKg: null, leftKg: 12.5, rightKg: 12.5, leftReps: 5, rightReps: 4, extra: { tempo: '3-1-1' } };
    expect(workoutSetFromRow(workoutSetToRow(U, 'w1', 0, set) as unknown as Row<'workout_sets'>)).toEqual(set);
  });
});

describe('weight rows', () => {
  it('reads and writes a weigh-in', () => {
    const row = weightToRow(U, { day: '2026-10-26', kg: 81.4, loggedAt: T0 });
    expect(row).toEqual({ user_id: U, log_date: '2026-10-26', kg: 81.4, logged_at: '2026-10-26T12:30:00.000Z', extra: {} });
    expect(weightFromRow(row as unknown as Row<'weight_entries'>)).toEqual({ day: '2026-10-26', kg: 81.4, loggedAt: T0 });
  });

  it.each([[0], [-5], [400.01], [Number.NaN], [Number.POSITIVE_INFINITY]])('refuses %p kg (the database would)', (kg) => {
    expect(weightToRow(U, { day: '2026-10-26', kg, loggedAt: T0 })).toBeNull();
  });

  it('accepts the limits that are allowed', () => {
    expect(weightToRow(U, { day: '2026-10-26', kg: 0.1, loggedAt: T0 })).not.toBeNull();
    expect(weightToRow(U, { day: '2026-10-26', kg: 400, loggedAt: T0 })).not.toBeNull();
  });
});

describe('goals, settings, plan', () => {
  it('missing goals come back as the defaults', () => {
    expect(goalsFromRow(null)).toEqual({ protein: 150, fat: 65, carbs: 200, calories: 1985 });
    expect(goalsFromRow(undefined).calories).toBe(1985);
  });

  it('reads goals and derives calories from the macros', () => {
    expect(goalsFromRow({ user_id: U, protein: 100, fat: 50, carbs: 100, extra: {} } as Row<'nutrition_goals'>)).toEqual({ protein: 100, fat: 50, carbs: 100, calories: 1250 });
  });

  it('writes whole grams and never stores calories', () => {
    const row = goalsToRow(U, { protein: 120.4, fat: 60.6, carbs: 199.5 });
    expect(row).toEqual({ user_id: U, protein: 120, fat: 61, carbs: 200, extra: {} });
    expect('calories' in row).toBe(false);
  });

  it('writes goals inside the allowed range and passes extra through', () => {
    const row = goalsToRow(U, { protein: -5, fat: 1e9, carbs: Number.NaN }, { keep: true });
    expect(row.protein).toBeGreaterThanOrEqual(0);
    expect(row.fat).toBeLessThan(1e9);
    expect(Number.isFinite(row.carbs)).toBe(true);
    expect(row.extra).toEqual({ keep: true });
  });

  it('settings default when there is no row or the values are junk', () => {
    expect(settingsFromRow(null)).toEqual({ units: { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' }, language: null, theme: null });
    const junk = settingsFromRow({ units_weight: 'stone', units_height: null, units_distance: 'mi', units_clock: '99h', language: 'fr', theme: 'blue' } as Row<'user_settings'>);
    expect(junk).toEqual({ units: { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' }, language: null, theme: null });
  });

  it('settings read what was chosen', () => {
    expect(settingsFromRow({ units_weight: 'lb', units_height: 'ftin', units_distance: 'm', units_clock: '24h', language: 'th', theme: 'dark' } as Row<'user_settings'>)).toEqual({
      units: { weight: 'lb', height: 'ftin', distance: 'm', clock: '24h' }, language: 'th', theme: 'dark',
    });
  });

  it('settings are written whole and keep what this version does not manage', () => {
    const base = { user_id: U, hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: 25, hyrox_history_backfilled: true, extra: { x: 1 } } as unknown as Row<'user_settings'>;
    const row = settingsToRow(U, { units: { weight: 'lb', height: 'cm', distance: 'km', clock: '24h' }, language: 'en', theme: null }, base);
    expect(row).toEqual({
      user_id: U, theme: null, language: 'en', units_weight: 'lb', units_height: 'cm', units_distance: 'km', units_clock: '24h',
      hyrox_leaderboard_gender: 'women', hyrox_facility_lane_m: 25, hyrox_history_backfilled: true, extra: { x: 1 },
    });
  });

  it('settings without a base row write the HYROX columns as unset', () => {
    const row = settingsToRow(U, settingsFromRow(null));
    expect(row).toMatchObject({ hyrox_leaderboard_gender: null, hyrox_facility_lane_m: null, hyrox_history_backfilled: false, extra: {} });
  });

  it('no split plan row means no plan', () => {
    expect(splitPlanFromRow(null)).toBeNull();
    expect(splitPlanFromRow(undefined)).toBeNull();
  });

  it('reads a split plan, dropping malformed pieces', () => {
    const plan = splitPlanFromRow({
      user_id: U, split_type: 'ppl', days_per_week: 3, goal: 'muscle',
      days: [{ label: 'Push', exercises: ['Bench press', 7, 'Dips'] }, 'junk', null, { exercises: 'nope' }],
      schedule: { monday: 'Push', tuesday: 4, wednesday: 'Rest' },
      exercise_prescriptions: { '["Push","Bench press"]': { sets: 4, reps: '8' }, bad: 'x', also: { sets: 'q' } },
      extra: {},
    } as Row<'split_plans'>);
    expect(plan).toEqual({
      splitType: 'ppl', daysPerWeek: 3, goal: 'muscle',
      days: [{ label: 'Push', exercises: ['Bench press', 'Dips'] }, { label: '', exercises: [] }],
      schedule: { monday: 'Push', wednesday: 'Rest' },
      exercisePrescriptions: { '["Push","Bench press"]': { sets: 4, reps: 8 }, also: { sets: undefined, reps: undefined } },
    });
  });

  it('a split plan with non-array days reads as no days', () => {
    expect(splitPlanFromRow({ user_id: U, split_type: null, days_per_week: null, goal: null, days: {}, schedule: [], exercise_prescriptions: null, extra: {} } as Row<'split_plans'>)).toEqual({
      splitType: null, daysPerWeek: null, goal: null, days: [], schedule: {}, exercisePrescriptions: {},
    });
  });

  it('a split plan survives a round trip', () => {
    const plan: SplitPlan = {
      splitType: 'upper_lower', daysPerWeek: 4, goal: 'strength',
      days: [{ label: 'Upper', exercises: ['Row', 'Press'] }, { label: 'Lower', exercises: ['Squat'] }],
      schedule: { monday: 'Upper', tuesday: 'Lower', wednesday: 'Rest' },
      exercisePrescriptions: { '["Upper","Row"]': { sets: 3, reps: 10 } },
    };
    const row = splitPlanToRow(U, plan, { z: 1 });
    expect(row.extra).toEqual({ z: 1 });
    expect(splitPlanFromRow(row as unknown as Row<'split_plans'>)).toEqual(plan);
  });
});

describe('survivors: blanks and rounding', () => {
  it('a blank string is no number, not zero', () => {
    const set = workoutSetToRow(U, 'w1', 0, { reps: '' as never, weightKg: '' as never, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
    expect(set).toMatchObject({ reps: null, weight_kg: null });
    const row = nutritionEntryToRow(U, '2026-10-26', { id: 'x', food: 'F', addedAt: T0, grams: '' as never, baseCalories: '' as never });
    expect(row).toMatchObject({ grams: null, base_calories: null });
  });

  it('goals round each macro to the nearest whole gram, halves up', () => {
    expect(goalsToRow(U, { protein: 120.6, fat: 60.5, carbs: 199.4 })).toMatchObject({ protein: 121, fat: 61, carbs: 199 });
  });
});
