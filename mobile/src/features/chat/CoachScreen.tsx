import { useCallback } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getApi } from '@/api';
import { useActions, useCoachThread } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { historyForServer, todaysCoachTurns, type ChatTurn } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { Button, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { ChatView } from './ChatView';
import { useChatSession } from './useChatSession';

/**
 * The Coach tab: ask about training. One conversation per day (the website's rule: yesterday's thread is gone when the day turns),
 * kept on the device and on the server, cleared with "New chat". Every answer carries its sources, the AI disclaimer and a Report
 * button, and the consent question comes before the first message leaves the phone.
 */
export default function CoachScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const today = toIsoDate(new Date());
  const thread = useCoachThread(today);
  const actions = useActions();
  const turns = todaysCoachTurns(thread.data, today);

  const ask = useCallback((message: string, history: readonly ChatTurn[]) => getApi().coachChat(message, historyForServer(history, 'coach')), []);
  const answered = useCallback(() => void actions.markActivity(toIsoDate(new Date()), 'coach_chat'), [actions]);
  const session = useChatSession({ turns, save: actions.saveCoachTurn, ask, onAnswered: answered, errorText: t('coach.errorReaching') });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'left', 'right']}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
        <OfflineBanner />
        {turns.length > 0 ? <Button tone="plain" title={t('coach.newChat')} onPress={() => void actions.clearCoach()} /> : null}
      </View>
      <ChatView
        turns={turns}
        session={session}
        feature="coach"
        placeholder={t('coach.inputPlaceholder')}
        suggestions={[t('coach.suggestion1'), t('coach.suggestion2')]}
        limitText={(time) => t('coach.limitReached', { time })}
        limitPlaceholder={t('coach.limitReachedPlaceholder')}
        empty={
          <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
            <Text style={{ fontSize: 40 }} accessibilityElementsHidden importantForAccessibility="no">
              💪
            </Text>
            <Text variant="title" style={{ textAlign: 'center' }}>
              {t('coach.welcomeTitle')}
            </Text>
            <Text variant="body" secondary style={{ textAlign: 'center' }}>
              {t('coach.welcomeBody')}
            </Text>
            <Text variant="caption" secondary style={{ textAlign: 'center' }}>
              {t('coach.sourcesNote')}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
