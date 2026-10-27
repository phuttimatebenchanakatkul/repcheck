import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { getApi } from '@/api';
import { useActions, useCoachingProfile, useHyroxPrefs, useHyroxRaces, useSettings } from '@/data/hooks';
import { useTranslation } from '@/i18n';
import { NO_PRACTICE, STATIONS, defaultCustomRace, finishedCustomRace, type CustomBlock, STATION_KEYS, allPersonalBests, finishedRace, formatClock, laneOrDefault, leaderboardResult, profileGender, type Category, type Format, type Gender, type Practice, type Race, type Split, practiceAfter } from '@/logic/hyrox';
import { newId } from '@/logic/ids';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Row } from '@/ui/widgets';
import { space } from '@/ui/tokens';

import { CustomBuilder } from './CustomBuilder';
import { FinishedView } from './FinishedView';
import { HistoryView } from './HistoryView';
import { LaneCard } from './LaneCard';
import { LeaderboardCard } from './LeaderboardCard';
import { RaceSetup, type Setup } from './RaceSetup';
import { RunningRace } from './RunningRace';
import { StationIcon } from './StationIcon';
import { StationInfoSheet } from './StationInfoSheet';
import { comboLabel } from './labels';

type Page = 'home' | 'setup' | 'running' | 'finished' | 'history' | 'leaderboard';

/** The first screen: your fastest time (or an invitation), the eight stations, and the way in to a race. */
function Hero({ races, onStart, onHistory, onInfo }: { races: readonly Race[]; onStart: () => void; onHistory: () => void; onInfo: (station: string) => void }) {
  const { t } = useTranslation();
  const best = allPersonalBests(races)[0] ?? null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="eyebrow" secondary>
          {t('hyrox.hero.kicker')}
        </Text>
        {races.length ? (
          <Text variant="label" testID="race-count">
            🏁 {t('hyrox.hero.races', { n: races.length, s: races.length === 1 ? '' : 's' })}
          </Text>
        ) : null}
      </View>
      {best ? (
        <>
          <Text style={{ fontSize: 44, lineHeight: 52, fontWeight: '800' }} testID="hero-time">
            {formatClock(best.totalSeconds)}
          </Text>
          <Text variant="body" secondary testID="hero-sub">
            {t('hyrox.hero.pbSub', { combo: comboLabel(t as never, best.gender, best.category, best.format) })}
          </Text>
        </>
      ) : races.length ? (
        <>
          <Text variant="title" testID="hero-title">
            {t('hyrox.hero.noPbTitle')}
          </Text>
          <Text variant="body" secondary>
            {t('hyrox.hero.noPbSub')}
          </Text>
        </>
      ) : (
        <>
          <Text variant="title" testID="hero-title">
            {t('hyrox.hero.emptyTitle')}
          </Text>
          <Text variant="body" secondary>
            {t('hyrox.hero.emptySub')}
          </Text>
        </>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {STATION_KEYS.map((key) => (
          <Pressable key={key} accessibilityRole="button" accessibilityLabel={STATIONS.find((s) => s.key === key)?.title ?? key} onPress={() => onInfo(key)} hitSlop={space.xs} style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}>
            <StationIcon name={key} size={28} />
          </Pressable>
        ))}
      </View>
      <Button title={t('hyrox.startRace')} onPress={onStart} />
      <Button tone="plain" title={t('hyrox.viewPersonalBests')} onPress={onHistory} />
    </Card>
  );
}

/**
 * The HYROX race tracker (`/hyrox`): pick the race, run it by tapping through the sixteen segments against the clock, see where the time
 * went, and keep every race in a history with your personal bests. A finished race is saved to the account (and its time put on the
 * leaderboard when it counts there); static/hyrox.js is the original.
 */
export default function HyroxScreen() {
  const { t } = useTranslation();
  const actions = useActions();
  const units = useSettings().data.units;
  const races = useHyroxRaces();
  const prefs = useHyroxPrefs();
  const coaching = useCoachingProfile();
  const [view, setView] = useState<Page>('home');
  const [setup, setSetup] = useState<Setup>({ category: null, format: null, gender: null, scale: 'full' });
  const [finished, setFinished] = useState<Race | null>(null);
  const [practice, setPractice] = useState<Practice>(NO_PRACTICE);
  const [info, setInfo] = useState<string | null>(null);
  const [raceType, setRaceType] = useState<'standard' | 'custom'>('standard');
  // The race being built is kept for the visit, so going back to Standard and again to Custom does not lose it.
  const [blocks, setBlocks] = useState<CustomBlock[]>(() => defaultCustomRace(newId));
  const [error, setError] = useState<string | null>(null);

  // The gender on the coaching profile decides the standard; only someone with no profile is asked.
  const fromProfile = profileGender(coaching.data?.gender);
  const effective: Setup = { ...setup, gender: fromProfile ?? setup.gender };
  const laneM = laneOrDefault(prefs.data.laneM);
  // Whose leaderboard: the one chosen (or raced under last), else the profile's gender; null asks.
  const boardGender: Gender | null = prefs.data.leaderboardGender ?? fromProfile;

  // The standard race being run; a hand-made one has no such thing (null).
  const runConfig = raceType === 'standard' && effective.category && effective.format && effective.gender ? { category: effective.category, format: effective.format, gender: effective.gender, scale: effective.scale, practice } : null;

  const finish = async (splits: Split[], totalSeconds: number) => {
    const config = effective as { category: Category; format: Format; gender: Gender; scale: Setup['scale'] };
    const custom = raceType === 'custom';
    const race = custom ? finishedCustomRace(splits, totalSeconds, newId(), new Date().toISOString()) : finishedRace(config, splits, totalSeconds, races.data, newId(), new Date().toISOString());
    setFinished(race);
    setError(null);
    setView('finished');
    try {
      await actions.saveHyroxRace(race);
    } catch {
      setError(t('hyrox.history.saveError'));
    }
    // The leaderboard's copy is a bonus: the race is already in the history, so any trouble here is quiet.
    const result = leaderboardResult(race);
    if (result) {
      await actions.saveHyroxPrefs({ leaderboardGender: config.gender }).catch(() => undefined);
      await getApi().submitHyroxResult(result);
    }
  };

  /** Keeps the AI's read on the race (the history and the finish screen both show it from there). */
  const analysed = async (race: Race) => {
    setFinished((current) => (current && current.id === race.id ? race : current));
    try {
      await actions.saveHyroxRace(race);
    } catch {
      setError(t('hyrox.history.saveError'));
    }
  };

  const chooseBoardGender = (gender: Gender) => {
    void actions.saveHyroxPrefs({ leaderboardGender: gender }).catch(() => undefined);
  };

  const remove = async (race: Race) => {
    setError(null);
    try {
      await actions.deleteHyroxRace(race.id);
    } catch {
      setError(t('hyrox.history.deleteError'));
    }
  };

  /** A change to the setup; a practice weight or split measured against what was changed goes with it. */
  const changeSetup = (next: Setup) => {
    setPractice((current) => practiceAfter(effective, { ...next, gender: fromProfile ?? next.gender }, current));
    setSetup(next);
  };

  const reset = () => {
    setSetup({ category: null, format: null, gender: null, scale: 'full' });
    setPractice(NO_PRACTICE);
    setRaceType('standard');
    setView('home');
  };

  return (
    <Screen>
      <OfflineBanner />
      {races.isLoading ? (
        <ActivityIndicator />
      ) : (
        <>
          {view === 'home' ? (
            <>
              <Hero races={races.data} onStart={() => setView('setup')} onHistory={() => setView('history')} onInfo={setInfo} />
              <LeaderboardCard gender={boardGender} onGender={chooseBoardGender} />
            </>
          ) : null}

          {view === 'setup' ? (
            <>
              <Button tone="plain" title={t('common.back')} onPress={() => setView('home')} />
              <Text variant="title" accessibilityRole="header">
                {t('hyrox.setupSheet.title')}
              </Text>
              <Text variant="label">{t('hyrox.step.raceType')}</Text>
              {(['standard', 'custom'] as const).map((id) => (
                <Row key={id} onPress={() => setRaceType(id)} label={t(`hyrox.raceType.${id}.title`)} selected={raceType === id}>
                  <View style={{ flex: 1 }}>
                    <Text variant="rowTitle">{t(`hyrox.raceType.${id}.title`)}</Text>
                    <Text variant="caption" secondary>
                      {t(`hyrox.raceType.${id}.sub`)}
                    </Text>
                  </View>
                </Row>
              ))}
              {raceType === 'standard' ? (
                <RaceSetup setup={effective} onChange={changeSetup} practice={practice} onPractice={setPractice} needsGender={fromProfile === null} laneM={prefs.data.laneM} units={units} history={races.data} onStart={() => setView('running')} />
              ) : (
                <>
                  <CustomBuilder blocks={blocks} onChange={setBlocks} onReset={() => setBlocks(defaultCustomRace(newId))} />
                  <LaneCard laneM={prefs.data.laneM} />
                  <Button title={t('hyrox.startRace')} disabled={blocks.length === 0} onPress={() => setView('running')} />
                </>
              )}
            </>
          ) : null}

          {view === 'running' && (raceType === 'custom' || runConfig) ? (
            <RunningRace
              config={runConfig}
              custom={raceType === 'custom' ? blocks : null}
              laneM={laneM}
              units={units}
              onFinish={(splits, total) => void finish(splits, total)}
              onCancel={reset}
              onInfo={setInfo}
            />
          ) : null}

          {view === 'finished' && finished ? <FinishedView race={finished} onAnother={reset} onHistory={() => setView('history')} onLeaderboard={() => setView('leaderboard')} onAnalysed={(race) => void analysed(race)} /> : null}

          {view === 'leaderboard' ? <LeaderboardCard gender={boardGender} onGender={chooseBoardGender} onBack={reset} /> : null}

          {view === 'history' ? <HistoryView races={races.data} onRemove={(race) => void remove(race)} onBack={reset} onAnalysed={(race) => void analysed(race)} /> : null}

          <StationInfoSheet station={info} onClose={() => setInfo(null)} />
          <ErrorText>{error}</ErrorText>
          <Text variant="caption" secondary testID="trademark">
            {t('hyrox.trademarkNote')}
          </Text>
        </>
      )}
    </Screen>
  );
}
