import { createElement } from '../dom.ts';
import { dayName, isoDate, nextStudyDates, russianDate } from '../date.ts';
import type {
  ActualGroup,
  ActualGroupArtifact,
  ActualDate,
  ActualLesson,
  BaseGroupArtifact,
  Diagnostic,
  Lesson,
  LessonVariant,
} from '../types.ts';

export interface ScheduleRenderOptions {
  group: string;
  subgroup: string | null;
  onOpenReplacementDetails: (
    date: string,
    actual: ActualGroup,
    actualDate: ActualDate,
  ) => void;
}

const visibleDiagnostic = (diagnostic: Diagnostic): boolean =>
  diagnostic.severity === 'warning' ||
  diagnostic.severity === 'error' ||
  diagnostic.severity === 'fatal';

const diagnosticForDate = (diagnostic: Diagnostic, date: string): boolean =>
  diagnostic.context?.date === date;

const roomLabel = (room: string): string | null => {
  const match = /^([АБВМТФ])\s*\d/iu.exec(room.trim());
  if (match?.[1]) return `корпус ${match[1].toUpperCase()}`;
  if (/(?:спорт|сп\.)/iu.test(room)) return 'спортзал';
  if (/(?:дот|дистанцион)/iu.test(room)) return 'дистанционно';
  return null;
};

const shortTimingLabel = (variant: LessonVariant | undefined): string => {
  if (!variant?.timing.slots.length) return 'время уточняется';
  const periods = variant.timing.slots
    .map((slot) => `${slot.start}–${slot.end}`)
    .join('\n');
  return variant.timing.breakAfterMinutes
    ? `${periods}\nперемена ${variant.timing.breakAfterMinutes} мин`
    : periods;
};

/**
 * Собирает время под номером пары. Обычно все варианты пары используют один
 * профиль звонков; если аудитории ведут к разным профилям, обе версии времени
 * остаются видны, но не дублируются возле каждого предмета.
 */
const lessonTimingLabel = (variants: readonly LessonVariant[]): string =>
  [
    ...new Set(
      variants.map((variant) => shortTimingLabel(variant)).filter(Boolean),
    ),
  ].join('\n\n');

const filterLesson = <T extends Lesson>(
  lesson: T,
  subgroup: string | null,
): T | null => {
  if (!subgroup) return lesson;
  const variants = lesson.variants.filter(
    (variant) => !variant.subgroup || variant.subgroup === subgroup,
  );
  return variants.length ? { ...lesson, variants } : null;
};

const replacementLabel = (lesson: ActualLesson): string | null => {
  const type = lesson.replacements[0]?.replacement.type;
  if (lesson.status === 'cancelled' || type === 'cancel') return 'ОТМЕНЕНО';
  if (type === 'replace') return 'ЗАМЕНЕНО';
  if (type === 'add') return 'ДОБАВЛЕНО';
  if (type === 'move') return 'ПЕРЕНЕСЕНО';
  return null;
};

const createVariant = (variant: LessonVariant): HTMLElement => {
  const item = createElement(
    'div',
    `space-y-1${variant.subgroup ? ` subgroup-gradient-${variant.subgroup}` : ''}`,
  );
  const title = createElement('strong', 'block font-medium');
  title.textContent = variant.subject || 'Предмет не указан';
  const location = roomLabel(variant.room);
  const details = [
    variant.teacher,
    variant.room,
    location &&
    location.localeCompare(variant.room, 'ru-RU', {
      sensitivity: 'accent',
    }) !== 0
      ? location
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (details) {
    const text = createElement(
      'p',
      'text-sm text-stone-600 dark:text-stone-300',
    );
    text.textContent = details;
    item.append(text);
  }
  if (variant.subgroup) {
    const chip = createElement('span', 'chip');
    chip.textContent = `Подгруппа ${variant.subgroup}`;
    item.append(chip);
  }
  return item;
};

const createLesson = (
  lesson: Lesson | ActualLesson,
  actual: boolean,
): HTMLElement => {
  const actualLesson = lesson as ActualLesson;
  const card = createElement(
    'article',
    `lesson-card${actual && actualLesson.status === 'cancelled' ? ' lesson-cancelled' : ''}`,
  );
  card.dataset.lessonNumber = String(lesson.number);
  const numberColumn = createElement('div', 'lesson-number-column');
  const number = createElement('div', 'lesson-number');
  number.textContent = `${lesson.number}`;
  const time = createElement('p', 'lesson-time');
  time.textContent = lessonTimingLabel(lesson.variants);
  numberColumn.append(number, time);
  const content = createElement('div', 'min-w-0 space-y-2');
  const label = actual ? replacementLabel(actualLesson) : null;
  if (label) {
    const badge = createElement('span', 'state-badge');
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
      const note = createElement(
        'p',
        'text-sm leading-5 text-stone-600 dark:text-stone-300',
      );
      note.textContent = source;
      content.append(note);
    }
  }
  card.append(numberColumn, content);
  return card;
};

const createDiagnostic = (diagnostic: Diagnostic): HTMLElement => {
  const item = createElement(
    'article',
    `diagnostic-card diagnostic-${diagnostic.severity}`,
  );
  const title = createElement('strong', 'block text-sm');
  title.textContent = `${diagnostic.severity.toUpperCase()} · ${diagnostic.code}`;
  const text = createElement('p', 'mt-1 text-sm leading-5');
  text.textContent = diagnostic.message;
  item.append(title, text);
  return item;
};

const createUnresolved = (
  unresolved: ActualGroup['unresolvedReplacements'][number],
): HTMLElement => {
  const item = createElement('article', 'unresolved-card');
  const title = createElement('strong', 'block text-sm');
  title.textContent = `${unresolved.event.summary}: пара ${unresolved.lessonNumber}`;
  const text = createElement('p', 'mt-1 text-sm leading-5');
  text.textContent = unresolved.event.description;
  item.append(title, text);
  return item;
};

/**
 * Рендерит ближайшие учебные дни. Для выбранной подгруппы общие пары
 * сохраняются, а варианты других подгрупп скрываются.
 */
export const renderSchedule = (
  container: HTMLElement,
  base: BaseGroupArtifact,
  actual: ActualGroupArtifact | null,
  options: ScheduleRenderOptions,
): void => {
  const baseDays = new Map(base.group.days.map((day) => [day.day, day]));
  const diagnostics = [...base.diagnostics, ...(actual?.diagnostics ?? [])];
  container.replaceChildren();

  for (const date of nextStudyDates()) {
    const dateKey = isoDate(date);
    const day = dayName(date);
    if (!day) continue;
    const actualDate = actual?.dates[dateKey];
    const actualGroup = actualDate?.groups[options.group];
    const baseDay = baseDays.get(day);
    const card = createElement('section', 'day-card');
    const heading = createElement(
      'div',
      'flex items-start justify-between gap-3',
    );
    const title = createElement('h3', 'text-base font-semibold tracking-tight');
    title.textContent = russianDate(date);
    heading.append(title);
    if (actualGroup) {
      const details = createElement('button', 'button-secondary text-xs');
      details.type = 'button';
      details.textContent = 'Замены и детали';
      details.addEventListener('click', () =>
        options.onOpenReplacementDetails(dateKey, actualGroup, actualDate),
      );
      heading.append(details);
    }
    card.append(heading);

    const originalLessons = actualGroup?.lessons ?? baseDay?.lessons ?? [];
    const lessons = originalLessons
      .map((lesson) => filterLesson(lesson, options.subgroup))
      .filter((lesson): lesson is Lesson | ActualLesson => Boolean(lesson));
    const isRemoteDay =
      lessons.length > 0 &&
      lessons.every((lesson) =>
        lesson.variants.every((variant) =>
          /(?:дот|дистанцион)/iu.test(variant.room),
        ),
      );
    if (isRemoteDay) {
      card.classList.add('day-remote');
      const remote = createElement('p', 'remote-day-label');
      remote.textContent = '💻 Весь день дистанционно';
      card.append(remote);
    }
    if (!lessons.length) {
      const empty = createElement(
        'p',
        'mt-5 text-sm text-stone-500 dark:text-stone-400',
      );
      empty.textContent = 'Занятия не опубликованы';
      card.append(empty);
    } else {
      const list = createElement(
        'div',
        'mt-4 divide-y divide-stone-200 dark:divide-stone-800',
      );
      for (const lesson of lessons)
        list.append(createLesson(lesson, Boolean(actualGroup)));
      card.append(list);
    }

    for (const unresolved of actualGroup?.unresolvedReplacements ?? [])
      card.append(createUnresolved(unresolved));
    for (const diagnostic of diagnostics.filter(
      (item) => visibleDiagnostic(item) && diagnosticForDate(item, dateKey),
    ))
      card.append(createDiagnostic(diagnostic));
    container.append(card);
  }
};
