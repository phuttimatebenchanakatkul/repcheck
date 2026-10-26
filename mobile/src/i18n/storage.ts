import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

import { detectLanguage, isLanguage, setLanguage, type Language } from './index';

const KEY = 'repcheck_language';

/**
 * Start-up: the language the person chose, else the device's. (Once settings sync (phase 5) the chosen language becomes
 * an account setting; until then it is per device, as it was on the website.)
 */
export async function restoreLanguage(): Promise<Language> {
  let chosen: string | null = null;
  try {
    chosen = await AsyncStorage.getItem(KEY);
  } catch {
    // unreadable storage is the same as nothing chosen
  }
  const language = isLanguage(chosen) ? chosen : detectLanguage(getLocales().map((l) => l.languageCode));
  setLanguage(language);
  return language;
}

export async function chooseLanguage(language: Language): Promise<void> {
  setLanguage(language);
  await AsyncStorage.setItem(KEY, language);
}
