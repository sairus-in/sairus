// i18n/index.ts — Language switcher with AsyncStorage persistence
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { en, TranslationKeys } from './en';
import { ta } from './ta';

const LANG_KEY = 'preferred-language';
type Language = 'en' | 'ta';

let currentLang: Language = 'en';
const langMap: Record<Language, TranslationKeys> = { en, ta };

/**
 * Get a translated string. Supports {{placeholder}} interpolation.
 */
export function t(
  path: string,
  params?: Record<string, string | number>,
): string {
  const keys = path.split('.');
  let result: any = langMap[currentLang];

  for (const key of keys) {
    result = result?.[key];
    if (result === undefined) {
      // Fallback to English
      result = keys.reduce((acc: any, k) => acc?.[k], en);
      break;
    }
  }

  if (typeof result !== 'string') return path;

  if (params) {
    return Object.entries(params).reduce(
      (str, [key, val]) => str.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val)),
      result,
    );
  }

  return result;
}

/**
 * Hook that provides current language + toggle function.
 * Persists preference to AsyncStorage.
 */
export function useLanguage() {
  const [lang, setLang] = useState<Language>(currentLang);

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((stored: string | null) => {
      if (stored === 'ta' || stored === 'en') {
        currentLang = stored;
        setLang(stored);
      }
    });
  }, []);

  const toggleLanguage = useCallback(async () => {
    const next: Language = currentLang === 'en' ? 'ta' : 'en';
    currentLang = next;
    setLang(next);
    await AsyncStorage.setItem(LANG_KEY, next);
  }, []);

  const setLanguage = useCallback(async (l: Language) => {
    currentLang = l;
    setLang(l);
    await AsyncStorage.setItem(LANG_KEY, l);
  }, []);

  return { lang, toggleLanguage, setLanguage, t };
}

export { en, ta };
export type { Language, TranslationKeys };
