import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { formatClock, type Race } from '@/logic/hyrox';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { RaceBreakdown } from './RaceBreakdown';
import { comboLabel } from './labels';

/** The result: the time, whether it was flagged or a new best, and where the time went. It is already saved when this shows. */
export function FinishedView({ race, onAnother, onHistory }: { race: Race; onAnother: () => void; onHistory: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const combo = comboLabel(t as never, race.gender, race.category, race.format);
  const tone = race.flagged ? colors.red : race.isNewPb ? colors.amber : colors.green;
  return (
    <Card>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text style={{ fontSize: 56, lineHeight: 64, fontWeight: '800' }} testID="finish-time">
          {formatClock(race.totalSeconds)}
        </Text>
        <Text variant="label" secondary testID="finish-combo">
          {combo}
        </Text>
      </View>
      <View style={{ padding: space.md, borderRadius: radius.md, backgroundColor: tone.tint }} accessibilityRole="summary">
        <Text variant="body" testID="finish-banner">
          {race.flagged ? t('hyrox.flagged', { combo }).replace(/<\/?strong>/g, '') : race.isNewPb ? t('hyrox.pb.new', { combo }) : t('hyrox.saved')}
        </Text>
      </View>
      <RaceBreakdown race={race} />
      <Button title={t('hyrox.logAnother')} onPress={onAnother} />
      <Button tone="plain" title={t('hyrox.viewPersonalBests')} onPress={onHistory} />
    </Card>
  );
}
