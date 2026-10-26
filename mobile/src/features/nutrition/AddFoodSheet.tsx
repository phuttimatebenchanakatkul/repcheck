import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';

import type { CustomFood } from '@/api/endpoints';
import { useTranslation } from '@/i18n';
import { candidateEntry, candidateGrams, candidateIsDish, findCandidate, searchCandidates, type Candidate } from '@/logic/candidates';
import { iconForFood } from '@/logic/foodIcon';
import { foodByName } from '@/logic/foods';
import { macroLine, scaledMacros } from '@/logic/macros';
import { recentFoods, topPicksForHour } from '@/logic/suggestions';
import type { FoodUnit, NutritionEntry } from '@/logic/types';
import { formatHourLabel, type UnitPrefs } from '@/logic/units';
import { newId } from '@/logic/ids';
import { Button, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Chip, Row, Segmented, Sheet } from '@/ui/widgets';

import { AmountField } from './AmountField';

const SECTION_LIMIT = 8;

function emojiFor(candidate: Candidate): string {
  return candidate.kind === 'custom' ? candidate.food.emoji || '🍽️' : iconForFood(candidate.name);
}

function describe(candidate: Candidate): string {
  if (candidate.kind === 'library') {
    return `${candidate.food.calories} kcal · ${macroLine(candidate.food)} / 100 g`;
  }
  if (candidate.kind === 'custom') return `${Math.round(candidate.food.calories)} kcal · ${macroLine(candidate.food)} / ${candidate.food.servingLabel}`;
  const m = scaledMacros(candidate.entry);
  return `${m.calories} kcal · ${macroLine(m)}`;
}

/**
 * The "Log a food" sheet. Empty search: the person's favourites, what they usually eat around now, and what they logged lately.
 * Typing: matches from the shared library and their own foods. Choosing one asks for the amount, then logs it. In ingredient mode
 * (adding to a dish) a tap adds the library food as another ingredient straight away.
 */
function AddFoodBody({
  mode,
  day,
  hour,
  favorites,
  customFoods,
  logged,
  units,
  now = () => new Date(),
  onAdd,
  onAddIngredient,
  onCreateFood,
  onQuickAdd,
  onScan,
}: {
  mode: 'entry' | 'ingredient';
  day: string;
  /** Logged from a specific hour row: filed on that hour. */
  hour?: number;
  favorites: readonly string[];
  customFoods: readonly CustomFood[];
  /** Everything the person has logged lately (any order). */
  logged: readonly NutritionEntry[];
  units: UnitPrefs;
  now?: () => Date;
  onAdd: (entry: NutritionEntry) => void;
  onAddIngredient: (foodName: string) => void;
  onCreateFood: () => void;
  onQuickAdd: () => void;
  onScan: (mode: 'meal' | 'barcode') => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'custom'>('all');
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [grams, setGrams] = useState(100);
  const [unit, setUnit] = useState<FoodUnit>('g');
  const [amountKey, setAmountKey] = useState(0);

  const sources = useMemo(() => ({ custom: customFoods, logged }), [customFoods, logged]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const entryMode = mode === 'entry';
  const hourNow = hour ?? now().getHours();

  const resolve = (names: readonly string[]): Candidate[] =>
    names
      .map((name) => findCandidate(name, sources))
      .filter((c): c is Candidate => c !== null && (entryMode || c.kind === 'library'))
      .slice(0, SECTION_LIMIT);

  const results = query.trim() ? searchCandidates(query, favoriteSet, entryMode ? customFoods : [], entryMode ? scope : 'all') : [];
  const sections = query.trim()
    ? []
    : [
        { key: 'favorites', title: t('nutrition.favorites'), items: resolve(favorites) },
        { key: 'top', title: t('nutrition.topPicksForHour', { hour: formatHourLabel(hourNow, units) }), items: resolve(topPicksForHour(logged, hourNow, SECTION_LIMIT)) },
        { key: 'recent', title: t('nutrition.recent'), items: resolve(recentFoods(logged, SECTION_LIMIT)) },
      ].filter((section) => section.items.length > 0 && !(scope === 'custom' && entryMode));

  const choose = (candidate: Candidate) => {
    if (!entryMode) {
      if (foodByName(candidate.name)) onAddIngredient(candidate.name);
      return;
    }
    setChosen(candidate);
    setGrams(candidateGrams(candidate));
    setUnit('g');
    setAmountKey((n) => n + 1);
  };

  const preview = chosen ? candidateEntry(chosen, { id: 'preview', day, now: now(), hour, grams, unit }) : null;
  const previewMacros = preview ? scaledMacros(preview) : null;

  const add = () => {
    if (!chosen) return;
    const entry = candidateEntry(chosen, { id: newId(), day, now: now(), hour, grams, unit });
    success();
    onAdd(entry); // the sheet closes when the log accepts it; if it cannot, the amount step stays as it was
  };

  const candidateRow = (candidate: Candidate, key: string) => (
    <Row key={key} onPress={() => choose(candidate)} label={`${candidate.name}, ${describe(candidate)}`}>
      <Text style={{ fontSize: 26 }} accessibilityElementsHidden importantForAccessibility="no">
        {emojiFor(candidate)}
      </Text>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" numberOfLines={1}>
          {candidate.name}
        </Text>
        <Text variant="caption" secondary numberOfLines={1}>
          {describe(candidate)}
        </Text>
      </View>
    </Row>
  );

  return (
    <>
      {chosen && preview && previewMacros ? (
        <View style={{ gap: space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <Text style={{ fontSize: 40 }}>{emojiFor(chosen)}</Text>
            <View style={{ flex: 1 }}>
              <Text variant="rowTitle" numberOfLines={2}>
                {chosen.name}
              </Text>
              <Text variant="title" style={{ fontSize: 28 }} testID="preview-kcal">
                {previewMacros.calories} kcal
              </Text>
              <Text variant="label" secondary testID="preview-macros">
                {macroLine(previewMacros)}
              </Text>
            </View>
          </View>
          <AmountField
            key={`amount-${amountKey}`}
            label={candidateIsDish(chosen) ? t('nutrition.amount.totalLabel') : t('nutrition.amount.label')}
            grams={grams}
            unit={unit}
            units={candidateIsDish(chosen) ? ['g'] : undefined}
            unitLabel={t('app.nutrition.unit')}
            onChange={(g, u) => {
              setGrams(g);
              setUnit(u);
            }}
          />
          {chosen.kind === 'custom' && (
            <View style={{ gap: space.sm }}>
              <Text variant="eyebrow" secondary>
                {t('app.nutrition.servings')}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {[{ label: chosen.food.servingLabel, grams: chosen.food.servingGrams }, ...chosen.food.servings].map((serving) => (
                  <Chip
                    key={`${serving.label}-${serving.grams}`}
                    label={`${serving.label} · ${Math.round(serving.grams)} g`}
                    selected={Math.abs(serving.grams - grams) < 0.05}
                    onPress={() => {
                      setGrams(serving.grams);
                      setUnit('g');
                      setAmountKey((n) => n + 1);
                    }}
                  />
                ))}
              </View>
            </View>
          )}
          <Button title={t('app.nutrition.add')} onPress={add} disabled={!(grams > 0)} />
          <Button tone="plain" title={t('common.back')} onPress={() => setChosen(null)} />
        </View>
      ) : (
        <View style={{ gap: space.md }}>
          <TextInput
            accessibilityLabel={t('nutrition.search.placeholder')}
            placeholder={t('nutrition.search.placeholder')}
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
            value={query}
            onChangeText={setQuery}
            style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: space.md, fontSize: 16 }}
          />
          {entryMode && (
            <Segmented
              label={t('app.nutrition.scope')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: t('nutrition.scope.all') },
                { value: 'custom', label: t('nutrition.scope.custom') },
              ]}
            />
          )}

          {query.trim() ? (
            results.length ? (
              results.map((candidate) => candidateRow(candidate, `${candidate.kind}-${candidate.name}`))
            ) : (
              <View style={{ gap: space.xs, paddingVertical: space.lg }}>
                <Text variant="rowTitle">{t('nutrition.noMatchTitle', { query: query.trim() })}</Text>
                <Text variant="body" secondary>
                  {t('nutrition.noMatchSub')}
                </Text>
              </View>
            )
          ) : (
            <>
              {sections.map((section) => (
                <View key={section.key} style={{ gap: space.sm }}>
                  <Text variant="eyebrow" secondary accessibilityRole="header">
                    {section.title}
                  </Text>
                  {section.items.map((candidate) => candidateRow(candidate, `${section.key}-${candidate.kind}-${candidate.name}`))}
                </View>
              ))}
              {scope === 'custom' && entryMode && customFoods.length === 0 && (
                <Text variant="body" secondary>
                  {t('nutrition.custom.empty')}
                </Text>
              )}
              {scope === 'custom' && entryMode && customFoods.map((food) => candidateRow({ kind: 'custom', name: food.name, food }, `own-${food.id}`))}
              {sections.length === 0 && scope === 'all' && (
                <Text variant="body" secondary>
                  {t('nutrition.searchToAdd')}
                </Text>
              )}
            </>
          )}

          {entryMode && (
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Row onPress={() => onScan('meal')} label={t('mobile.scanMeal')}>
                <View style={{ flex: 1 }}>
                  <Text variant="rowTitle">{t('mobile.scanMeal')}</Text>
                  <Text variant="caption" secondary>
                    {t('mobile.scanMealSub')}
                  </Text>
                </View>
              </Row>
              <Row onPress={() => onScan('barcode')} label={t('mobile.scanBarcode')}>
                <View style={{ flex: 1 }}>
                  <Text variant="rowTitle">{t('mobile.scanBarcode')}</Text>
                  <Text variant="caption" secondary>
                    {t('mobile.scanBarcodeSub')}
                  </Text>
                </View>
              </Row>
              <Row onPress={onCreateFood} label={t('nutrition.custom.create')}>
                <View style={{ flex: 1 }}>
                  <Text variant="rowTitle">{t('nutrition.custom.create')}</Text>
                  <Text variant="caption" secondary>
                    {t('nutrition.custom.createSub')}
                  </Text>
                </View>
              </Row>
              <Row onPress={onQuickAdd} label={t('nutrition.manualMacro.button')}>
                <View style={{ flex: 1 }}>
                  <Text variant="rowTitle">{t('nutrition.manualMacro.button')}</Text>
                  <Text variant="caption" secondary>
                    {t('nutrition.manualMacro.sub')}
                  </Text>
                </View>
              </Row>
            </View>
          )}
        </View>
      )}
    </>
  );
}

type SheetProps = Parameters<typeof AddFoodBody>[0] & { visible: boolean; onClose: () => void };

export function AddFoodSheet({ visible, onClose, ...body }: SheetProps) {
  const { t } = useTranslation();
  const title = body.mode === 'ingredient' ? t('nutrition.modal.addIngredient') : body.hour !== undefined ? t('nutrition.modal.addFoodAt', { hour: formatHourLabel(body.hour, body.units) }) : t('nutrition.modal.logFoodNow');
  return (
    <Sheet visible={visible} title={title} closeLabel={t('common.close')} onClose={onClose}>
      <AddFoodBody {...body} />
    </Sheet>
  );
}
