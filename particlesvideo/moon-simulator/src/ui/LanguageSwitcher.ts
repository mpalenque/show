import { i18n, type Locale } from '../i18n/i18n';

const LOCALES: Locale[] = ['en', 'es', 'it'];

export function createLanguageSwitcher(): void {
  const element = document.getElementById('language-switcher');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Element with id "language-switcher" was not found');
  }

  element.innerHTML = '';

  const buttons = LOCALES.map((locale) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lang-btn';
    button.textContent = locale.toUpperCase();
    button.addEventListener('click', () => {
      i18n.setLocale(locale);
    });
    element.appendChild(button);
    return { locale, button };
  });

  const syncActive = (activeLocale: Locale): void => {
    buttons.forEach(({ locale, button }) => {
      button.classList.toggle('active', locale === activeLocale);
    });
  };

  syncActive(i18n.getLocale());
  i18n.onLanguageChange((locale) => {
    syncActive(locale);
  });
}
