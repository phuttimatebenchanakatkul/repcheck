import { useRef, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { entryTotals, macroLine, scaledMacros } from '@/logic/macros';
import { iconForFood } from '@/logic/foodIcon';
import { removeIngredient, setDishTotal, setEntryGrams, setIngredientGrams } from '@/logic/foods';
import type { Ingredient, NutritionEntry } from '@/logic/types';
import { formatTime, localeFor, type UnitPrefs } from '@/logic/units';
import { Button, Card, Text } from '@/ui/components';
import { tap } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { AmountField } from './AmountField';

/** The line under a food's name: when it was logged, how much, how many calories. */
export function entrySub(entry: NutritionEntry, units: UnitPrefs, locale: string): string {
  return `${formatTime(entry.addedAt, units, locale)} • ${Math.round(entryTotals(entry).grams)}g • ${scaledMacros(entry).calories} kcal`;
}

function MiniMacros({ ingredient }: { ingredient: Ingredient }) {
  const m = scaledMacros(ingredient);
  return (
    <Text variant="caption" secondary>
      {m.calories} kcal · {macroLine(m)}
    </Text>
  );
}

/**
 * One logged food: a card that expands into its amount, its macros and (for a dish) its ingredients. Edits change a local draft
 * (the numbers update as the person types) and are SAVED when they leave a field, change the unit, or press Done, so typing
 * "150" is one write, not three.
 */
export function EntryCard({
  entry,
  expanded,
  favorite,
  units,
  onToggle,
  onFavorite,
  onSave,
  onDelete,
  onAddIngredient,
}: {
  entry: NutritionEntry;
  expanded: boolean;
  favorite: boolean;
  units: UnitPrefs;
  onToggle: () => void;
  onFavorite: (food: string, on: boolean) => void;
  onSave: (entry: NutritionEntry) => void;
  onDelete: (id: string) => void;
  onAddIngredient: (entry: NutritionEntry) => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const [draft, setDraftState] = useState(entry);
  const draftRef = useRef(entry);
  /** What was last saved (or opened with): a commit with nothing new since sends nothing. */
  const savedRef = useRef(entry);
  const [ingredientsOpen, setIngredientsOpen] = useState(true);
  /** Bumped when an ingredient changes the dish's total, so the Total field is re-read (it is not re-read while it is being typed in). */
  const [rev, setRev] = useState(0);

  // The card shows the saved entry when collapsed and the draft while it is open for editing.
  const shown = expanded ? draft : entry;
  const setDraft = (next: NutritionEntry) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const save = (next: NutritionEntry) => {
    savedRef.current = next;
    onSave(next);
  };
  const commit = () => {
    if (draftRef.current !== savedRef.current) save(draftRef.current);
  };
  const commitIngredient = () => {
    commit();
    setRev((n) => n + 1);
  };
  const toggle = () => {
    if (expanded) commit();
    else {
      savedRef.current = entry;
      setDraft(entry);
    }
    onToggle();
  };

  const macros = scaledMacros(shown);
  const dish = !!shown.ingredients && shown.ingredients.length > 0;
  const totals = entryTotals(shown);

  const confirmDelete = () =>
    Alert.alert(t('nutrition.deleteConfirm.title'), shown.food, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('nutrition.removeFood'), style: 'destructive', onPress: () => onDelete(entry.id) },
    ]);

  return (
    <View style={{ gap: space.sm }}>
      <Card style={{ padding: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingRight: space.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${entry.food}, ${expanded ? t('app.nutrition.hideDetails') : t('app.nutrition.showDetails')}`}
            accessibilityState={{ expanded }}
            onPress={toggle}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 64 }}>
            <Text style={{ fontSize: 28 }} accessibilityElementsHidden importantForAccessibility="no">
              {iconForFood(entry.food)}
            </Text>
            <View style={{ flex: 1 }}>
              <Text variant="rowTitle" numberOfLines={1}>
                {entry.food}
              </Text>
              <Text variant="caption" secondary>
                {entrySub(shown, units, locale)}
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={favorite ? t('app.nutrition.unfavorite') : t('app.nutrition.favorite')}
            accessibilityState={{ selected: favorite }}
            onPress={() => {
              tap();
              onFavorite(entry.food, !favorite);
            }}
            hitSlop={space.sm}
            style={{ width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 22, color: favorite ? colors.red.fill : colors.textSecondary }}>{favorite ? '♥' : '♡'}</Text>
          </Pressable>
        </View>
      </Card>

      {expanded && (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
            <Text variant="title" style={{ fontSize: 26 }} testID="entry-kcal">
              {macros.calories}
            </Text>
            <Text variant="body" secondary>
              kcal
            </Text>
            <Text variant="label" style={{ marginLeft: 'auto' }} testID="entry-macros">
              {macroLine(macros)}
            </Text>
          </View>

          {dish ? (
            <AmountField
              key={`total-${entry.id}-${rev}`}
              label={t('nutrition.amount.totalLabel')}
              grams={totals.grams}
              unit="g"
              units={['g']}
              onChange={(grams) => setDraft(setDishTotal(draftRef.current, grams))}
              onCommit={commit}
            />
          ) : (
            <AmountField
              key={`amount-${entry.id}`}
              label={t('nutrition.amount.label')}
              grams={shown.grams ?? 0}
              unit={shown.unit ?? 'g'}
              unitLabel={t('app.nutrition.unit')}
              onChange={(grams, unit) => setDraft(setEntryGrams(draftRef.current, grams, unit))}
              onCommit={commit}
            />
          )}

          {dish && (
            <View style={{ gap: space.sm }}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: ingredientsOpen }} onPress={() => setIngredientsOpen((open) => !open)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text variant="label" style={{ color: colors.link }}>
                  {t('nutrition.ingredientsCount', { n: shown.ingredients?.length ?? 0 })} · {ingredientsOpen ? t('nutrition.minimize') : t('nutrition.adjustAmounts')}
                </Text>
              </Pressable>
              {ingredientsOpen &&
                shown.ingredients?.map((ingredient, index) => (
                  <View key={`${ingredient.name}-${index}`} style={{ gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text variant="rowTitle" numberOfLines={1} style={{ flex: 1 }}>
                        {ingredient.name}
                      </Text>
                      {(shown.ingredients?.length ?? 0) > 1 && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${t('common.remove')} ${ingredient.name}`}
                          onPress={() => {
                            const next = removeIngredient(draftRef.current, index);
                            setDraft(next);
                            save(next);
                            setRev((n) => n + 1);
                          }}
                          hitSlop={space.sm}
                          style={{ minHeight: 44, justifyContent: 'center' }}>
                          <Text variant="label" style={{ color: colors.ink.red }}>
                            {t('common.remove')}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    <AmountField
                      key={`ing-${entry.id}-${index}-${ingredient.name}`}
                      label={ingredient.name}
                      grams={ingredient.grams}
                      unit={ingredient.unit ?? 'g'}
                      units={[ingredient.unit ?? 'g']}
                      onChange={(grams) => setDraft(setIngredientGrams(draftRef.current, index, grams))}
                      onCommit={commitIngredient}
                    />
                    <MiniMacros ingredient={ingredient} />
                  </View>
                ))}
            </View>
          )}

          <Button
            tone="plain"
            title={t('nutrition.addIngredient')}
            onPress={() => {
              onAddIngredient(draftRef.current);
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Button tone="plain" title={t('nutrition.removeFood')} onPress={confirmDelete} />
            <Button title={t('common.done')} onPress={toggle} />
          </View>
        </Card>
      )}
    </View>
  );
}
