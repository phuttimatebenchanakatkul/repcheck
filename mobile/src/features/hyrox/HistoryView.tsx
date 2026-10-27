import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';

import { useTranslation } from '@/i18n';
import { PB_BOARD_LIMIT, formatClock, formatClockPrecise, newestFirst, pbBoards, type Race } from '@/logic/hyrox';
import { localeFor } from '@/logic/units';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Chip, Row, Sheet } from '@/ui/widgets';

import { RaceBreakdown } from './RaceBreakdown';
import { comboLabel, raceDate } from './labels';

/** Your own best times for one combo, fastest first: the five fastest of each combo you have finished. */
function PbBoard({ races, onOpen }: { races: readonly Race[]; onOpen: (race: Race) => void }) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const locale = localeFor(language);
  const boards = pbBoards(races);
  const [chosen, setChosen] = useState<string | null>(null);
  if (!boards.length) {
    return (
      <Card>
        <Text variant="rowTitle" accessibilityRole="header">
          {t('hyrox.pb.boardTitle')}
        </Text>
        <Text variant="rowTitle" testID="pb-empty">
          {t('hyrox.pb.boardEmptyTitle')}
        </Text>
        <Text variant="body" secondary>
          {t('hyrox.pb.boardEmptySub')}
        </Text>
      </Card>
    );
  }
  // A stale choice (its last race was just removed) falls back to the first board rather than showing nothing.
  const active = boards.find((b) => b.key === chosen) ?? boards[0];
  const label = (b: (typeof boards)[number]) => `${comboLabel(t as never, b.gender, b.category, b.format)}${b.scale === 'half' ? ` · ${t('hyrox.scale.half.title')}` : ''}`;
  const rows = active.entries.slice(0, PB_BOARD_LIMIT);
  const best = rows[0].totalSeconds;
  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.pb.boardTitle')}
      </Text>
      {boards.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {boards.map((b) => (
            <Chip key={b.key} label={label(b)} selected={b.key === active.key} onPress={() => setChosen(b.key)} />
          ))}
        </ScrollView>
      ) : (
        <Text variant="label" testID="pb-solo">
          {label(active)}
        </Text>
      )}
      {rows.map((race, i) => (
        <Pressable
          key={race.id}
          accessibilityRole="button"
          accessibilityLabel={`${formatClock(race.totalSeconds)}, ${raceDate(race.date, locale)}`}
          onPress={() => onOpen(race)}
          testID={`pb-row-${i + 1}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: i === 0 ? colors.green.tint : undefined }}
        >
          <Text variant={i < 3 ? 'title' : 'rowTitle'} secondary style={{ minWidth: 40 }}>
            {i < 3 ? '#' : ''}
            {i + 1}
          </Text>
          <View style={{ flex: 1 }}>
            <Text variant="rowTitle">{formatClock(race.totalSeconds)}</Text>
            <Text variant="caption" secondary>
              {raceDate(race.date, locale)}
            </Text>
          </View>
          <Text variant="label" secondary>
            {i === 0 ? t('hyrox.pb.boardPbTag') : `+${formatClockPrecise(race.totalSeconds - best)}`}
          </Text>
        </Pressable>
      ))}
      {active.entries.length > rows.length ? (
        <Text variant="caption" secondary testID="pb-foot">
          {t('hyrox.pb.boardShowingTop', { shown: rows.length, n: active.entries.length })}
        </Text>
      ) : null}
      <Text variant="caption" secondary>
        {t('hyrox.pb.beatItHint')}
      </Text>
    </Card>
  );
}

/** One race: its time, combo and date, and where the time went. */
export function RaceDetailSheet({ race, onClose }: { race: Race | null; onClose: () => void }) {
  const { t, language } = useTranslation();
  return (
    <Sheet visible={race !== null} title={race ? formatClock(race.totalSeconds) : ''} closeLabel={t('common.close')} onClose={onClose}>
      {race ? (
        <>
          <Text variant="body" secondary testID="detail-meta">
            {comboLabel(t as never, race.gender, race.category, race.format)} · {raceDate(race.date, localeFor(language))}
          </Text>
          <RaceBreakdown race={race} />
        </>
      ) : null}
    </Sheet>
  );
}

/** Your personal bests, and every race you have finished, newest first (each opens its breakdown; each can be removed). */
export function HistoryView({ races, onRemove, onBack }: { races: readonly Race[]; onRemove: (race: Race) => void; onBack: () => void }) {
  const { t, language } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const locale = localeFor(language);
  const rows = newestFirst(races);
  const opened = races.find((r) => r.id === open) ?? null;

  const confirmRemove = (race: Race) =>
    Alert.alert(`${formatClock(race.totalSeconds)} · ${raceDate(race.date, locale)}`, undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => onRemove(race) },
    ]);

  return (
    <View style={{ gap: space.md }}>
      <PbBoard races={races} onOpen={(race) => setOpen(race.id)} />
      <Card>
        <Text variant="rowTitle" accessibilityRole="header">
          {t('hyrox.history.title')}
        </Text>
        {rows.length === 0 ? (
          <View style={{ alignItems: 'center', gap: space.xs, paddingVertical: space.lg }}>
            <Text style={{ fontSize: 36 }} accessibilityElementsHidden importantForAccessibility="no">
              ⏱️
            </Text>
            <Text variant="rowTitle">{t('hyrox.nothingYet')}</Text>
            <Text variant="body" secondary style={{ textAlign: 'center' }}>
              {t('hyrox.nothingYetSub')}
            </Text>
          </View>
        ) : (
          rows.map((race) => (
            <Row key={race.id} onPress={() => setOpen(race.id)} label={`${formatClock(race.totalSeconds)}, ${comboLabel(t as never, race.gender, race.category, race.format)}, ${raceDate(race.date, locale)}`}>
              <View style={{ flex: 1 }} testID={`history-${race.id}`}>
                <Text variant="rowTitle">{formatClock(race.totalSeconds)}</Text>
                <Text variant="caption" secondary>
                  {comboLabel(t as never, race.gender, race.category, race.format)}
                </Text>
                <Text variant="caption" secondary>
                  {raceDate(race.date, locale)}
                  {race.flagged ? ` · ${t('hyrox.history.flagged')}` : ''}
                </Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.remove')}: ${formatClock(race.totalSeconds)}`} hitSlop={space.sm} onPress={() => confirmRemove(race)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="title" secondary>
                  ×
                </Text>
              </Pressable>
            </Row>
          ))
        )}
        <Button tone="plain" title={t('hyrox.backToSetup')} onPress={onBack} />
      </Card>
      <RaceDetailSheet race={opened} onClose={() => setOpen(null)} />
    </View>
  );
}
