import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { breakdownTotals, formatClock, formatClockPrecise, segmentDurations, type Race } from '@/logic/hyrox';
import { Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { StationIcon } from './StationIcon';

/** Where a race's time went: time on the runs and on the stations, then a bar for every segment in race order (runs muted, stations bold). */
export function RaceBreakdown({ race }: { race: Pick<Race, 'splits'> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const durations = segmentDurations(race);
  const longest = Math.max(1, ...durations.map((d) => d.seconds));
  const totals = breakdownTotals(durations);
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.breakdown.title')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="title" testID="total-running">
            {formatClock(totals.running)}
          </Text>
          <Text variant="caption" secondary>
            {t('hyrox.breakdown.running')}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title" testID="total-stations">
            {formatClock(totals.stations)}
          </Text>
          <Text variant="caption" secondary>
            {t('hyrox.breakdown.stations')}
          </Text>
        </View>
      </View>
      {durations.map((d, i) => {
        const percent = Math.max(4, Math.round((d.seconds / longest) * 100));
        return (
          <View key={`${d.key}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 }} testID={`segment-${i}`}>
            <StationIcon name={d.key} size={18} />
            <Text variant="caption" style={{ width: 110 }} numberOfLines={1}>
              {d.title}
            </Text>
            <View style={{ flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }}>
              <View testID={`bar-${i}`} style={{ width: `${percent}%`, height: '100%', backgroundColor: d.type === 'run' ? colors.textSecondary : colors.green.fill }} />
            </View>
            <Text variant="caption" style={{ width: 48, textAlign: 'right' }}>
              {formatClockPrecise(d.seconds)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
