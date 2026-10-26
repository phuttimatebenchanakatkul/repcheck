import { Pressable, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { addDays, parseIso, startOfWeek, weekDays } from '@/logic/dates';
import { localeFor } from '@/logic/units';

import { Text } from './components';
import { useTheme } from './theme';
import { radius, space } from './tokens';

/** The week (Monday first) around the chosen day, a dot under each day that has something logged, and arrows to step a week. */
export function DateStrip({
  selected,
  today,
  loggedDays,
  loggedLabel,
  onSelect,
}: {
  selected: string;
  today: string;
  loggedDays: ReadonlySet<string>;
  /** What a screen reader says for a day with something on it (the date is passed in already written out). */
  loggedLabel: (date: string) => string;
  onSelect: (day: string) => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const days = weekDays(startOfWeek(selected));

  const arrow = (label: string, glyph: string, to: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onSelect(to)} hitSlop={space.sm} style={{ width: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="title" style={{ color: colors.link }}>
        {glyph}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {arrow(t('app.nutrition.prevWeek'), '‹', addDays(selected, -7))}
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-between' }}>
        {days.map((day) => {
          const date = parseIso(day) as Date;
          const isSelected = day === selected;
          const logged = loggedDays.has(day);
          const long = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityLabel={logged ? loggedLabel(long) : long}
              accessibilityState={{ selected: isSelected }}
              onPress={() => onSelect(day)}
              style={{ width: 42, minHeight: 60, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: radius.md, backgroundColor: isSelected ? colors.buttonFill : 'transparent' }}>
              <Text variant="caption" style={{ color: isSelected ? '#ffffff' : colors.textSecondary }}>
                {date.toLocaleDateString(locale, { weekday: 'narrow' })}
              </Text>
              <Text variant="rowTitle" style={{ color: isSelected ? '#ffffff' : day === today ? colors.ink.green : colors.text }}>
                {date.getDate()}
              </Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: logged ? (isSelected ? '#ffffff' : colors.green.fill) : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
      {arrow(t('app.nutrition.nextWeek'), '›', addDays(selected, 7))}
    </View>
  );
}
