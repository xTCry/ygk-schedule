import './style.css';
import { loadIndex } from './api.ts';
import { initializeColorModeControl } from './color-mode.ts';
import { initializeGroupPicker } from './components/group-picker.ts';
import { formatUpdate } from './date.ts';
import { requiredElement } from './dom.ts';
import { initializeThemeControl } from './theme.ts';

const groupStorageKey = 'ygk-schedule-group';

const initialize = async (): Promise<void> => {
  initializeThemeControl();
  initializeColorModeControl();
  const form = requiredElement<HTMLFormElement>('#group-form');
  const input = requiredElement<HTMLInputElement>('#group-input');
  const clear = requiredElement<HTMLButtonElement>('#group-clear');
  const toggle = requiredElement<HTMLButtonElement>('#group-toggle');
  const list = requiredElement<HTMLElement>('#group-options');
  const status = requiredElement<HTMLElement>('#home-status');
  const updates = requiredElement<HTMLElement>('#updates');

  try {
    const index = await loadIndex();
    const savedGroup = localStorage.getItem(groupStorageKey);
    const initialGroup =
      index.groups.find((group) => group.code === savedGroup)?.code ??
      index.groups[0]?.code ??
      '';
    const picker = initializeGroupPicker(
      { input, clear, toggle, list },
      {
        groups: index.groups.map((group) => group.code),
        initialValue: initialGroup,
        onSelect: (group) => localStorage.setItem(groupStorageKey, group),
      },
    );
    input.disabled = false;
    clear.disabled = false;
    toggle.disabled = false;
    updates.textContent = `Базовое расписание: ${formatUpdate(index.updates.schedule)} · замены: ${formatUpdate(index.updates.replacements)}`;
    status.textContent = `Опубликовано групп: ${index.groups.length}.`;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const group = picker.commitTypedValue();
      if (!group) {
        status.textContent = 'Выберите группу из списка.';
        input.focus();
        return;
      }
      localStorage.setItem(groupStorageKey, group);
      window.location.assign(`group.html?group=${encodeURIComponent(group)}`);
    });
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : 'Не удалось загрузить опубликованные данные';
  }
};

void initialize();
