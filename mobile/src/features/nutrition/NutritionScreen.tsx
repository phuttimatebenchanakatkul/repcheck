import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import type { NewCustomFood } from '@/api/endpoints';
import { useActions, useCustomFoods, useFoodFavorites, useGoals, useNutritionDay, useNutritionRecent, useSettings } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { toIsoDate } from '@/logic/dates';
import { dayTitle } from '@/logic/dayTitle';
import { addIngredient } from '@/logic/foods';
import { sumMacrosForDay } from '@/logic/macros';
import type { NutritionEntry } from '@/logic/types';
import { localeFor } from '@/logic/units';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { space } from '@/ui/tokens';

import { useCheckinStatus } from '@/features/coaching/useCheckin';

import { AddFoodSheet } from './AddFoodSheet';
import { DateStrip } from '@/ui/DateStrip';
import { EntryCard } from './EntryCard';
import { CustomFoodSheet, GoalsSheet, QuickAddSheet } from './forms';
import { ScanSheet } from './ScanSheet';
import { TotalsCard } from './TotalsCard';

type Adding = { mode: 'entry' } | { mode: 'ingredient'; target: NutritionEntry };

/**
 * The food log for a day: calories and macros against the goals, the day's foods (each opens to its amount and ingredients), and the
 * sheet that logs another. Everything shown is the saved copy plus this device's still-waiting changes, so it works with no signal.
 */
export default function NutritionScreen() {
  const { t, language } = useTranslation();
  const locale = localeFor(language);
  const today = toIsoDate(new Date());
  const [day, setDay] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [scanning, setScanning] = useState<'meal' | 'barcode' | null>(null);
  /** Set when a scanned barcode matched nothing and the person is making that food themselves. */
  const [barcode, setBarcode] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when an ingredient is added from outside the card, so the open card is rebuilt from the saved dish instead of its draft. */
  const [rev, setRev] = useState(0);

  const entries = useNutritionDay(day);
  const goals = useGoals();
  const favorites = useFoodFavorites();
  const recent = useNutritionRecent();
  const settings = useSettings();
  const custom = useCustomFoods();
  const actions = useActions();
  const router = useRouter();
  const checkin = useCheckinStatus(today);

  const loggedDays = new Set(recent.data.map((entry) => entry.day));
  if (entries.data.length) loggedDays.add(day);
  const totals = sumMacrosForDay(entries.data);
  const favoriteSet = new Set(favorites.data);

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

  const save = (entry: NutritionEntry) => run(() => actions.saveFood(day, entry));

  const addEntry = async (entry: NutritionEntry) => {
    if (await save(entry)) {
      setExpanded(entry.id);
      setAdding(null);
      setQuickOpen(false);
      setScanning(null);
    }
  };

  const addIngredientTo = async (target: NutritionEntry, foodName: string) => {
    const next = addIngredient(target, foodName);
    if (next && (await save(next))) {
      setRev((n) => n + 1);
      setExpanded(next.id);
      setAdding(null);
    }
  };

  const createFood = async (food: NewCustomFood) => {
    await actions.createCustomFood(food); // the sheet shows the server's reason if it refuses
    setCustomOpen(false);
    setBarcode(undefined);
  };

  return (
    <Screen>
      <OfflineBanner />
      <DateStrip selected={day} today={today} loggedDays={loggedDays} loggedLabel={(date) => t('app.nutrition.dayLogged', { day: date })} onSelect={setDay} />

      <TotalsCard totals={totals} goals={goals.data} onEditGoals={() => setGoalsOpen(true)} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Button tone="plain" title={t('home.macros.fullStats')} onPress={() => router.push('/full-stats')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button tone="plain" title={t('weight.loggingHistoryTitle')} onPress={() => router.push('/logging-history')} />
        </View>
      </View>

      {checkin.daysRemaining === null ? null : checkin.daysRemaining === 0 ? (
        <Card>
          <Text variant="rowTitle">{t('coaching.checkin.title')}</Text>
          <Text variant="body" secondary>
            {t('coaching.checkin.sub')}
          </Text>
          <Button title={t('coaching.checkin.button')} onPress={() => router.push('/checkin')} />
        </Card>
      ) : (
        <Text variant="caption" secondary testID="checkin-wait">
          {t('coaching.checkin.comeBackIn', { n: checkin.daysRemaining, s: checkin.daysRemaining === 1 ? '' : 's' })}
        </Text>
      )}

      <View style={{ gap: space.xs }}>
        <Text variant="title" style={{ fontSize: 22 }} accessibilityRole="header">
          {dayTitle(day, today, locale, { today: t('nutrition.day.today'), yesterday: t('nutrition.day.yesterday') })}
        </Text>
        {entries.data.length > 0 && (
          <Text variant="body" secondary>
            {t('nutrition.day.items', { n: entries.data.length, s: entries.data.length === 1 ? '' : 's' })} · {totals.calories} kcal
          </Text>
        )}
      </View>

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
            🥗
          </Text>
          <Text variant="rowTitle" style={{ textAlign: 'center' }}>
            {t('nutrition.empty.title')}
          </Text>
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('nutrition.empty.sub')}
          </Text>
        </Card>
      ) : (
        entries.data.map((entry) => (
          <EntryCard
            key={`${entry.id}-${rev}`}
            entry={entry}
            expanded={expanded === entry.id}
            favorite={favoriteSet.has(entry.food)}
            units={settings.data.units}
            onToggle={() => setExpanded((open) => (open === entry.id ? null : entry.id))}
            onFavorite={(food, on) => void run(() => actions.setFoodFavorite(food, on))}
            onSave={(next) => void save(next)}
            onDelete={(id) => {
              setExpanded(null);
              void run(() => actions.deleteFood(id));
            }}
            onAddIngredient={(target) => setAdding({ mode: 'ingredient', target })}
          />
        ))
      )}

      <Button title={t('nutrition.logFood')} onPress={() => setAdding({ mode: 'entry' })} />

      <AddFoodSheet
        visible={adding !== null}
        mode={adding?.mode ?? 'entry'}
        day={day}
        favorites={favorites.data}
        customFoods={custom.data}
        logged={recent.data}
        units={settings.data.units}
        onClose={() => setAdding(null)}
        onAdd={(entry) => void addEntry(entry)}
        onAddIngredient={(name) => adding?.mode === 'ingredient' && void addIngredientTo(adding.target, name)}
        onCreateFood={() => {
          setAdding(null); // one sheet at a time: stacked modals are fragile on iOS
          setCustomOpen(true);
        }}
        onQuickAdd={() => {
          setAdding(null);
          setQuickOpen(true);
        }}
        onDeleteCustomFood={(id) => void run(() => actions.deleteCustomFood(id))}
        onScan={(mode) => {
          setAdding(null);
          setScanning(mode);
        }}
      />
      <ScanSheet
        visible={scanning !== null}
        mode={scanning ?? 'meal'}
        day={day}
        onAdd={(entry) => void addEntry(entry)}
        onCreateFood={(code) => {
          setScanning(null);
          setBarcode(code);
          setCustomOpen(true);
        }}
        onClose={() => setScanning(null)}
      />
      <QuickAddSheet visible={quickOpen} day={day} onAdd={(entry) => void addEntry(entry)} onClose={() => setQuickOpen(false)} />
      <CustomFoodSheet visible={customOpen} barcode={barcode} onCreate={createFood} onClose={() => { setCustomOpen(false); setBarcode(undefined); }} />
      <GoalsSheet
        visible={goalsOpen}
        goals={goals.data}
        onSave={(next) => {
          void run(() => actions.saveGoals(next)).then((saved) => saved && setGoalsOpen(false));
        }}
        onClose={() => setGoalsOpen(false)}
      />
    </Screen>
  );
}
