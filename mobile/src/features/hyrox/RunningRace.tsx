import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { useTranslation } from '@/i18n';
import {
  STATIONS,
  STATION_SPECS,
  formatClock,
  formatClockPrecise,
  formatWeight,
  roundsToDo,
  sessionWeightKg,
  type Practice,
  scaledStationDistanceM,
  scaledWallBallReps,
  segmentTitle,
  stationMeters,
  type Category,
  type Format,
  type Gender,
  type Scale,
  type Segment,
  type Split,
} from '@/logic/hyrox';
import type { UnitPrefs } from '@/logic/units';
import { Button, Card, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';

import { StationIcon } from './StationIcon';

export interface RaceConfig {
  category: Category;
  format: Format;
  gender: Gender;
  scale: Scale;
  /** A practice session's lighter weights and shares; the standard where nothing was changed. */
  practice: Practice;
}

/** What to do at the segment now: the number of reps, or laps (and the load), or the distance. */
function Now({ segment, config, laneM, units }: { segment: Segment; config: RaceConfig; laneM: number; units: UnitPrefs }) {
  const { t } = useTranslation();
  if (segment.type === 'run') return null;
  const spec = STATION_SPECS[segment.key];
  const chip = (value: string, label: string, testID: string) => (
    <View key={testID} style={{ alignItems: 'center', minWidth: 80 }}>
      <Text variant="title" testID={testID}>
        {value}
      </Text>
      <Text variant="caption" secondary>
        {label}
      </Text>
    </View>
  );
  if (segment.key === 'wallBalls') {
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
        {chip(String(scaledWallBallReps(config.gender, config.scale)), t('hyrox.space.chip.reps'), 'now-reps')}
        {chip(formatWeight(spec.ballKg?.[config.gender] ?? 0, units), t('hyrox.space.chip.ball'), 'now-ball')}
        {chip(`${spec.targetFt?.[config.gender]}ft`, t('hyrox.space.chip.target'), 'now-target')}
      </View>
    );
  }
  if (segment.key === 'skierg' || segment.key === 'row') {
    return <View style={{ flexDirection: 'row', justifyContent: 'center' }}>{chip(stationMeters(scaledStationDistanceM(segment.key, config.scale) ?? 0), t('hyrox.space.chip.distance'), 'now-distance')}</View>;
  }
  const rounds = roundsToDo(segment.key, config.format, config.scale, laneM, config.practice, config.gender, config.category);
  const weight = sessionWeightKg(segment.key, config.gender, config.category, config.format, config.practice);
  const label = segment.key === 'sledPush' || segment.key === 'sledPull' ? t('hyrox.space.chip.sled') : segment.key === 'farmersCarry' ? t('hyrox.space.chip.perHand') : segment.key === 'lunges' ? t('hyrox.space.chip.sandbag') : t('hyrox.space.chip.load');
  return (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <Text style={{ fontSize: 56, lineHeight: 64, fontWeight: '800' }} testID="now-rounds">
        {rounds}
      </Text>
      <Text variant="label" secondary>
        {config.format === 'doubles' ? t('hyrox.running.yourShare') : t('hyrox.running.roundsLabel')}
      </Text>
      {weight ? (
        <Text variant="body" testID="now-weight">
          {formatWeight(weight, units)} {label.toLowerCase()}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The race itself: the clock, the segment to do now with what it asks of you, and one big button to finish it. The clock is the time since
 * the start, so it stays right if the screen locks or the app is away for a while. Finishing the last segment hands the splits back.
 */
export function RunningRace({
  config,
  laneM,
  units,
  onFinish,
  onCancel,
  onInfo,
}: {
  config: RaceConfig;
  laneM: number;
  units: UnitPrefs;
  onFinish: (splits: Split[], totalSeconds: number) => void;
  onCancel: () => void;
  onInfo: (station: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [start] = useState(() => new Date().getTime());
  const [elapsed, setElapsed] = useState(0);
  const [index, setIndex] = useState(0);
  const [splits, setSplits] = useState<Split[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((new Date().getTime() - start) / 1000), 200);
    return () => clearInterval(timer);
  }, [start]);

  const segment = STATIONS[index];
  const isLast = index >= STATIONS.length - 1;

  const complete = () => {
    const at = (new Date().getTime() - start) / 1000;
    const next = [...splits, { key: segment.key, title: segmentTitle(segment, config.scale, units), atSeconds: at }];
    if (isLast) return onFinish(next, at);
    setSplits(next);
    setIndex(index + 1);
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View>
          <Text variant="title" testID="timer">
            {formatClock(elapsed)}
          </Text>
          <Text variant="caption" secondary>
            {t('hyrox.running.elapsed')}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="title" testID="count">
            {index + 1}/{STATIONS.length}
          </Text>
          <Text variant="caption" secondary>
            {t('hyrox.running.segmentLabel')}
            {config.format === 'doubles' ? ` · ${t('hyrox.running.doublesBadge')}` : ''}
          </Text>
        </View>
      </View>

      <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.md }}>
        <Text variant="eyebrow" secondary>
          {t('hyrox.running.upNow')}
        </Text>
        <StationIcon name={segment.key} size={64} />
        <Text variant="title" testID="now-title" accessibilityRole="header">
          {segmentTitle(segment, config.scale, units)}
        </Text>
        <Now segment={segment} config={config} laneM={laneM} units={units} />
        {segment.type === 'station' ? <Button tone="plain" title={t('hyrox.running.howTo')} onPress={() => onInfo(segment.key)} /> : null}
      </View>

      <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: STATIONS.length, now: index }} style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((index / STATIONS.length) * 100)}%`, height: '100%', backgroundColor: colors.green.fill }} />
      </View>

      <Button title={isLast ? t('hyrox.finishRace') : t('hyrox.complete.generic')} onPress={complete} />
      <Button
        tone="plain"
        title={t('hyrox.cancelThisRace')}
        onPress={() =>
          Alert.alert(t('hyrox.cancelThisRace'), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('hyrox.cancelRace'), style: 'destructive', onPress: onCancel },
          ])
        }
      />

      {splits.length ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label" secondary>
            {t('hyrox.running.doneLabel', { count: splits.length })}
          </Text>
          {splits
            .slice()
            .reverse()
            .map((split, i) => {
              const at = splits.length - i - 1;
              const delta = at === 0 ? split.atSeconds : split.atSeconds - splits[at - 1].atSeconds;
              return (
                <View key={`${split.key}-${at}`} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} testID={`done-${at}`}>
                  <StationIcon name={split.key} size={18} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {split.title}
                  </Text>
                  <Text variant="label">{formatClockPrecise(delta)}</Text>
                  <Text variant="caption" secondary style={{ width: 56, textAlign: 'right' }}>
                    {formatClock(split.atSeconds)}
                  </Text>
                </View>
              );
            })}
        </View>
      ) : null}
    </Card>
  );
}
