import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { SafetySheet, type SafetyTarget } from '@/features/social/SafetySheet';
import { useSocialChanged } from '@/features/social/queries';
import { useTranslation } from '@/i18n';
import { BOARD_TABS, GENDERS, formatClock, type Category, type Format, type Gender } from '@/logic/hyrox';
import { Button, Card, ErrorText, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Chip, Row } from '@/ui/widgets';

import { useBoardChanged, useHyroxBoard } from './queries';

function BoardRow({ rank, name, seconds, me, onMore, moreLabel }: { rank: number; name: string; seconds: number; me?: boolean; onMore?: () => void; moreLabel?: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View
      testID={me ? 'board-me' : `board-${rank}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: me ? colors.blue.tint : undefined }}
    >
      <Text variant={rank <= 3 ? 'title' : 'rowTitle'} secondary style={{ minWidth: 32 }}>
        {rank}
      </Text>
      <Text variant="rowTitle" style={{ flex: 1 }} numberOfLines={1}>
        {name}
        {me ? `  ${t('hyrox.leaderboard.you')}` : ''}
      </Text>
      <Text variant="label">{formatClock(seconds)}</Text>
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

/**
 * The global HYROX leaderboard: one gender at a time, and one of four boards (Open or Pro, Singles or Doubles). Every other name has a
 * way to report or block it (Guideline 1.2). `gender` is whose board this is; null asks, once, which is yours.
 */
export function LeaderboardCard({ gender, onGender, onBack }: { gender: Gender | null; onGender: (gender: Gender) => void; onBack?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const [safety, setSafety] = useState<SafetyTarget | null>(null);
  const boardChanged = useBoardChanged();
  const socialChanged = useSocialChanged();
  const { category, format } = BOARD_TABS[tab] as { category: Category; format: Format };
  const board = useHyroxBoard(gender, category, format);

  if (!gender) {
    return (
      <Card>
        <Text variant="rowTitle" accessibilityRole="header">
          {t('hyrox.leaderboard.pickGenderTitle')}
        </Text>
        {GENDERS.map((id) => (
          <Row key={id} onPress={() => onGender(id)} label={t(`hyrox.gender.${id}`)}>
            <Text variant="rowTitle">{t(`hyrox.gender.${id}`)}</Text>
          </Row>
        ))}
        {onBack ? <Button tone="plain" title={t('hyrox.backToSetup')} onPress={onBack} /> : null}
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.leaderboard.button')}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {GENDERS.map((id) => (
          <Chip key={id} label={t(`hyrox.gender.${id}`)} selected={id === gender} onPress={() => onGender(id)} />
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {BOARD_TABS.map((entry, i) => (
          <Chip key={`${entry.category}-${entry.format}`} label={`${t(`hyrox.format.${entry.format}.title`)} · ${t(`hyrox.category.${entry.category}.title`)}`} selected={i === tab} onPress={() => setTab(i)} />
        ))}
      </ScrollView>

      {board.isPending ? (
        <Text variant="body" secondary>
          {t('common.loading')}
        </Text>
      ) : board.isError ? (
        <>
          <ErrorText>{t('hyrox.leaderboard.loadError')}</ErrorText>
          <Button tone="plain" title={t('app.nutrition.retry')} onPress={() => void board.refetch()} />
        </>
      ) : (
        <>
          {board.data.rows.length === 0 ? (
            <View style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.lg }}>
              <Text variant="rowTitle">{t('hyrox.leaderboard.emptyTitle')}</Text>
              <Text variant="body" secondary>
                {t('hyrox.leaderboard.emptySub')}
              </Text>
            </View>
          ) : (
            <>
              {board.data.rows.map((row, i) => {
                const mine = board.data.mine !== null && board.data.mine.rank === i + 1;
                return (
                  <BoardRow
                    key={row.userId}
                    rank={i + 1}
                    name={row.name}
                    seconds={row.bestSeconds}
                    me={mine}
                    moreLabel={`${t('safety.moreActions')}: ${row.name}`}
                    onMore={mine ? undefined : () => setSafety({ id: row.userId, name: row.name })}
                  />
                );
              })}
              <Text variant="caption" secondary testID="board-total">
                {t('hyrox.leaderboard.totalAthletes', { n: board.data.total, s: board.data.total === 1 ? '' : 's' })}
              </Text>
            </>
          )}
          {board.data.mine && board.data.mine.rank > board.data.rows.length ? <BoardRow me rank={board.data.mine.rank} name={board.data.mine.name} seconds={board.data.mine.bestSeconds} /> : null}
          {!board.data.mine ? (
            <Text variant="caption" secondary testID="board-not-competed">
              {t('hyrox.leaderboard.notCompeted')}
            </Text>
          ) : null}
        </>
      )}
      {onBack ? <Button tone="plain" title={t('hyrox.backToSetup')} onPress={onBack} /> : null}
      <SafetySheet
        target={safety}
        onClose={() => setSafety(null)}
        onChanged={() => {
          void socialChanged();
          void boardChanged();
        }}
      />
    </Card>
  );
}
