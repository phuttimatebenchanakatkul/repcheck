import { useState } from 'react';
import { View } from 'react-native';

import { useActions } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import {
  CATEGORIES,
  FORMATS,
  GENDERS,
  SCALES,
  STATIONS,
  STATION_SPECS,
  cleanLane,
  formatClock,
  formatWeight,
  laneOrDefault,
  personalBest,
  roundsFor,
  runDistanceM,
  scaledStationDistanceM,
  scaledWallBallReps,
  segmentTitle,
  stationMeters,
  stationWeightKg,
  type Category,
  type Format,
  type Gender,
  type Race,
  type Scale,
} from '@/logic/hyrox';
import { formatDistanceKm, localeFor, type UnitPrefs } from '@/logic/units';
import { Button, Card, ErrorText, Field, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Row } from '@/ui/widgets';

import { StationIcon } from './StationIcon';
import { comboLabel, raceDate } from './labels';

export interface Setup {
  category: Category | null;
  format: Format | null;
  gender: Gender | null;
  scale: Scale;
}

function Choice({ title, sub, selected, onPress }: { title: string; sub?: string; selected: boolean; onPress: () => void }) {
  return (
    <Row onPress={onPress} label={title} selected={selected}>
      <View style={{ flex: 1 }}>
        <Text variant="rowTitle">{title}</Text>
        {sub ? (
          <Text variant="caption" secondary>
            {sub}
          </Text>
        ) : null}
      </View>
    </Row>
  );
}

/** What a station asks of you at this setup: the weight and laps of the person's lane, or reps, or a distance. */
function stationStats(key: string, setup: Setup & { category: Category; gender: Gender }, laneM: number, units: UnitPrefs, t: (key: never, vars?: Record<string, string | number>) => string): { stats: string; caption: string } {
  const tr = t as unknown as (key: string) => string;
  const spec = STATION_SPECS[key];
  if (key === 'wallBalls') {
    const reps = scaledWallBallReps(setup.gender, setup.scale);
    const ball = formatWeight(spec.ballKg?.[setup.gender] ?? 0, units);
    return { stats: `${reps} ${tr('hyrox.space.chip.reps')}`, caption: `${ball} · ${spec.targetFt?.[setup.gender]}ft ${tr('hyrox.space.chip.target')}` };
  }
  if (key === 'skierg' || key === 'row') return { stats: `${stationMeters(scaledStationDistanceM(key, setup.scale) ?? 0)} ${tr('hyrox.space.chip.distance')}`, caption: '' };
  const weight = stationWeightKg(key, setup.gender, setup.category);
  const laps = `${roundsFor(key, setup.scale, laneM)} ${tr('hyrox.space.laps')}`;
  return { stats: weight ? `${formatWeight(weight, units)} ${tr('hyrox.weightAdjust.weightLabel')} · ${laps}` : laps, caption: '' };
}

/** Category, format, (gender,) length, the person's lane, and the whole race in order: everything to decide before the clock starts. */
export function RaceSetup({
  setup,
  onChange,
  needsGender,
  laneM,
  units,
  history,
  onStart,
}: {
  setup: Setup;
  onChange: (next: Setup) => void;
  /** The person has no gender on their coaching profile, so the page has to ask. */
  needsGender: boolean;
  laneM: number | null;
  units: UnitPrefs;
  history: readonly Race[];
  onStart: () => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const actions = useActions();
  const lane = laneOrDefault(laneM);
  const [laneText, setLaneText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = setup.category !== null && setup.format !== null && setup.gender !== null;
  const best = ready ? personalBest(history, setup.category as Category, setup.format as Format, setup.gender as Gender, setup.scale) : null;

  const set = (patch: Partial<Setup>) => {
    const next = { ...setup, ...patch };
    // Half is Singles-only: switching to Doubles drops it rather than silently racing a half-length Doubles nobody picked.
    if (next.format !== 'singles') next.scale = 'full';
    onChange(next);
  };

  const saveLane = async (text: string) => {
    setError(null);
    try {
      await actions.saveHyroxPrefs({ laneM: cleanLane(text) });
    } catch {
      setError(t('nutrition.log.saveError'));
    }
    setLaneText(null);
  };

  const runM = runDistanceM(setup.scale);
  const runCount = STATIONS.filter((s) => s.type === 'run').length;
  const stationCount = STATIONS.length - runCount;

  return (
    <View style={{ gap: space.md }}>
      <Text variant="label">{t('hyrox.step.category')}</Text>
      {CATEGORIES.map((id) => (
        <Choice key={id} title={t(`hyrox.category.${id}.title`)} sub={t(`hyrox.category.${id}.sub`)} selected={setup.category === id} onPress={() => set({ category: id })} />
      ))}

      <Text variant="label">{t('hyrox.step.format')}</Text>
      {FORMATS.map((id) => (
        <Choice key={id} title={t(`hyrox.format.${id}.title`)} sub={t(`hyrox.format.${id}.sub`)} selected={setup.format === id} onPress={() => set({ format: id })} />
      ))}

      {needsGender && setup.format ? (
        <>
          <Text variant="label">{t('hyrox.step.gender')}</Text>
          {GENDERS.map((id) => (
            <Choice key={id} title={t(`hyrox.gender.${id}`)} selected={setup.gender === id} onPress={() => set({ gender: id })} />
          ))}
        </>
      ) : null}

      {setup.format === 'singles' && setup.gender ? (
        <>
          <Text variant="label">{t('hyrox.step.scale')}</Text>
          {SCALES.map((id) => (
            <Choice key={id} title={t(`hyrox.scale.${id}.title`)} sub={t(`hyrox.scale.${id}.sub`)} selected={setup.scale === id} onPress={() => set({ scale: id })} />
          ))}
        </>
      ) : null}

      {ready ? (
        <>
          <Card>
            <Text variant="rowTitle" accessibilityRole="header">
              {t('hyrox.space.title')}
            </Text>
            <Text variant="body" secondary>
              {t('hyrox.space.intro')}
            </Text>
            <Text variant="caption" secondary>
              {t('hyrox.space.measureStep1Title')} {t('hyrox.space.measureStep1Body')} {t('hyrox.space.measureStep2Title')} {t('hyrox.space.measureStep2Body')}
            </Text>
            <Field
              label={`${t('hyrox.space.laneLabel')} (m)`}
              value={laneText ?? String(lane)}
              onChangeText={setLaneText}
              onEndEditing={(event) => void saveLane(event.nativeEvent.text)}
              keyboardType="decimal-pad"
              selectTextOnFocus
            />
            {laneM !== null ? <Button tone="plain" title={t('hyrox.weightAdjust.reset')} onPress={() => void saveLane('')} /> : null}
            <ErrorText>{error}</ErrorText>
          </Card>

          <Card>
            <Text variant="rowTitle" accessibilityRole="header">
              {t('hyrox.step.agenda')}
            </Text>
            <Text variant="body" testID="agenda-summary">
              {formatDistanceKm((runM * runCount) / 1000, units)} · {t('hyrox.agenda.totalRunning', { n: runCount, each: formatDistanceKm(runM / 1000, units) })} · {stationCount} {t('hyrox.agenda.stations')}
            </Text>
            {STATIONS.map((segment, i) => {
              const { stats, caption } = segment.type === 'run' ? { stats: '', caption: '' } : stationStats(segment.key, setup as Setup & { category: Category; gender: Gender }, lane, units, t as never);
              return (
                <View key={segment.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40 }} testID={`agenda-${segment.key}`}>
                  <Text variant="caption" secondary style={{ width: 20 }}>
                    {i + 1}
                  </Text>
                  <StationIcon name={segment.key} size={22} />
                  <View style={{ flex: 1 }}>
                    <Text variant="body" style={{ color: segment.type === 'run' ? colors.textSecondary : colors.text }}>
                      {segmentTitle(segment, setup.scale, units)}
                    </Text>
                    {caption ? (
                      <Text variant="caption" secondary>
                        {caption}
                      </Text>
                    ) : null}
                  </View>
                  {stats ? (
                    <Text variant="caption" secondary>
                      {stats}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      {best ? (
        <Card>
          <Text variant="caption" secondary>
            {t('hyrox.pb.setupLabel', { combo: comboLabel(t as never, best.gender, best.category, best.format) })}
          </Text>
          <Text variant="title" testID="setup-pb">
            {formatClock(best.totalSeconds)}
          </Text>
          <Text variant="caption" secondary>
            {t('hyrox.pb.setDate', { date: raceDate(best.date, localeFor(language)) })}
          </Text>
        </Card>
      ) : null}

      <Button title={t('hyrox.startRace')} disabled={!ready} onPress={onStart} />
    </View>
  );
}

