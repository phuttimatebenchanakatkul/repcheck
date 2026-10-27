import * as WebBrowser from 'expo-web-browser';
import { useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Appearance, Pressable, TextInput, View } from 'react-native';

import { ApiError, getApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { signOut } from '@/auth/actions';
import { useActions, useCoachingProfile, useSettings } from '@/data/hooks';
import { shownMessage, useBlockedAccounts, useSocialChanged } from '@/features/social/queries';
import { useTranslation } from '@/i18n';
import { chooseLanguage } from '@/i18n/storage';
import { ACCOUNT_GRACE_DAYS, colorSchemeOverride, formatDueDate, providerName } from '@/logic/account';
import { localeFor, type UnitPrefs } from '@/logic/units';
import { AI_PRIVACY_URL, LEGAL_LINKS, WEBSITE_URL } from '@/links';
import { getSupabase } from '@/supabase/client';
import { Button, Card, ErrorText, Screen, Text } from '@/ui/components';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { useTheme } from '@/ui/theme';
import { radius, space } from '@/ui/tokens';
import { Row, Segmented } from '@/ui/widgets';

function Section({ title, sub, children, danger }: { title: string; sub?: string; children: ReactNode; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Card style={danger ? { borderColor: colors.red.fill } : undefined}>
      <Text variant="rowTitle" accessibilityRole="header">
        {title}
      </Text>
      {sub ? (
        <Text variant="body" secondary>
          {sub}
        </Text>
      ) : null}
      {children}
    </Card>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      {children}
    </View>
  );
}

const open = (url: string) => void WebBrowser.openBrowserAsync(url);

/** Your name, and the email it is under (managed by Apple or Google when you signed in with one). */
function AccountSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { state, refreshProfile } = useAuth();
  const profile = state.status === 'ready' ? state.profile : null;
  const user = state.status === 'ready' ? state.session.user : null;
  const [name, setName] = useState(profile?.name ?? '');
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({ kind: 'idle' });
  const provider = providerName(user?.app_metadata?.provider);

  const save = async () => {
    setStatus({ kind: 'saving' });
    try {
      await getApi().rename(name.trim());
      await refreshProfile();
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof ApiError && error.status !== 0 && error.status < 500 ? error.message : t('settings.account.errorGeneric') });
    }
  };

  return (
    <Section title={t('settings.account.title')} sub={t('settings.account.sub')}>
      <Line label={t('settings.account.nameLabel')}>
        <TextInput
          accessibilityLabel={t('settings.account.nameLabel')}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setStatus({ kind: 'idle' });
          }}
          maxLength={40}
          autoCapitalize="words"
          style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, paddingHorizontal: space.md, fontSize: 16 }}
        />
      </Line>
      <Line label={t('settings.account.emailLabel')}>
        <Text variant="body" testID="account-email">
          {user?.email ?? '—'}
        </Text>
        {provider ? (
          <Text variant="caption" secondary>
            {t('settings.account.emailManagedBy', { provider })}
          </Text>
        ) : null}
      </Line>
      <Button title={status.kind === 'saving' ? t('settings.account.saving') : t('settings.account.save')} loading={status.kind === 'saving'} disabled={!name.trim() || name.trim() === profile?.name} onPress={() => void save()} />
      {status.kind === 'saved' ? <Text variant="label" style={{ color: colors.ink.green }}>{t('settings.account.saved')}</Text> : null}
      {status.kind === 'error' ? <ErrorText>{status.message}</ErrorText> : null}
    </Section>
  );
}

/** Theme, language and the four units. They are account settings: a change is saved to the account and applies at once. */
function PreferencesSections() {
  const { t, language } = useTranslation();
  const settings = useSettings().data;
  const actions = useActions();
  const [error, setError] = useState<string | null>(null);

  const save = async (next: typeof settings) => {
    setError(null);
    try {
      await actions.saveSettings(next);
    } catch {
      setError(t('settings.account.errorGeneric'));
    }
  };
  const setUnit = <K extends keyof UnitPrefs>(key: K, value: UnitPrefs[K]) => void save({ ...settings, units: { ...settings.units, [key]: value } });

  return (
    <>
      <Section title={t('settings.appearance.title')} sub={t('settings.appearance.sub')}>
        <Segmented
          label={t('settings.appearance.theme')}
          value={settings.theme ?? 'system'}
          options={[
            { value: 'system', label: t('app.settings.system') },
            { value: 'light', label: t('settings.appearance.light') },
            { value: 'dark', label: t('settings.appearance.dark') },
          ]}
          onChange={(value) => {
            const theme = value === 'system' ? null : value;
            Appearance.setColorScheme(colorSchemeOverride(theme));
            void save({ ...settings, theme });
          }}
        />
      </Section>

      <Section title={t('settings.language.title')} sub={t('settings.language.sub')}>
        <Segmented
          label={t('settings.language.appLanguage')}
          value={language}
          options={[
            { value: 'en', label: t('settings.language.en') },
            { value: 'th', label: t('settings.language.th') },
          ]}
          onChange={(language) => {
            void chooseLanguage(language);
            void save({ ...settings, language });
          }}
        />
      </Section>

      <Section title={t('settings.units.title')} sub={t('settings.units.sub')}>
        <Line label={t('settings.units.weight')}>
          <Segmented label={t('settings.units.weight')} value={settings.units.weight} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} onChange={(v) => setUnit('weight', v)} />
        </Line>
        <Line label={t('settings.units.height')}>
          <Segmented label={t('settings.units.height')} value={settings.units.height} options={[{ value: 'cm', label: 'cm' }, { value: 'ftin', label: t('settings.units.ftin') }]} onChange={(v) => setUnit('height', v)} />
        </Line>
        <Line label={t('settings.units.distance')}>
          <Segmented label={t('settings.units.distance')} value={settings.units.distance} options={[{ value: 'km', label: 'km' }, { value: 'm', label: 'm' }]} onChange={(v) => setUnit('distance', v)} />
        </Line>
        <Line label={t('settings.units.clock')}>
          <Segmented label={t('settings.units.clock')} value={settings.units.clock} options={[{ value: '12h', label: t('settings.units.12h') }, { value: '24h', label: t('settings.units.24h') }]} onChange={(v) => setUnit('clock', v)} />
        </Line>
        <ErrorText>{error}</ErrorText>
      </Section>
    </>
  );
}

/** Consent to send what you submit to the AI service, as easy to withdraw as to give (Guideline 5.1.2(i)). */
function AiSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { state, refreshProfile } = useAuth();
  const on = state.status === 'ready' && state.profile.ai_consent;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setAiConsent(!on);
      await refreshProfile();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status !== 0 && failure.status < 500 ? failure.message : t('settings.account.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('settings.ai.title')} sub={t('settings.ai.sub')}>
      <Line label={t('settings.ai.label')}>
        <Text variant="body" testID="ai-state" style={{ color: on ? colors.ink.green : colors.textSecondary }}>
          {on ? t('settings.ai.on') : t('settings.ai.off')}
        </Text>
      </Line>
      <Button title={on ? t('settings.ai.turnOff') : t('settings.ai.turnOn')} tone={on ? 'plain' : 'primary'} loading={busy} onPress={() => void toggle()} />
      <ErrorText>{error}</ErrorText>
      <Pressable accessibilityRole="link" onPress={() => open(AI_PRIVACY_URL)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text variant="label" style={{ color: colors.link }}>
          {t('settings.ai.privacy')}
        </Text>
      </Pressable>
    </Section>
  );
}

/** Deleting the account (Guideline 5.1.1(v)): scheduled, erased after a grace period, and undone with "Keep my account" until then. */
function DeleteSection() {
  const { t, language } = useTranslation();
  const { colors } = useTheme();
  const { state, refreshProfile } = useAuth();
  const due = state.status === 'ready' ? state.profile.due_at : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const run = async (action: () => Promise<unknown>, done: string | null) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await refreshProfile();
      if (done) setMessage({ kind: 'ok', text: done });
    } catch {
      setMessage({ kind: 'error', text: t('settings.danger.error') });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(t('settings.danger.title'), t('settings.danger.confirmPrompt', { days: ACCOUNT_GRACE_DAYS }), [
      { text: t('aiReport.cancel'), style: 'cancel' },
      { text: t('settings.danger.button'), style: 'destructive', onPress: () => void run(() => getApi().scheduleDeletion(), null) },
    ]);

  return (
    <Section title={t('settings.danger.title')} danger>
      {due ? (
        <>
          <Text variant="body" testID="deletion-scheduled">
            {t('settings.danger.scheduled', { date: formatDueDate(due, localeFor(language)) })}
          </Text>
          <Button title={t('settings.danger.restore')} loading={busy} onPress={() => void run(() => getApi().restoreAccount(), t('settings.danger.restored'))} />
        </>
      ) : (
        <>
          <Text variant="body" secondary>
            {t('settings.danger.body', { days: ACCOUNT_GRACE_DAYS })}
          </Text>
          <Text variant="caption" secondary>
            {t('settings.danger.what')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy, busy }}
            disabled={busy}
            onPress={confirmDelete}
            style={{ minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.red.fill, opacity: busy ? 0.5 : 1 }}>
            <Text variant="rowTitle" style={{ color: '#ffffff' }}>
              {t('settings.danger.button')}
            </Text>
          </Pressable>
        </>
      )}
      {message ? message.kind === 'ok' ? <Text variant="label" style={{ color: colors.ink.green }}>{message.text}</Text> : <ErrorText>{message.text}</ErrorText> : null}
    </Section>
  );
}

/** The questions behind the calorie and macro targets: set them up, or go through them again. */
function CoachingSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useCoachingProfile();
  return (
    <Section title={t('coaching.title')} sub={profile.data ? undefined : t('coaching.setup.lead')}>
      <Button title={profile.data ? t('coaching.editProfile') : t('coaching.setup.button')} tone={profile.data ? 'plain' : 'primary'} onPress={() => router.push('/coaching-wizard')} />
    </Section>
  );
}

/** The people you have blocked, each with a way to undo it (Guideline 1.2: blocking has to be reversible where it was done). */
function BlockedSection() {
  const { t } = useTranslation();
  const blocked = useBlockedAccounts();
  const changed = useSocialChanged();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const unblock = async (id: string) => {
    if (working) return;
    setWorking(id);
    setError(null);
    try {
      await getApi().unblockAccount(id);
      await changed();
    } catch (failure) {
      setError(shownMessage(failure, t('safety.genericError')));
    } finally {
      setWorking(null);
    }
  };

  return (
    <Section title={t('settings.blocked.title')} sub={t('settings.blocked.sub')}>
      {blocked.isPending ? (
        <Text variant="body" secondary>
          {t('common.loading')}
        </Text>
      ) : blocked.isError ? (
        <>
          <ErrorText>{t('safety.genericError')}</ErrorText>
          <Button tone="plain" title={t('app.nutrition.retry')} onPress={() => void blocked.refetch()} />
        </>
      ) : blocked.data.length === 0 ? (
        <Text variant="body" secondary testID="blocked-empty">
          {t('settings.blocked.empty')}
        </Text>
      ) : (
        blocked.data.map((person) => (
          <View key={person.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} testID={`blocked-${person.id}`}>
            <Text variant="rowTitle" style={{ flex: 1 }} numberOfLines={1}>
              {person.name}
            </Text>
            <Button tone="plain" title={t('settings.blocked.unblock')} loading={working === person.id} disabled={working !== null} onPress={() => void unblock(person.id)} />
          </View>
        ))
      )}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

/** Settings: account, appearance, language, units, AI features, legal pages, log out and delete account. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <OfflineBanner />
      <AccountSection />
      <CoachingSection />
      <PreferencesSections />
      <AiSection />
      <BlockedSection />
      <Section title={t('settings.legal.title')}>
        {LEGAL_LINKS.map((link) => (
          <Row key={link.key} onPress={() => open(`${WEBSITE_URL}${link.path}`)} label={t(link.label)}>
            <Text variant="rowTitle" style={{ flex: 1 }}>
              {t(link.label)}
            </Text>
          </Row>
        ))}
      </Section>
      <Section title={t('settings.logout.title')} sub={t('settings.logout.sub')}>
        <Button tone="plain" title={t('sidebar.logout')} onPress={() => void signOut(getSupabase())} />
      </Section>
      <DeleteSection />
    </Screen>
  );
}
