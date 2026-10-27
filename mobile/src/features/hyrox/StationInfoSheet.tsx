import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { STATIONS } from '@/logic/hyrox';
import { STATION_HOWTO, STATION_VIDEOS, videoUrl } from '@/logic/hyroxHowto';
import { Button, Text } from '@/ui/components';
import { space } from '@/ui/tokens';
import { Sheet } from '@/ui/widgets';

import { StationIcon } from './StationIcon';

/** How a station is done: what it is, three steps, and the tip that saves the most time, with a tutorial video in the in-app browser. */
export function StationInfoSheet({ station, onClose }: { station: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const title = STATIONS.find((s) => s.key === station)?.title ?? station ?? '';
  const howto = station ? STATION_HOWTO[station] : undefined;
  const video = station ? STATION_VIDEOS[station] : undefined;
  return (
    <Sheet visible={station !== null} title={title} closeLabel={t('common.close')} onClose={onClose}>
      {station ? (
        <View style={{ gap: space.md }}>
          <View style={{ alignItems: 'center' }}>
            <StationIcon name={station} size={56} />
          </View>
          {howto ? (
            <>
              <Text variant="body" testID="howto-summary">
                {howto.summary}
              </Text>
              <Text variant="label">{t('hyrox.howto.stepsLabel')}</Text>
              {howto.steps.map((step, i) => (
                <Text key={step} variant="body" testID={`howto-step-${i}`}>
                  {i + 1}. {step}
                </Text>
              ))}
              <Text variant="body" testID="howto-tip">
                💡 {t('hyrox.howto.tipLabel')} {howto.tip}
              </Text>
            </>
          ) : null}
          {video ? <Button tone="plain" title={`▶ ${t('app.hyrox.watch')}`} onPress={() => void WebBrowser.openBrowserAsync(videoUrl(video))} /> : null}
        </View>
      ) : null}
    </Sheet>
  );
}
