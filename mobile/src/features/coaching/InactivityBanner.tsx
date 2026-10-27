import { View } from 'react-native';

import { useActions, useCoachingProfile, useInactivityNoticedOn, useNutritionRecent, useWeights } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { addDays, toIsoDate } from '@/logic/dates';
import { idleDays, inactivityNotice } from '@/logic/inactivity';
import { Button, Card, Text } from '@/ui/components';
import { space } from '@/ui/tokens';

/**
 * "It's been N days since you logged your weight or food": for someone with a coaching profile who has been away three days or more,
 * until they dismiss it for the day. static/coaching.js (renderInactivityBanner) is the original; there, dismissing did not hide it.
 */
export function InactivityBanner() {
  const { t } = useTranslation();
  const actions = useActions();
  const today = toIsoDate(new Date());
  const profile = useCoachingProfile();
  const noticedOn = useInactivityNoticedOn();
  const weights = useWeights(addDays(today, -365), today);
  const food = useNutritionRecent();
  if (!profile.data) return null;
  const latestWeight = weights.data[weights.data.length - 1]?.day ?? null;
  const latestFood = food.data.reduce<string | null>((latest, entry) => (latest === null || entry.day > latest ? entry.day : latest), null);
  const days = inactivityNotice(idleDays(profile.data.createdOn, latestWeight, latestFood, today), noticedOn.data, today);
  if (days === null || weights.isLoading || food.isLoading) return null;
  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Text variant="body" testID="inactivity">
          ⚠️ {t('coaching.inactivity', { n: days })}
        </Text>
        <Button tone="plain" title={t('coaching.dismiss')} onPress={() => void actions.dismissInactivity().catch(() => undefined)} />
      </View>
    </Card>
  );
}
