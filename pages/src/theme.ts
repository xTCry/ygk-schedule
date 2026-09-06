import { requiredElement } from './dom.ts';

export type ThemePreference = 'system' | 'light' | 'dark';

const storageKey = 'ygk-schedule-theme';

const isThemePreference = (value: string | null): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

const effectiveTheme = (preference: ThemePreference): 'light' | 'dark' =>
  preference === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : preference;

export const applyTheme = (preference: ThemePreference): void => {
  document.documentElement.classList.toggle(
    'dark',
    effectiveTheme(preference) === 'dark',
  );
  document.documentElement.dataset.theme = preference;
};

const nextTheme = (preference: ThemePreference): ThemePreference =>
  preference === 'system'
    ? 'light'
    : preference === 'light'
      ? 'dark'
      : 'system';

const labelForTheme = (preference: ThemePreference): string =>
  `Тема: ${
    preference === 'system'
      ? 'системная'
      : preference === 'light'
        ? 'светлая'
        : 'тёмная'
  }`;

/**
 * Подключает общий selector темы. Системная тема вычисляется локально и не
 * отправляется ни в API, ни в сторонние сервисы.
 */
export const initializeThemeControl = (): void => {
  const button = requiredElement<HTMLButtonElement>('#theme-toggle');
  const saved = localStorage.getItem(storageKey);
  let preference: ThemePreference = isThemePreference(saved) ? saved : 'system';
  const render = (): void => {
    button.textContent = labelForTheme(preference);
    button.title = 'Переключить тему';
    button.ariaLabel = 'Переключить тему: системная, светлая или тёмная';
    applyTheme(preference);
  };
  render();
  button.addEventListener('click', () => {
    preference = nextTheme(preference);
    localStorage.setItem(storageKey, preference);
    render();
  });
};
