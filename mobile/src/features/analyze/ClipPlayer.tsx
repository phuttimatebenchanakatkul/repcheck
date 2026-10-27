import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import { useTranslation } from '@/i18n';
import { Button, Text } from '@/ui/components';
import { radius, space } from '@/ui/tokens';

const CLIP_HEIGHT = 360;

function Player({ url, label, onError }: { url: string; label: string; onError: () => void }) {
  // Muted and looped like the website: a few seconds of a set read better on a second pass, and a clip must not shout in a gym.
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onError();
    });
    return () => subscription.remove();
  }, [player, onError]);
  return <VideoView player={player} nativeControls contentFit="contain" accessibilityLabel={label} style={{ width: '100%', height: CLIP_HEIGHT, borderRadius: radius.md, backgroundColor: '#000' }} />;
}

type State = { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'unavailable' } | { kind: 'offline' };

/**
 * The clip an analysis ran on. A link is good for five minutes, so a result that has only just come back plays the link it came with
 * (`freshUrl`) and any other analysis asks the server for a new one each time it opens, never trusting the one kept in the saved copy.
 */
export function ClipPlayer({ analysisId, freshUrl }: { analysisId: number; freshUrl?: string | null }) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  // What is on screen is derived from which request this is (the clip and the attempt), so asking again shows "loading" at once
  // without any effect having to set state on its way in.
  const key = `${analysisId}:${attempt}`;
  const usesFresh = !!freshUrl && attempt === 0;
  const [fetched, setFetched] = useState<{ key: string; state: State } | null>(null);
  const [brokenKey, setBrokenKey] = useState<string | null>(null);

  useEffect(() => {
    if (usesFresh) return;
    // A late answer to an earlier request carries that request's key, so it can never be mistaken for the current one.
    getApi()
      .analysisVideoUrl(analysisId)
      .then((url) => setFetched({ key, state: url ? { kind: 'ready', url } : { kind: 'unavailable' } }))
      .catch((error) => setFetched({ key, state: error instanceof ApiError && error.status === 0 ? { kind: 'offline' } : { kind: 'unavailable' } }));
  }, [analysisId, key, usesFresh]);

  // A link that stopped working (it expired while the screen sat open): say so and offer a new one instead of leaving a black box.
  const failed = useCallback(() => setBrokenKey(key), [key]);

  const state: State = brokenKey === key ? { kind: 'unavailable' } : usesFresh ? { kind: 'ready', url: freshUrl as string } : fetched?.key === key ? fetched.state : { kind: 'loading' };

  if (state.kind === 'ready') return <Player url={state.url} label={t('app.analyze.clip')} onError={failed} />;
  if (state.kind === 'loading') {
    return (
      <View accessible accessibilityLabel={t('app.analyze.clipLoading')} style={{ height: CLIP_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <View style={{ gap: space.sm, alignItems: 'center', paddingVertical: space.lg }}>
      <Text variant="body" secondary style={{ textAlign: 'center' }}>
        {state.kind === 'offline' ? t('app.analyze.offlineClip') : t('app.analyze.clipUnavailable')}
      </Text>
      <Button tone="plain" title={t('app.analyze.tryAgain')} onPress={() => setAttempt((n) => n + 1)} />
    </View>
  );
}
