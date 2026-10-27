import { useState } from 'react';
import { View } from 'react-native';

import { useActions, useDayStatuses, useNutritionRange } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { parseIso, toIsoDate } from '@/logic/dates';
import { monthDays, monthOf, type Month } from '@/logic/history';
import { dayStatus, overrideFor, statusCounts, statusOptions, type DayStatus } from '@/logic/nutritionHistory';
import { localeFor } from '@/logic/units';
import { Card, ErrorText, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Row, Sheet } from '@/ui/widgets';

import { MonthCalendar, MonthNav } from './MonthCalendar';

const STATUS_LABEL: Record<DayStatus, 'loggingHistory.summary.logged' | 'loggingHistory.summary.fasting' | 'loggingHistory.summary.incomplete' | 'loggingHistory.summary.notLogged'> = {
  logged: 'loggingHistory.summary.logged',
  fasting: 'loggingHistory.summary.fasting',
  incomplete: 'loggingHistory.summary.incomplete',
  none: 'loggingHistory.summary.notLogged',
};

/** Which days had food, and which were marked fasting or incomplete: a month at a time. Tap a day to mark it. */
export default function LoggingHistoryScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const now = new Date();
  const today = toIsoDate(now);
  const [month, setMonth] = useState<Month>(monthOf(now));
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useActions();

  const days = monthDays(month);
  const from = days[0];
  const to = days[days.length - 1];
  const food = useNutritionRange(from, to);
  const marks = useDayStatuses(from, to);
  const withFood = new Set(food.data.map((e) => e.day));
  const statusOf = (day: string): DayStatus => dayStatus(withFood.has(day), marks.data[day]);
  const counts = statusCounts(days, today, statusOf);
  const empty = counts.logged === 0 && counts.fasting === 0 && counts.incomplete === 0 && counts.none > 0;

  const color: Record<DayStatus, string | null> = { logged: colors.green.fill, fasting: colors.amber.fill, incomplete: colors.textSecondary, none: null };
  const dayLabel = (day: string) => (parseIso(day) as Date).toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });

  const choose = async (day: string, choice: 'logged' | 'incomplete' | 'fasting') => {
    setError(null);
    try {
      await actions.setDayStatus(day, overrideFor(choice));
      setOpen(null);
    } catch {
      setError(t('nutrition.log.saveError'));
    }
  };

  const current = open ? statusOf(open) : null;

  return (
    <Screen>
      <OfflineBanner />
      <Card>
        <MonthNav month={month} latest={monthOf(now)} onChange={setMonth} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.md }}>
          {(['logged', 'fasting', 'incomplete', 'none'] as const).map((status) => (
            <Text key={status} variant="body" secondary testID={`count-${status}`}>
              {counts[status]} {t(STATUS_LABEL[status])}
            </Text>
          ))}
        </View>
        {empty ? (
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('loggingHistory.emptyMonth')}
          </Text>
        ) : null}
        <MonthCalendar
          month={month}
          today={today}
          has={(day) => color[statusOf(day)] !== null}
          colorFor={(day) => color[statusOf(day)]}
          activeColor={colors.green.fill}
          describe={(day) => `${dayLabel(day)}, ${t(STATUS_LABEL[statusOf(day)])}`}
          onPressDay={setOpen}
        />
      </Card>

      <Sheet visible={open !== null} title={open ? dayLabel(open) : ''} closeLabel={t('common.close')} onClose={() => setOpen(null)}>
        {open && (
          <View style={{ gap: space.md }}>
            <Text variant="body" secondary>
              {t('coaching.dayPopup.question')}
            </Text>
            {statusOptions(withFood.has(open)).map((option) => (
              <Row key={option.choice} onPress={() => void choose(open, option.choice)} label={t(option.labelKey)} selected={option.choice === 'logged' ? current === 'logged' || current === 'none' : current === option.choice}>
                <Text variant="rowTitle" style={{ flex: 1 }}>
                  {t(option.labelKey)}
                </Text>
              </Row>
            ))}
            <ErrorText>{error}</ErrorText>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
