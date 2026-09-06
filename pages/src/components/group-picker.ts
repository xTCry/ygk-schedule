import { createElement } from '../dom.ts';

export interface GroupPickerElements {
  input: HTMLInputElement;
  clear: HTMLButtonElement;
  toggle: HTMLButtonElement;
  list: HTMLElement;
}

export interface GroupPickerOptions {
  groups: readonly string[];
  initialValue: string;
  onSelect: (group: string) => void;
}

export interface GroupPicker {
  /** Возвращает последнюю подтвержденную группу, а не произвольный ввод. */
  readonly value: () => string;
  /** Обновляет видимое поле после смены группы извне компонента. */
  readonly setValue: (group: string) => void;
  /** Подтверждает точное совпадение из поля ввода. */
  readonly commitTypedValue: () => string | null;
}

const normalized = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('ru-RU');

/** Сортирует коды стабильно и независимо от порядка прихода API. */
export const sortGroupCodes = (groups: readonly string[]): string[] =>
  [...new Set(groups)].sort((left, right) =>
    left.localeCompare(right, 'ru-RU'),
  );

/** Ищет по всей строке, чтобы по сокращению можно было быстро найти группу. */
export const filterGroupCodes = (
  groups: readonly string[],
  query: string,
): string[] => {
  const needle = normalized(query);
  if (!needle) return [...groups];
  return groups.filter((group) => normalized(group).includes(needle));
};

/** Возвращает канонический код только при точном совпадении без учета регистра. */
export const resolveGroupCode = (
  groups: readonly string[],
  value: string,
): string | null => {
  const expected = normalized(value);
  return groups.find((group) => normalized(group) === expected) ?? null;
};

/**
 * Подключает единое поле выбора группы с фильтруемым выпадающим списком.
 *
 * Свободный текст не считается новым значением: оно подтверждается только
 * после точного выбора существующего кода, чтобы ссылка и localStorage
 * никогда не получили опечатку.
 */
export const initializeGroupPicker = (
  elements: GroupPickerElements,
  options: GroupPickerOptions,
): GroupPicker => {
  const groups = sortGroupCodes(options.groups);
  const { input, clear, toggle, list } = elements;
  const root = list.closest('.group-picker');
  if (!root)
    throw new Error('Список групп должен находиться внутри .group-picker');
  let selected =
    resolveGroupCode(groups, options.initialValue) ?? groups[0] ?? '';
  let activeIndex = -1;
  let visibleGroups: string[] = [];
  let expanded = false;

  const optionId = (index: number): string =>
    `${list.id || 'group-options'}-option-${index}`;

  const updateExpanded = (): void => {
    input.ariaExpanded = String(expanded);
    toggle.ariaExpanded = String(expanded);
    toggle.textContent = expanded ? '⌃' : '⌄';
    toggle.ariaLabel = expanded
      ? 'Скрыть список групп'
      : 'Показать список групп';
    toggle.title = toggle.ariaLabel;
    list.hidden = !expanded;
  };

  const updateClear = (): void => {
    clear.hidden = !input.value;
  };

  const renderOptions = (): void => {
    visibleGroups = filterGroupCodes(groups, input.value);
    if (activeIndex >= visibleGroups.length) activeIndex = -1;
    list.replaceChildren();
    if (!visibleGroups.length) {
      const empty = createElement('li', 'group-picker-empty');
      empty.textContent = 'Совпадений нет';
      empty.role = 'presentation';
      list.append(empty);
      input.removeAttribute('aria-activedescendant');
      return;
    }
    for (const [index, group] of visibleGroups.entries()) {
      const option = createElement('li', 'group-picker-option');
      option.id = optionId(index);
      option.role = 'option';
      option.textContent = group;
      option.ariaSelected = String(group === selected);
      option.classList.toggle(
        'group-picker-option-active',
        index === activeIndex,
      );
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        select(group);
      });
      list.append(option);
    }
    const activeId = activeIndex >= 0 ? optionId(activeIndex) : undefined;
    if (activeId) input.setAttribute('aria-activedescendant', activeId);
    else input.removeAttribute('aria-activedescendant');
  };

  const open = (): void => {
    expanded = true;
    activeIndex = -1;
    renderOptions();
    updateExpanded();
  };

  const close = (restoreInput = false): void => {
    expanded = false;
    activeIndex = -1;
    if (restoreInput) input.value = selected;
    updateClear();
    updateExpanded();
  };

  const select = (group: string): void => {
    selected = group;
    input.value = group;
    updateClear();
    close();
    options.onSelect(group);
  };

  const commitTypedValue = (): string | null => {
    const group = resolveGroupCode(groups, input.value);
    if (!group) return null;
    if (group !== selected) select(group);
    else {
      input.value = group;
      close();
    }
    return group;
  };

  input.value = selected;
  input.role = 'combobox';
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.autocomplete = 'off';
  clear.type = 'button';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', list.id);
  updateExpanded();
  updateClear();

  input.addEventListener('focus', open);
  input.addEventListener('input', () => {
    activeIndex = -1;
    if (!expanded) expanded = true;
    renderOptions();
    updateClear();
    updateExpanded();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) open();
      if (!visibleGroups.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex =
        (activeIndex + direction + visibleGroups.length) % visibleGroups.length;
      renderOptions();
      return;
    }
    if (event.key === 'Enter') {
      const active = visibleGroups[activeIndex];
      if (active) {
        event.preventDefault();
        select(active);
      } else if (commitTypedValue()) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    }
  });
  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement) && !list.matches(':hover'))
        close(true);
    }, 100);
  });
  clear.addEventListener('click', () => {
    input.value = '';
    input.focus();
    open();
    updateClear();
  });
  toggle.addEventListener('click', () => {
    if (expanded) close(true);
    else {
      input.focus();
      open();
    }
  });

  return {
    value: () => selected,
    setValue: (group) => {
      const resolved = resolveGroupCode(groups, group);
      if (!resolved) return;
      selected = resolved;
      input.value = resolved;
      close();
    },
    commitTypedValue,
  };
};
