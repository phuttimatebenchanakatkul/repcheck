import { useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { groupByMonth } from '@/logic/analyzeResult';
import { localeFor } from '@/logic/units';
import { Button, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { space } from '@/ui/tokens';

import { AnalysisRow } from './AnalysisRow';
import { monthHeading } from './labels';
import { useAnalysisHistory } from './queries';

/** Every analysis the server still keeps (the newest 20), newest first, under the month they were made in. */
export default function HistoryScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const history = useAnalysisHistory();
  const entries = history.data ?? [];
  const now = new Date().getTime();
  const locale = localeFor(language);

  return (
    <Screen>
      <OfflineBanner />
      {history.isLoading && entries.length === 0 ? <ActivityIndicator testID="loading" /> : null}
      {history.isError && entries.length === 0 ? (
        <View style={{ gap: space.sm }}>
          <Text variant="body" secondary>
            {t('app.analyze.historyFailed')}
          </Text>
          <Button tone="plain" title={t('app.analyze.tryAgain')} onPress={() => void history.refetch()} />
        </View>
      ) : null}
      {!history.isLoading && !history.isError && entries.length === 0 ? (
        <Text variant="body" secondary style={{ textAlign: 'center', paddingVertical: space.xl }}>
          {t('analyzeHistory.empty')}
        </Text>
      ) : null}
      {groupByMonth(entries).map((group) => (
        <View key={group.key} style={{ gap: space.sm }}>
          <Text variant="eyebrow" secondary accessibilityRole="header">
            {monthHeading(group.ms, locale)}
          </Text>
          {group.entries.map((entry) => (
            <AnalysisRow key={entry.id} entry={entry} now={now} onPress={() => router.push({ pathname: '/analysis', params: { id: String(entry.id) } })} />
          ))}
        </View>
      ))}
    </Screen>
  );
}
