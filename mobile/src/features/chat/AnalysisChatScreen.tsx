import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, getApi } from '@/api';
import { useAnalysis } from '@/features/analyze/queries';
import { useActions, useAnalysisThread } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { analysisChatClosed, analysisChatContext, historyForServer, type ChatTurn } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { Button, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { ChatView } from './ChatView';
import { useChatSession } from './useChatSession';

/** A standard navigation bar is this tall below the status bar; the keyboard has to clear it too. */
const NAV_BAR = 44;

function Loaded({ analysisId }: { analysisId: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const actions = useActions();
  const analysis = useAnalysis(analysisId);
  const thread = useAnalysisThread(analysisId);
  const found = analysis.data;

  const ask = useCallback(
    (message: string, history: readonly ChatTurn[]) => {
      // The chat is only offered once the analysis is known, so there is always something to tell the server about.
      if (!found) throw new ApiError(t('app.analyze.loadFailed'), 0);
      return getApi().analysisChat(message, historyForServer(history, 'assistant'), analysisChatContext(found));
    },
    [found, t],
  );
  const save = useCallback((turn: ChatTurn) => actions.saveAnalysisTurn(analysisId, turn), [actions, analysisId]);
  const answered = useCallback(() => void actions.markActivity(toIsoDate(new Date()), 'analyze_chat'), [actions]);
  const session = useChatSession({ turns: thread.data, save, ask, onAnswered: answered, errorText: t('analyzeChat.errorReaching') });

  if (!found) return null;
  const closed = analysisChatClosed(found.created_at_ms, new Date().getTime());
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
        <OfflineBanner />
      </View>
      <ChatView
        turns={thread.data}
        session={session}
        feature="analyze_chat"
        keyboardOffset={insets.top + NAV_BAR}
        placeholder={t('analyzeChat.inputPlaceholder')}
        suggestions={[t('analyzeChat.suggestion1'), t('analyzeChat.suggestion2')]}
        limitText={(time) => t('analyzeChat.limitReached', { time })}
        limitPlaceholder={t('analyzeChat.limitReachedPlaceholder')}
        closedText={closed ? t('analyzeChat.closed') : undefined}
        closedPlaceholder={t('analyzeChat.closedPlaceholder')}
        header={
          <View style={{ gap: space.xs }}>
            <Text variant="rowTitle" accessibilityRole="header">
              {found.exercise_label}
              {found.overall_score !== null ? ` · ${found.overall_score}` : ''}
            </Text>
            <Text variant="caption" secondary>
              {t('analyzeChat.headerSub')}
            </Text>
          </View>
        }
        empty={
          <View style={{ gap: space.sm, paddingVertical: space.md }}>
            <Text variant="title">{t('analyzeChat.welcomeTitle')}</Text>
            <Text variant="body" secondary>
              {t('analyzeChat.welcomeBody')}
            </Text>
          </View>
        }
      />
    </View>
  );
}

/** Ask about one analysis (`/analysis-chat?id=7`): its scores and report are told to the AI service with each question. */
export default function AnalysisChatScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const analysisId = /^\d+$/.test(id ?? '') ? Number(id) : NaN;
  const analysis = useAnalysis(analysisId);
  const gone = analysis.error instanceof ApiError && analysis.error.status === 404;

  if (analysis.data) return <Loaded analysisId={analysisId} />;
  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md }}>
      {analysis.isLoading ? <ActivityIndicator testID="loading" /> : null}
      {gone || Number.isNaN(analysisId) ? (
        <Text variant="body" secondary style={{ textAlign: 'center' }}>
          {t('app.analyze.notFound')}
        </Text>
      ) : null}
      {analysis.isError && !gone ? (
        <>
          <Text variant="body" secondary>
            {t('app.analyze.loadFailed')}
          </Text>
          <Button tone="plain" title={t('app.analyze.tryAgain')} onPress={() => void analysis.refetch()} />
        </>
      ) : null}
    </View>
  );
}
