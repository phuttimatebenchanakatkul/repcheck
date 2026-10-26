import { useState } from 'react';
import { View } from 'react-native';

import { STREAK_WINDOW_DAYS } from '@/data/access';
import { useStreak } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { addDays, parseIso, toIsoDate } from '@/logic/dates';
import { calendarSummary, monthDays, monthOf, type Month } from '@/logic/history';
import { localeFor } from '@/logic/units';
import { Card, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { MonthCalendar, MonthNav } from './MonthCalendar';

/** The streak: current and longest, and a calendar of the days that counted. Reached from the streak tile on Home. */
export default function StreakScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const now = new Date();
  const today = toIsoDate(now);
  const streak = useStreak(now);
  const [month, setMonth] = useState<Month>(monthOf(now));
  const active = streak.data.active;
  const summary = calendarSummary(monthDays(month), today, (day) => active.has(day));
  const locale = localeFor(language);
  // The days the app reads reach back this far: a month before it would look empty for lack of data, not lack of activity.
  const earliest = monthOf(parseIso(addDays(today, -STREAK_WINDOW_DAYS)) as Date);

  return (
    <Screen>
      <OfflineBanner />
      <Card>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
            <Text variant="title" style={{ fontSize: 26 }} testID="streak-current">
              {streak.data.current}
            </Text>
            <Text variant="caption" secondary>
              {t('streaks.current')}
            </Text>
          </View>
          <View style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
            <Text variant="title" style={{ fontSize: 26 }} testID="streak-longest">
              {streak.data.longest}
            </Text>
            <Text variant="caption" secondary>
              {t('streaks.longest')}
            </Text>
          </View>
        </View>
      </Card>

      <Text variant="rowTitle" accessibilityRole="header">
        {t('streaks.calendarTitle')}
      </Text>
      <Card>
        <MonthNav month={month} latest={monthOf(now)} earliest={earliest} onChange={setMonth} />
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg, marginVertical: space.sm }}>
          <Text variant="body" secondary testID="streak-summary-active">
            {summary.active} {t('streaks.legend.active')}
          </Text>
          <Text variant="body" secondary testID="streak-summary-none">
            {summary.inactive} {t('streaks.legend.none')}
          </Text>
        </View>
        {summary.active === 0 && summary.inactive > 0 ? (
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('streaks.emptyMonth')}
          </Text>
        ) : null}
        <MonthCalendar
          month={month}
          today={today}
          has={(day) => active.has(day)}
          activeColor={colors.amber.fill}
          describe={(day, on) => `${(parseIso(day) as Date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}, ${on ? t('streaks.legend.active') : t('streaks.legend.none')}`}
        />
      </Card>
    </Screen>
  );
}
