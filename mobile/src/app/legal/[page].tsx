import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { LegalPage } from '@/legal/LegalScreen';
import { isLegalPage, type LegalPageKey } from '@/legal/pages';
import { LEGAL_LINKS } from '@/links';
import { useTranslation } from '@/i18n';

/** A policy page: reachable signed out (the sign-up screen links Terms and Privacy) and signed in (Settings lists them all). */
export default function LegalRoute() {
  const { page, section } = useLocalSearchParams<{ page?: string; section?: string }>();
  const { t } = useTranslation();
  if (!isLegalPage(page)) return <Redirect href="/" />;
  const key: LegalPageKey = page;
  const entry = LEGAL_LINKS.find((link) => link.key === key);
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: entry ? t(entry.label) : '' }} />
      <LegalPage page={key} section={typeof section === 'string' && section ? section : undefined} />
    </>
  );
}
