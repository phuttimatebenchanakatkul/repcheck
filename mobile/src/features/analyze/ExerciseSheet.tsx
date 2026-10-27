import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { useExerciseFavorites, useCustomExercises } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { defaultSuggestions, exerciseByName, searchExercises } from '@/logic/workouts';
import { emojiForExercise } from '@/features/workouts/ExercisePicker';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Row, Sheet } from '@/ui/widgets';

const SECTION_LIMIT = 8;

/**
 * Choose the exercise a clip shows. The server grades any name, so the person's own exercises are offered beside the library's. With
 * nothing typed: what was analyzed lately, favourites, then a starter set; typing searches the library.
 */
export function ExerciseSheet({ visible, recent, onPick, onClose }: { visible: boolean; recent: readonly string[]; onPick: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const favorites = useExerciseFavorites().data;
  const custom = useCustomExercises().data;
  const customNames = custom.map((e) => e.name);
  const known = (name: string) => exerciseByName(name) !== undefined || customNames.includes(name);

  const typed = query.trim();
  const results = typed ? searchExercises(typed, new Set(favorites), customNames) : [];
  const sections = typed
    ? []
    : [
        { key: 'recent', title: t('analyze.recent'), items: recent.slice(0, SECTION_LIMIT) },
        { key: 'favorites', title: t('nutrition.favorites'), items: favorites.filter(known).slice(0, SECTION_LIMIT) },
        { key: 'suggested', title: t('workouts.suggestedTitle'), items: defaultSuggestions(6) },
      ].filter((section) => section.items.length > 0);

  const pick = (name: string) => {
    setQuery('');
    onPick(name);
  };
  const close = () => {
    setQuery('');
    onClose();
  };

  const row = (name: string, key: string) => (
    <Row key={key} onPress={() => pick(name)} label={name}>
      <Text style={{ fontSize: 26 }} accessibilityElementsHidden importantForAccessibility="no">
        {emojiForExercise(name, custom)}
      </Text>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" numberOfLines={1}>
          {name}
        </Text>
        {exerciseByName(name)?.category ? (
          <Text variant="caption" secondary numberOfLines={1}>
            {exerciseByName(name)?.category}
          </Text>
        ) : null}
      </View>
    </Row>
  );

  return (
    <Sheet visible={visible} title={t('analyze.chooseExercise')} closeLabel={t('common.close')} onClose={close}>
      <TextInput
        accessibilityLabel={t('analyze.searchPlaceholder')}
        placeholder={t('analyze.searchPlaceholder')}
        placeholderTextColor={colors.textSecondary}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 16 }}
      />
      {typed ? (
        results.length > 0 ? (
          results.map((name) => row(name, name))
        ) : (
          <Text variant="body" secondary>
            {t('analyze.noMatch', { query: typed })}
          </Text>
        )
      ) : (
        sections.map((section) => (
          <View key={section.key} style={{ gap: space.sm }}>
            <Text variant="eyebrow" secondary accessibilityRole="header">
              {section.title}
            </Text>
            {section.items.map((name) => row(name, `${section.key}-${name}`))}
          </View>
        ))
      )}
    </Sheet>
  );
}
