import { useRef, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { formatTime, kgToDisplay, displayToKg, localeFor, weightUnitLabel, type UnitPrefs } from '@/logic/units';
import type { WorkoutEntry, WorkoutSet } from '@/logic/types';
import {
  blankSet,
  collapseOneSided,
  entryIsComplete,
  isBodyweight,
  newSetCarryingWeight,
  repsSummary,
  setUnilateral,
  showsUnilateralToggle,
  topWeightKg,
  type CustomExerciseMeta,
} from '@/logic/workouts';
import { Button, Card, Text } from '@/ui/components';
import { success, tap } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Segmented } from '@/ui/widgets';

/** The line under an exercise's name: when it was logged, the heaviest weight, and the sets so far. */
export function workoutSub(entry: WorkoutEntry, units: UnitPrefs, locale: string, t: Parameters<typeof repsSummary>[1]): string {
  const top = topWeightKg(entry);
  const weight = top !== null ? `${kgToDisplay(top, units)} ${weightUnitLabel(units)} • ` : '';
  return `${formatTime(entry.addedAt, units, locale)} • ${weight}${repsSummary(entry, t)}`;
}

/** A typed weight (in the person's unit) as kg, or null for blank/unreadable/negative. */
export function parseWeight(text: string, units: UnitPrefs): number | null {
  const kg = displayToKg(text, units);
  return Number.isFinite(kg) && kg >= 0 ? kg : null;
}

/** A typed rep count: a whole number from 0, or null. */
export function parseReps(text: string): number | null {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function NumberInput({ label, text, suffix, onText, onCommit }: { label: string; text: string; suffix: string; onText: (text: string) => void; onCommit: () => void }) {
  const { colors } = useTheme();
  const [value, setValue] = useState(text);
  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <TextInput
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        selectTextOnFocus
        placeholder="0"
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={(next) => {
          setValue(next);
          onText(next);
        }}
        onEndEditing={onCommit}
        style={{ flex: 1, minHeight: 44, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.sm, fontSize: 16, textAlign: 'center', fontVariant: ['tabular-nums'] }}
      />
      <Text variant="caption" secondary>
        {suffix}
      </Text>
    </View>
  );
}

/**
 * One logged exercise: a card that opens into its sets. Typing changes a local draft (the summary updates as you type); the draft is
 * SAVED when you leave a field, add or remove a set, switch sides, or press Done.
 */
export function WorkoutCard({
  entry,
  expanded,
  units,
  custom,
  emoji,
  onToggle,
  onSave,
  onDelete,
}: {
  entry: WorkoutEntry;
  expanded: boolean;
  units: UnitPrefs;
  custom: CustomExerciseMeta;
  emoji: string;
  onToggle: () => void;
  onSave: (entry: WorkoutEntry) => void;
  onDelete: (id: string) => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const unit = weightUnitLabel(units);
  const [draft, setDraftState] = useState(entry);
  const draftRef = useRef(entry);
  const savedRef = useRef(entry);
  /** Bumped when sets are added or removed or the mode switches, so each field is re-read (a field is never re-read while typed in). */
  const [rev, setRev] = useState(0);

  const shown = expanded ? draft : collapseOneSided(entry, custom);
  const setDraft = (next: WorkoutEntry) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const save = (next: WorkoutEntry) => {
    savedRef.current = next;
    onSave(next);
  };
  const commit = () => {
    if (draftRef.current !== savedRef.current) save(draftRef.current);
  };
  const structural = (next: WorkoutEntry) => {
    setDraft(next);
    save(next);
    setRev((n) => n + 1);
  };
  const toggle = () => {
    if (expanded) commit();
    else {
      const start = collapseOneSided(entry, custom);
      savedRef.current = entry;
      setDraft(start);
    }
    onToggle();
  };

  const bodyweight = isBodyweight(entry.exercise);
  const eachSide = shown.unilateral;
  const complete = entryIsComplete(shown);

  const editSet = (index: number, patch: Partial<WorkoutSet>) => {
    const current = draftRef.current;
    const next = { ...current, sets: current.sets.map((s, i) => (i === index ? { ...s, ...patch } : s)) };
    if (!entryIsComplete(current) && entryIsComplete(next)) success(); // the last rep count went in: the exercise is done
    setDraft(next);
  };

  const confirmDelete = () =>
    Alert.alert(t('workouts.deleteConfirm.title'), entry.exercise, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('workouts.exercise.removeExercise'), style: 'destructive', onPress: () => onDelete(entry.id) },
    ]);

  const field = (kind: 'weight' | 'reps', set: WorkoutSet, index: number, side: 'both' | 'left' | 'right') => {
    const key = `${kind}-${side}-${index}-${rev}`;
    if (kind === 'weight') {
      const kg = side === 'left' ? set.leftKg : side === 'right' ? set.rightKg : set.weightKg;
      const prop = side === 'left' ? 'leftKg' : side === 'right' ? 'rightKg' : 'weightKg';
      return (
        <NumberInput
          key={key}
          label={`${t('workouts.exercise.setN', { n: index + 1 })} ${unit}${side === 'both' ? '' : ` ${side === 'left' ? t('workouts.exercise.left') : t('workouts.exercise.right')}`}`}
          text={kg === null ? '' : String(kgToDisplay(kg, units))}
          suffix={unit}
          onText={(text) => editSet(index, { [prop]: parseWeight(text, units) })}
          onCommit={commit}
        />
      );
    }
    const reps = side === 'left' ? set.leftReps : side === 'right' ? set.rightReps : set.reps;
    const prop = side === 'left' ? 'leftReps' : side === 'right' ? 'rightReps' : 'reps';
    return (
      <NumberInput
        key={key}
        label={`${t('workouts.exercise.setN', { n: index + 1 })} ${t('workouts.exercise.repsLabel')}${side === 'both' ? '' : ` ${side === 'left' ? t('workouts.exercise.left') : t('workouts.exercise.right')}`}`}
        text={reps === null ? '' : String(reps)}
        suffix={t('workouts.exercise.repsLabel')}
        onText={(text) => editSet(index, { [prop]: parseReps(text) })}
        onCommit={commit}
      />
    );
  };

  const line = (set: WorkoutSet, index: number, side: 'both' | 'left' | 'right') => (
    <View key={`${side}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {side !== 'both' && (
        <Text variant="label" secondary style={{ width: 18 }}>
          {side === 'left' ? t('workouts.exercise.left') : t('workouts.exercise.right')}
        </Text>
      )}
      {!bodyweight && field('weight', set, index, side)}
      {!bodyweight && <Text variant="body" secondary>×</Text>}
      {field('reps', set, index, side)}
    </View>
  );

  return (
    <View style={{ gap: space.sm }}>
      <Card style={{ padding: 0, borderColor: complete ? colors.green.fill : colors.border }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${entry.exercise}, ${expanded ? t('app.nutrition.hideDetails') : t('app.nutrition.showDetails')}${complete ? ', ✓' : ''}`}
          accessibilityState={{ expanded }}
          onPress={toggle}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64 }}>
          <View>
            <Text style={{ fontSize: 28 }} accessibilityElementsHidden importantForAccessibility="no">
              {emoji}
            </Text>
            {complete && (
              <Text style={{ position: 'absolute', right: -6, bottom: -4, fontSize: 14, color: colors.ink.green }} accessibilityElementsHidden importantForAccessibility="no" testID="complete-check">
                ✓
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="rowTitle" numberOfLines={1}>
              {entry.exercise}
            </Text>
            <Text variant="caption" secondary>
              {workoutSub(shown, units, locale, t)}
            </Text>
          </View>
        </Pressable>
      </Card>

      {expanded && (
        <Card>
          {showsUnilateralToggle(entry.exercise, custom) && (
            <Segmented
              value={eachSide ? 'each' : 'both'}
              onChange={(mode) => structural(setUnilateral(draftRef.current, mode === 'each'))}
              options={[
                { value: 'both', label: t('workouts.exercise.bothSides') },
                { value: 'each', label: t('workouts.exercise.eachSide') },
              ]}
            />
          )}
          {shown.sets.map((set, index) => (
            <View key={`set-${index}-${rev}`} style={{ gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label">{t('workouts.exercise.setN', { n: index + 1 })}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('common.remove')} ${t('workouts.exercise.setN', { n: index + 1 })}`}
                  onPress={() => structural({ ...draftRef.current, sets: draftRef.current.sets.filter((_, i) => i !== index) })}
                  hitSlop={space.sm}
                  style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Text variant="title" secondary>
                    ×
                  </Text>
                </Pressable>
              </View>
              {eachSide ? (
                <>
                  {line(set, index, 'left')}
                  {line(set, index, 'right')}
                </>
              ) : (
                line(set, index, 'both')
              )}
            </View>
          ))}
          <Button
            tone="plain"
            title={t('workouts.exercise.addSet')}
            onPress={() => {
              tap();
              structural({ ...draftRef.current, sets: [...draftRef.current.sets, draftRef.current.sets.length ? newSetCarryingWeight(draftRef.current.sets) : blankSet()] });
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button tone="plain" title={t('workouts.exercise.removeExercise')} onPress={confirmDelete} />
            <Button title={t('common.done')} onPress={toggle} />
          </View>
        </Card>
      )}
    </View>
  );
}
