import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { monthDays, shiftMonth, type Month } from '@/logic/history';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

/** "Month Year" with the month name in the person's language (the website's common.month.N strings). */
export function useMonthLabel() {
  const { t } = useTranslation();
  return ({ year, month }: Month) => `${t(`common.month.${month}` as 'common.month.0')} ${year}`;
}

/** The month's arrows and its name. Forward stops at `latest`, back at `earliest` (when given). */
export function MonthNav({ month, latest, earliest, onChange }: { month: Month; latest: Month; earliest?: Month; onChange: (month: Month) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = useMonthLabel();
  const atLatest = month.year * 12 + month.month >= latest.year * 12 + latest.month;
  const atEarliest = !!earliest && month.year * 12 + month.month <= earliest.year * 12 + earliest.month;
  const arrow = (name: string, glyph: string, disabled: boolean, to: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => onChange(shiftMonth(month, to))}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Text variant="title" style={{ color: colors.text }}>
        {glyph}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md }}>
      {arrow(t('app.history.prevMonth'), '‹', atEarliest, -1)}
      <Text variant="rowTitle" style={{ minWidth: 150, textAlign: 'center' }} accessibilityRole="header">
        {label(month)}
      </Text>
      {arrow(t('app.history.nextMonth'), '›', atLatest, 1)}
    </View>
  );
}

/**
 * One circle per day of the month: filled when `has(day)`, a ring on today, dimmed after today. `describe` is what a screen reader
 * says for a day. With `onPressDay` the circles are buttons (future days stay off).
 */
export function MonthCalendar({
  month,
  today,
  has,
  activeColor,
  describe,
  onPressDay,
}: {
  month: Month;
  today: string;
  has: (day: string) => boolean;
  activeColor: string;
  describe: (day: string, active: boolean) => string;
  onPressDay?: (day: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' }}>
      {monthDays(month).map((day) => {
        const active = has(day);
        const future = day > today;
        const press = onPressDay && !future;
        return (
          <Pressable
            key={day}
            accessibilityRole={press ? 'button' : 'text'}
            accessibilityLabel={describe(day, active)}
            disabled={!press}
            onPress={() => onPressDay?.(day)}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? activeColor : colors.border,
              borderWidth: day === today ? 2 : 0,
              borderColor: colors.blue.fill,
              opacity: future ? 0.3 : 1,
            }}>
            <Text variant="label" style={{ color: active ? '#ffffff' : colors.text }}>
              {Number(day.slice(8))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
