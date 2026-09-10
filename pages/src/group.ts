import './style.css';
import { loadActualSchedule, loadGroupSchedule, loadIndex } from './api.ts';
import { initializeColorModeControl } from './color-mode.ts';
import { openCalendarDialog } from './components/calendar-dialog.ts';
import { initializeGroupPicker } from './components/group-picker.ts';
import { renderSchedule } from './components/schedule.ts';
import { formatScheduleDate, formatUpdate } from './date.ts';
import { createElement, requiredElement } from './dom.ts';
import { replacementSourceUrlForGroup } from './replacement-source.ts';
import { describeLessonReplacement } from './replacement-summary.ts';
import { initializeThemeControl } from './theme.ts';
import type {
  ActualGroup,
  ActualDate,
  BaseGroupArtifact,
  Diagnostic,
  PagesApiGroup,
  PagesApiIndex,
} from './types.ts';

const visibleDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.severity === 'warning' ||
  diagnostic.severity === 'error' ||
  diagnostic.severity === 'fatal';

const groupStorageKey = 'ygk-schedule-group';
const subgroupStorageKey = (group: string): string =>
  `ygk-schedule-subgroup:${group}`;
const showOtherSubgroupsStorageKey = 'ygk-schedule-show-other-subgroups';

const subgroupsFor = (schedule: BaseGroupArtifact): string[] =>
  [
    ...new Set(
      schedule.group.days.flatMap((day) =>
        day.lessons.flatMap((lesson) =>
          lesson.variants.flatMap((variant) =>
            variant.subgroup ? [variant.subgroup] : [],
          ),
        ),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru-RU'));

const sourceLinksFor = (
  index: PagesApiIndex,
  schedule: BaseGroupArtifact,
): Array<{ fileName: string; url?: string }> => {
  const sourceIds = new Set(
    schedule.group.sourceBlocks
      .map((source) => source.sourceId)
      .filter((value): value is string => Boolean(value)),
  );
  return index.sources.filter((source) => sourceIds.has(source.id));
};

const renderSources = (
  index: PagesApiIndex,
  schedule: BaseGroupArtifact,
): void => {
  const container = requiredElement<HTMLElement>('#source-links');
  container.replaceChildren();
  const sources = sourceLinksFor(index, schedule);
  if (!sources.length) {
    container.textContent = 'Источник XLSX не указан в опубликованной версии.';
    return;
  }
  for (const source of sources) {
    const link = createElement('a', 'source-link');
    link.textContent = source.fileName;
    if (source.url) {
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
    } else {
      link.removeAttribute('href');
    }
    container.append(link);
  }
};

const renderUpdates = (
  container: HTMLElement,
  index: PagesApiIndex,
  actual: Awaited<ReturnType<typeof loadActualSchedule>> | null,
): void => {
  container.replaceChildren(
    document.createTextNode(
      `Базовое расписание обновлено: ${formatUpdate(index.updates.schedule)}`,
    ),
  );
  const latest = Object.entries(actual?.dates ?? {})
    .flatMap(([date, actualDate]) =>
      Object.entries(actualDate.shifts ?? {}).map(([shift, snapshot]) => ({
        date,
        shift,
        source: snapshot.source,
      })),
    )
    .sort((left, right) => {
      const dateOrder = right.date.localeCompare(left.date);
      if (dateOrder) return dateOrder;
      return (right.source.fetchedAt ?? '').localeCompare(
        left.source.fetchedAt ?? '',
      );
    })[0];
  if (!latest) {
    container.append(
      document.createTextNode(' · Замены для этой группы пока не опубликованы'),
    );
    return;
  }
  container.append(document.createTextNode(' · Замены на '));
  const link = createElement('a', 'text-link');
  link.textContent = formatScheduleDate(latest.date);
  if (latest.source.url) {
    link.href = latest.source.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
  }
  container.append(link);
  const shift = latest.shift === 'first' ? '1 смена' : '2 смена';
  const checked = latest.source.fetchedAt
    ? ` · проверено: ${formatUpdate(latest.source.fetchedAt)}`
    : '';
  container.append(document.createTextNode(` (${shift}${checked})`));
};

const openReplacementDialog = (
  date: string,
  group: string,
  actual: ActualGroup,
  actualDate: ActualDate,
  base: BaseGroupArtifact,
  diagnostics: readonly Diagnostic[],
): void => {
  const dialog = requiredElement<HTMLDialogElement>('#replacement-dialog');
  const content = requiredElement<HTMLElement>('#replacement-dialog-content');
  const close = requiredElement<HTMLButtonElement>('#replacement-dialog-close');
  content.replaceChildren();
  const title = createElement('h2', 'text-xl font-semibold tracking-tight');
  title.textContent = `Изменения на ${date}`;
  content.append(title);
  const sources = Object.entries(actualDate.shifts ?? {});
  if (sources.length) {
    const sourceSection = createElement('div', 'mt-4 flex flex-wrap gap-2');
    for (const [shift, snapshot] of sources) {
      const source = createElement(
        snapshot.source.url ? 'a' : 'span',
        'source-link',
      );
      source.textContent = `Исходная страница замен: ${
        shift === 'first' ? '1 смена' : '2 смена'
      }`;
      if (source instanceof HTMLAnchorElement && snapshot.source.url) {
        source.href = replacementSourceUrlForGroup(snapshot.source.url, group);
        source.target = '_blank';
        source.rel = 'noreferrer';
      }
      sourceSection.append(source);
    }
    content.append(sourceSection);
  }

  const details = createElement('div', 'mt-5 space-y-3');
  for (const lesson of actual.lessons.filter(
    (item) => item.replacements.length > 0 || item.status === 'cancelled',
  )) {
    const item = createElement(
      'article',
      'rounded-xl border border-stone-200 p-4 dark:border-stone-700',
    );
    const heading = createElement('strong', 'block');
    heading.textContent = `Пара ${lesson.number}`;
    const text = createElement(
      'p',
      'mt-1 text-sm leading-5 text-stone-600 dark:text-stone-300',
    );
    text.textContent =
      describeLessonReplacement(
        lesson,
        base.group.days.find((day) => day.day === actualDate.day)?.lessons,
        actualDate.weekType,
      ) ?? 'Изменение опубликовано';
    item.append(heading, text);
    details.append(item);
  }
  for (const unresolved of actual.unresolvedReplacements) {
    const item = createElement(
      'article',
      'rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100',
    );
    const heading = createElement('strong', 'block');
    heading.textContent = `Необработанная строка: пара ${unresolved.lessonNumber}`;
    const text = createElement('p', 'mt-1 text-sm leading-5');
    text.textContent = unresolved.event.description;
    item.append(heading, text);
    details.append(item);
  }
  for (const diagnostic of diagnostics.filter(
    (item) => visibleDiagnostic(item) && item.context?.date === date,
  )) {
    const item = createElement(
      'article',
      'rounded-xl border border-red-300 bg-red-50 p-4 text-red-950 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100',
    );
    const heading = createElement('strong', 'block');
    heading.textContent = `${diagnostic.code}`;
    const text = createElement('p', 'mt-1 text-sm leading-5');
    text.textContent = diagnostic.message;
    item.append(heading, text);
    details.append(item);
  }
  if (!details.childElementCount) {
    const empty = createElement(
      'p',
      'mt-4 text-sm text-stone-600 dark:text-stone-300',
    );
    empty.textContent = 'Для этой даты нет дополнительных деталей.';
    details.append(empty);
  }
  content.append(details);
  close.onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
};

const renderGroup = async (
  index: PagesApiIndex,
  group: PagesApiGroup,
  subgroup: string | null,
  showOtherSubgroups: boolean,
): Promise<string[]> => {
  const status = requiredElement<HTMLElement>('#group-status');
  status.textContent = `Загружаем расписание ${group.code}…`;
  const [base, actual] = await Promise.all([
    loadGroupSchedule(group.code),
    group.hasActual ? loadActualSchedule(group.code) : Promise.resolve(null),
  ]);
  const title = requiredElement<HTMLElement>('#group-title');
  const updates = requiredElement<HTMLElement>('#group-updates');
  const diagnostics = requiredElement<HTMLElement>('#group-diagnostics');
  const schedule = requiredElement<HTMLElement>('#schedule');
  title.textContent = group.code;
  renderUpdates(updates, index, actual);
  renderSources(index, base);
  diagnostics.replaceChildren();
  for (const item of [
    ...base.diagnostics,
    ...(actual?.diagnostics ?? []),
  ].filter(
    (diagnostic) => visibleDiagnostic(diagnostic) && !diagnostic.context?.date,
  )) {
    const card = createElement('article', 'diagnostic-card');
    const heading = createElement('strong', 'block text-sm');
    heading.textContent = `${item.severity.toUpperCase()} · ${item.code}`;
    const text = createElement('p', 'mt-1 text-sm leading-5');
    text.textContent = item.message;
    card.append(heading, text);
    diagnostics.append(card);
  }
  renderSchedule(schedule, base, actual, {
    group: group.code,
    subgroup,
    showOtherSubgroups,
    onOpenReplacementDetails: (date, actualGroup, actualDate) =>
      openReplacementDialog(date, group.code, actualGroup, actualDate, base, [
        ...base.diagnostics,
        ...(actual?.diagnostics ?? []),
      ]),
  });
  status.textContent = '';

  return subgroupsFor(base);
};

const initialize = async (): Promise<void> => {
  initializeThemeControl();
  initializeColorModeControl();
  const status = requiredElement<HTMLElement>('#group-status');
  const groupInput = requiredElement<HTMLInputElement>('#group-input');
  const groupClear = requiredElement<HTMLButtonElement>('#group-clear');
  const groupToggle = requiredElement<HTMLButtonElement>('#group-toggle');
  const groupOptions = requiredElement<HTMLElement>('#group-options');
  const subgroupSelect = requiredElement<HTMLSelectElement>('#subgroup-select');
  const showOtherSubgroups = requiredElement<HTMLInputElement>(
    '#show-other-subgroups',
  );
  const calendar = requiredElement<HTMLButtonElement>('#calendar-button');
  try {
    const index = await loadIndex();
    const requested = new URL(window.location.href).searchParams.get('group');
    const savedGroup = localStorage.getItem(groupStorageKey);
    const group =
      index.groups.find((item) => item.code === requested) ??
      index.groups.find((item) => item.code === savedGroup) ??
      index.groups[0];
    if (!group) throw new Error('В опубликованном API нет групп');
    localStorage.setItem(groupStorageKey, group.code);

    let currentGroup = group;
    let currentSubgroup = localStorage.getItem(subgroupStorageKey(group.code));
    let keepOtherSubgroups =
      localStorage.getItem(showOtherSubgroupsStorageKey) !== 'false';
    showOtherSubgroups.checked = keepOtherSubgroups;
    const refresh = async (): Promise<void> => {
      let available = await renderGroup(
        index,
        currentGroup,
        currentSubgroup,
        keepOtherSubgroups,
      );
      if (currentSubgroup && !available.includes(currentSubgroup)) {
        currentSubgroup = null;
        localStorage.removeItem(subgroupStorageKey(currentGroup.code));
        available = await renderGroup(
          index,
          currentGroup,
          currentSubgroup,
          keepOtherSubgroups,
        );
      }
      subgroupSelect.replaceChildren();
      const all = document.createElement('option');
      all.value = '';
      all.textContent = 'Все подгруппы';
      subgroupSelect.append(all);
      for (const subgroup of available) {
        const option = document.createElement('option');
        option.value = subgroup;
        option.textContent = `Подгруппа ${subgroup}`;
        subgroupSelect.append(option);
      }
      subgroupSelect.value = currentSubgroup ?? '';
      subgroupSelect.disabled = available.length === 0;
    };
    const selectGroup = (next: PagesApiGroup): void => {
      currentGroup = next;
      currentSubgroup = localStorage.getItem(subgroupStorageKey(next.code));
      localStorage.setItem(groupStorageKey, next.code);
      const url = new URL(window.location.href);
      url.searchParams.set('group', next.code);
      window.history.replaceState({}, '', url);
      void refresh().catch((error: unknown) => {
        status.textContent =
          error instanceof Error
            ? error.message
            : 'Не удалось обновить расписание';
      });
    };
    const groupPicker = initializeGroupPicker(
      {
        input: groupInput,
        clear: groupClear,
        toggle: groupToggle,
        list: groupOptions,
      },
      {
        groups: index.groups.map((item) => item.code),
        initialValue: group.code,
        onSelect: (code) => {
          const next = index.groups.find((item) => item.code === code);
          if (next && next.code !== currentGroup.code) selectGroup(next);
        },
      },
    );
    groupInput.disabled = false;
    groupClear.disabled = false;
    groupToggle.disabled = false;
    await refresh();

    subgroupSelect.addEventListener('change', () => {
      currentSubgroup = subgroupSelect.value || null;
      if (currentSubgroup)
        localStorage.setItem(
          subgroupStorageKey(currentGroup.code),
          currentSubgroup,
        );
      else localStorage.removeItem(subgroupStorageKey(currentGroup.code));
      void refresh().catch((error: unknown) => {
        status.textContent =
          error instanceof Error
            ? error.message
            : 'Не удалось обновить расписание';
      });
    });
    showOtherSubgroups.addEventListener('change', () => {
      keepOtherSubgroups = showOtherSubgroups.checked;
      localStorage.setItem(
        showOtherSubgroupsStorageKey,
        String(keepOtherSubgroups),
      );
      void refresh().catch((error: unknown) => {
        status.textContent =
          error instanceof Error
            ? error.message
            : 'Не удалось обновить расписание';
      });
    });
    calendar.addEventListener('click', () =>
      openCalendarDialog(
        index.groups.find((item) => item.code === groupPicker.value()) ??
          currentGroup,
        currentSubgroup,
      ),
    );
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : 'Не удалось загрузить опубликованные данные';
  }
};

void initialize();
