import { useEffect } from 'react';
import { Appearance } from 'react-native';

import { useSettings } from '@/data/hooks';
import { chooseLanguage } from '@/i18n/storage';
import { colorSchemeOverride } from '@/logic/account';

/**
 * Puts the account's saved theme and language to work. Theme and language are account settings (so they follow the person to another
 * device), but the screens read the device's appearance and the current language, so the saved ones are applied as they load and
 * whenever they change. A person who has chosen neither keeps the device's own appearance and language.
 */
export function SettingsApplier() {
  const { theme, language } = useSettings().data;

  useEffect(() => {
    Appearance.setColorScheme(colorSchemeOverride(theme));
  }, [theme]);

  useEffect(() => {
    if (language) void chooseLanguage(language);
  }, [language]);

  return null;
}
