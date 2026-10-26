import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { exchangeRecoveryCode, requestPasswordReset, updatePassword } from '@/auth/actions';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation, type TranslationKey } from '@/i18n';
import { getSupabase } from '@/supabase/client';
import { Button, ErrorText, Field, Screen, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space } from '@/ui/tokens';

const MIN_PASSWORD = 8; // the website's rule

/**
 * One screen for the whole password-reset journey, reachable while signed out (to ask for the email, and to receive the link)
 * and while "recovering" (to choose the new password):
 *  1. no code in the link, signed out: ask for the email and send the reset link (the answer never says if the address is known);
 *  2. a `code` in the link: swap it for a session. The auth provider then reports PASSWORD_RECOVERY ...
 *  3. ... and, recovering: choose a new password. Done, the app carries on as that person.
 * The link only works on the phone that asked for it (the one-time code is tied to a secret kept here).
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { state, finishRecovery } = useAuth();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exchanged = useRef<string | null>(null);
  /** The code whose exchange has finished (successfully or not): until then, and only with a code, the screen is "checking your link". */
  const [finished, setFinished] = useState<string | null>(null);

  const recovering = state.status === 'recovering';
  const failure = (reason: string) => t(`app.auth.error.${reason}` as TranslationKey);

  useEffect(() => {
    if (!code || exchanged.current === code) return;
    exchanged.current = code; // a code works once; never exchange the same one twice
    if (recovering) return; // it already did its job: it is what started this recovery
    void exchangeRecoveryCode(getSupabase(), code).then((result) => {
      setFinished(code);
      if (!result.ok) setError(failure(result.reason));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, recovering]);

  async function sendLink() {
    if (!email.trim()) return setError(failure('missing'));
    setBusy(true);
    setError(null);
    const result = await requestPasswordReset(getSupabase(), email, Linking.createURL('reset-password'));
    setBusy(false);
    if (result.ok) setSent(true);
    else setError(failure(result.reason));
  }

  async function save() {
    if (password.length < MIN_PASSWORD) return setError(failure('tooShort'));
    if (password !== repeat) return setError(t('app.reset.mismatch'));
    setBusy(true);
    setError(null);
    const result = await updatePassword(getSupabase(), password);
    setBusy(false);
    if (result.ok) finishRecovery();
    else setError(failure(result.reason));
  }

  const checking = !recovering && !!code && finished !== code;

  return (
    <Screen>
      {recovering ? (
        <>
          <Text variant="title" style={{ fontSize: 24 }}>
            {t('app.reset.newTitle')}
          </Text>
          <Field label={t('app.reset.newPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" />
          <Field label={t('app.reset.repeat')} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" onSubmitEditing={() => void save()} />
          <ErrorText>{error}</ErrorText>
          <Button title={t('app.reset.save')} loading={busy} onPress={() => void save()} />
        </>
      ) : checking ? (
        <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl }}>
          <ActivityIndicator color={colors.text} />
          <Text variant="body" secondary>
            {t('app.reset.working')}
          </Text>
        </View>
      ) : (
        <>
          <Text variant="title" style={{ fontSize: 24 }}>
            {t('app.reset.title')}
          </Text>
          <Text variant="body" secondary>
            {t('app.reset.sub')}
          </Text>
          <Field label={t('app.auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" onSubmitEditing={() => void sendLink()} />
          {sent && <Text variant="body">{t('app.reset.sent')}</Text>}
          <ErrorText>{error}</ErrorText>
          <Button title={t('app.auth.sendReset')} loading={busy} onPress={() => void sendLink()} />
          <Button tone="plain" title={t('app.reset.back')} onPress={() => router.replace('/sign-in')} />
        </>
      )}
    </Screen>
  );
}
