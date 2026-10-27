import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useGoals, useNutritionRange } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { addDays, parseIso, startOfWeek, toIsoDate, weekDays } from '@/logic/dates';
import { percentOf, sumMacrosForDay } from '@/logic/macros';
import { chartScale, heightPercent, weekStats, type WeekDay } from '@/logic/nutritionHistory';
import { localeFor } from '@/logic/units';
import { Card, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Bar } from '@/ui/widgets';

const PLOT_HEIGHT = 160;

/** This week's calories day by day against the goal, the average, how many days landed on target, and a day's macros. */
export default function FullStatsScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const today = toIsoDate(new Date());
  const days = weekDays(startOfWeek(today));
  const [selected, setSelected] = useState(today);
  const entries = useNutritionRange(days[0], addDays(days[0], 6));
  const goals = useGoals().data;

  const perDay = days.map((day) => {
    const ofDay = entries.data.filter((e) => e.day === day);
    const eaten = sumMacrosForDay(ofDay);
    // sumMacrosForDay already rounds each entry and adds whole numbers, so these are whole.
    return { day, calories: eaten.calories, protein: eaten.protein, fat: eaten.fat, carbs: eaten.carbs, hasData: ofDay.length > 0 };
  });
  const forStats: WeekDay[] = perDay;
  const stats = weekStats(forStats, goals.calories);
  const scale = chartScale(forStats, goals.calories);
  const detail = perDay.find((d) => d.day === selected) ?? perDay[0];
  const name = (day: string, style: 'short' | 'narrow' | 'long') => (parseIso(day) as Date).toLocaleDateString(locale, style === 'long' ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: style });

  return (
    <Screen>
      <OfflineBanner />
      <Text variant="body" secondary>
        {t('fullStats.sub')}
      </Text>
      <Card>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="caption" secondary>
              {t('fullStats.dailyAvg')}
            </Text>
            <Text variant="title" style={{ fontSize: 22 }} testID="stat-average">
              {stats.average === null ? '—' : `${stats.average.toLocaleString(locale)} kcal`}
            </Text>
          </View>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text variant="caption" secondary>
              {t('fullStats.daysOnTarget')}
            </Text>
            <Text variant="title" style={{ fontSize: 22 }} testID="stat-target">
              {stats.onTarget}/{stats.logged} {t('fullStats.daysLogged')}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <Text variant="eyebrow" secondary>
          {t('fullStats.caloriesThisWeek')}
        </Text>
        <View style={{ height: PLOT_HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: (heightPercent(goals.calories, scale) / 100) * PLOT_HEIGHT, borderTopWidth: 1, borderColor: colors.textSecondary, borderStyle: 'dashed' }}
          />
          {perDay.map((d) => (
            <Pressable
              key={d.day}
              accessibilityRole="button"
              accessibilityLabel={`${name(d.day, 'short')} ${Number(d.day.slice(8))}, ${d.calories} kcal`}
              accessibilityState={{ selected: d.day === selected }}
              onPress={() => setSelected(d.day)}
              style={{ flex: 1, height: PLOT_HEIGHT, justifyContent: 'flex-end' }}>
              <View style={{ height: (heightPercent(d.calories, scale) / 100) * PLOT_HEIGHT, borderRadius: radius.sm, backgroundColor: d.day === selected ? colors.green.fill : colors.green.tint }} />
            </Pressable>
          ))}
        </View>
        <Text variant="caption" secondary testID="goal-line">
          {t('fullStats.goalLine', { n: goals.calories.toLocaleString(locale) })}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {perDay.map((d) => (
            <Pressable key={d.day} accessibilityRole="button" accessibilityLabel={name(d.day, 'long')} onPress={() => setSelected(d.day)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label" style={{ color: d.day === selected ? colors.ink.green : colors.textSecondary }}>
                {name(d.day, 'narrow')}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Text variant="rowTitle" accessibilityRole="header">
          {name(detail.day, 'long')}
        </Text>
        {detail.hasData ? (
          <>
            <Text variant="title" style={{ fontSize: 28 }} testID="detail-kcal">
              {detail.calories.toLocaleString(locale)} <Text variant="body" secondary>{t('fullStats.totalCalories')}</Text>
            </Text>
            {(
              [
                ['protein', detail.protein, goals.protein, colors.red.fill],
                ['fat', detail.fat, goals.fat, colors.amber.fill],
                ['carbs', detail.carbs, goals.carbs, colors.green.fill],
              ] as const
            ).map(([key, value, goal, tint]) => (
              <View key={key} style={{ gap: space.xs }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="label">{t(`common.${key}`)}</Text>
                  <Text variant="body" secondary testID={`detail-${key}`}>
                    {value}/{Math.round(goal)}g
                  </Text>
                </View>
                <Bar percent={percentOf(value, goal)} color={tint} label={t(`common.${key}`)} />
              </View>
            ))}
          </>
        ) : (
          <Text variant="body" secondary>
            {t('fullStats.nothingLogged')}
          </Text>
        )}
      </Card>
    </Screen>
  );
}
