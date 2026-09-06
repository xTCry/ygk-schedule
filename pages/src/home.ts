import './style.css';
import { loadIndex } from './api.ts';
import { formatUpdate } from './date.ts';
import { requiredElement } from './dom.ts';
import { initializeThemeControl } from './theme.ts';

const initialize = async (): Promise<void> => {
  initializeThemeControl();
  const form = requiredElement<HTMLFormElement>('#group-form');
  const select = requiredElement<HTMLSelectElement>('#group-select');
  const status = requiredElement<HTMLElement>('#home-status');
  const updates = requiredElement<HTMLElement>('#updates');

  try {
    const index = await loadIndex();
    select.replaceChildren();
    for (const group of index.groups) {
      const option = document.createElement('option');
      option.value = group.code;
      option.textContent = group.code;
      select.append(option);
    }
    select.disabled = false;
    updates.textContent = `Базовое расписание: ${formatUpdate(index.updates.schedule)} · замены: ${formatUpdate(index.updates.replacements)}`;
    status.textContent = `Опубликовано групп: ${index.groups.length}.`;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      window.location.assign(
        `group.html?group=${encodeURIComponent(select.value)}`,
      );
    });
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : 'Не удалось загрузить опубликованные данные';
  }
};

void initialize();
