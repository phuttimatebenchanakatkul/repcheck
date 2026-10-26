import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { CustomExercise } from '@/api/endpoints';
import { useTranslation } from '@/i18n';
import { parseIso } from '@/logic/dates';
import {
  MAX_REPS,
  MAX_SETS,
  MONDAY_FIRST,
  REST,
  assignDay,
  dayFor,
  isEdited,
  prescriptionFor,
  removeDayExercise,
  resetPrescription,
  setPrescription,
  standardPrescription,
  type Weekday,
} from '@/logic/splitPlan';
import type { SplitPlan } from '@/logic/types';
import { localeFor } from '@/logic/units';
import { Button, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Chip } from '@/ui/widgets';

import { emojiForExercise } from '../ExercisePicker';

/** A date in the week of 2026-10-26 (a Monday) that falls on each weekday: only used to ask the locale for the weekday's name. */
const WEEKDAY_SAMPLE: Record<Weekday, string> = { monday: '2026-10-26', tuesday: '2026-10-27', wednesday: '2026-10-28', thursday: '2026-10-29', friday: '2026-10-30', saturday: '2026-10-31', sunday: '2026-11-01' };

function NumberBox({ label, value, standard, edited, max, onCommit }: { label: string; value: number; standard: number; edited: boolean; max: number; onCommit: (value: number) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [text, setText] = useState(String(value));
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <Text variant="eyebrow" secondary>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={2}
        value={text}
        onChangeText={setText}
        onEndEditing={() => {
          const n = Number.parseInt(text, 10);
          if (Number.isFinite(n) && n > 0) {
            onCommit(Math.min(n, max));
            setText(String(Math.min(n, max)));
          } else {
            setText(String(value)); // a blank or zero field snaps back to the last good number
          }
        }}
        style={{ minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: edited ? colors.green.fill : colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 18, textAlign: 'center' }}
      />
      <Text variant="caption" secondary>
        {t('workouts.wizard.standardValue', { n: standard })}
      </Text>
    </View>
  );
}

/**
 * A week of workouts to look at and change: pick a weekday, say what is on it (any of the plan's days, or Rest), and edit that day's
 * exercises (add, remove, and each one's sets and reps). Every change goes out through `onChange` as a whole new plan.
 */
export function PlanEditor({
  plan,
  initialWeekday,
  today,
  customExercises,
  onChange,
  onPickExercises,
}: {
  plan: SplitPlan;
  initialWeekday: Weekday;
  /** The weekday that is today, marked in the strip. */
  today?: Weekday;
  customExercises: readonly CustomExercise[];
  onChange: (plan: SplitPlan) => void;
  /** Open the picker for this day's exercises. */
  onPickExercises: (label: string) => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const [weekday, setWeekday] = useState<Weekday>(initialWeekday);
  const [editing, setEditing] = useState<string | null>(null);

  const name = (key: Weekday, style: 'long' | 'short') => (parseIso(WEEKDAY_SAMPLE[key]) as Date).toLocaleDateString(locale, { weekday: style });
  const day = dayFor(plan, weekday);
  const label = plan.schedule[weekday];
  const rest = !day;
  const labels = plan.days.map((d) => d.label);
  const heading = rest
    ? t('workouts.plan.dayPlanLabelRest', { weekday: today === weekday ? t('workouts.plan.today') : name(weekday, 'long') })
    : t('workouts.plan.dayPlanLabel', { weekday: today === weekday ? t('workouts.plan.today') : name(weekday, 'long'), label: day.label });

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {MONDAY_FIRST.map((key) => {
          const trains = !!dayFor(plan, key);
          const selected = key === weekday;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${name(key, 'long')}${trains ? `, ${plan.schedule[key]}` : `, ${t('workouts.wizard.rest')}`}`}
              accessibilityState={{ selected }}
              onPress={() => {
                setWeekday(key);
                setEditing(null);
              }}
              style={{ width: 44, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.md, backgroundColor: selected ? colors.buttonFill : 'transparent' }}>
              <Text variant="label" style={{ color: selected ? '#ffffff' : key === today ? colors.ink.green : colors.text }}>
                {name(key, 'short')}
              </Text>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: trains ? (selected ? '#ffffff' : colors.green.fill) : colors.border }} />
            </Pressable>
          );
        })}
      </View>

      <Text variant="rowTitle" accessibilityRole="header">
        {heading}
      </Text>

      <View style={{ gap: space.sm }}>
        <Text variant="eyebrow" secondary>
          {t('app.plan.whatsOnThisDay')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {[...labels, REST].map((option) => (
            <Chip
              key={option}
              label={option === REST ? t('workouts.wizard.rest') : option}
              selected={option === (rest ? REST : label)}
              onPress={() => {
                setEditing(null);
                onChange({ ...plan, schedule: assignDay(plan.schedule, weekday, option) });
              }}
            />
          ))}
        </View>
      </View>

      {rest ? (
        <Text variant="body" secondary>
          {t('workouts.wizard.restDayNote')}
        </Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {day.exercises.length === 0 && (
            <Text variant="body" secondary>
              {t('workouts.plan.noExercisesText')}
            </Text>
          )}
          {day.exercises.map((exercise, index) => {
            const p = prescriptionFor(plan.exercisePrescriptions, day.label, exercise);
            const std = standardPrescription(exercise);
            const edited = isEdited(plan.exercisePrescriptions, day.label, exercise);
            const open = editing === exercise;
            return (
              <View key={`${exercise}-${index}`} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.sm }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${exercise}, ${p.sets}×${p.reps}`}
                    accessibilityState={{ expanded: open }}
                    onPress={() => setEditing(open ? null : exercise)}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, padding: space.md }}>
                    <Text style={{ fontSize: 24 }} accessibilityElementsHidden importantForAccessibility="no">
                      {emojiForExercise(exercise, customExercises)}
                    </Text>
                    <Text variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
                      {exercise}
                    </Text>
                    <Text variant="label" secondary>
                      {p.sets}×{p.reps}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t('common.remove')} ${exercise}`}
                    hitSlop={space.sm}
                    onPress={() => {
                      setEditing(null);
                      onChange(removeDayExercise(plan, day.label, index));
                    }}
                    style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                    <Text variant="title" secondary>
                      ×
                    </Text>
                  </Pressable>
                </View>
                {open && (
                  <View style={{ gap: space.md, padding: space.md, paddingTop: 0 }}>
                    <View style={{ flexDirection: 'row', gap: space.md }}>
                      <NumberBox
                        key={`sets-${day.label}-${exercise}-${p.sets}`}
                        label={t('workouts.wizard.sets')}
                        value={p.sets}
                        standard={std.sets}
                        edited={edited.sets}
                        max={MAX_SETS}
                        onCommit={(sets) => onChange({ ...plan, exercisePrescriptions: setPrescription(plan.exercisePrescriptions, day.label, exercise, { sets }) })}
                      />
                      <NumberBox
                        key={`reps-${day.label}-${exercise}-${p.reps}`}
                        label={t('workouts.wizard.reps')}
                        value={p.reps}
                        standard={std.reps}
                        edited={edited.reps}
                        max={MAX_REPS}
                        onCommit={(reps) => onChange({ ...plan, exercisePrescriptions: setPrescription(plan.exercisePrescriptions, day.label, exercise, { reps }) })}
                      />
                    </View>
                    {(edited.sets || edited.reps) && (
                      <Button tone="plain" title={t('workouts.wizard.resetToStandard')} onPress={() => onChange({ ...plan, exercisePrescriptions: resetPrescription(plan.exercisePrescriptions, day.label, exercise) })} />
                    )}
                  </View>
                )}
              </View>
            );
          })}
          <Button tone="plain" title={t('workouts.wizard.pickExercises')} onPress={() => onPickExercises(day.label)} />
        </View>
      )}
    </View>
  );
}
