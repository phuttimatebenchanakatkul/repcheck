import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { Button, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { space } from '@/ui/tokens';

import { AnalysisView } from './AnalysisView';
import { useAnalysis } from './queries';

/** One past analysis, opened from the recent list or the history (`/analysis?id=7`). The saved copy shows at once; the clip link is fetched fresh. */
export default function AnalysisScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const parsed = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const query = useAnalysis(parsed);
  const gone = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Screen>
      <OfflineBanner />
      {query.data ? <AnalysisView analysis={query.data} onAsk={() => router.push({ pathname: '/analysis-chat', params: { id: String(query.data?.id) } })} /> : null}
      {!query.data && query.isLoading ? <ActivityIndicator testID="loading" /> : null}
      {!query.data && (gone || Number.isNaN(parsed)) ? (
        <Text variant="body" secondary style={{ textAlign: 'center', paddingVertical: space.xl }}>
          {t('app.analyze.notFound')}
        </Text>
      ) : null}
      {!query.data && query.isError && !gone ? (
        <View style={{ gap: space.sm }}>
          <Text variant="body" secondary>
            {t('app.analyze.loadFailed')}
          </Text>
          <Button tone="plain" title={t('app.analyze.tryAgain')} onPress={() => void query.refetch()} />
        </View>
      ) : null}
    </Screen>
  );
}
