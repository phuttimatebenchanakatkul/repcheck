import { Outbox, rowIdentity, type KeyValueStorage, type Operation } from '../../store/outbox';
import type { WorkoutEntry } from '../../logic/types';
import {
  activityMark,
  dayStatus,
  exerciseFavorite,
  goalsUpsert,
  nutritionDelete,
  nutritionFavorite,
  nutritionUpsert,
  settingsUpsert,
  splitPlanUpsert,
  weightDelete,
  weightUpsert,
  workoutDelete,
  workoutSave,
} from '../ops';

const U = 'user-1';
const DAY = '2026-10-26';
const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

const upsertRow = (op: Operation) => (op.kind === 'upsert' ? op.row : (() => { throw new Error('not an upsert'); })());

const entry = (sets: number): WorkoutEntry => ({
  id: 'w1', exercise: 'Bench press', addedAt: T0, unilateral: false,
  sets: Array.from({ length: sets }, (_, i) => ({ reps: 10 - i, weightKg: 60 + i, leftKg: null, rightKg: null, leftReps: null, rightReps: null })),
});

describe('every operation names the key its table is unique on', () => {
  const cases: [string, Operation, string][] = [
    ['nutrition upsert', nutritionUpsert(U, DAY, { id: 'n1', food: 'Egg', addedAt: T0 }), 'user_id,id'],
    ['nutrition delete', nutritionDelete(U, 'n1'), 'user_id,id'],
    ['workout delete', workoutDelete(U, 'w1'), 'user_id,id'],
    ['weight delete', weightDelete(U, DAY), 'user_id,log_date'],
    ['goals', goalsUpsert(U, { protein: 100, fat: 50, carbs: 100 }), 'user_id'],
    ['settings', settingsUpsert(U, { units: { weight: 'kg', height: 'cm', distance: 'km', clock: '12h' }, language: null, theme: null }), 'user_id'],
    ['split plan', splitPlanUpsert(U, { splitType: null, daysPerWeek: null, goal: null, days: [], schedule: {}, exercisePrescriptions: {} }), 'user_id'],
    ['food favourite on', nutritionFavorite(U, 'Egg', true), 'user_id,food_name'],
    ['food favourite off', nutritionFavorite(U, 'Egg', false), 'user_id,food_name'],
    ['exercise favourite on', exerciseFavorite(U, 'Squat', true), 'user_id,exercise_name'],
    ['exercise favourite off', exerciseFavorite(U, 'Squat', false), 'user_id,exercise_name'],
    ['day status set', dayStatus(U, DAY, 'fasting'), 'user_id,log_date'],
    ['day status cleared', dayStatus(U, DAY, null), 'user_id,log_date'],
    ['activity mark', activityMark(U, DAY, 'coach_chat'), 'user_id,log_date,action'],
  ];
  it.each(cases)('%s', (_name, op, key) => {
    expect(op.key).toBe(key);
  });

  it('and every key column is actually present on the row or the match, so rows coalesce by identity', () => {
    for (const [, op] of cases) {
      const source = op.kind === 'upsert' ? op.row : op.match;
      for (const column of op.key.split(',')) expect(source).toHaveProperty(column);
    }
  });

  it('the upsert for a person only ever carries that person', () => {
    for (const [, op] of cases) {
      const source = op.kind === 'upsert' ? op.row : op.match;
      expect(source.user_id).toBe(U);
    }
  });
});

describe('nutrition and weight', () => {
  it('the nutrition upsert is the whole row filed under the day', () => {
    const op = nutritionUpsert(U, DAY, { id: 'n1', food: 'Egg', addedAt: T0, grams: 50, baseCalories: 143 });
    expect(op).toMatchObject({ kind: 'upsert', table: 'nutrition_entries' });
    expect(upsertRow(op)).toMatchObject({ user_id: U, id: 'n1', log_date: DAY, food: 'Egg', grams: 50, base_calories: 143 });
  });

  it('a delete matches on the person and the id', () => {
    expect(nutritionDelete(U, 'n1')).toEqual({ kind: 'delete', table: 'nutrition_entries', key: 'user_id,id', match: { user_id: U, id: 'n1' } });
  });

  it('a weigh-in the database would refuse queues nothing', () => {
    expect(weightUpsert(U, { day: DAY, kg: 0, loggedAt: T0 })).toBeNull();
    expect(weightUpsert(U, { day: DAY, kg: 401, loggedAt: T0 })).toBeNull();
  });

  it('a valid weigh-in is an upsert keyed by day', () => {
    const op = weightUpsert(U, { day: DAY, kg: 80, loggedAt: T0 });
    expect(op).toMatchObject({ kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date' });
    expect(op && upsertRow(op)).toMatchObject({ log_date: DAY, kg: 80 });
  });

  it('two weigh-ins for one day share an identity (the second replaces the first in the queue)', () => {
    const a = weightUpsert(U, { day: DAY, kg: 80, loggedAt: T0 }) as Operation;
    const b = weightUpsert(U, { day: DAY, kg: 79, loggedAt: T0 + 1 }) as Operation;
    expect(rowIdentity(a)).toBe(rowIdentity(b));
    expect(rowIdentity(a)).not.toBe(rowIdentity(weightUpsert(U, { day: '2026-10-27', kg: 80, loggedAt: T0 }) as Operation));
  });
});

describe('favourites, day status and activity', () => {
  it('turning a favourite on then off share one identity, so on-then-off while offline cancels out', () => {
    expect(rowIdentity(nutritionFavorite(U, 'Egg', true))).toBe(rowIdentity(nutritionFavorite(U, 'Egg', false)));
    expect(rowIdentity(exerciseFavorite(U, 'Squat', true))).toBe(rowIdentity(exerciseFavorite(U, 'Squat', false)));
  });

  it('a food and an exercise of the same name are different rows', () => {
    expect(rowIdentity(nutritionFavorite(U, 'Plank', true))).not.toBe(rowIdentity(exerciseFavorite(U, 'Plank', true)));
  });

  it('day status: a value upserts, null removes the override', () => {
    expect(dayStatus(U, DAY, 'incomplete')).toMatchObject({ kind: 'upsert', row: { status: 'incomplete', log_date: DAY } });
    expect(dayStatus(U, DAY, null)).toEqual({ kind: 'delete', table: 'day_status_overrides', key: 'user_id,log_date', match: { user_id: U, log_date: DAY } });
  });

  it('a streak mark is one row per day per action', () => {
    expect(rowIdentity(activityMark(U, DAY, 'a'))).toBe(rowIdentity(activityMark(U, DAY, 'a')));
    expect(rowIdentity(activityMark(U, DAY, 'a'))).not.toBe(rowIdentity(activityMark(U, DAY, 'b')));
    expect(rowIdentity(activityMark(U, DAY, 'a'))).not.toBe(rowIdentity(activityMark(U, '2026-10-27', 'a')));
  });
});

describe('workoutSave', () => {
  it('is the entry, then a clear of its sets, then one set per position', () => {
    const ops = workoutSave(U, DAY, entry(3));
    expect(ops.map((o) => `${o.kind}:${o.table}`)).toEqual([
      'upsert:workout_entries', 'delete:workout_sets', 'upsert:workout_sets', 'upsert:workout_sets', 'upsert:workout_sets',
    ]);
    expect(ops.slice(2).map((o) => upsertRow(o).position)).toEqual([0, 1, 2]);
    expect(ops[1]).toEqual({ kind: 'delete', table: 'workout_sets', key: 'user_id,entry_id', match: { user_id: U, entry_id: 'w1' } });
  });

  it('an entry with no sets is the entry and the clear only', () => {
    expect(workoutSave(U, DAY, entry(0)).map((o) => o.kind)).toEqual(['upsert', 'delete']);
  });

  it('files the entry under the day', () => {
    expect(upsertRow(workoutSave(U, DAY, entry(1))[0])).toMatchObject({ log_date: DAY, exercise: 'Bench press' });
  });
});

describe('the outbox treats a re-saved workout correctly', () => {
  function memory(): KeyValueStorage {
    const data = new Map<string, string>();
    return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
  }
  const makeOutbox = () => {
    const sent: Operation[] = [];
    return { outbox: new Outbox(memory(), async (op) => (sent.push(op), null)), sent };
  };
  const isSetsOf = (id: string) => (op: Operation) => op.table === 'workout_sets' && (op.kind === 'upsert' ? op.row.entry_id : op.match.entry_id) === id;

  it('without a purge, shrinking a waiting workout leaves the longer version’s extra set behind (why access.ts purges first)', async () => {
    const { outbox, sent } = makeOutbox();
    for (const op of workoutSave(U, DAY, entry(3))) await outbox.enqueue(U, op);
    for (const op of workoutSave(U, DAY, entry(1))) await outbox.enqueue(U, op);
    await outbox.flush(U);
    const positions = sent.filter((o) => o.kind === 'upsert' && o.table === 'workout_sets').map((o) => upsertRow(o).position);
    expect(positions).toContain(2); // the stale set 2 is still sent after the clear
  });

  it('with a purge first, only the newest version is sent', async () => {
    const { outbox, sent } = makeOutbox();
    for (const op of workoutSave(U, DAY, entry(3))) await outbox.enqueue(U, op);
    await outbox.purge(U, isSetsOf('w1'));
    for (const op of workoutSave(U, DAY, entry(1))) await outbox.enqueue(U, op);
    await outbox.flush(U);
    const sets = sent.filter((o) => o.kind === 'upsert' && o.table === 'workout_sets');
    expect(sets.map((o) => upsertRow(o).position)).toEqual([0]);
    expect(sent.map((o) => `${o.kind}:${o.table}`)).toEqual(['upsert:workout_entries', 'delete:workout_sets', 'upsert:workout_sets']);
  });

  it('creating and deleting a workout while offline sends nothing for the entry (the sets purge handles the rest)', async () => {
    const { outbox, sent } = makeOutbox();
    for (const op of workoutSave(U, DAY, entry(2))) await outbox.enqueue(U, op);
    await outbox.purge(U, isSetsOf('w1'));
    await outbox.enqueue(U, workoutDelete(U, 'w1'));
    await outbox.flush(U);
    expect(sent).toEqual([]);
  });
});
