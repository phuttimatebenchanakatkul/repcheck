import { View } from 'react-native';

import { useTranslation } from '@/i18n';
import { space } from '@/ui/tokens';

import { Button, Text } from './components';

/** The question asked before the first thing is sent to the AI service: the website's wording (`aiConsent.*`). It lists each kind of thing the app sends: food photos, lift videos, chat messages, and the progress photos, weight and goal behind a plan. */
export function AiConsent({ onAllow, onDecline }: { onAllow: () => void; onDecline: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space.md }}>
      <Text variant="title">{t('aiConsent.title')}</Text>
      <Text variant="body">{t('aiConsent.body')}</Text>
      <Text variant="body">• {t('aiConsent.item1')}</Text>
      <Text variant="body">• {t('aiConsent.item2')}</Text>
      <Text variant="body">• {t('aiConsent.item3')}</Text>
      <Text variant="body">• {t('aiConsent.item4')}</Text>
      <Text variant="caption" secondary>
        {t('aiConsent.fine')}
      </Text>
      <Button title={t('aiConsent.allow')} onPress={onAllow} />
      <Button tone="plain" title={t('aiConsent.decline')} onPress={onDecline} />
    </View>
  );
}
