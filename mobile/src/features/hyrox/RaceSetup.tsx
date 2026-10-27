import { useState } from 'react';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import {
  CATEGORIES,
  FORMATS,
  GENDERS,
  ROUND_STATIONS,
  SCALES,
  STATIONS,
  STATION_SPECS,
  cleanRounds,
  doublesShare,
  formatClock,
  formatWeight,
  hasPractice,
  laneOrDefault,
  personalBest,
  practiceWeight,
  roundsFor,
  runDistanceM,
  scaledStationDistanceM,
  scaledWallBallReps,
  segmentTitle,
  sessionWeightKg,
  stationMeters,
  stationWeightKg,
  type Category,
  type Format,
  type Gender,
  type Practice,
  type Race,
  type Scale,
} from '@/logic/hyrox';
import { formatDistanceKm, localeFor, type UnitPrefs } from '@/logic/units';
import { Button, Card, Field, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';
import { Row } from '@/ui/widgets';

import { LaneCard } from './LaneCard';
import { StationIcon } from './StationIcon';
import { comboLabel, raceDate } from './labels';

export interface Setup {
  category: Category | null;
  format: Format | null;
  gender: Gender | null;
  scale: Scale;
}

type Translate = (key: never, vars?: Record<string, string | number>) => string;
type Ready = Setup & { category: Category; format: Format; gender: Gender };

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
function stationStats(key: string, setup: Ready, laneM: number, units: UnitPrefs, practice: Practice, t: Translate): { stats: string; caption: string } {
  const tr = t as unknown as (key: string) => string;
  const spec = STATION_SPECS[key];
  if (key === 'wallBalls') {
    const reps = scaledWallBallReps(setup.gender, setup.scale);
    const ball = formatWeight(spec.ballKg?.[setup.gender] ?? 0, units);
    return { stats: `${reps} ${tr('hyrox.space.chip.reps')}`, caption: `${ball} · ${spec.targetFt?.[setup.gender]}ft ${tr('hyrox.space.chip.target')}` };
  }
  if (key === 'skierg' || key === 'row') return { stats: `${stationMeters(scaledStationDistanceM(key, setup.scale) ?? 0)} ${tr('hyrox.space.chip.distance')}`, caption: '' };
  const standard = stationWeightKg(key, setup.gender, setup.category);
  const current = sessionWeightKg(key, setup.gender, setup.category, setup.format, practice);
  const laps = `${roundsFor(key, setup.scale, laneM, standard !== null && current !== null ? { standardKg: standard, currentKg: current } : undefined)} ${tr('hyrox.space.laps')}`;
  return { stats: current ? `${formatWeight(current, units)} ${tr('hyrox.weightAdjust.weightLabel')} · ${laps}` : laps, caption: '' };
}

/** Pro Singles only: a lighter weight to practise with, up to the standard, which makes the distance (the laps) longer to match. */
function PracticeWeights({ setup, practice, onPractice }: { setup: Ready; practice: Practice; onPractice: (next: Practice) => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [typing, setTyping] = useState<Record<string, string>>({});
  return (
    <Card>
      {hasPractice(practice) ? (
        <Text variant="caption" style={{ color: colors.ink.amber }} testID="practice-warning">
          {t('hyrox.weightAdjust.raceFixedWarning')}
        </Text>
      ) : null}
      {ROUND_STATIONS.map((key) => {
        const standard = stationWeightKg(key, setup.gender, setup.category) as number;
        const current = sessionWeightKg(key, setup.gender, setup.category, setup.format, practice) as number;
        const title = STATIONS.find((s) => s.key === key)?.title ?? key;
        const commit = (text: string) => {
          const weight = practiceWeight(text, standard);
          const { [key]: _gone, ...rest } = practice.weights;
          onPractice({ ...practice, weights: weight < standard ? { ...rest, [key]: weight } : rest });
          setTyping(({ [key]: _typed, ...others }) => others);
        };
        return (
          <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} testID={`practice-${key}`}>
            <StationIcon name={key} size={28} />
            <View style={{ flex: 1 }}>
              <Field
                label={`${title} ${t('hyrox.weightAdjust.weightLabel')} (kg)`}
                value={typing[key] ?? String(current)}
                onChangeText={(text) => setTyping((now) => ({ ...now, [key]: text }))}
                onEndEditing={(event) => commit(event.nativeEvent.text)}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
            </View>
            {current < standard ? <Button tone="plain" title={t('hyrox.weightAdjust.reset')} onPress={() => commit('')} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

/** Doubles only: how many of each station's rounds are yours and how many your partner's; the total is the Singles total. */
function DoublesSplit({ setup, laneM, units, practice, onPractice }: { setup: Ready; laneM: number; units: UnitPrefs; practice: Practice; onPractice: (next: Practice) => void }) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState<Record<string, string>>({});
  return (
    <Card>
      <Text variant="rowTitle" accessibilityRole="header">
        {t('hyrox.step.doublesSplit')}
      </Text>
      {ROUND_STATIONS.map((key) => {
        const share = doublesShare(key, setup.scale, laneM, practice.doubles[key]);
        if (!share) return null;
        const title = STATIONS.find((s) => s.key === key)?.title ?? key;
        const weight = stationWeightKg(key, setup.gender, setup.category);
        const uneven = share.mine !== share.total - share.mine;
        const commitMine = (text: string) => {
          onPractice({ ...practice, doubles: { ...practice.doubles, [key]: cleanRounds(text, share.total) } });
          setTyping(({ [`${key}:me`]: _a, ...others }) => others);
        };
        const commitPartner = (text: string) => {
          onPractice({ ...practice, doubles: { ...practice.doubles, [key]: share.total - cleanRounds(text, share.total) } });
          setTyping(({ [`${key}:partner`]: _a, ...others }) => others);
        };
        const reset = () => {
          const { [key]: _gone, ...rest } = practice.doubles;
          onPractice({ ...practice, doubles: rest });
        };
        return (
          <View key={key} style={{ gap: space.xs }} testID={`split-${key}`}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <StationIcon name={key} size={28} />
              <Text variant="rowTitle" style={{ flex: 1 }}>
                {title}
              </Text>
              {weight ? (
                <Text variant="caption" secondary>
                  {formatWeight(weight, units)}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${t('hyrox.doublesSplit.you')} (${t('hyrox.doublesSplit.unit.rounds')}) · ${title}`}
                  value={typing[`${key}:me`] ?? String(share.mine)}
                  onChangeText={(text) => setTyping((now) => ({ ...now, [`${key}:me`]: text }))}
                  onEndEditing={(event) => commitMine(event.nativeEvent.text)}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={`${t('hyrox.doublesSplit.partner')} (${t('hyrox.doublesSplit.unit.rounds')}) · ${title}`}
                  value={typing[`${key}:partner`] ?? String(share.partner)}
                  onChangeText={(text) => setTyping((now) => ({ ...now, [`${key}:partner`]: text }))}
                  onEndEditing={(event) => commitPartner(event.nativeEvent.text)}
                  keyboardType="number-pad"
                  selectTextOnFocus
                />
              </View>
            </View>
            {uneven ? <Button tone="plain" title={t('hyrox.weightAdjust.reset')} onPress={reset} /> : null}
          </View>
        );
      })}
    </Card>
  );
}

/** Category, format, (gender,) length, the person's lane, and the whole race in order: everything to decide before the clock starts. */
export function RaceSetup({
  setup,
  onChange,
  practice,
  onPractice,
  needsGender,
  laneM,
  units,
  history,
  onStart,
}: {
  setup: Setup;
  onChange: (next: Setup) => void;
  practice: Practice;
  onPractice: (next: Practice) => void;
  /** The person has no gender on their coaching profile, so the page has to ask. */
  needsGender: boolean;
  laneM: number | null;
  units: UnitPrefs;
  history: readonly Race[];
  onStart: () => void;
}) {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const lane = laneOrDefault(laneM);

  const ready = setup.category !== null && setup.format !== null && setup.gender !== null;
  const best = ready ? personalBest(history, setup.category as Category, setup.format as Format, setup.gender as Gender, setup.scale) : null;

  const set = (patch: Partial<Setup>) => {
    const next = { ...setup, ...patch };
    // Half is Singles-only: switching to Doubles drops it rather than silently racing a half-length Doubles nobody picked.
    if (next.format !== 'singles') next.scale = 'full';
    onChange(next);
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
          <LaneCard laneM={laneM} />

          {setup.category === 'pro' && setup.format === 'singles' ? <PracticeWeights setup={setup as Ready} practice={practice} onPractice={onPractice} /> : null}
          {setup.format === 'doubles' ? <DoublesSplit setup={setup as Ready} laneM={lane} units={units} practice={practice} onPractice={onPractice} /> : null}

          <Card>
            <Text variant="rowTitle" accessibilityRole="header">
              {t('hyrox.step.agenda')}
            </Text>
            <Text variant="body" testID="agenda-summary">
              {formatDistanceKm((runM * runCount) / 1000, units)} · {t('hyrox.agenda.totalRunning', { n: runCount, each: formatDistanceKm(runM / 1000, units) })} · {stationCount} {t('hyrox.agenda.stations')}
            </Text>
            {STATIONS.map((segment, i) => {
              const { stats, caption } = segment.type === 'run' ? { stats: '', caption: '' } : stationStats(segment.key, setup as Ready, lane, units, practice, t as never);
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
