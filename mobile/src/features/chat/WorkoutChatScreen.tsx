import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getApi } from '@/api';
import { useActions, useSettings, useWorkoutHistory, useWorkoutThread } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { historyForServer, type ChatTurn } from '@/logic/chat';
import { toIsoDate } from '@/logic/dates';
import { localeFor } from '@/logic/units';
import { buildWorkoutSummary } from '@/logic/workoutSummary';
import { Button, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

import { ChatView } from './ChatView';
import { useChatSession } from './useChatSession';

/** A standard navigation bar is this tall below the status bar; the keyboard has to clear it too. */
const NAV_BAR = 44;

/** The day the link names, or today when it names none or nonsense. */
export function dayFromParam(param: string | undefined, today: string): string {
  return param !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(param) && !Number.isNaN(Date.parse(`${param}T00:00:00Z`)) ? param : today;
}

/**
 * Ask about your training (`/workout-chat?day=2026-10-27`): progressive overload, form, whether you are training a muscle enough. Each
 * question is sent with a summary of the last week and each exercise's last four sessions (the website's, line for line). One thread
 * per day, kept for good; a past day's thread can be read but only today's takes questions, and "New chat" empties one day only.
 */
export default function WorkoutChatScreen() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const actions = useActions();
  const params = useLocalSearchParams<{ day?: string }>();
  const today = toIsoDate(new Date());
  const day = dayFromParam(params.day, today);
  const isToday = day === today;
  const thread = useWorkoutThread(day);
  const history = useWorkoutHistory();
  const units = useSettings().data.units;
  const locale = localeFor(language);

  const ask = useCallback(
    (message: string, turns: readonly ChatTurn[]) => {
      const words = (key: 'workouts.plan.today' | 'workouts.day.yesterday') => t(key);
      const summary = buildWorkoutSummary(history.data, toIsoDate(new Date()), units, words, locale);
      return getApi().workoutChat(message, historyForServer(turns, 'assistant'), { workout_summary: summary });
    },
    [history.data, locale, t, units],
  );
  const session = useChatSession({ turns: thread.data, save: actions.saveWorkoutTurn, ask, errorText: t('workoutChat.errorReaching') });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm }}>
        <OfflineBanner />
        {isToday && thread.data.length > 0 ? <Button tone="plain" title={t('coach.newChat')} onPress={() => void actions.clearWorkoutThread(day)} /> : null}
      </View>
      <ChatView
        turns={thread.data}
        session={session}
        feature="workout_chat"
        keyboardOffset={insets.top + NAV_BAR}
        placeholder={t('workoutChat.inputPlaceholder')}
        suggestions={[t('workoutChat.suggestion1'), t('workoutChat.suggestion2')]}
        limitText={(time) => t('workoutChat.limitReached', { time })}
        limitPlaceholder={t('workoutChat.limitReachedPlaceholder')}
        closedText={isToday ? undefined : t('workoutChat.readOnlyDayStatus')}
        closedPlaceholder={t('workoutChat.readOnlyDayPlaceholder')}
        header={
          <View style={{ gap: space.xs }}>
            <Text variant="rowTitle" accessibilityRole="header">
              {t('workoutChat.title')}
            </Text>
            <Text variant="caption" secondary>
              {t('workoutChat.subtitle')}
            </Text>
          </View>
        }
        empty={
          <Text variant="body" secondary>
            {t('workoutChat.empty')}
          </Text>
        }
      />
    </View>
  );
}
