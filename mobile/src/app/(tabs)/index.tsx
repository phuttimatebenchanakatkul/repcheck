import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/actions';
import { useTranslation } from '@/i18n';
import { getSupabase } from '@/supabase/client';
import { Button, Card, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';

export default function Home() {
  const { t } = useTranslation();
  const { state } = useAuth();
  const name = state.status === 'ready' ? state.profile.name : '';

  return (
    <Screen>
      <OfflineBanner />
      <Text variant="title" style={{ fontSize: 28 }}>
        {t('app.home.hello', { name })}
      </Text>
      <Card>
        <Text variant="body" secondary>
          {t('app.comingSoon')}
        </Text>
      </Card>
      <Button tone="plain" title={t('app.setup.signOut')} onPress={() => void signOut(getSupabase())} />
    </Screen>
  );
}
