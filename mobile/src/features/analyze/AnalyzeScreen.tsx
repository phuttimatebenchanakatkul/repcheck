import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import type { PickedVideo } from '@/api/analyze';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { STATUS_STEP_MS, statusKeyAt } from '@/logic/analyzeResult';
import type { Analysis } from '@/logic/analyzeResult';
import { AiConsent } from '@/ui/AiConsent';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { chooseVideo, recordVideo, type VideoResult } from '@/ui/videos';
import { space } from '@/ui/tokens';
import { Row } from '@/ui/widgets';

import { AnalysisRow } from './AnalysisRow';
import { AnalysisView } from './AnalysisView';
import { ExerciseSheet } from './ExerciseSheet';
import { analyzeKeys, useAnalysisHistory, useUserId } from './queries';

type Stage = { kind: 'form' } | { kind: 'consent' } | { kind: 'working' } | { kind: 'error'; message: string } | { kind: 'result'; analysis: Analysis };

const RECENT_SHOWN = 5;

/** The wait for a result: the website's rotating lines, a spinner, and the thing the person should do (nothing, but stay). */
function Working() {
  const { t } = useTranslation();
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTicks((n) => n + 1), STATUS_STEP_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <View accessibilityRole="progressbar" style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
      <ActivityIndicator size="large" />
      <Text variant="rowTitle" testID="status-line" accessibilityLiveRegion="polite">
        {t(statusKeyAt(ticks * STATUS_STEP_MS))}
      </Text>
      <Text variant="body" secondary style={{ textAlign: 'center' }}>
        {t('app.analyze.working')}
      </Text>
    </View>
  );
}

/**
 * The Analyze tab: choose the exercise, film a set or pick a clip, send it to be graded, read the result. Past analyses sit below.
 * The consent question comes before anything leaves the phone, as it does everywhere an AI service is used.
 */
export default function AnalyzeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useUserId();
  const { state, refreshProfile } = useAuth();
  const consented = state.status === 'ready' && state.profile.ai_consent;
  const history = useAnalysisHistory();
  const entries = history.data ?? [];
  const now = new Date().getTime();
  const recentLabels = [...new Set(entries.map((e) => e.exercise_label))];

  const [chosen, setChosen] = useState<string | null>(null);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Like the website, the last exercise analyzed is already chosen when nothing else has been.
  const exercise = chosen ?? recentLabels[0] ?? null;

  const run = async () => {
    if (!exercise || !video) return;
    setStage({ kind: 'working' });
    try {
      const analysis = await getApi().analyzeVideo(video, exercise);
      success();
      void queryClient.invalidateQueries({ queryKey: analyzeKeys.all(userId) });
      setStage({ kind: 'result', analysis });
    } catch (error) {
      if (error instanceof ApiError && error.needsAiConsent) setStage({ kind: 'consent' });
      else setStage({ kind: 'error', message: error instanceof ApiError ? error.message : t('app.analyze.failed') });
    }
  };

  /** The question comes before anything leaves the phone: with no consent on file the clip is not sent, not even to be refused. */
  const submit = () => {
    if (!consented) setStage({ kind: 'consent' });
    else void run();
  };

  const allow = async () => {
    setStage({ kind: 'working' });
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch (error) {
      return setStage({ kind: 'error', message: error instanceof ApiError ? error.message : t('app.analyze.failed') });
    }
    await run();
  };

  const picked = (result: VideoResult) => {
    if (result.kind === 'denied') return setNotice(t('app.analyze.cameraDenied'));
    if (result.kind === 'cancelled') return;
    setNotice(null);
    setVideo(result.video);
  };

  const another = () => {
    setVideo(null);
    setStage({ kind: 'form' });
  };

  const open = (id: number) => router.push({ pathname: '/analysis', params: { id: String(id) } });

  if (stage.kind === 'result') {
    return (
      <Screen>
        <AnalysisView analysis={stage.analysis} fresh onAnother={another} />
      </Screen>
    );
  }
  if (stage.kind === 'working') {
    return (
      <Screen>
        <Working />
      </Screen>
    );
  }
  if (stage.kind === 'consent') {
    return (
      <Screen>
        <AiConsent onAllow={() => void allow()} onDecline={() => setStage({ kind: 'form' })} />
      </Screen>
    );
  }

  const ready = !!exercise && !!video;
  return (
    <Screen>
      <OfflineBanner />
      <Text variant="body" secondary>
        {t('app.analyze.sub')}
      </Text>

      <Text variant="eyebrow" secondary accessibilityRole="header">
        {t('app.analyze.exerciseLabel')}
      </Text>
      <Row onPress={() => setPicking(true)} label={exercise ? `${exercise}, ${t('analyze.changeExercise')}` : t('analyze.chooseExercise')}>
        <Text variant="rowTitle" style={{ flex: 1 }} numberOfLines={1}>
          {exercise ?? t('analyze.chooseExercise')}
        </Text>
        {exercise ? (
          <Text variant="label" secondary>
            {t('analyze.changeExercise')}
          </Text>
        ) : null}
      </Row>

      <Card>
        {video ? (
          <>
            <Text variant="rowTitle" testID="video-ready">
              {t('app.analyze.videoReady')}
            </Text>
            <Text variant="caption" secondary numberOfLines={1}>
              {video.name ?? video.uri.split('/').pop()}
            </Text>
            <Button tone="plain" title={t('app.analyze.removeVideo')} onPress={() => setVideo(null)} />
          </>
        ) : (
          <>
            <Text variant="body" secondary>
              {t('analyze.recordHint')}
            </Text>
            <Button title={t('app.analyze.record')} onPress={() => void recordVideo().then(picked)} />
            <Button tone="plain" title={t('app.analyze.choose')} onPress={() => void chooseVideo().then(picked)} />
          </>
        )}
      </Card>
      <ErrorText>{notice}</ErrorText>

      {stage.kind === 'error' ? <ErrorText>{stage.message}</ErrorText> : null}
      <Button title={t('analyze.submit')} disabled={!ready} onPress={submit} />
      {!ready ? (
        <Text variant="caption" secondary style={{ textAlign: 'center' }}>
          {t('app.analyze.pickBoth')}
        </Text>
      ) : null}

      <Text variant="eyebrow" secondary accessibilityRole="header" style={{ marginTop: space.md }}>
        {t('analyze.recentAnalyses')}
      </Text>
      {history.isError && entries.length === 0 ? (
        <Text variant="body" secondary>
          {t('app.analyze.historyFailed')}
        </Text>
      ) : entries.length === 0 && !history.isLoading ? (
        <Text variant="body" secondary>
          {t('app.analyze.noRecent')}
        </Text>
      ) : (
        entries.slice(0, RECENT_SHOWN).map((entry) => <AnalysisRow key={entry.id} entry={entry} now={now} onPress={() => open(entry.id)} />)
      )}
      {entries.length > 0 ? <Button tone="plain" title={t('analyze.viewFullLogs')} onPress={() => router.push('/analysis-history')} /> : null}

      <ExerciseSheet
        visible={picking}
        recent={recentLabels}
        onPick={(name) => {
          setChosen(name);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  );
}
