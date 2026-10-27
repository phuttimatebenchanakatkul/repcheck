/**
 * What the screens read. Each hook is the server's answer (React Query, persisted on the device) with this person's still-waiting
 * writes laid on top (src/data/overlay.ts), so a log made offline shows at once and a refetch never makes it vanish.
 *
 * Every hook returns `data` that is always defined (an empty list / the defaults before anything loads), plus `isLoading` (first load,
 * nothing cached) and `isError` (the load failed and there is nothing cached to show), so a screen decides what to draw.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';

import type { CustomExercise, CustomFood } from '../api/endpoints';
import { activeDaySet, currentStreak, longestStreak } from '../logic/streak';
import type { ChatTurn } from '../logic/chat';
import type { Goals, NutritionEntry, SplitPlan, WorkoutEntry } from '../logic/types';
import type { QueuedOperation } from '../store/outbox';
import type { Data, RecentNutrition, RecentWorkout } from './access';
import { RECENT_NUTRITION_LIMIT, RECENT_WORKOUT_LIMIT } from './access';
import { keys } from './keys';
import { goalsFromRow, settingsFromRow, splitPlanFromRow, type AppSettings, type Row, type WeightEntry } from './mappers';
import {
  latestRow,
  overlayDayStatuses,
  overlayAnalysisThread,
  overlayCoachThread,
  overlayNames,
  overlayNutritionDay,
  overlayNutritionRange,
  overlayNutritionRecent,
  overlayWeights,
  overlayWorkoutDay,
  overlayWorkoutRecent,
  pendingActiveDays,
  waiting,
  waitingOn,
  type DayStatuses,
} from './overlay';

export interface DataContextValue {
  data: Data;
  /** This person's writes still waiting to be sent, kept current by the provider. */
  queue: readonly QueuedOperation[];
}

export const DataContext = createContext<DataContextValue | null>(null);

export function useDataContext(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('Data hooks need <DataProvider> and a signed-in person.');
  return value;
}

/** The writes: each one queues for sending and updates what the screens show straight away. */
export function useActions(): Data['actions'] {
  return useDataContext().data.actions;
}

export interface Loaded<T> {
  data: T;
  /** Nothing yet to show: the first load is still running. */
  isLoading: boolean;
  /** The load failed and nothing was cached to show instead. */
  isError: boolean;
  refetch: () => void;
}

interface QueryLike {
  isPending: boolean;
  isError: boolean;
  data: unknown;
  refetch: () => unknown;
}

function status<T>(query: QueryLike, data: T): Loaded<T> {
  const nothing = query.data === undefined;
  return { data, isLoading: query.isPending && nothing, isError: query.isError && nothing, refetch: () => void query.refetch() };
}

/** The day string for a hook's key arrives from callers as `YYYY-MM-DD`. */
export function useNutritionDay(day: string): Loaded<NutritionEntry[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.nutritionDay(data.userId, day), queryFn: () => data.fetch.nutritionDay(day) });
  const entries = useMemo(
    () => overlayNutritionDay(query.data ?? [], waiting(queue, data.userId, 'nutrition_entries'), day),
    [query.data, queue, data.userId, day],
  );
  return status(query, entries);
}

export function useNutritionRecent(): Loaded<RecentNutrition[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.nutritionRecent(data.userId), queryFn: () => data.fetch.nutritionRecent() });
  const entries = useMemo(
    () => overlayNutritionRecent(query.data ?? [], waiting(queue, data.userId, 'nutrition_entries')).slice(0, RECENT_NUTRITION_LIMIT),
    [query.data, queue, data.userId],
  );
  return status(query, entries);
}

/** Everything logged on days from `from` to `to` (each entry carries its day), with this device's waiting changes applied. */
export function useNutritionRange(from: string, to: string): Loaded<RecentNutrition[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.nutritionRange(data.userId, from, to), queryFn: () => data.fetch.nutritionRange(from, to) });
  const entries = useMemo(
    () => overlayNutritionRange(query.data ?? [], waiting(queue, data.userId, 'nutrition_entries'), from, to),
    [query.data, queue, data.userId, from, to],
  );
  return status(query, entries);
}

export function useGoals(): Loaded<Goals> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.goals(data.userId), queryFn: () => data.fetch.goalsRow() });
  const goals = useMemo(() => {
    const pending = latestRow<Row<'nutrition_goals'>>(waiting(queue, data.userId, 'nutrition_goals'));
    return goalsFromRow(pending ? (pending.deleted ? null : pending.row) : query.data);
  }, [query.data, queue, data.userId]);
  return status(query, goals);
}

export function useFoodFavorites(): Loaded<string[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.nutritionFavorites(data.userId), queryFn: () => data.fetch.foodFavorites() });
  const names = useMemo(() => overlayNames(query.data ?? [], waiting(queue, data.userId, 'nutrition_favorites'), 'food_name'), [query.data, queue, data.userId]);
  return status(query, names);
}

export function useExerciseFavorites(): Loaded<string[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.exerciseFavorites(data.userId), queryFn: () => data.fetch.exerciseFavorites() });
  const names = useMemo(() => overlayNames(query.data ?? [], waiting(queue, data.userId, 'exercise_favorites'), 'exercise_name'), [query.data, queue, data.userId]);
  return status(query, names);
}

export function useWorkoutDay(day: string): Loaded<WorkoutEntry[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.workoutDay(data.userId, day), queryFn: () => data.fetch.workoutDay(day) });
  const entries = useMemo(
    () => overlayWorkoutDay(query.data ?? [], waitingOn(queue, data.userId, ['workout_entries', 'workout_sets']), day),
    [query.data, queue, data.userId, day],
  );
  return status(query, entries);
}

export function useWorkoutRecent(): Loaded<RecentWorkout[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.workoutRecent(data.userId), queryFn: () => data.fetch.workoutRecent() });
  const entries = useMemo(
    () => overlayWorkoutRecent(query.data ?? [], waitingOn(queue, data.userId, ['workout_entries', 'workout_sets']), RECENT_WORKOUT_LIMIT),
    [query.data, queue, data.userId],
  );
  return status(query, entries);
}

export function useSplitPlan(): Loaded<SplitPlan | null> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.splitPlan(data.userId), queryFn: () => data.fetch.splitPlanRow() });
  const plan = useMemo(() => {
    const pending = latestRow<Row<'split_plans'>>(waiting(queue, data.userId, 'split_plans'));
    return splitPlanFromRow(pending ? (pending.deleted ? null : pending.row) : query.data);
  }, [query.data, queue, data.userId]);
  return status(query, plan);
}

export function useWeights(from: string, to: string): Loaded<WeightEntry[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.weights(data.userId, from, to), queryFn: () => data.fetch.weights(from, to) });
  const entries = useMemo(() => overlayWeights(query.data ?? [], waiting(queue, data.userId, 'weight_entries'), from, to), [query.data, queue, data.userId, from, to]);
  return status(query, entries);
}

export function useSettings(): Loaded<AppSettings> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.settings(data.userId), queryFn: () => data.fetch.settingsRow() });
  const settings = useMemo(() => {
    const pending = latestRow<Row<'user_settings'>>(waiting(queue, data.userId, 'user_settings'));
    return settingsFromRow(pending ? (pending.deleted ? null : pending.row) : query.data);
  }, [query.data, queue, data.userId]);
  return status(query, settings);
}

export function useDayStatuses(from: string, to: string): Loaded<DayStatuses> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.dayStatuses(data.userId, from, to), queryFn: () => data.fetch.dayStatuses(from, to) });
  const statuses = useMemo(
    () => overlayDayStatuses(query.data ?? {}, waiting(queue, data.userId, 'day_status_overrides'), from, to),
    [query.data, queue, data.userId, from, to],
  );
  return status(query, statuses);
}

/** Every day with something on it (sorted), including the days of logs still waiting to be sent. */
export function useActiveDays(): Loaded<string[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.activeDays(data.userId), queryFn: () => data.fetch.activeDays(), staleTime: 5 * 60_000 });
  const days = useMemo(() => Array.from(new Set([...(query.data ?? []), ...pendingActiveDays(queue, data.userId)])).sort(), [query.data, queue, data.userId]);
  return status(query, days);
}

export interface Streak {
  current: number;
  longest: number;
  active: ReadonlySet<string>;
}

export function useStreak(today: Date = new Date()): Loaded<Streak> {
  const days = useActiveDays();
  const day = today.toDateString(); // recompute when the calendar day changes, not on every render
  const streak = useMemo(() => {
    const active = activeDaySet(days.data);
    return { current: currentStreak(active, today), longest: longestStreak(active), active };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `today` is keyed by its calendar day
  }, [days.data, day]);
  return { ...days, data: streak };
}

export function useCustomFoods(): Loaded<CustomFood[]> {
  const { data } = useDataContext();
  const query = useQuery({ queryKey: keys.customFoods(data.userId), queryFn: () => data.fetch.customFoods() });
  return status(query, query.data ?? []);
}

export function useCustomExercises(): Loaded<CustomExercise[]> {
  const { data } = useDataContext();
  const query = useQuery({ queryKey: keys.customExercises(data.userId), queryFn: () => data.fetch.customExercises() });
  return status(query, query.data ?? []);
}

/** The coach's thread for one day: the server's turns with this device's waiting turns (and a waiting clear) applied. */
export function useCoachThread(day: string): Loaded<ChatTurn[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.coachThread(data.userId, day), queryFn: () => data.fetch.coachThread(day) });
  const turns = useMemo(() => {
    const ops = waiting(queue, data.userId, 'coach_messages');
    // A waiting turn belongs to the day it was made on; only today's are laid over today's thread.
    const own = ops.filter((op) => op.kind === 'delete' || op.row.msg_date === day);
    return overlayCoachThread(query.data ?? [], own);
  }, [query.data, queue, data.userId, day]);
  return status(query, turns);
}

/** One analysis's chat: the server's turns with this device's waiting turns for it. */
export function useAnalysisThread(analysisId: number): Loaded<ChatTurn[]> {
  const { data, queue } = useDataContext();
  const query = useQuery({ queryKey: keys.analysisThread(data.userId, analysisId), queryFn: () => data.fetch.analysisThread(analysisId), enabled: Number.isInteger(analysisId) && analysisId > 0 });
  const turns = useMemo(() => overlayAnalysisThread(query.data ?? [], waiting(queue, data.userId, 'analyze_chat_messages'), analysisId), [query.data, queue, data.userId, analysisId]);
  return status(query, turns);
}
