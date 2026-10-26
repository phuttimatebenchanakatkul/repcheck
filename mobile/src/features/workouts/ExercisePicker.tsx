import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import type { CustomExercise } from '@/api/endpoints';
import { useTranslation } from '@/i18n';
import type { CustomExerciseMode } from '@/logic/types';
import { defaultSuggestions, exerciseByName, searchExercises } from '@/logic/workouts';
import { Button, ErrorText, Field, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Row, Segmented, Sheet } from '@/ui/widgets';

const SECTION_LIMIT = 8;

export function emojiForExercise(name: string, custom: readonly CustomExercise[]): string {
  return custom.find((e) => e.name === name)?.emoji || exerciseByName(name)?.emoji || '💪';
}

/**
 * The "Log an exercise" sheet. Empty search: today's plan, favourites, what was done lately, a starter set. Typing: the person's own
 * exercises, then the library, favourites first. A tap logs it; the star keeps it among the favourites.
 */
export function ExercisePicker({
  visible,
  plan,
  favorites,
  customExercises,
  recent,
  onPick,
  onToggleFavorite,
  onCreate,
  onClose,
}: {
  visible: boolean;
  /** Today's plan: its day's label and exercises, or null. */
  plan: { label: string; exercises: readonly string[] } | null;
  favorites: readonly string[];
  customExercises: readonly CustomExercise[];
  recent: readonly string[];
  onPick: (name: string) => void;
  onToggleFavorite: (name: string, on: boolean) => void;
  onCreate: (name?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const favoriteSet = new Set(favorites);
  const customNames = customExercises.map((e) => e.name);
  const known = (name: string) => exerciseByName(name) !== undefined || customNames.includes(name);

  const results = query.trim() ? searchExercises(query, favoriteSet, customNames) : [];
  const sections = query.trim()
    ? []
    : [
        ...(plan ? [{ key: 'plan', title: `${t('workouts.plan.title')} · ${plan.label}`, items: plan.exercises.filter(known) }] : []),
        { key: 'favorites', title: t('nutrition.favorites'), items: favorites.filter(known).slice(0, SECTION_LIMIT) },
        { key: 'recent', title: t('nutrition.recent'), items: recent.filter(known).slice(0, SECTION_LIMIT) },
        { key: 'suggested', title: t('workouts.suggestedTitle'), items: defaultSuggestions(6) },
      ].filter((section) => section.items.length > 0);

  const pick = (name: string) => {
    setQuery('');
    onPick(name);
  };

  const row = (name: string, key: string) => {
    const favorite = favoriteSet.has(name);
    const category = exerciseByName(name)?.category;
    return (
      <Row key={key} onPress={() => pick(name)} label={name}>
        <Text style={{ fontSize: 26 }} accessibilityElementsHidden importantForAccessibility="no">
          {emojiForExercise(name, customExercises)}
        </Text>
        <View style={{ flex: 1 }}>
          <Text variant="rowTitle" numberOfLines={1}>
            {name}
          </Text>
          {category ? (
            <Text variant="caption" secondary numberOfLines={1}>
              {category}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${favorite ? t('app.nutrition.unfavorite') : t('app.nutrition.favorite')}: ${name}`}
          accessibilityState={{ selected: favorite }}
          onPress={() => onToggleFavorite(name, !favorite)}
          hitSlop={space.sm}
          style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22, color: favorite ? colors.amber.fill : colors.textSecondary }}>{favorite ? '★' : '☆'}</Text>
        </Pressable>
      </Row>
    );
  };

  return (
    <Sheet visible={visible} title={t('workouts.logExercise')} closeLabel={t('common.close')} onClose={() => { setQuery(''); onClose(); }}>
      <TextInput
        accessibilityLabel={t('workouts.search.placeholder')}
        placeholder={t('workouts.search.placeholder')}
        placeholderTextColor={colors.textSecondary}
        autoCorrect={false}
        returnKeyType="search"
        value={query}
        onChangeText={setQuery}
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 16 }}
      />
      {query.trim() ? (
        <>
          {results.map((name) => row(name, `result-${name}`))}
          {results.length === 0 && (
            <View style={{ gap: space.xs, paddingVertical: space.md }}>
              <Text variant="rowTitle">{t('workouts.search.noMatchTitle', { query: query.trim() })}</Text>
              <Text variant="body" secondary>
                {t('workouts.search.noMatchSub')}
              </Text>
            </View>
          )}
          {!customNames.includes(query.trim()) && <Button tone="plain" title={t('workouts.create.buttonNamed', { name: query.trim() })} onPress={() => onCreate(query.trim())} />}
        </>
      ) : (
        <>
          {sections.map((section) => (
            <View key={section.key} style={{ gap: space.sm }}>
              <Text variant="eyebrow" secondary accessibilityRole="header">
                {section.title}
              </Text>
              {section.items.map((name) => row(name, `${section.key}-${name}`))}
            </View>
          ))}
          <Button tone="plain" title={t('workouts.create.button')} onPress={() => onCreate()} />
        </>
      )}
    </Sheet>
  );
}

// -- a custom exercise ------------------------------------------------------------------------------------------------------------------

const MODES: readonly { value: CustomExerciseMode; label: 'workouts.create.modeBoth' | 'workouts.create.modeEach' | 'workouts.create.modeEither'; sub: 'workouts.create.modeBothSub' | 'workouts.create.modeEachSub' | 'workouts.create.modeEitherSub' }[] = [
  { value: 'both', label: 'workouts.create.modeBoth', sub: 'workouts.create.modeBothSub' },
  { value: 'each', label: 'workouts.create.modeEach', sub: 'workouts.create.modeEachSub' },
  { value: 'either', label: 'workouts.create.modeEither', sub: 'workouts.create.modeEitherSub' },
];

function CustomExerciseForm({ initialName, existing, onCreate }: { initialName: string; existing: readonly string[]; onCreate: (input: { name: string; emoji?: string; mode: CustomExerciseMode }) => Promise<void> }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState('');
  const [mode, setMode] = useState<CustomExerciseMode>('both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError(t('workouts.create.nameRequired'));
    if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return setError(t('workouts.create.duplicate'));
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: trimmed, emoji: emoji.trim() || undefined, mode });
    } catch (e) {
      setError(e instanceof Error && (e as { status?: number }).status ? e.message : t('workouts.create.failed'));
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <Field label={t('workouts.create.nameLabel')} placeholder={t('workouts.create.namePlaceholder')} value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label={t('workouts.create.emojiLabel')} value={emoji} onChangeText={setEmoji} maxLength={8} />
      <Text variant="eyebrow" secondary>
        {t('workouts.create.modeLabel')}
      </Text>
      <Segmented value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.value, label: t(m.label) }))} />
      <Text variant="caption" secondary>
        {t(MODES.find((m) => m.value === mode)?.sub ?? 'workouts.create.modeBothSub')}
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button title={t('workouts.create.save')} onPress={() => void submit()} loading={busy} />
    </View>
  );
}

export function CustomExerciseSheet({
  visible,
  initialName,
  existing,
  onCreate,
  onClose,
}: {
  visible: boolean;
  initialName: string;
  /** Names already taken (the person's own exercises). */
  existing: readonly string[];
  onCreate: (input: { name: string; emoji?: string; mode: CustomExerciseMode }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet visible={visible} title={t('workouts.create.button')} closeLabel={t('common.close')} onClose={onClose}>
      <CustomExerciseForm initialName={initialName} existing={existing} onCreate={onCreate} />
    </Sheet>
  );
}
