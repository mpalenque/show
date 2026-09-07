import { en } from './en';
import { es } from './es';
import { it } from './it';

export type Locale = 'en' | 'es' | 'it';
type TranslationDict = Record<string, string>;
type LanguageChangeCallback = (locale: Locale) => void;

const LOCALE_STORAGE_KEY = 'moon-sim:locale';
const VALID_LOCALES: readonly string[] = ['en', 'es', 'it'];

const getSavedLocale = (): Locale => {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved && VALID_LOCALES.includes(saved)) {
      return saved as Locale;
    }
  } catch { }
  return 'en';
};

class I18n {
  private locale: Locale = getSavedLocale();
  private dictionaries: Record<Locale, TranslationDict> = { en, es, it };
  private listeners: LanguageChangeCallback[] = [];

  t(key: string): string {
    return this.dictionaries[this.locale][key] ?? key;
  }

  getLocale(): Locale {
    return this.locale;
  }

  setLocale(next: Locale): void {
    if (next === this.locale) {
      return;
    }
    this.locale = next;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch { }
    this.listeners.forEach((cb) => cb(next));
  }

  onLanguageChange(cb: LanguageChangeCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== cb);
    };
  }
}

export const i18n = new I18n();
export const t = (key: string): string => i18n.t(key);
