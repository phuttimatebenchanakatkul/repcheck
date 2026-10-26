import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/actions';
import { useTranslation } from '@/i18n';
import { getSupabase } from '@/supabase/client';
import { Button, ErrorText, Field, Screen, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

/**
 * Between "signed in" and "has a profile": fetching or creating it, asking an email account for a name, or offering a retry
 * when the server could not be reached. Always leaves a way out (Log out), so nobody is stuck on this screen.
 */
export default function Setup() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { state, submitName, retry } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError(t('app.auth.error.missingName'));
    setBusy(true);
    setError(null);
    setError(await submitName(name));
    setBusy(false);
  }

  return (
    <Screen scroll={false} style={{ justifyContent: 'center' }}>
      {state.status === 'needs-name' ? (
        <>
          <Text variant="title" style={{ fontSize: 24 }}>
            {t('app.setup.nameTitle')}
          </Text>
          <Text variant="body" secondary>
            {t('app.setup.nameSub')}
          </Text>
          <Field label={t('app.auth.name')} value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={60} onSubmitEditing={() => void save()} />
          <ErrorText>{error}</ErrorText>
          <Button title={t('app.setup.continue')} loading={busy} onPress={() => void save()} />
        </>
      ) : state.status === 'error' ? (
        <>
          <ErrorText>{state.message}</ErrorText>
          <Button title={t('app.setup.retry')} onPress={retry} />
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: space.md }}>
          <ActivityIndicator color={colors.text} />
          <Text variant="body" secondary>
            {t('app.setup.settingUp')}
          </Text>
        </View>
      )}
      <Button tone="plain" title={t('app.setup.signOut')} onPress={() => void signOut(getSupabase())} />
    </Screen>
  );
}
