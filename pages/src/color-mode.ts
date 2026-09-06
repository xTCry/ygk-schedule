import { requiredElement } from './dom.ts';

export type ColorMode = 'colored' | 'calm';

const storageKey = 'ygk-schedule-color-mode';

const isColorMode = (value: string | null): value is ColorMode =>
  value === 'colored' || value === 'calm';

const labelForColorMode = (mode: ColorMode): string =>
  `Палитра: ${mode === 'colored' ? 'цветная' : 'спокойная'}`;

/**
 * Переключает декоративную палитру независимо от светлой/тёмной темы.
 * Diagnostics и состояния замен не обесцвечиваются, чтобы не потерять смысл.
 */
export const initializeColorModeControl = (): void => {
  const button = requiredElement<HTMLButtonElement>('#color-mode-toggle');
  const saved = localStorage.getItem(storageKey);
  let mode: ColorMode = isColorMode(saved) ? saved : 'colored';
  const render = (): void => {
    document.documentElement.dataset.colorMode = mode;
    button.textContent = labelForColorMode(mode);
    button.title = 'Переключить цветную и спокойную палитру';
    button.ariaLabel = button.title;
  };
  render();
  button.addEventListener('click', () => {
    mode = mode === 'colored' ? 'calm' : 'colored';
    localStorage.setItem(storageKey, mode);
    render();
  });
};
