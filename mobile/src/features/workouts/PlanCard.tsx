import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { parseIso, weekdayIndex } from '@/logic/dates';
import type { SplitPlan } from '@/logic/types';
import { localeFor } from '@/logic/units';
import { WEEKDAY_KEYS, setsRepsText, todaysSplit } from '@/logic/workouts';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

/**
 * What today's split says to do. A tap on an exercise logs it for TODAY (the website's quick add, whichever day is being viewed) and
 * turns into a tick; the button opens the planner.
 */
export function PlanCard({
  plan,
  today,
  loggedToday,
  onAdd,
  onOpen,
}: {
  plan: SplitPlan | null;
  today: string;
  /** Exercises already logged today. */
  loggedToday: ReadonlySet<string>;
  onAdd: (exercise: string) => void;
  onOpen: () => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const split = todaysSplit(plan, today);
  const weekday = (parseIso(today) as Date).toLocaleDateString(localeFor(language), { weekday: 'long' });
  const rest = !split && !!plan && plan.schedule[WEEKDAY_KEYS[weekdayIndex(today)]] === 'Rest';

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="eyebrow" secondary accessibilityRole="header">
          {t('workouts.plan.title')}
        </Text>
        <Button tone="plain" title={plan ? t('workouts.plan.editSplit') : t('workouts.plan.planSplit')} onPress={onOpen} />
      </View>
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
            split.exercises.map((exercise) => {
              const added = loggedToday.has(exercise);
              return (
                <Pressable
                  key={exercise}
                  accessibilityRole="button"
                  accessibilityLabel={added ? t('app.plan.loggedToday', { name: exercise }) : `${t('workouts.logExercise')}: ${exercise}`}
                  accessibilityState={{ disabled: added }}
                  disabled={added}
                  onPress={() => onAdd(exercise)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="label">{exercise}</Text>
                    <Text variant="caption" secondary>
                      {setsRepsText(exercise)}
                    </Text>
                  </View>
                  <Text variant="title" style={{ color: added ? colors.ink.green : colors.link }}>
                    {added ? '✓' : '+'}
                  </Text>
                </Pressable>
              );
            })
          )}
        </View>
      )}
    </Card>
  );
}
