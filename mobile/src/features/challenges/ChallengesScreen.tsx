import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useStreak } from '@/data/hooks';
import { SafetySheet, type SafetyTarget } from '@/features/social/SafetySheet';
import { useSocialChanged } from '@/features/social/queries';
import { useTranslation } from '@/i18n';
import { DEFAULT_SCOPE, isPodium, othersOnBoard, repGap, type LeaderboardScope } from '@/logic/challenges';
import { localeFor } from '@/logic/units';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Segmented } from '@/ui/widgets';

import { ExerciseIcon } from './ExerciseIcon';
import { RecordSheet } from './RecordSheet';
import { useChallengeChanged, useLeaderboard, useTodaysChallenge } from './queries';

function Row({ rank, label, reps, meta, strong, me, onMore, moreLabel }: { rank: number; label: string; reps: number; meta: string; strong: boolean; me?: boolean; onMore?: () => void; moreLabel?: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      testID={me ? 'my-standing' : `rank-${rank}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: me ? colors.blue.tint : undefined }}
    >
      <Text variant={strong ? 'title' : 'rowTitle'} secondary={!me} style={{ minWidth: 44 }}>
        #{rank}
      </Text>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="caption" secondary>
          {reps} {t('challenges.reps')}
        </Text>
      </View>
      <Text variant="label" secondary>
        {meta}
      </Text>
      {onMore ? (
        <Pressable accessibilityRole="button" accessibilityLabel={moreLabel} hitSlop={space.sm} onPress={onMore} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="title" secondary>
            ⋮
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The daily challenge: today's exercise and a way to record an attempt, and the leaderboard (friends or everybody) with report / block on every other name. */
export default function ChallengesScreen() {
  const { t, language } = useTranslation();
  const router = useRouter();
  const now = new Date();
  const [scope, setScope] = useState<LeaderboardScope>(DEFAULT_SCOPE);
  const [recording, setRecording] = useState(false);
  const [safety, setSafety] = useState<SafetyTarget | null>(null);
  const today = useTodaysChallenge();
  const board = useLeaderboard(scope);
  const streak = useStreak(now);
  const challengeChanged = useChallengeChanged();
  const socialChanged = useSocialChanged();

  const exercise = today.data?.exercise;
  const attempted = !!today.data?.attempted;
  const others = board.data ? othersOnBoard(board.data) : [];
  const mine = board.data?.mine ?? null;

  return (
    <Screen>
      <OfflineBanner />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="body" secondary>
            {now.toLocaleDateString(localeFor(language), { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
          <Text variant="label" testID="streak">
            {t('home.streakCount', { n: streak.data.current })}
          </Text>
        </View>
        {today.isError ? (
          <>
            <ErrorText>{t('safety.genericError')}</ErrorText>
            <Button tone="plain" title={t('app.nutrition.retry')} onPress={() => void today.refetch()} />
          </>
        ) : exercise ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <ExerciseIcon exercise={exercise} />
              <Text variant="title" style={{ flex: 1 }} testID="exercise">
                {t('challenges.todayIs', { exercise: t(`challenges.${exercise}`) })}
              </Text>
            </View>
            <Button title={t(attempted ? 'challenges.alreadyAttemptedToday' : 'challenges.recordAttempt')} disabled={attempted} onPress={() => setRecording(true)} />
          </>
        ) : (
          <Text variant="body" secondary>
            {t('common.loading')}
          </Text>
        )}
      </Card>

      <Text variant="title" style={{ fontSize: 22 }} accessibilityRole="header">
        {t('challenges.leaderboard')}
      </Text>
      <Segmented
        label={t('challenges.leaderboard')}
        value={scope}
        onChange={setScope}
        options={[
          { value: 'friends', label: t('challenges.friends') },
          { value: 'global', label: t('challenges.global') },
        ]}
      />

      <Card>
        {board.isPending ? (
          <Text variant="body" secondary>
            {t('common.loading')}
          </Text>
        ) : board.isError ? (
          <>
            <ErrorText>{t('safety.genericError')}</ErrorText>
            <Button tone="plain" title={t('app.nutrition.retry')} onPress={() => void board.refetch()} />
          </>
        ) : (
          <>
            {mine ? <Row me strong rank={mine.rank} label={t('challenges.youLabel')} reps={mine.totalReps} meta={t('challenges.of', { n: board.data.total })} /> : null}
            {others.map((row) => (
              <Row
                key={row.userId}
                rank={row.rank}
                label={row.name}
                reps={row.totalReps}
                strong={isPodium(row.rank)}
                meta={gapText(repGap(row.totalReps, mine ? mine.totalReps : null), t('challenges.tied'))}
                moreLabel={`${t('safety.moreActions')}: ${row.name}`}
                onMore={() => setSafety({ id: row.userId, name: row.name })}
              />
            ))}
            {!mine && others.length === 0 ? (
              <View style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.lg }}>
                <Text variant="rowTitle">{t('challenges.emptyTitle')}</Text>
                <Text variant="body" secondary>
                  {t('challenges.emptySub')}
                </Text>
              </View>
            ) : null}
            <Text variant="caption" secondary testID="board-foot">
              {board.data.total > board.data.rows.length ? t('challenges.showingTop', { n: board.data.rows.length, total: board.data.total }) : t('challenges.thatsEveryone')}
            </Text>
            {board.data.total > board.data.rows.length ? null : <Button tone="plain" title={t('challenges.inviteFriends')} onPress={() => router.push('/friends')} />}
          </>
        )}
      </Card>

      {exercise ? (
        <RecordSheet
          visible={recording}
          exercise={exercise}
          title={t('challenges.recordTitleFor', { exercise: t(`challenges.${exercise}`) })}
          onClose={() => setRecording(false)}
          onCounted={() => void challengeChanged()}
          onLimit={() => void challengeChanged()}
        />
      ) : null}
      <SafetySheet
        target={safety}
        onClose={() => setSafety(null)}
        onChanged={() => {
          void socialChanged();
          void challengeChanged();
        }}
      />
    </Screen>
  );
}

function gapText(gap: number | null, tied: string): string {
  if (gap === null) return '';
  if (gap === 0) return tied;
  return gap > 0 ? `+${gap}` : `${gap}`;
}
