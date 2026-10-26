import { useState } from 'react';
import { View } from 'react-native';

import { useActions, useCustomExercises, useExerciseFavorites, useSettings, useSplitPlan, useWorkoutDay, useWorkoutRecent } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { toIsoDate } from '@/logic/dates';
import { dayTitle } from '@/logic/dayTitle';
import { newId } from '@/logic/ids';
import type { CustomExerciseMode, SplitPlan, WorkoutEntry } from '@/logic/types';
import { localeFor } from '@/logic/units';
import { newWorkoutEntry, todaysSplit, type CustomExerciseMeta } from '@/logic/workouts';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { DateStrip } from '@/ui/DateStrip';
import { success } from '@/ui/haptics';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { space } from '@/ui/tokens';

import { CustomExerciseSheet, ExercisePicker, emojiForExercise } from './ExercisePicker';
import { PlanCard } from './PlanCard';
import { PlanSheet } from './plan/PlanSheet';
import { WorkoutCard } from './WorkoutCard';

/**
 * The workout log for a day: today's plan, the day's exercises (each opens into its sets) and the sheet that logs another.
 * Everything shown is the saved copy plus this device's still-waiting changes, so it works with no signal.
 */
export default function WorkoutsScreen() {
  const { t, language } = useTranslation();
  const locale = localeFor(language);
  const today = toIsoDate(new Date());
  const [day, setDay] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<{ name: string } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = useWorkoutDay(day);
  const todays = useWorkoutDay(today);
  const recent = useWorkoutRecent();
  const favorites = useExerciseFavorites();
  const plan = useSplitPlan();
  const settings = useSettings();
  const customExercises = useCustomExercises();
  const actions = useActions();

  const custom: CustomExerciseMeta = Object.fromEntries(customExercises.data.map((e) => [e.name, { mode: e.mode }]));
  const loggedDays = new Set(recent.data.map((entry) => entry.day));
  if (entries.data.length) loggedDays.add(day);
  const totalSets = entries.data.reduce((sum, entry) => sum + entry.sets.length, 0);
  const split = todaysSplit(plan.data, today);
  const recentNames = recent.data.map((entry) => entry.exercise).filter((name, i, all) => all.indexOf(name) === i);

  /** Runs a write; a full queue (or anything else unexpected) is shown instead of silently losing the change. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await action();
      return true;
    } catch {
      setError(t('nutrition.log.saveError'));
      return false;
    }
  };

  /** `extraCustom`: an exercise made a moment ago, which the cached list does not hold yet but whose mode the new entry must follow. */
  const addExercise = async (name: string, extraCustom: CustomExerciseMeta = {}, onDay: string = day) => {
    const entry = newWorkoutEntry(name, { id: newId(), day: onDay, now: new Date(), custom: { ...custom, ...extraCustom } });
    if (await run(() => actions.saveWorkout(onDay, entry))) {
      success();
      if (onDay === day) setExpanded(entry.id);
      setPicking(false);
      setCreating(null);
    }
  };

  const createExercise = async (input: { name: string; emoji?: string; mode: CustomExerciseMode }) => {
    const created = await actions.createCustomExercise(input); // the sheet shows the server's reason if it refuses
    await addExercise(created.name, { [created.name]: { mode: created.mode } });
  };

  /** Building or changing a split is using the app, so the day counts toward the streak (the website marks it in the same place). */
  const savePlan = async (next: SplitPlan) => {
    await actions.saveSplitPlan(next);
    await actions.markActivity(today, 'split_plan');
  };

  return (
    <Screen>
      <OfflineBanner />
      <PlanCard
        plan={plan.data}
        today={today}
        loggedToday={new Set(todays.data.map((entry) => entry.exercise))}
        onAdd={(name) => void addExercise(name, {}, today)}
        onOpen={() => setPlanOpen(true)}
      />
      <DateStrip selected={day} today={today} loggedDays={loggedDays} loggedLabel={(date) => t('app.workouts.dayLogged', { day: date })} onSelect={setDay} />

      <View style={{ gap: space.xs }}>
        <Text variant="title" style={{ fontSize: 22 }} accessibilityRole="header">
          {dayTitle(day, today, locale, { today: t('nutrition.day.today'), yesterday: t('workouts.day.yesterday') })}
        </Text>
        {entries.data.length > 0 && (
          <Text variant="body" secondary>
            {t('workouts.day.exercises', { n: entries.data.length, s: entries.data.length === 1 ? '' : 's' })} · {t('workouts.day.sets', { n: totalSets, s: totalSets === 1 ? '' : 's' })}
          </Text>
        )}
      </View>

      <Button title={t('workouts.logExercise')} onPress={() => setPicking(true)} />
      <ErrorText>{error}</ErrorText>

      {entries.isLoading ? (
        <Text variant="body" secondary>
          {t('common.loading')}
        </Text>
      ) : entries.isError ? (
        <Card>
          <Text variant="body" secondary>
            {t('app.nutrition.loadFailed')}
          </Text>
          <Button tone="plain" title={t('app.nutrition.retry')} onPress={entries.refetch} />
        </Card>
      ) : entries.data.length === 0 ? (
        <Card>
          <Text style={{ fontSize: 40, textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
            🌱
          </Text>
          <Text variant="rowTitle" style={{ textAlign: 'center' }}>
            {t('workouts.empty.title')}
          </Text>
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('workouts.empty.sub')}
          </Text>
        </Card>
      ) : (
        entries.data.map((entry: WorkoutEntry) => (
          <WorkoutCard
            key={entry.id}
            entry={entry}
            expanded={expanded === entry.id}
            units={settings.data.units}
            custom={custom}
            emoji={emojiForExercise(entry.exercise, customExercises.data)}
            onToggle={() => setExpanded((open) => (open === entry.id ? null : entry.id))}
            onSave={(next) => void run(() => actions.saveWorkout(day, next))}
            onDelete={(id) => {
              setExpanded(null);
              void run(() => actions.deleteWorkout(id));
            }}
          />
        ))
      )}

      <ExercisePicker
        visible={picking}
        plan={split ? { label: split.label, exercises: split.exercises } : null}
        favorites={favorites.data}
        customExercises={customExercises.data}
        recent={recentNames}
        onPick={(name) => void addExercise(name)}
        onToggleFavorite={(name, on) => void run(() => actions.setExerciseFavorite(name, on))}
        onCreate={(name) => setCreating({ name: name ?? '' })}
        onClose={() => setPicking(false)}
      />
      <PlanSheet visible={planOpen} saved={plan.data} onSave={savePlan} onClose={() => setPlanOpen(false)} />
      <CustomExerciseSheet
        visible={creating !== null}
        initialName={creating?.name ?? ''}
        existing={customExercises.data.map((e) => e.name)}
        onCreate={createExercise}
        onClose={() => setCreating(null)}
      />
    </Screen>
  );
}
