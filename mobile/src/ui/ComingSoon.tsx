import { useTranslation, type TranslationKey } from '@/i18n';

import { Card, Screen, Text } from './components';
import { OfflineBanner } from './OfflineBanner';

/** A tab's placeholder until its phase is built (see MOBILE_APP_PLAN.md, phases 3-5). */
export function ComingSoon({ titleKey }: { titleKey: TranslationKey }) {
  const { t } = useTranslation();
  return (
    <Screen>
      <OfflineBanner />
      <Text variant="title" style={{ fontSize: 28 }}>
        {t(titleKey)}
      </Text>
      <Card>
        <Text variant="body" secondary>
          {t('app.comingSoon')}
        </Text>
      </Card>
    </Screen>
  );
}
