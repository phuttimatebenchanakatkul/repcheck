import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useCoachingProfile, useNutritionRecent, useWeights } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { addDays, toIsoDate } from '@/logic/dates';
import { planReminders } from '@/logic/reminders';
import { restoreReminderPref, useRemindersOn } from '@/store/remindersPref';
import { cancelReminders, scheduleReminders } from '@/ui/reminders';

/**
 * Keeps the phone's waiting reminders right: when the person has turned them on, the next "you have been away" and "check-in due"
 * notifications are worked out from their data and scheduled in place of the last ones, whenever that data changes, the language
 * changes or the app comes back to the front. Signed out (or switched off), none are left waiting.
 */
export function RemindersScheduler() {
  const { t, language } = useTranslation();
  const on = useRemindersOn();
  const profile = useCoachingProfile();
  const today = toIsoDate(new Date());
  const weights = useWeights(addDays(today, -365), today);
  const food = useNutritionRecent();
  const [foreground, setForeground] = useState(0);

  useEffect(() => {
    void restoreReminderPref();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForeground((n) => n + 1);
    });
    return () => subscription.remove();
  }, []);

  // Nothing is worked out from data that has not arrived (it would only be wrong for a moment, and scheduled).
  const ready = !profile.isLoading && !weights.isLoading && !food.isLoading;
  const latestWeightDay = weights.data[weights.data.length - 1]?.day ?? null;
  const latestFoodDay = food.data.reduce<string | null>((latest, entry) => (latest === null || entry.day > latest ? entry.day : latest), null);
  const plan = useMemo(
    () =>
      on && ready
        ? planReminders({ now: new Date(), hasProfile: !!profile.data, createdOn: profile.data?.createdOn ?? null, lastAdjustmentOn: profile.data?.lastAdjustmentOn ?? null, latestWeightDay, latestFoodDay })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `foreground` re-plans when the app returns (the day may have changed)
    [on, ready, profile.data, latestWeightDay, latestFoodDay, foreground],
  );
  // 'waiting' (not worked out yet) differs from an empty plan, so reminders left from an earlier visit are cleared once it is known there are none.
  const planKey = plan ? `plan:${plan.map((p) => `${p.id}@${p.at.getTime()}`).join(',')}` : 'waiting';

  useEffect(() => {
    if (!on) {
      void cancelReminders();
      return;
    }
    if (plan) {
      void scheduleReminders(plan, {
        inactivity: { title: 'RepCheck', body: t('coaching.notify.body') },
        checkin: { title: t('coaching.checkin.title'), body: t('coaching.checkin.sub') },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planKey stands for the plan's contents
  }, [on, planKey, language]);

  // Signing out takes the scheduler away with it: another person's reminders must not be left on the phone.
  useEffect(() => () => void cancelReminders(), []);

  return null;
}
