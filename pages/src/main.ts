type DayOfWeek =
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота';

interface LessonVariant {
  subject: string;
  teacher: string;
  room: string;
  weekType: 'numerator' | 'denominator' | 'both' | 'unknown';
  subgroup?: string;
}

interface Lesson {
  number: number;
  variants: LessonVariant[];
}

interface BaseGroupArtifact {
  group: {
    group: string;
    days: Array<{ day: DayOfWeek; lessons: Lesson[] }>;
  };
  diagnostics: Diagnostic[];
}

interface AppliedReplacement {
  replacement: {
    type: 'replace' | 'cancel' | 'add' | 'move' | 'unknown';
    original: { raw: string } | null;
    replacement: { raw: string; room?: string } | null;
  };
}

interface ActualLesson extends Lesson {
  status: 'scheduled' | 'cancelled';
  replacements: AppliedReplacement[];
}

interface ActualGroupArtifact {
  dates: Record<
    string,
    {
      date: string;
      day: DayOfWeek;
      groups: Record<
        string,
        {
          lessons: ActualLesson[];
          unresolvedReplacements: Array<{
            lessonNumber: number;
            reason: string;
            event: { summary: string; description: string; room?: string };
          }>;
        }
      >;
    }
  >;
  diagnostics: Diagnostic[];
}

interface Diagnostic {
  severity: 'info' | 'warning' | 'error' | 'fatal';
  code: string;
  message: string;
  normalizedGroup?: string;
  context?: Record<string, unknown>;
}

interface PagesApiIndex {
  generatedAt: string;
  groups: Array<{
    code: string;
    hasActual: boolean;
    hasReplacements: boolean;
  }>;
}

const dayOrder: DayOfWeek[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

const root = document.documentElement;
const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
const apiUrl = (path: string): URL => new URL(`api/${path}`, baseUrl);
const siteUrl = (path: string): URL => new URL(path, baseUrl);

const groupSelect = document.querySelector<HTMLSelectElement>('#group-select');
const status = document.querySelector<HTMLElement>('#status');
const scheduleView = document.querySelector<HTMLElement>('#schedule-view');
const scheduleTitle = document.querySelector<HTMLElement>('#schedule-title');
const scheduleCaption =
  document.querySelector<HTMLElement>('#schedule-caption');
const daysContainer = document.querySelector<HTMLElement>('#days');
const diagnosticsContainer =
  document.querySelector<HTMLElement>('#diagnostics');
const calendarLinks = document.querySelector<HTMLElement>('#calendar-links');

if (
  !groupSelect ||
  !status ||
  !scheduleView ||
  !scheduleTitle ||
  !scheduleCaption ||
  !daysContainer ||
  !diagnosticsContainer ||
  !calendarLinks
)
  throw new Error('Schedule page root elements were not found');

const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(apiUrl(path));
  if (!response.ok)
    throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
};

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);

/**
 * Возвращает календарную дату по Москве, а не по часовому поясу браузера.
 * Это не дает пользователю на востоке или западе увидеть замены на соседний
 * день относительно опубликованного расписания ЯГК.
 */
const isoDate = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day)
    throw new Error('Не удалось определить текущую дату по Москве');
  return `${year}-${month}-${day}`;
};

const dayName = (date: Date): DayOfWeek | null =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    weekday: 'long',
  })
    .format(date)
    .replace(/^\p{L}/u, (letter) => letter.toUpperCase()) as DayOfWeek;

const russianDate = (date: Date): string =>
  formatDate(date).replace(/^\p{L}/u, (letter) => letter.toUpperCase());

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
};

const createVariant = (variant: LessonVariant): HTMLElement => {
  const element = createElement('div', 'lesson-variant');
  const subject = createElement('strong');
  subject.textContent = variant.subject || 'Предмет не указан';
  element.append(subject);
  const details = [variant.teacher, variant.room].filter(Boolean).join(' · ');
  if (details) {
    const meta = createElement('span', 'lesson-meta');
    meta.textContent = details;
    element.append(meta);
  }
  if (variant.subgroup) {
    const subgroup = createElement('span', 'chip');
    subgroup.textContent = `Подгруппа ${variant.subgroup}`;
    element.append(subgroup);
  }
  return element;
};

const replacementLabel = (lesson: ActualLesson): string | null => {
  const type = lesson.replacements[0]?.replacement.type;
  if (lesson.status === 'cancelled' || type === 'cancel') return 'ОТМЕНЕНО';
  if (type === 'replace') return 'ЗАМЕНЕНО';
  if (type === 'add') return 'ДОБАВЛЕНО';
  if (type === 'move') return 'ПЕРЕНЕСЕНО';
  return null;
};

const createLesson = (
  lesson: Lesson | ActualLesson,
  actual = false,
): HTMLElement => {
  const actualLesson = lesson as ActualLesson;
  const card = createElement(
    'article',
    `lesson${actual && actualLesson.status === 'cancelled' ? ' cancelled' : ''}`,
  );
  const number = createElement('span', 'lesson-number');
  number.textContent = String(lesson.number);
  card.append(number);

  const content = createElement('div', 'lesson-content');
  const label = actual ? replacementLabel(actualLesson) : null;
  if (label) {
    const badge = createElement('span', 'lesson-state');
    badge.textContent = label;
    content.append(badge);
  }
  for (const variant of lesson.variants) content.append(createVariant(variant));

  if (actual && actualLesson.replacements.length) {
    const source = actualLesson.replacements
      .map((item) => {
        const original = item.replacement.original?.raw;
        const replacement = item.replacement.replacement?.raw;
        return original && replacement ? `${original} → ${replacement}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .join('; ');
    if (source) {
      const note = createElement('p', 'replacement-note');
      note.textContent = source;
      content.append(note);
    }
  }
  card.append(content);
  return card;
};

const createUnresolvedReplacement = (
  replacement: ActualGroupArtifact['dates'][string]['groups'][string]['unresolvedReplacements'][number],
): HTMLElement => {
  const card = createElement('article', 'unresolved');
  const title = createElement('strong');
  title.textContent = `${replacement.event.summary}: пара ${replacement.lessonNumber}`;
  const description = createElement('p');
  description.textContent = replacement.event.description;
  card.append(title, description);
  return card;
};

const isVisibleDiagnostic = (diagnostic: Diagnostic): boolean =>
  ['warning', 'error', 'fatal'].includes(diagnostic.severity);

const isDiagnosticForDate = (diagnostic: Diagnostic, date: string): boolean =>
  diagnostic.context?.date === date;

const renderDiagnostics = (diagnostics: readonly Diagnostic[]): void => {
  diagnosticsContainer.replaceChildren();
  const commonDiagnostics = diagnostics.filter(
    (diagnostic) =>
      isVisibleDiagnostic(diagnostic) &&
      typeof diagnostic.context?.date !== 'string',
  );
  if (!commonDiagnostics.length) return;
  const heading = createElement('h3');
  heading.textContent = 'Проверить перед занятиями';
  diagnosticsContainer.append(heading);
  for (const diagnostic of commonDiagnostics) {
    const item = createElement('article', `diagnostic ${diagnostic.severity}`);
    const title = createElement('strong');
    title.textContent = `${diagnostic.severity.toUpperCase()} · ${diagnostic.code}`;
    const message = createElement('p');
    message.textContent = diagnostic.message;
    item.append(title, message);
    diagnosticsContainer.append(item);
  }
};

const renderDateDiagnostics = (
  card: HTMLElement,
  diagnostics: readonly Diagnostic[],
  date: string,
): void => {
  for (const diagnostic of diagnostics.filter(
    (item) => isVisibleDiagnostic(item) && isDiagnosticForDate(item, date),
  )) {
    const item = createElement('article', `diagnostic ${diagnostic.severity}`);
    const title = createElement('strong');
    title.textContent = `${diagnostic.severity.toUpperCase()} · ${diagnostic.code}`;
    const message = createElement('p');
    message.textContent = diagnostic.message;
    item.append(title, message);
    card.append(item);
  }
};

const addCalendarLink = (
  kind: 'base' | 'actual',
  group: string,
): HTMLElement => {
  const link = createElement('a', 'calendar-link');
  link.href = siteUrl(
    `ical/${kind}/${encodeURIComponent(group)}.ics`,
  ).toString();
  link.textContent = kind === 'actual' ? 'Подписаться: actual ICS' : 'Base ICS';
  return link;
};

const getNextDates = (): Date[] => {
  const result: Date[] = [];
  const current = new Date();
  for (let offset = 0; result.length < 7 && offset < 14; offset += 1) {
    const date = new Date(current);
    date.setDate(date.getDate() + offset);
    if (dayOrder.includes(dayName(date) ?? 'Понедельник')) result.push(date);
  }
  return result;
};

const renderGroup = async (
  group: PagesApiIndex['groups'][number],
): Promise<void> => {
  status.textContent = `Загружаем расписание ${group.code}…`;
  const [base, actual] = await Promise.all([
    fetchJson<BaseGroupArtifact>(
      `base/groups/${encodeURIComponent(group.code)}.json`,
    ),
    group.hasActual
      ? fetchJson<ActualGroupArtifact>(
          `actual/groups/${encodeURIComponent(group.code)}.json`,
        )
      : Promise.resolve<ActualGroupArtifact | null>(null),
  ]);
  const baseDays = new Map(base.group.days.map((day) => [day.day, day]));
  const nextDates = getNextDates();

  scheduleTitle.textContent = group.code;
  scheduleCaption.textContent =
    'Ближайшие учебные дни по опубликованной версии';
  calendarLinks.replaceChildren(
    addCalendarLink('actual', group.code),
    addCalendarLink('base', group.code),
  );
  const diagnostics = [...base.diagnostics, ...(actual?.diagnostics ?? [])];
  renderDiagnostics(diagnostics);
  daysContainer.replaceChildren();

  for (const date of nextDates) {
    const dateKey = isoDate(date);
    const day = dayName(date);
    if (!day) continue;
    const actualDay = actual?.dates[dateKey]?.groups[group.code];
    const baseDay = baseDays.get(day);
    const card = createElement('section', 'day-card');
    const heading = createElement('h3');
    heading.textContent = russianDate(date);
    card.append(heading);
    const lessons = actualDay?.lessons ?? baseDay?.lessons ?? [];
    if (actualDay) {
      const caption = createElement('p', 'day-state');
      caption.textContent = 'Есть опубликованные замены';
      card.append(caption);
    }
    if (!lessons.length) {
      const empty = createElement('p', 'empty');
      empty.textContent = 'Занятий не опубликовано';
      card.append(empty);
    } else {
      for (const lesson of lessons)
        card.append(createLesson(lesson, Boolean(actualDay)));
    }
    for (const replacement of actualDay?.unresolvedReplacements ?? [])
      card.append(createUnresolvedReplacement(replacement));
    renderDateDiagnostics(card, diagnostics, dateKey);
    daysContainer.append(card);
  }
  scheduleView.hidden = false;
  status.textContent = '';
};

const selectGroup = async (
  index: PagesApiIndex,
  groupCode: string,
): Promise<void> => {
  const group = index.groups.find((item) => item.code === groupCode);
  if (!group) return;
  const url = new URL(window.location.href);
  url.searchParams.set('group', group.code);
  window.history.replaceState({}, '', url);
  await renderGroup(group);
};

const initialize = async (): Promise<void> => {
  try {
    const index = await fetchJson<PagesApiIndex>('index.json');
    groupSelect.replaceChildren();
    for (const group of index.groups) {
      const option = document.createElement('option');
      option.value = group.code;
      option.textContent = group.code;
      groupSelect.append(option);
    }
    groupSelect.disabled = false;
    const requested = new URL(window.location.href).searchParams.get('group');
    const defaultGroup = index.groups.find((item) => item.code === requested)
      ? requested!
      : index.groups[0]?.code;
    if (!defaultGroup) throw new Error('В опубликованном API нет групп');
    groupSelect.value = defaultGroup;
    groupSelect.addEventListener('change', () => {
      void selectGroup(index, groupSelect.value).catch((error: unknown) => {
        status.textContent =
          error instanceof Error
            ? error.message
            : 'Не удалось обновить расписание';
      });
    });
    await selectGroup(index, defaultGroup);
  } catch (error) {
    root.classList.add('load-failed');
    status.textContent =
      error instanceof Error
        ? error.message
        : 'Не удалось загрузить опубликованные данные';
  }
};

void initialize();
import './style.css';
