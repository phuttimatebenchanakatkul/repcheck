/**
 * The write-queue operations (src/store/outbox.ts) for each thing a person can change. Every operation is an IDEMPOTENT whole-row
 * upsert or a delete by key, so a retry after an interrupted send is always safe.
 */
import type { Operation } from '../store/outbox';

import type { Json } from '@/supabase/database.types';

import type { ChatTurn } from '../logic/chat';
import type { CoachingData } from '../logic/coachingProfile';
import type { Race } from '../logic/hyrox';
import type { Goals, NutritionEntry, SplitPlan, WorkoutEntry } from '../logic/types';
import {
  analysisTurnToRow,
  coachingRowAfterCheckin,
  coachingRowWithInactivityNoticed,
  hyroxRaceToRow,
  hyroxSplitToRow,
  settingsRowWithHyrox,
  type HyroxPrefs,
  coachingRowFromData,
  workoutTurnToRow,
  coachTurnToRow,
  goalsToRow,
  nutritionEntryToRow,
  settingsToRow,
  splitPlanToRow,
  weightToRow,
  workoutEntryToRow,
  workoutSetToRow,
  type AppSettings,
  type Row,
  type WeightEntry,
} from './mappers';

export const nutritionUpsert = (userId: string, day: string, entry: NutritionEntry): Operation => ({
  kind: 'upsert', table: 'nutrition_entries', key: 'user_id,id', row: nutritionEntryToRow(userId, day, entry) as Record<string, unknown>,
});

export const nutritionDelete = (userId: string, id: string): Operation => ({
  kind: 'delete', table: 'nutrition_entries', key: 'user_id,id', match: { user_id: userId, id },
});

/**
 * Saving a workout entry replaces its sets: the entry row, then every set row by position, and any positions beyond the new count
 * removed. The set DELETE goes first and is by (user, entry) so it also clears sets left over from a longer earlier version; the
 * outbox keeps the order, and the cascade on the entry means deleting the entry needs only the one delete.
 */
export function workoutSave(userId: string, day: string, entry: WorkoutEntry): Operation[] {
  return [
    { kind: 'upsert', table: 'workout_entries', key: 'user_id,id', row: workoutEntryToRow(userId, day, entry) as Record<string, unknown> },
    { kind: 'delete', table: 'workout_sets', key: 'user_id,entry_id', match: { user_id: userId, entry_id: entry.id } },
    ...entry.sets.map((set, position): Operation => ({
      kind: 'upsert', table: 'workout_sets', key: 'user_id,entry_id,position', row: workoutSetToRow(userId, entry.id, position, set) as Record<string, unknown>,
    })),
  ];
}

export const workoutDelete = (userId: string, id: string): Operation => ({
  kind: 'delete', table: 'workout_entries', key: 'user_id,id', match: { user_id: userId, id },
});

/** null when the figure is outside what the database accepts (the caller reports it before anything is queued). */
export function weightUpsert(userId: string, entry: WeightEntry): Operation | null {
  const row = weightToRow(userId, entry);
  return row ? { kind: 'upsert', table: 'weight_entries', key: 'user_id,log_date', row: row as Record<string, unknown> } : null;
}

export const weightDelete = (userId: string, day: string): Operation => ({
  kind: 'delete', table: 'weight_entries', key: 'user_id,log_date', match: { user_id: userId, log_date: day },
});

export const goalsUpsert = (userId: string, goals: Pick<Goals, 'protein' | 'fat' | 'carbs'>, extra?: Json): Operation => ({
  kind: 'upsert', table: 'nutrition_goals', key: 'user_id', row: goalsToRow(userId, goals, extra) as Record<string, unknown>,
});

export const settingsUpsert = (userId: string, settings: AppSettings, base?: Row<'user_settings'> | null): Operation => ({
  kind: 'upsert', table: 'user_settings', key: 'user_id', row: settingsToRow(userId, settings, base) as Record<string, unknown>,
});

export const splitPlanUpsert = (userId: string, plan: SplitPlan, extra?: Json): Operation => ({
  kind: 'upsert', table: 'split_plans', key: 'user_id', row: splitPlanToRow(userId, plan, extra) as Record<string, unknown>,
});

export const nutritionFavorite = (userId: string, name: string, on: boolean): Operation =>
  on
    ? { kind: 'upsert', table: 'nutrition_favorites', key: 'user_id,food_name', row: { user_id: userId, food_name: name } }
    : { kind: 'delete', table: 'nutrition_favorites', key: 'user_id,food_name', match: { user_id: userId, food_name: name } };

export const exerciseFavorite = (userId: string, name: string, on: boolean): Operation =>
  on
    ? { kind: 'upsert', table: 'exercise_favorites', key: 'user_id,exercise_name', row: { user_id: userId, exercise_name: name } }
    : { kind: 'delete', table: 'exercise_favorites', key: 'user_id,exercise_name', match: { user_id: userId, exercise_name: name } };

/** "fasting" / "incomplete" for a day; null restores automatic detection (the row is removed). */
export const dayStatus = (userId: string, day: string, status: 'fasting' | 'incomplete' | null): Operation =>
  status
    ? { kind: 'upsert', table: 'day_status_overrides', key: 'user_id,log_date', row: { user_id: userId, log_date: day, status } }
    : { kind: 'delete', table: 'day_status_overrides', key: 'user_id,log_date', match: { user_id: userId, log_date: day } };

/** Records a client-side action as a streak day (the ones with no dated record of their own: coach chat, a split plan edit, ...). */
export const activityMark = (userId: string, day: string, action: string): Operation => ({
  kind: 'upsert', table: 'activity_days', key: 'user_id,log_date,action', row: { user_id: userId, log_date: day, action },
});

/** Saving one coach turn: an upsert on (user, client id), so a retried send is the same send. */
export const coachTurnSave = (userId: string, turn: ChatTurn): Operation => ({
  kind: 'upsert', table: 'coach_messages', key: 'user_id,client_id', row: coachTurnToRow(userId, turn) as Record<string, unknown>,
});

/** Clearing the coach's thread removes every one of the person's turns (the website's "clear" empties the whole thread). */
export const coachClear = (userId: string): Operation => ({
  kind: 'delete', table: 'coach_messages', key: 'user_id', match: { user_id: userId },
});

/** Saving one turn of an analysis's chat: an upsert on (user, client id), so a retried send is the same send. */
export const analysisTurnSave = (userId: string, analysisId: number, turn: ChatTurn): Operation => ({
  kind: 'upsert', table: 'analyze_chat_messages', key: 'user_id,client_id', row: analysisTurnToRow(userId, analysisId, turn) as Record<string, unknown>,
});

/** Saving one turn of a day's workout chat: an upsert on (user, client id), so a retried send is the same send. */
export const workoutTurnSave = (userId: string, turn: ChatTurn): Operation => ({
  kind: 'upsert', table: 'workout_chat_messages', key: 'user_id,client_id', row: workoutTurnToRow(userId, turn) as Record<string, unknown>,
});

/** "New chat" on a day removes that day's turns only: other days' threads are kept for good. */
export const workoutChatClear = (userId: string, day: string): Operation => ({
  kind: 'delete', table: 'workout_chat_messages', key: 'user_id,msg_date', match: { user_id: userId, msg_date: day },
});

/** Saving the coaching profile: one row per person, written whole. */
export const coachingProfileSave = (userId: string, data: CoachingData, base: Row<'coaching_profiles'> | null | undefined, weeklyDistribution: Json | null): Operation => ({
  kind: 'upsert', table: 'coaching_profiles', key: 'user_id', row: coachingRowFromData(userId, data, base, weeklyDistribution) as Record<string, unknown>,
});

/** Saving a finished weekly check-in onto the coaching row. */
export const coachingCheckinSave = (userId: string, base: Row<'coaching_profiles'>, checkin: Parameters<typeof coachingRowAfterCheckin>[1]): Operation => ({
  kind: 'upsert', table: 'coaching_profiles', key: 'user_id', row: { ...coachingRowAfterCheckin(base, checkin), user_id: userId } as Record<string, unknown>,
});

/**
 * Saving a finished HYROX race: the race row, then its splits by position (any left over from an earlier version cleared first). The
 * race goes first because the splits belong to it; deleting the race needs only the one delete (the splits cascade).
 */
export function hyroxRaceSave(userId: string, race: Race): Operation[] {
  return [
    { kind: 'upsert', table: 'hyrox_races', key: 'user_id,id', row: hyroxRaceToRow(userId, race) as Record<string, unknown> },
    { kind: 'delete', table: 'hyrox_race_splits', key: 'user_id,race_id', match: { user_id: userId, race_id: race.id } },
    ...race.splits.map((split, position): Operation => ({
      kind: 'upsert', table: 'hyrox_race_splits', key: 'user_id,race_id,position', row: hyroxSplitToRow(userId, race.id, position, split) as Record<string, unknown>,
    })),
  ];
}

export const hyroxRaceDelete = (userId: string, id: string): Operation => ({
  kind: 'delete', table: 'hyrox_races', key: 'user_id,id', match: { user_id: userId, id },
});

/** Saving the HYROX preferences (lane length, leaderboard gender): the whole settings row, the rest of it as it was. */
export const hyroxPrefsSave = (userId: string, prefs: HyroxPrefs, base: Row<'user_settings'> | null | undefined): Operation => ({
  kind: 'upsert', table: 'user_settings', key: 'user_id', row: settingsRowWithHyrox(userId, prefs, base) as Record<string, unknown>,
});

/** Dismissing the inactivity nudge for the day. */
export const coachingInactivityNoticed = (userId: string, base: Row<'coaching_profiles'>, today: string): Operation => ({
  kind: 'upsert', table: 'coaching_profiles', key: 'user_id', row: { ...coachingRowWithInactivityNoticed(base, today), user_id: userId } as Record<string, unknown>,
});
