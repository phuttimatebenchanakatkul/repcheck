import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/actions';
import { useGoals, useNutritionDay, useSettings, useStreak, useWeights, useWorkoutDay } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { addDays, parseIso, toIsoDate } from '@/logic/dates';
import { calorieRing, percentOf, sumMacrosForDay } from '@/logic/macros';
import { lastDays } from '@/logic/streak';
import { formatWeightKg, localeFor } from '@/logic/units';
import { getSupabase } from '@/supabase/client';
import { Button, Card, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Bar, Ring } from '@/ui/widgets';

import { WeightForm } from '../history/WeightForm';

/**
 * Today at a glance: the streak, calories and macros against the goals, a quick weigh-in, and the two things most people open the
 * app to do. Everything reads the same saved-plus-waiting data the other screens do, so it is right with no signal too.
 */
export default function HomeScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const { state } = useAuth();
  const name = state.status === 'ready' ? state.profile.name : '';
  const locale = localeFor(language);

  const now = new Date();
  const today = toIsoDate(now);
  const streak = useStreak(now);
  const entries = useNutritionDay(today);
  const goals = useGoals();
  const workouts = useWorkoutDay(today);
  const settings = useSettings();
  const weights = useWeights(addDays(today, -365), today);

  const totals = sumMacrosForDay(entries.data);
  const ring = calorieRing(totals.calories, goals.data.calories);
  const units = settings.data.units;
  const latest = weights.data[weights.data.length - 1];
  const week = lastDays(now, 7);
  const exerciseCount = workouts.data.length;

  return (
    <Screen>
      <OfflineBanner />
      <Text variant="title" style={{ fontSize: 28 }}>
        {t('home.greeting', { name })}
      </Text>

      <Card>
        <Text variant="eyebrow" secondary>
          {t('streaks.current')}
        </Text>
        <Text variant="title" style={{ fontSize: 26 }} testID="streak-count">
          {t('home.streakCount', { n: streak.data.current })}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}>
          {week.map((day) => {
            const active = streak.data.active.has(day);
            const date = parseIso(day) as Date;
            return (
              <View
                key={day}
                accessible
                accessibilityLabel={`${date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}, ${active ? t('streaks.legend.active') : t('streaks.legend.none')}`}
                style={{ alignItems: 'center', gap: space.xs }}>
                <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.green.fill : colors.border }}>
                  <Text variant="caption" style={{ color: active ? '#ffffff' : colors.textSecondary }}>
                    {active ? '✓' : ''}
                  </Text>
                </View>
                <Text variant="caption" secondary>
                  {date.toLocaleDateString(locale, { weekday: 'narrow' })}
                </Text>
              </View>
            );
          })}
        </View>
        {streak.data.longest > 0 && (
          <Text variant="caption" secondary>
            {t('streaks.longest')}: {streak.data.longest}
          </Text>
        )}
        <Button tone="plain" title={t('app.history.viewStreak')} onPress={() => router.push('/streaks')} />
      </Card>

      <Card>
        <Text variant="eyebrow" secondary>
          {t('home.macros.title')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Ring fill={ring.fill} size={104} stroke={10} color={ring.over ? colors.red.fill : colors.green.fill} label={t('home.macros.title')}>
            <Text variant="title" style={{ fontSize: 22 }} testID="home-consumed">
              {ring.consumed}
            </Text>
            <Text variant="caption" secondary>
              kcal
            </Text>
          </Ring>
          <View style={{ flex: 1, gap: space.sm }}>
            {(
              [
                ['protein', totals.protein, goals.data.protein, colors.blue.fill],
                ['fat', totals.fat, goals.data.fat, colors.amber.fill],
                ['carbs', totals.carbs, goals.data.carbs, colors.purple.fill],
              ] as const
            ).map(([key, value, goal, color]) => (
              <View key={key} style={{ gap: 2 }}>
                <Text variant="caption" secondary>
                  {t(`common.${key}`)} {value} / {goal} g
                </Text>
                <Bar percent={percentOf(value, goal)} color={color} label={t(`common.${key}`)} />
              </View>
            ))}
          </View>
        </View>
        <Text variant="body" secondary testID="home-remaining">
          {ring.over ? `${Math.abs(ring.remaining)} ${t('nutrition.totals.kcalOver')}` : t('home.macros.left', { n: ring.remaining })}
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Button title={t('nutrition.logFood')} onPress={() => router.navigate('/nutrition')} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title={t('workouts.logExercise')} onPress={() => router.navigate('/workouts')} />
        </View>
      </View>
      {exerciseCount > 0 && (
        <Text variant="body" secondary>
          {t('nav.workouts')}: {t('workouts.day.exercises', { n: exerciseCount, s: exerciseCount === 1 ? '' : 's' })}
        </Text>
      )}

      <Card>
        <Text variant="eyebrow" secondary>
          {t('weight.emptyCta')}
        </Text>
        {latest ? (
          <Text variant="body" secondary testID="latest-weight">
            {t('weight.latest')}: {formatWeightKg(latest.kg, units)}
          </Text>
        ) : (
          <Text variant="body" secondary>
            {t('weight.emptyTitle')}
          </Text>
        )}
        <WeightForm day={today} units={units} />
        <Button tone="plain" title={t('app.history.viewHistory')} onPress={() => router.push('/weight')} />
      </Card>

      <Button tone="plain" title={t('app.setup.signOut')} onPress={() => void signOut(getSupabase())} />
    </Screen>
  );
}
