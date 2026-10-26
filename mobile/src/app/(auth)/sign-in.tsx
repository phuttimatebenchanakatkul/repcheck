import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { useAuth } from '@/auth/AuthProvider';
import { signInWithEmail, signUpWithEmail, type AuthResult } from '@/auth/actions';
import { appleSignInAvailable, signInWithApple } from '@/auth/apple';
import { GOOGLE_ENABLED, signInWithGoogle } from '@/auth/google';
import { useTranslation, type TranslationKey } from '@/i18n';
import { getSupabase } from '@/supabase/client';
import { Button, ErrorText, Field, Screen, Text } from '@/ui/components';
import { useTheme } from '@/ui/theme';
import { space, type } from '@/ui/tokens';

/** The public policy pages: they open for someone with no account yet, which is the point of showing them here. */
const TERMS_URL = 'https://repcheck-q0m4.onrender.com/terms';
const PRIVACY_URL = 'https://repcheck-q0m4.onrender.com/privacy';

export default function SignIn() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { rememberNameHint } = useAuth();
  const [mode, setMode] = useState<'log-in' | 'sign-up'>('log-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const signingUp = mode === 'sign-up';

  useEffect(() => {
    void appleSignInAvailable().then(setAppleAvailable);
  }, []);

  function describe(result: AuthResult): void {
    if (result.ok) return; // the auth listener moves the app on
    if (result.reason === 'cancelled') return;
    if (result.reason === 'confirm-email') {
      setNotice(t('app.auth.confirmEmail'));
      setMode('log-in');
      return;
    }
    setError(t(`app.auth.error.${result.reason}` as TranslationKey));
  }

  async function run(work: () => Promise<AuthResult>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      describe(await work());
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (!email.trim() || !password) return setError(t('app.auth.error.missing'));
    if (signingUp && !name.trim()) return setError(t('app.auth.error.missingName'));
    void run(() => (signingUp ? signUpWithEmail(getSupabase(), email, password, name) : signInWithEmail(getSupabase(), email, password)));
  }

  function apple() {
    void run(async () => {
      const { result, fullName } = await signInWithApple(getSupabase());
      if (result.ok) rememberNameHint(fullName);
      return result;
    });
  }

  const link = { color: colors.link, textDecorationLine: 'underline' as const };

  return (
    <Screen>
      <View style={{ gap: space.xs, marginTop: space.xl }}>
        <Text variant="title" style={{ fontSize: 28 }}>
          {signingUp ? t('app.auth.createAccount') : t('app.auth.welcomeBack')}
        </Text>
      </View>

      {appleAvailable && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={24}
          style={{ height: 48 }}
          onPress={apple}
        />
      )}
      {GOOGLE_ENABLED && <Button tone="plain" title={t('app.auth.continueGoogle')} disabled={busy} onPress={() => void run(() => signInWithGoogle(getSupabase()))} />}

      {(appleAvailable || GOOGLE_ENABLED) && (
        <Text variant="caption" secondary style={{ textAlign: 'center' }}>
          {t('app.auth.or')}
        </Text>
      )}

      {signingUp && <Field label={t('app.auth.name')} value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" maxLength={60} />}
      <Field label={t('app.auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field
        label={t('app.auth.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={signingUp ? 'new-password' : 'current-password'}
        textContentType={signingUp ? 'newPassword' : 'password'}
        onSubmitEditing={submit}
      />

      {notice && <Text variant="body">{notice}</Text>}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? t('app.auth.working') : signingUp ? t('app.auth.signUp') : t('app.auth.logIn')} loading={busy} onPress={submit} />

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.xs, alignItems: 'center' }}>
        <Text variant="body" secondary>
          {signingUp ? t('app.auth.haveAccount') : t('app.auth.noAccount')}
        </Text>
        <Pressable accessibilityRole="link" hitSlop={12} onPress={() => (setMode(signingUp ? 'log-in' : 'sign-up'), setError(null))}>
          <RNText style={[type.label as object, { color: colors.link }]}>{signingUp ? t('app.auth.logIn') : t('app.auth.signUp')}</RNText>
        </Pressable>
      </View>

      {/* App Store Guideline 5.1.2(i): disclosed before the account exists, and it covers all three ways in. */}
      <RNText style={[type.caption as object, { color: colors.textSecondary, lineHeight: 17 }]}>
        {t('app.auth.consent.pre')}
        <RNText accessibilityRole="link" style={link} onPress={() => void WebBrowser.openBrowserAsync(TERMS_URL)}>
          {t('app.auth.consent.terms')}
        </RNText>
        {t('app.auth.consent.mid')}
        <RNText accessibilityRole="link" style={link} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_URL)}>
          {t('app.auth.consent.privacy')}
        </RNText>
        {t('app.auth.consent.post')}
      </RNText>
    </Screen>
  );
}
