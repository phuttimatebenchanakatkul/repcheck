import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { calorieRing, percentOf } from '@/logic/macros';
import type { Goals, Macros } from '@/logic/types';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Bar, Ring } from '@/ui/widgets';

/** The day's calories as a ring (green, amber-red once over the goal) and the three macros against their goals. */
export function TotalsCard({ totals, goals, onEditGoals }: { totals: Macros; goals: Goals; onEditGoals: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ring = calorieRing(totals.calories, goals.calories);
  const color = ring.over ? colors.red.fill : colors.green.fill;

  const macros = [
    { key: 'protein', label: t('common.protein'), value: totals.protein, goal: goals.protein, color: colors.blue.fill },
    { key: 'fat', label: t('common.fat'), value: totals.fat, goal: goals.fat, color: colors.amber.fill },
    { key: 'carbs', label: t('common.carbs'), value: totals.carbs, goal: goals.carbs, color: colors.purple.fill },
  ] as const;

  return (
    <Card>
      <Text variant="eyebrow" secondary>
        {t('nutrition.totals.title')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
        <Ring fill={ring.fill} color={color} label={t('nutrition.totals.title')}>
          <Text variant="title" style={{ fontSize: 26 }} testID="ring-consumed">
            {ring.consumed}
          </Text>
          <Text variant="caption" secondary>
            {t('nutrition.totals.kcalConsumed')}
          </Text>
        </Ring>
        <View style={{ flex: 1, gap: space.sm }}>
          <Text variant="title" style={{ fontSize: 22, color: ring.over ? colors.ink.red : colors.ink.green }} testID="ring-remaining">
            {Math.abs(ring.remaining)}
          </Text>
          <Text variant="body" secondary>
            {ring.over ? t('nutrition.totals.kcalOver') : t('nutrition.totals.kcalLeft')}
          </Text>
          <Text variant="caption" secondary>
            {t('home.food.ofGoal', { n: ring.goal })}
          </Text>
        </View>
      </View>
      <View style={{ gap: space.md, marginTop: space.sm }}>
        {macros.map((macro) => (
          <View key={macro.key} style={{ gap: space.xs }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="label">{macro.label}</Text>
              <Text variant="body" secondary>
                {macro.value} / {macro.goal} g
              </Text>
            </View>
            <Bar percent={percentOf(macro.value, macro.goal)} color={macro.color} label={macro.label} />
          </View>
        ))}
      </View>
      <Button tone="plain" title={t('nutrition.totals.editGoals')} onPress={onEditGoals} />
    </Card>
  );
}
