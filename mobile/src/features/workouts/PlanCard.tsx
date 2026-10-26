import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { parseIso, weekdayIndex } from '@/logic/dates';
import type { SplitPlan } from '@/logic/types';
import { localeFor } from '@/logic/units';
import { WEEKDAY_KEYS, setsRepsText, todaysSplit } from '@/logic/workouts';
import { Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

/** What today's split says to do; tapping an exercise logs it on the day being viewed. */
export function PlanCard({ plan, today, onAdd }: { plan: SplitPlan | null; today: string; onAdd: (exercise: string) => void }) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const split = todaysSplit(plan, today);
  const weekday = (parseIso(today) as Date).toLocaleDateString(localeFor(language), { weekday: 'long' });
  const rest = !split && !!plan && plan.schedule[WEEKDAY_KEYS[weekdayIndex(today)]] === 'Rest';

  return (
    <Card>
      <Text variant="eyebrow" secondary accessibilityRole="header">
        {t('workouts.plan.title')}
      </Text>
      {!plan ? (
        <Text variant="body" secondary>
          {t('app.workouts.noPlan')}
        </Text>
      ) : rest ? (
        <Text variant="body" secondary>
          {t('workouts.plan.restDay')}
        </Text>
      ) : !split ? (
        <Text variant="body" secondary>
          {t('workouts.plan.restText')}
        </Text>
      ) : (
        <View style={{ gap: space.sm }}>
          <Text variant="rowTitle">{t('workouts.plan.dayPlanLabel', { weekday, label: split.label })}</Text>
          {split.exercises.length === 0 ? (
            <Text variant="body" secondary>
              {t('workouts.plan.noExercisesText')}
            </Text>
          ) : (
            split.exercises.map((exercise) => (
              <Pressable
                key={exercise}
                accessibilityRole="button"
                accessibilityLabel={`${t('workouts.logExercise')}: ${exercise}`}
                onPress={() => onAdd(exercise)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label">{exercise}</Text>
                  <Text variant="caption" secondary>
                    {setsRepsText(exercise)}
                  </Text>
                </View>
                <Text variant="title" style={{ color: colors.link }}>
                  +
                </Text>
              </Pressable>
            ))
          )}
        </View>
      )}
    </Card>
  );
}
