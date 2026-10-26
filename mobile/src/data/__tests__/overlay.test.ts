import type { NutritionEntry, WorkoutEntry } from '../../logic/types';
import type { Operation, QueuedOperation } from '../../store/outbox';
import {
  activityMark,
  dayStatus,
  exerciseFavorite,
  goalsUpsert,
  nutritionDelete,
  nutritionFavorite,
  nutritionUpsert,
  weightDelete,
  weightUpsert,
  workoutDelete,
  workoutSave,
} from '../ops';
import {
  latestRow,
  overlayNames,
  overlayNutritionDay,
  overlayDayStatuses,
  overlayNutritionRecent,
  overlayWeights,
  overlayWorkoutDay,
  overlayWorkoutRecent,
  pendingActiveDays,
  waiting,
  waitingOn,
} from '../overlay';

const U = 'user-1';
const DAY = '2026-10-26';
const NEXT = '2026-10-27';
const T0 = Date.UTC(2026, 9, 26, 8, 0, 0);

const food = (id: string, addedAt: number, over: Partial<NutritionEntry> = {}): NutritionEntry => ({ id, food: `Food ${id}`, addedAt, grams: 100, unit: 'g', baseCalories: 100, baseCarbs: 0, baseFat: 0, baseProtein: 0, ...over });

const queued = (userId: string, ...ops: Operation[]): QueuedOperation[] => ops.map((op, i) => ({ id: `q${i}`, userId, op, queuedAt: i, attempts: 0 }));

describe('waiting / waitingOn', () => {
  const queue = [
    ...queued(U, nutritionUpsert(U, DAY, food('a', T0)), weightDelete(U, DAY)),
    ...queued('someone-else', nutritionUpsert('someone-else', DAY, food('x', T0))),
  ];

  it('is one person’s operations on one table, oldest first', () => {
    const ops = waiting(queue, U, 'nutrition_entries');
    expect(ops).toHaveLength(1);
    expect(waiting(queue, 'someone-else', 'nutrition_entries')).toHaveLength(1);
  });

  it('never returns another person’s operation', () => {
    expect(waiting(queue, U, 'nutrition_entries').every((o) => o.kind === 'upsert' && o.row.user_id === U)).toBe(true);
  });

  it('waitingOn keeps several tables interleaved in queue order', () => {
    const q = queued(U, ...workoutSave(U, DAY, { id: 'w1', exercise: 'Squat', addedAt: T0, unilateral: false, sets: [{ reps: 5, weightKg: 100, leftKg: null, rightKg: null, leftReps: null, rightReps: null }] }));
    expect(waitingOn(q, U, ['workout_entries', 'workout_sets']).map((o) => `${o.kind}:${o.table}`)).toEqual(['upsert:workout_entries', 'delete:workout_sets', 'upsert:workout_sets']);
    expect(waitingOn(q, U, ['workout_entries']).map((o) => o.table)).toEqual(['workout_entries']);
    expect(waitingOn(q, 'someone-else', ['workout_entries'])).toEqual([]);
  });
});

describe('overlayNutritionDay', () => {
  it('shows a waiting entry the server does not have yet, in time order', () => {
    const list = overlayNutritionDay([food('a', T0), food('c', T0 + 20)], [nutritionUpsert(U, DAY, food('b', T0 + 10))], DAY);
    expect(list.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('a waiting edit replaces the server’s copy', () => {
    const list = overlayNutritionDay([food('a', T0, { grams: 100 })], [nutritionUpsert(U, DAY, food('a', T0, { grams: 250 }))], DAY);
    expect(list).toHaveLength(1);
    expect(list[0].grams).toBe(250);
  });

  it('a waiting delete hides the server’s copy', () => {
    expect(overlayNutritionDay([food('a', T0), food('b', T0 + 1)], [nutritionDelete(U, 'a')], DAY).map((e) => e.id)).toEqual(['b']);
  });

  it('an entry moved to another day disappears from this one and does not appear on the wrong day', () => {
    const list = overlayNutritionDay([food('a', T0)], [nutritionUpsert(U, NEXT, food('a', T0))], DAY);
    expect(list).toEqual([]);
  });

  it('ops are applied in order: a delete then a re-add shows the entry, an add then a delete does not', () => {
    expect(overlayNutritionDay([food('a', T0)], [nutritionDelete(U, 'a'), nutritionUpsert(U, DAY, food('a', T0, { grams: 5 }))], DAY)[0].grams).toBe(5);
    expect(overlayNutritionDay([], [nutritionUpsert(U, DAY, food('a', T0)), nutritionDelete(U, 'a')], DAY)).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const server = [food('b', T0 + 1), food('a', T0)];
    overlayNutritionDay(server, [], DAY);
    expect(server.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('an entry that is on the server and not touched stays as is', () => {
    const e = food('a', T0, { extra: { k: 1 } });
    expect(overlayNutritionDay([e], [], DAY)).toEqual([e]);
  });
});

describe('overlayNutritionRecent', () => {
  const recent = (id: string, addedAt: number, day = DAY) => ({ ...food(id, addedAt), day });

  it('newest first, with waiting entries filed under their own day', () => {
    const list = overlayNutritionRecent([recent('a', T0)], [nutritionUpsert(U, NEXT, food('b', T0 + 5))]);
    expect(list.map((e) => [e.id, e.day])).toEqual([['b', NEXT], ['a', DAY]]);
  });

  it('an edit replaces, a delete removes', () => {
    const list = overlayNutritionRecent([recent('a', T0), recent('b', T0 + 1)], [nutritionDelete(U, 'a'), nutritionUpsert(U, DAY, food('b', T0 + 1, { grams: 7 }))]);
    expect(list.map((e) => [e.id, e.grams])).toEqual([['b', 7]]);
  });

  it('moving an entry to a different day re-files it', () => {
    const list = overlayNutritionRecent([recent('a', T0)], [nutritionUpsert(U, NEXT, food('a', T0))]);
    expect(list.map((e) => e.day)).toEqual([NEXT]);
  });
});

describe('overlayWorkoutDay', () => {
  const set = (reps: number, weightKg = 50) => ({ reps, weightKg, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
  const lift = (id: string, addedAt: number, sets: ReturnType<typeof set>[], over: Partial<WorkoutEntry> = {}): WorkoutEntry => ({ id, exercise: `Lift ${id}`, addedAt, unilateral: false, sets, ...over });
  const apply = (server: WorkoutEntry[], ...saves: Operation[][]) => overlayWorkoutDay(server, saves.flat(), DAY);

  it('a new waiting workout appears with its sets in order', () => {
    const out = apply([], workoutSave(U, DAY, lift('w1', T0, [set(10), set(8), set(6)])));
    expect(out).toHaveLength(1);
    expect(out[0].sets.map((s) => s.reps)).toEqual([10, 8, 6]);
  });

  it('re-saving a workout with FEWER sets shows only the new sets, not the server’s longer version', () => {
    const server = [lift('w1', T0, [set(10), set(8), set(6)])];
    const out = apply(server, workoutSave(U, DAY, lift('w1', T0, [set(12)])));
    expect(out[0].sets.map((s) => s.reps)).toEqual([12]);
  });

  it('re-saving with MORE sets shows all of them', () => {
    const out = apply([lift('w1', T0, [set(10)])], workoutSave(U, DAY, lift('w1', T0, [set(10), set(9), set(8)])));
    expect(out[0].sets.map((s) => s.reps)).toEqual([10, 9, 8]);
  });

  it('clearing every set leaves an entry with none', () => {
    const out = apply([lift('w1', T0, [set(10)])], workoutSave(U, DAY, lift('w1', T0, [])));
    expect(out).toHaveLength(1);
    expect(out[0].sets).toEqual([]);
  });

  it('a waiting rename / each-side change applies, while the server’s extra is kept', () => {
    const out = apply([lift('w1', T0, [set(5)], { extra: { note: 'x' } })], workoutSave(U, DAY, lift('w1', T0, [set(5)], { exercise: 'Renamed', unilateral: true })));
    expect(out[0]).toMatchObject({ exercise: 'Renamed', unilateral: true, extra: { note: 'x' } });
  });

  it('a waiting delete removes the entry and ignores any set ops queued before it', () => {
    const out = overlayWorkoutDay([lift('w1', T0, [set(5)]), lift('w2', T0 + 1, [set(6)])], [...workoutSave(U, DAY, lift('w1', T0, [set(9)])), workoutDelete(U, 'w1')], DAY);
    expect(out.map((e) => e.id)).toEqual(['w2']);
  });

  it('set ops for an entry that is not on this day are ignored (they cannot invent an entry)', () => {
    const out = overlayWorkoutDay([], workoutSave(U, NEXT, lift('w9', T0, [set(1)])), DAY);
    expect(out).toEqual([]);
  });

  it('an entry moved to another day leaves this one', () => {
    const out = overlayWorkoutDay([lift('w1', T0, [set(5)])], workoutSave(U, NEXT, lift('w1', T0, [set(5)])), DAY);
    expect(out).toEqual([]);
  });

  it('keeps entries in time order and the sets by position', () => {
    const out = overlayWorkoutDay([lift('b', T0 + 10, [set(1)]), lift('a', T0, [set(2)])], workoutSave(U, DAY, lift('c', T0 + 5, [set(3), set(4)])), DAY);
    expect(out.map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('a waiting set write with no clear before it replaces just that position', () => {
    const only: Operation = { kind: 'upsert', table: 'workout_sets', key: 'user_id,entry_id,position', row: { user_id: U, entry_id: 'w1', position: 1, reps: 99, weight_kg: 1, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} } };
    const out = overlayWorkoutDay([lift('w1', T0, [set(10), set(8)])], [only], DAY);
    expect(out[0].sets.map((s) => s.reps)).toEqual([10, 99]);
  });

  it('does not change the entries it was given', () => {
    const server = [lift('w1', T0, [set(10), set(8)])];
    overlayWorkoutDay(server, workoutSave(U, DAY, lift('w1', T0, [set(1)])), DAY);
    expect(server[0].sets.map((s) => s.reps)).toEqual([10, 8]);
  });

  it('ignores operations on other tables', () => {
    const server = [lift('w1', T0, [set(10)])];
    expect(overlayWorkoutDay(server, [nutritionDelete(U, 'w1')], DAY)).toEqual(server);
  });
});

describe('latestRow', () => {
  it('is undefined with nothing waiting', () => {
    expect(latestRow([])).toBeUndefined();
  });

  it('is the last write: the row for an upsert, a deletion for a delete', () => {
    const goals = (p: number) => goalsUpsert(U, { protein: p, fat: 50, carbs: 100 });
    expect(latestRow<{ protein: number }>([goals(100), goals(120)])).toEqual({ deleted: false, row: expect.objectContaining({ protein: 120 }) });
    expect(latestRow([goals(100), nutritionDelete(U, 'x')])).toEqual({ deleted: true });
  });
});

describe('overlayNames (favourites)', () => {
  it('adds the waiting favourites and removes the un-favourited, sorted', () => {
    const ops = [nutritionFavorite(U, 'Banana', true), nutritionFavorite(U, 'Egg', false)];
    expect(overlayNames(['Egg', 'Apple'], ops, 'food_name')).toEqual(['Apple', 'Banana']);
  });

  it('on then off cancels, off then on keeps', () => {
    expect(overlayNames([], [exerciseFavorite(U, 'Squat', true), exerciseFavorite(U, 'Squat', false)], 'exercise_name')).toEqual([]);
    expect(overlayNames(['Squat'], [exerciseFavorite(U, 'Squat', false), exerciseFavorite(U, 'Squat', true)], 'exercise_name')).toEqual(['Squat']);
  });

  it('does not change the names it was given, and de-duplicates', () => {
    const names = ['b', 'a'];
    expect(overlayNames(names, [nutritionFavorite(U, 'a', true)], 'food_name')).toEqual(['a', 'b']);
    expect(names).toEqual(['b', 'a']);
  });
});

describe('overlayWeights', () => {
  const w = (day: string, kg: number) => ({ day, kg, loggedAt: 0 });
  const put = (day: string, kg: number) => weightUpsert(U, { day, kg, loggedAt: 5 }) as Operation;

  it('adds a waiting weigh-in inside the range and replaces the same day', () => {
    const out = overlayWeights([w('2026-10-20', 82), w('2026-10-26', 81)], [put('2026-10-26', 80), put('2026-10-22', 81.5)], '2026-10-01', '2026-10-31');
    expect(out.map((e) => [e.day, e.kg])).toEqual([['2026-10-20', 82], ['2026-10-22', 81.5], ['2026-10-26', 80]]);
  });

  it('ignores a waiting weigh-in outside the range, and removes a stale server one if it was moved out', () => {
    expect(overlayWeights([], [put('2026-11-02', 80)], '2026-10-01', '2026-10-31')).toEqual([]);
    expect(overlayWeights([w('2026-10-26', 81)], [put('2026-11-02', 80), weightDelete(U, '2026-10-26')], '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('range ends are inclusive', () => {
    const out = overlayWeights([], [put('2026-10-01', 80), put('2026-10-31', 81)], '2026-10-01', '2026-10-31');
    expect(out.map((e) => e.day)).toEqual(['2026-10-01', '2026-10-31']);
  });

  it('a delete removes the day', () => {
    expect(overlayWeights([w('2026-10-26', 81)], [weightDelete(U, '2026-10-26')], '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('pendingActiveDays', () => {
  it('lists the days of waiting logs, for this person only', () => {
    const queue = [
      ...queued(U, nutritionUpsert(U, DAY, food('a', T0)), nutritionUpsert(U, NEXT, food('b', T0)), activityMark(U, '2026-10-20', 'coach_chat'), weightUpsert(U, { day: '2026-10-21', kg: 80, loggedAt: 0 }) as Operation),
      ...queued(U, ...workoutSave(U, '2026-10-22', { id: 'w', exercise: 'x', addedAt: T0, unilateral: false, sets: [] })),
      ...queued('someone-else', nutritionUpsert('someone-else', '2026-01-01', food('z', T0))),
    ];
    expect(pendingActiveDays(queue, U).sort()).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-26', '2026-10-27']);
  });

  it('a waiting delete or an unrelated table adds no day', () => {
    const queue = queued(U, nutritionDelete(U, 'a'), weightDelete(U, DAY), dayStatus(U, DAY, 'fasting'), nutritionFavorite(U, 'Egg', true), goalsUpsert(U, { protein: 1, fat: 1, carbs: 1 }));
    expect(pendingActiveDays(queue, U)).toEqual([]);
  });
});

describe('overlayWorkoutRecent', () => {
  const set = (reps: number) => ({ reps, weightKg: 50, leftKg: null, rightKg: null, leftReps: null, rightReps: null });
  const lift = (id: string, addedAt: number, day: string, reps: number[]) => ({ id, exercise: `Lift ${id}`, addedAt, unilateral: false, sets: reps.map(set), day });
  const save = (id: string, addedAt: number, day: string, reps: number[]) => workoutSave(U, day, { id, exercise: `Lift ${id}`, addedAt, unilateral: false, sets: reps.map(set) });

  it('puts a waiting workout on its own day, newest first', () => {
    const out = overlayWorkoutRecent([lift('a', T0, DAY, [5])], save('b', T0 + 100, NEXT, [8, 7]), 10);
    expect(out.map((e) => [e.id, e.day, e.sets.length])).toEqual([['b', NEXT, 2], ['a', DAY, 1]]);
  });

  it('re-saving shrinks the sets on the day it is filed under, leaving other days alone', () => {
    const out = overlayWorkoutRecent([lift('a', T0, DAY, [5, 5, 5]), lift('z', T0 - 5, '2026-10-20', [1, 2])], save('a', T0, DAY, [9]), 10);
    expect(out.find((e) => e.id === 'a')?.sets.map((s) => s.reps)).toEqual([9]);
    expect(out.find((e) => e.id === 'z')?.sets).toHaveLength(2);
  });

  it('moving a workout to another day re-files it', () => {
    const out = overlayWorkoutRecent([lift('a', T0, DAY, [5])], save('a', T0, NEXT, [5]), 10);
    expect(out.map((e) => [e.id, e.day])).toEqual([['a', NEXT]]);
  });

  it('a delete removes the entry from whichever day holds it', () => {
    const out = overlayWorkoutRecent([lift('a', T0, DAY, [5]), lift('b', T0 + 1, '2026-10-20', [5])], [workoutDelete(U, 'b')], 10);
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('is cut to the limit after the overlay, so a waiting entry is never pushed out by older server ones', () => {
    const server = [lift('a', T0, DAY, [1]), lift('b', T0 + 1, DAY, [1]), lift('c', T0 + 2, DAY, [1])];
    const out = overlayWorkoutRecent(server, save('d', T0 + 3, DAY, [1]), 2);
    expect(out.map((e) => e.id)).toEqual(['d', 'c']);
  });

  it('carries the day on each result and puts no `day` inside the entries it overlays', () => {
    const [only] = overlayWorkoutRecent([lift('a', T0, DAY, [5])], [], 5);
    expect(Object.keys(only).sort()).toEqual(['addedAt', 'day', 'exercise', 'id', 'sets', 'unilateral']);
  });
});

describe('overlayDayStatuses', () => {
  it('sets and clears a day, inside the range only', () => {
    const out = overlayDayStatuses({ '2026-10-20': 'fasting' }, [dayStatus(U, DAY, 'incomplete'), dayStatus(U, '2026-10-20', null), dayStatus(U, '2026-12-01', 'fasting')], '2026-10-01', '2026-10-31');
    expect(out).toEqual({ [DAY]: 'incomplete' });
  });

  it('the last write for a day wins', () => {
    expect(overlayDayStatuses({}, [dayStatus(U, DAY, 'fasting'), dayStatus(U, DAY, 'incomplete')], '2026-10-01', '2026-10-31')).toEqual({ [DAY]: 'incomplete' });
    expect(overlayDayStatuses({}, [dayStatus(U, DAY, 'fasting'), dayStatus(U, DAY, null)], '2026-10-01', '2026-10-31')).toEqual({});
  });

  it('does not change the object it was given', () => {
    const base = { [DAY]: 'fasting' as const };
    overlayDayStatuses(base, [dayStatus(U, DAY, null)], '2026-10-01', '2026-10-31');
    expect(base).toEqual({ [DAY]: 'fasting' });
  });

  it('a status it does not know is not shown', () => {
    const odd: Operation = { kind: 'upsert', table: 'day_status_overrides', key: 'user_id,log_date', row: { user_id: U, log_date: DAY, status: 'weird' } };
    expect(overlayDayStatuses({}, [odd], '2026-10-01', '2026-10-31')).toEqual({});
  });
});

describe('survivors: ordering and range ends', () => {
  const setOp = (entryId: string, position: number, reps: number): Operation => ({
    kind: 'upsert', table: 'workout_sets', key: 'user_id,entry_id,position',
    row: { user_id: U, entry_id: entryId, position, reps, weight_kg: 1, left_kg: null, right_kg: null, left_reps: null, right_reps: null, extra: {} },
  });

  it('sets come out in position order however the writes were queued', () => {
    const entry = { id: 'w1', exercise: 'x', addedAt: T0, unilateral: false, sets: [] };
    const out = overlayWorkoutDay([entry], [setOp('w1', 3, 33), setOp('w1', 0, 10), setOp('w1', 2, 22), setOp('w1', 1, 11)], DAY);
    expect(out[0].sets.map((s) => s.reps)).toEqual([10, 11, 22, 33]);
  });

  it('weigh-ins come out oldest day first however they were queued', () => {
    const put = (day: string) => weightUpsert(U, { day, kg: 80, loggedAt: 1 }) as Operation;
    const out = overlayWeights([], [put('2026-10-30'), put('2026-10-02'), put('2026-10-15'), put('2026-10-09'), put('2026-10-22')], '2026-10-01', '2026-10-31');
    expect(out.map((e) => e.day)).toEqual(['2026-10-02', '2026-10-09', '2026-10-15', '2026-10-22', '2026-10-30']);
  });

  it('a day status on the first or last day of the range is shown', () => {
    const out = overlayDayStatuses({}, [dayStatus(U, '2026-10-01', 'fasting'), dayStatus(U, '2026-10-31', 'incomplete'), dayStatus(U, '2026-09-30', 'fasting'), dayStatus(U, '2026-11-01', 'fasting')], '2026-10-01', '2026-10-31');
    expect(out).toEqual({ '2026-10-01': 'fasting', '2026-10-31': 'incomplete' });
  });
});
