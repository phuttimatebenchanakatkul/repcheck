/**
 * What the screens show = what the server has + what this device has queued but not yet sent.
 *
 * Without this, a refetch while a write is still waiting (offline, or just not flushed yet) would replace the screen with the server's
 * older copy and the entry the person just logged would vanish. So every read is the server's answer with this person's waiting
 * operations applied on top, in queue order; once an operation is sent, the server has it and the overlay stops mattering.
 */
import type { Operation, QueuedOperation } from '../store/outbox';

import type { NutritionEntry, WorkoutEntry, WorkoutSet } from '../logic/types';
import { nutritionRowToEntry, toMs, weightFromRow, workoutSetFromRow, type Row, type WeightEntry } from './mappers';

/** The waiting operations of one person on a table, oldest first. */
export function waiting(queue: readonly QueuedOperation[], userId: string, table: Operation['table']): Operation[] {
  return queue.filter((q) => q.userId === userId && q.op.table === table).map((q) => q.op);
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

// -- the food log for one day ----------------------------------------------------------------------------------------------------

export function overlayNutritionDay(entries: readonly NutritionEntry[], ops: readonly Operation[], day: string): NutritionEntry[] {
  let list = entries.slice();
  for (const op of ops) {
    if (op.kind === 'upsert') {
      const row = op.row as unknown as Row<'nutrition_entries'>;
      list = list.filter((e) => e.id !== row.id);
      if (row.log_date === day) list.push(nutritionRowToEntry(row));
    } else {
      list = list.filter((e) => e.id !== op.match.id);
    }
  }
  return list.sort((a, b) => a.addedAt - b.addedAt);
}

/** The same overlay for "recent entries" lists, which span days: entries are kept (or replaced) wherever they are filed. */
export function overlayNutritionRecent(entries: readonly (NutritionEntry & { day: string })[], ops: readonly Operation[]): (NutritionEntry & { day: string })[] {
  let list = entries.slice();
  for (const op of ops) {
    if (op.kind === 'upsert') {
      const row = op.row as unknown as Row<'nutrition_entries'>;
      list = list.filter((e) => e.id !== row.id);
      list.push({ ...nutritionRowToEntry(row), day: row.log_date });
    } else {
      list = list.filter((e) => e.id !== op.match.id);
    }
  }
  return list.sort((a, b) => b.addedAt - a.addedAt);
}

/** Entries filed under days from `from` to `to`, with the waiting operations applied (an entry moved out of the range leaves it). Oldest first. */
export function overlayNutritionRange(entries: readonly (NutritionEntry & { day: string })[], ops: readonly Operation[], from: string, to: string): (NutritionEntry & { day: string })[] {
  return overlayNutritionRecent(entries, ops)
    .filter((e) => e.day >= from && e.day <= to)
    .sort((a, b) => a.addedAt - b.addedAt);
}

// -- workouts: entries and their sets are two tables ------------------------------------------------------------------------------

/** The waiting operations on any of `tables`, oldest first and INTERLEAVED as queued (a save is entry, then sets: order matters). */
export function waitingOn(queue: readonly QueuedOperation[], userId: string, tables: readonly Operation['table'][]): Operation[] {
  return queue.filter((q) => q.userId === userId && tables.includes(q.op.table)).map((q) => q.op);
}

/**
 * One day's workout entries with the waiting operations applied in the order they were queued. A sets delete clears the entry's sets,
 * a set upsert puts a set at its position, an entry upsert (re)files it under its day (moving it off this day if it is filed elsewhere),
 * an entry delete removes it. Positions are 0..n-1, as this app always writes them.
 */
export function overlayWorkoutDay(entries: readonly WorkoutEntry[], ops: readonly Operation[], day: string): WorkoutEntry[] {
  type Working = Omit<WorkoutEntry, 'sets'> & { sets: Map<number, WorkoutSet> };
  const state = new Map<string, Working>(entries.map((e) => [e.id, { ...e, sets: new Map(e.sets.map((set, i) => [i, set])) }]));
  for (const op of ops) {
    if (op.table === 'workout_entries') {
      if (op.kind === 'upsert') {
        const row = op.row as unknown as Row<'workout_entries'>;
        if (row.log_date !== day) {
          state.delete(row.id);
          continue;
        }
        const existing = state.get(row.id);
        state.set(row.id, {
          id: row.id,
          exercise: row.exercise,
          addedAt: toMs(row.added_at),
          unilateral: row.unilateral === true,
          sets: existing?.sets ?? new Map(),
          ...(existing?.extra ? { extra: existing.extra } : {}),
        });
      } else {
        state.delete(str(op.match.id));
      }
    } else if (op.table === 'workout_sets') {
      if (op.kind === 'delete') {
        state.get(str(op.match.entry_id))?.sets.clear();
      } else {
        const row = op.row as unknown as Row<'workout_sets'>;
        state.get(row.entry_id)?.sets.set(row.position, workoutSetFromRow({ ...row, extra: row.extra ?? {} }));
      }
    }
  }
  return Array.from(state.values())
    .map(({ sets, ...entry }): WorkoutEntry => ({ ...entry, sets: Array.from(sets.entries()).sort((a, b) => a[0] - b[0]).map(([, set]) => set) }))
    .sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * "Recent workouts" spans days, and a set operation carries no day, so each day's entries are overlaid on their own (an entry upsert
 * names its day; a delete reaches every day). Newest first, cut to `limit` AFTER the overlay so a waiting entry is never pushed out.
 */
export function overlayWorkoutRecent(entries: readonly (WorkoutEntry & { day: string })[], ops: readonly Operation[], limit: number): (WorkoutEntry & { day: string })[] {
  const days = new Set(entries.map((e) => e.day));
  for (const op of ops) {
    if (op.table === 'workout_entries' && op.kind === 'upsert') days.add(str(op.row.log_date));
  }
  const out: (WorkoutEntry & { day: string })[] = [];
  for (const day of days) {
    const here = entries.filter((e) => e.day === day).map(({ day: _day, ...entry }): WorkoutEntry => entry);
    for (const entry of overlayWorkoutDay(here, ops, day)) out.push({ ...entry, day });
  }
  return out.sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
}

// -- single rows -----------------------------------------------------------------------------------------------------------------------

/** The latest waiting whole-row write to a one-row-per-person table (goals, settings, split plan), or undefined if none is waiting. */
export function latestRow<T>(ops: readonly Operation[]): { deleted: boolean; row?: T } | undefined {
  const last = ops[ops.length - 1];
  if (!last) return undefined;
  return last.kind === 'upsert' ? { deleted: false, row: last.row as T } : { deleted: true };
}

/** A name-keyed set (favourites) with the waiting adds and removes applied. */
export function overlayNames(names: readonly string[], ops: readonly Operation[], column: 'food_name' | 'exercise_name'): string[] {
  const set = new Set(names);
  for (const op of ops) {
    if (op.kind === 'upsert') set.add(str(op.row[column]));
    else set.delete(str(op.match[column]));
  }
  return Array.from(set).sort();
}

// -- weight, over a range of days ---------------------------------------------------------------------------------------------------

export function overlayWeights(entries: readonly WeightEntry[], ops: readonly Operation[], from: string, to: string): WeightEntry[] {
  const byDay = new Map(entries.map((e) => [e.day, e]));
  for (const op of ops) {
    if (op.kind === 'upsert') {
      const entry = weightFromRow(op.row as unknown as Row<'weight_entries'>);
      if (entry.day >= from && entry.day <= to) byDay.set(entry.day, entry);
      else byDay.delete(entry.day);
    } else {
      byDay.delete(str(op.match.log_date));
    }
  }
  return Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

// -- days with something on them (for the streak) ----------------------------------------------------------------------------------------

/** The days this device has queued activity for: a log written offline counts toward the streak straight away. */
export function pendingActiveDays(queue: readonly QueuedOperation[], userId: string): string[] {
  const days: string[] = [];
  for (const q of queue) {
    if (q.userId !== userId || q.op.kind !== 'upsert') continue;
    const { table, row } = q.op;
    if (table === 'nutrition_entries' || table === 'workout_entries' || table === 'weight_entries' || table === 'activity_days') {
      const day = row.log_date;
      if (typeof day === 'string') days.push(day);
    }
  }
  return days;
}

// -- day status ("fasting" / "incomplete"), over a range of days ---------------------------------------------------------------------

export type DayStatuses = Record<string, 'fasting' | 'incomplete'>;

export function overlayDayStatuses(statuses: Readonly<DayStatuses>, ops: readonly Operation[], from: string, to: string): DayStatuses {
  const out: DayStatuses = { ...statuses };
  for (const op of ops) {
    if (op.kind === 'upsert') {
      const day = str(op.row.log_date);
      const status = op.row.status;
      if (day >= from && day <= to && (status === 'fasting' || status === 'incomplete')) out[day] = status;
      else delete out[day];
    } else {
      delete out[str(op.match.log_date)];
    }
  }
  return out;
}
