import { useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';

import type { CustomExercise } from '@/api/endpoints';
import { useTranslation } from '@/i18n';
import { CATEGORIES, EXERCISES } from '@/logic/workouts';
import { Button, ErrorText, Field, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { emojiForExercise } from '../ExercisePicker';

/** With a search typed, at most this many matches are listed (the library has hundreds). */
export const MAX_MATCHES = 60;

/**
 * Pick exercises for a day: tick any number from the library (browsed by category) and the person's own. Done hands back the whole
 * selection. A new exercise made here is ticked straight away.
 */
export function ExerciseChecklist({
  initial,
  customExercises,
  onCreate,
  onDelete,
  onDone,
}: {
  initial: readonly string[];
  customExercises: readonly CustomExercise[];
  onCreate: (name: string) => Promise<CustomExercise>;
  /** Remove one of the person's own exercises (they confirm first). */
  onDelete: (exercise: CustomExercise) => Promise<void>;
  onDone: (selected: string[]) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [selected, setSelected] = useState<string[]>(() => [...initial]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const customNames = customExercises.map((e) => e.name);
  const customShown = customExercises.filter((e) => !q || e.name.toLowerCase().includes(q)).map((e) => e.name);
  const matches = q ? EXERCISES.filter((e) => e.name.toLowerCase().includes(q) && !customNames.includes(e.name)).map((e) => e.name).slice(0, MAX_MATCHES) : [];

  const toggle = (exercise: string) => setSelected((now) => (now.includes(exercise) ? now.filter((n) => n !== exercise) : [...now, exercise]));

  const row = (exercise: string, key: string) => {
    const on = selected.includes(exercise);
    return (
      <Pressable
        key={key}
        accessibilityRole="checkbox"
        accessibilityLabel={exercise}
        accessibilityState={{ checked: on }}
        onPress={() => toggle(exercise)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.sm }}>
        <Text style={{ width: 24, color: on ? colors.ink.green : colors.textSecondary }}>{on ? '☑' : '☐'}</Text>
        <Text style={{ fontSize: 22 }} accessibilityElementsHidden importantForAccessibility="no">
          {emojiForExercise(exercise, customExercises)}
        </Text>
        <Text variant="body" style={{ flex: 1 }}>
          {exercise}
        </Text>
        {customExercises.find((c) => c.name === exercise) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('common.remove')} ${exercise}`}
            hitSlop={space.sm}
            onPress={() => confirmDelete(exercise)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="title" secondary>
              ×
            </Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  const confirmDelete = (exercise: string) => {
    const mine = customExercises.find((c) => c.name === exercise);
    if (!mine) return;
    Alert.alert(t('workouts.deleteConfirm.title'), exercise, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: () => {
          setSelected((now) => now.filter((n) => n !== exercise));
          void onDelete(mine).catch(() => setError(t('workouts.create.failed')));
        },
      },
    ]);
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError(t('workouts.create.nameRequired'));
    setError(null);
    try {
      const made = await onCreate(trimmed);
      setSelected((now) => (now.includes(made.name) ? now : [...now, made.name]));
      setCreating(false);
      setName('');
    } catch (e) {
      setError(e instanceof Error && (e as { status?: number }).status ? e.message : t('workouts.create.failed'));
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <TextInput
        accessibilityLabel={t('workouts.search.placeholder')}
        placeholder={t('workouts.search.placeholder')}
        placeholderTextColor={colors.textSecondary}
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 16 }}
      />
      {creating ? (
        <View style={{ gap: space.sm }}>
          <Field label={t('workouts.wizard.exerciseName')} value={name} onChangeText={setName} maxLength={60} autoCapitalize="words" />
          <ErrorText>{error}</ErrorText>
          <Button title={t('common.save')} onPress={() => void create()} />
          <Button tone="plain" title={t('common.cancel')} onPress={() => setCreating(false)} />
        </View>
      ) : (
        <Button tone="plain" title={`+ ${t('workouts.wizard.createExercise')}`} onPress={() => setCreating(true)} />
      )}

      {customShown.filter((n) => q || !selected.includes(n)).length > 0 && (
        <View style={{ gap: space.xs }}>
          <Text variant="eyebrow" secondary accessibilityRole="header">
            {t('workouts.wizard.customExercises')}
          </Text>
          {customShown.filter((n) => q || !selected.includes(n)).map((exercise) => row(exercise, `custom-${exercise}`))}
        </View>
      )}

      {!q && selected.length > 0 && (
        <View style={{ gap: space.xs }}>
          <Text variant="eyebrow" secondary accessibilityRole="header">
            {t('app.plan.selected', { n: selected.length })}
          </Text>
          {selected.map((exercise) => row(exercise, `selected-${exercise}`))}
        </View>
      )}

      {q ? (
        <View style={{ gap: space.xs }}>
          {matches.map((exercise) => row(exercise, `match-${exercise}`))}
          {matches.length === 0 && customShown.length === 0 && <Text variant="body" secondary>{t('workouts.search.noMatchTitle', { query: query.trim() })}</Text>}
        </View>
      ) : (
        CATEGORIES.map((category) => {
          const names = EXERCISES.filter((e) => e.category === category && !customNames.includes(e.name)).map((e) => e.name);
          const expanded = open === category;
          const count = names.filter((n) => selected.includes(n)).length;
          return (
            <View key={category} style={{ gap: space.xs }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={category}
                onPress={() => setOpen(expanded ? null : category)}
                style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: space.sm }}>
                <Text variant="eyebrow" secondary style={{ flex: 1 }}>
                  {category}
                  {count ? ` · ${count}` : ''}
                </Text>
                <Text secondary>{expanded ? '⌃' : '⌄'}</Text>
              </Pressable>
              {expanded && names.filter((n) => !selected.includes(n)).map((exercise) => row(exercise, `${category}-${exercise}`))}
            </View>
          );
        })
      )}

      <Button title={selected.length ? t('workouts.wizard.doneWithCount', { n: selected.length }) : t('common.done')} onPress={() => onDone(selected)} />
    </View>
  );
}
