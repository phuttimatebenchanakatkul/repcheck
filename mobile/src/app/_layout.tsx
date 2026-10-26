import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { DataProvider } from '@/data/DataProvider';
import { useTranslation } from '@/i18n';
import { restoreLanguage } from '@/i18n/storage';
import { CACHE_MAX_AGE_MS, persister, queryClient } from '@/store';
import { SyncManager } from '@/store/SyncManager';
import { useTheme } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

/**
 * The gate. Which group of screens exists depends on who is signed in, and expo-router's Stack.Protected removes the
 * others entirely: a signed-out person cannot be sent to a tab by a stale link or a back swipe, and a signed-in one
 * cannot land on the sign-in screen.
 */
function Gate() {
  const { state } = useAuth();
  const status = state.status;
  const { t } = useTranslation();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null; // the splash screen is still up

  const needsSetup = status === 'setting-up' || status === 'needs-name' || status === 'error';
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'signed-out'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'signed-out' || status === 'recovering'}>
        <Stack.Screen name="reset-password" />
      </Stack.Protected>
      <Stack.Protected guard={needsSetup}>
        <Stack.Screen name="setup" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'ready'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="streaks" options={{ headerShown: true, title: t('streaks.calendarTitle') }} />
        <Stack.Screen name="weight" options={{ headerShown: true, title: t('app.weight.title') }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const { scheme, colors } = useTheme();

  useEffect(() => {
    void restoreLanguage();
  }, []);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.card, text: colors.text, border: colors.border, primary: colors.link },
  };

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: CACHE_MAX_AGE_MS }}>
      <AuthProvider>
        <SyncManager />
        <DataProvider>
          <ThemeProvider value={navigationTheme}>
            <Gate />
          </ThemeProvider>
        </DataProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}

