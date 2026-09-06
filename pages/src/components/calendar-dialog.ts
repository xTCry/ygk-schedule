import { siteUrl } from '../api.ts';
import { createElement, requiredElement } from '../dom.ts';
import type { PagesApiGroup } from '../types.ts';

const calendarFileFor = (
  files: readonly string[],
  group: string,
  subgroup: string | null,
): string | null => {
  const requested = subgroup ? `${group}-${subgroup}.ics` : `${group}.ics`;
  // Основные ICS создаются для каждой базовой группы. Список в API нужен,
  // чтобы показывать дополнительные подгруппы, но отсутствие старого index
  // не должно скрывать существующий общий календарь после обновления сайта.
  return files.length === 0 || files.includes(requested) ? requested : null;
};

const copyText = async (value: string): Promise<void> => {
  await navigator.clipboard.writeText(value);
};

/**
 * Открывает понятное окно подписки: actual учитывает опубликованные замены,
 * base оставлен для сравнения и редких случаев, когда нужен только шаблон.
 */
export const openCalendarDialog = (
  group: PagesApiGroup,
  subgroup: string | null,
): void => {
  const dialog = requiredElement<HTMLDialogElement>('#calendar-dialog');
  const content = requiredElement<HTMLElement>('#calendar-dialog-content');
  const close = requiredElement<HTMLButtonElement>('#calendar-dialog-close');
  content.replaceChildren();
  const actual = calendarFileFor(group.calendars.actual, group.code, subgroup);
  const base = calendarFileFor(group.calendars.base, group.code, subgroup);
  const groupLabel = subgroup
    ? `${group.code}, подгруппа ${subgroup}`
    : group.code;
  const title = createElement('h2', 'text-xl font-semibold tracking-tight');
  title.textContent = `Календарь: ${groupLabel}`;
  content.append(title);

  const description = createElement(
    'p',
    'mt-3 text-sm leading-6 text-stone-600 dark:text-stone-300',
  );
  description.textContent =
    'Скопируйте ссылку и добавьте её в Google Calendar: «Другие календари» → «По URL». Актуальный календарь учитывает только подтверждённые замены.';
  content.append(description);

  for (const item of [
    {
      label: 'Актуальное расписание с заменами',
      file: actual,
      kind: 'actual' as const,
      hint: 'Рекомендуемый вариант для подписки.',
    },
    {
      label: 'Основное расписание без замен',
      file: base,
      kind: 'base' as const,
      hint: 'Полезно для сравнения с регулярным шаблоном.',
    },
  ]) {
    const section = createElement(
      'section',
      'mt-5 rounded-xl border border-stone-200 p-4 dark:border-stone-700',
    );
    const heading = createElement('h3', 'font-medium');
    heading.textContent = item.label;
    const hint = createElement(
      'p',
      'mt-1 text-sm text-stone-600 dark:text-stone-300',
    );
    hint.textContent = item.hint;
    section.append(heading, hint);
    if (!item.file) {
      const unavailable = createElement(
        'p',
        'mt-3 text-sm text-amber-700 dark:text-amber-300',
      );
      unavailable.textContent = 'Файл ещё не опубликован для этой группы.';
      section.append(unavailable);
      content.append(section);
      continue;
    }
    const url = siteUrl(`ical/${item.kind}/${item.file}`);
    const input = createElement(
      'input',
      'mt-3 w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm dark:border-stone-600 dark:bg-stone-950',
    );
    input.value = url;
    input.readOnly = true;
    input.ariaLabel = `Ссылка: ${item.label}`;
    const actions = createElement('div', 'mt-3 flex flex-wrap gap-2');
    const copy = createElement('button', 'button-primary');
    copy.type = 'button';
    copy.textContent = 'Скопировать ссылку';
    copy.addEventListener('click', () => {
      void copyText(url).then(
        () => {
          copy.textContent = 'Скопировано';
        },
        () => {
          copy.textContent = 'Не удалось скопировать';
        },
      );
    });
    const open = createElement('a', 'button-secondary');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    open.textContent = 'Открыть файл';
    actions.append(copy, open);
    section.append(input, actions);
    content.append(section);
  }

  close.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
};
