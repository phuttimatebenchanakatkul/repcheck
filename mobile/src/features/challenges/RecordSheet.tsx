import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import { isLimitReached } from '@/api/challenges';
import { useAuth } from '@/auth/AuthProvider';
import { useActions } from '@/data/hooks';
import { Player } from '@/features/analyze/ClipPlayer';
import { shownMessage } from '@/features/social/queries';
import { useTranslation } from '@/i18n';
import { CHALLENGE_SECONDS, COUNTDOWN_SECONDS, MIN_RECORDING_MS, type Attempt, type ChallengeExercise } from '@/logic/challenges';
import { toIsoDate } from '@/logic/dates';
import { AiConsent } from '@/ui/AiConsent';
import { Button, ErrorText, Text } from '@/ui/components';
import { success } from '@/ui/haptics';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Sheet } from '@/ui/widgets';

type Stage =
  | { kind: 'consent'; uri?: string }
  | { kind: 'ready' }
  | { kind: 'countdown'; remaining: number }
  | { kind: 'recording' }
  | { kind: 'uploading'; uri: string }
  | { kind: 'result'; attempt: Attempt; uri: string }
  | { kind: 'error'; message: string };

/**
 * Records one attempt and has it counted: a camera preview, a countdown to get in position, up to 25 seconds of video, then the upload
 * and the server's count. templates/challenges.html (the record modal and the result popup) is the original; the website's cosmetic
 * "analysing" skeleton is not drawn. `onCounted` runs once the reps are on the board; `onLimit` when today's attempt turns out to be spent.
 */
export function RecordSheet({
  visible,
  exercise,
  title,
  onClose,
  onCounted,
  onLimit,
}: {
  visible: boolean;
  exercise: ChallengeExercise;
  title: string;
  onClose: () => void;
  onCounted: () => void;
  onLimit: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { state, refreshProfile } = useAuth();
  const actions = useActions();
  const [permission, requestPermission] = useCameraPermissions();
  const consented = state.status === 'ready' && state.profile.ai_consent;
  const [stage, setStage] = useState<Stage>({ kind: 'ready' });
  const [cameraReady, setCameraReady] = useState(false);
  const [canStop, setCanStop] = useState(false);
  const camera = useRef<CameraView>(null);
  /** Set when the sheet is closed mid-recording, so the clip that comes back is thrown away rather than sent. */
  const discard = useRef(false);

  const kind = stage.kind;
  const remaining = stage.kind === 'countdown' ? stage.remaining : 0;

  const record = async () => {
    discard.current = false;
    setCanStop(false);
    setStage({ kind: 'recording' });
    setTimeout(() => setCanStop(true), MIN_RECORDING_MS);
    try {
      const clip = await camera.current?.recordAsync({ maxDuration: CHALLENGE_SECONDS });
      if (discard.current) return;
      if (!clip?.uri) return setStage({ kind: 'error', message: t('challenges.recordFailed') });
      await send(clip.uri);
    } catch {
      if (!discard.current) setStage({ kind: 'error', message: t('challenges.recordFailed') });
    }
  };

  const send = async (uri: string) => {
    setStage({ kind: 'uploading', uri });
    try {
      const api = getApi();
      const challenge = await api.createChallenge();
      const attempt = await api.submitChallengeClip(challenge.id, { uri });
      // An attempt counts as a day's activity once the server has confirmed it, not when recording starts.
      await actions.markActivity(toIsoDate(new Date()), 'challenge').catch(() => undefined);
      success();
      onCounted();
      setStage({ kind: 'result', attempt, uri });
    } catch (error) {
      if (error instanceof ApiError && error.needsAiConsent) return setStage({ kind: 'consent', uri });
      if (isLimitReached(error)) onLimit();
      setStage({ kind: 'error', message: shownMessage(error, t('challenges.couldntProcess')) });
    }
  };

  // The countdown ticks once a second; at zero the recording starts.
  useEffect(() => {
    if (kind !== 'countdown') return;
    const timer = setTimeout(() => {
      if (remaining <= 1) void record();
      else setStage({ kind: 'countdown', remaining: remaining - 1 });
    }, 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `record` is recreated every render; only the tick should restart this
  }, [kind, remaining]);

  const stop = () => camera.current?.stopRecording();

  const close = () => {
    if (kind === 'uploading') return; // the count is on its way: wait for it
    if (kind === 'countdown' || kind === 'recording') {
      discard.current = true;
      if (kind === 'recording') camera.current?.stopRecording();
    }
    setCameraReady(false);
    setStage(consented ? { kind: 'ready' } : { kind: 'consent' });
    onClose();
  };

  const allow = async (uri?: string) => {
    try {
      await getApi().setAiConsent(true);
      await refreshProfile();
    } catch (error) {
      return setStage({ kind: 'error', message: shownMessage(error, t('challenges.couldntProcess')) });
    }
    if (uri) await send(uri);
    else setStage({ kind: 'ready' });
  };

  const showing: Stage = !consented && stage.kind === 'ready' ? { kind: 'consent' } : stage;
  const live = showing.kind === 'ready' || showing.kind === 'countdown' || showing.kind === 'recording';

  return (
    <Sheet visible={visible} title={title} closeLabel={t(showing.kind === 'result' ? 'common.done' : 'common.cancel')} onClose={close}>
      {showing.kind === 'consent' ? <AiConsent onAllow={() => void allow(showing.uri)} onDecline={close} /> : null}

      {live && permission && !permission.granted ? (
        <View style={{ gap: space.md }}>
          <ErrorText>{t('challenges.cameraAccessDenied')}</ErrorText>
          {permission.canAskAgain ? <Button tone="plain" title={t('challenges.startRecording')} onPress={() => void requestPermission()} /> : null}
        </View>
      ) : null}

      {live && permission?.granted ? (
        <View style={{ gap: space.md }}>
          <View style={{ width: '100%', aspectRatio: 3 / 4, borderRadius: radius.md, overflow: 'hidden', backgroundColor: '#000' }}>
            <CameraView ref={camera} style={{ flex: 1 }} facing="front" mode="video" mute onCameraReady={() => setCameraReady(true)} />
            {showing.kind === 'countdown' ? (
              <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Text testID="countdown" style={{ fontSize: 96, fontWeight: '800', color: '#FFFFFF' }}>
                  {showing.remaining}
                </Text>
                <Text variant="rowTitle" style={{ color: '#FFFFFF' }}>
                  {t('challenges.getReady')}
                </Text>
              </View>
            ) : null}
          </View>
          {showing.kind === 'ready' ? (
            <>
              {cameraReady ? null : (
                <Text variant="body" secondary testID="starting">
                  {t('challenges.startingCamera')}
                </Text>
              )}
              <Button title={t('challenges.startRecording')} disabled={!cameraReady} onPress={() => setStage({ kind: 'countdown', remaining: COUNTDOWN_SECONDS })} />
            </>
          ) : null}
          {showing.kind === 'recording' ? <Button title={t('challenges.stopSubmit')} disabled={!canStop} onPress={stop} /> : null}
        </View>
      ) : null}

      {live && !permission ? <ActivityIndicator testID="permission-spinner" /> : null}

      {showing.kind === 'uploading' ? (
        <View style={{ gap: space.md, alignItems: 'center', paddingVertical: space.xl }}>
          <ActivityIndicator />
          <Text variant="label" testID="analyzing">
            {t('challenges.analyzing')}
          </Text>
          <Text variant="body" secondary style={{ textAlign: 'center' }}>
            {t('challenges.uploadingCounting')}
          </Text>
        </View>
      ) : null}

      {showing.kind === 'error' ? (
        <View style={{ gap: space.md }}>
          <ErrorText>{showing.message}</ErrorText>
          <Button tone="plain" title={t('challenges.startRecording')} onPress={() => setStage({ kind: 'ready' })} />
        </View>
      ) : null}

      {showing.kind === 'result' ? (
        <View style={{ gap: space.md }}>
          <Text variant="title" accessibilityRole="header">
            {t('challenges.resultTitle', { exercise: t(`challenges.${showing.attempt.exercise}`) })}
          </Text>
          <Player url={showing.uri} label={t('app.analyze.clip')} onError={() => undefined} />
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1, alignItems: 'center', padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
              <Text variant="title" testID="total">
                {showing.attempt.total}
              </Text>
              <Text variant="caption" secondary>
                {t('challenges.repsDone')}
              </Text>
            </View>
            <View style={{ flex: 1, alignItems: 'center', padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.green.fill }}>
              <Text variant="title" testID="counted">
                {showing.attempt.counted}
              </Text>
              <Text variant="caption" secondary>
                {t('challenges.repsCounted')}
              </Text>
              <Text variant="caption" secondary>
                {t('challenges.repsCountedSub')}
              </Text>
            </View>
          </View>
          <Text variant="body" testID="note">
            {showing.attempt.rejected > 0
              ? t('challenges.resultRejected', { n: showing.attempt.rejected, s: showing.attempt.rejected === 1 ? '' : 's' })
              : t('challenges.resultAllCounted')}
          </Text>
          <Text variant="caption" secondary>
            {t('challenges.estimateNote')}
          </Text>
          <Button title={t('challenges.done')} onPress={close} />
        </View>
      ) : null}
    </Sheet>
  );
}
