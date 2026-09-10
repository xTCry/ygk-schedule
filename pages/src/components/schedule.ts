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
import { describeLessonReplacement } from '../replacement-summary.ts';

export interface ScheduleRenderOptions {
  group: string;
  subgroup: string | null;
  showOtherSubgroups: boolean;
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

const isRemoteVariant = (variant: LessonVariant): boolean =>
  /(?:дот|дистанцион)/iu.test(variant.room);

const subgroupPosition = (subgroup: string | undefined): number => {
  if (!subgroup) return -1;
  const number = Number(subgroup);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
};

/** Общий вариант всегда показывается до вариантов отдельных подгрупп. */
const sortVariants = <T extends LessonVariant>(variants: readonly T[]): T[] =>
  [...variants].sort((left, right) => {
    const subgroupOrder =
      subgroupPosition(left.subgroup) - subgroupPosition(right.subgroup);
    if (subgroupOrder) return subgroupOrder;
    return (left.subgroup ?? '').localeCompare(right.subgroup ?? '', 'ru-RU');
  });

const displayedVariants = <T extends LessonVariant>(
  variants: readonly T[],
  subgroup: string | null,
  showOtherSubgroups: boolean,
): T[] =>
  sortVariants(variants).filter(
    (variant) =>
      !subgroup ||
      showOtherSubgroups ||
      !variant.subgroup ||
      variant.subgroup === subgroup,
  );

/**
 * В номерной аудитории код корпуса уже очевиден. Вывод «Б409 · корпус Б»
 * временно отключен, пока не появится подтверждённый случай, где это полезно.
 */
const displayRoom = (room: string): string => {
  /*
  const building = /^([АБВМТФ])\s*\d/iu.exec(room.trim())?.[1];
  if (building) return `${room} · корпус ${building}`;
  */
  return room || 'Аудитория не указана';
};

const createLessonTiming = (
  variants: readonly LessonVariant[],
): HTMLElement => {
  const timing = createElement('div', 'lesson-time');
  const uniqueVariants = [
    ...new Map(
      variants.map((variant) => [
        JSON.stringify({
          slots: variant.timing.slots,
          breakAfterMinutes: variant.timing.breakAfterMinutes,
        }),
        variant,
      ]),
    ).values(),
  ];
  if (!uniqueVariants.some((variant) => variant.timing.slots.length)) {
    timing.textContent = '—';
    return timing;
  }
  for (const variant of uniqueVariants) {
    const line = createElement('div', 'leading-4');
    line.textContent = variant.timing.slots
      .map((slot) => `${slot.start}–${slot.end}`)
      .join('\n');
    if (variant.timing.breakAfterMinutes) {
      const pause = createElement('em', 'lesson-break');
      pause.textContent = `перемена ${variant.timing.breakAfterMinutes} мин`;
      line.append(document.createElement('br'), pause);
    }
    timing.append(line);
  }
  return timing;
};

const replacementLabel = (lesson: ActualLesson): string | null => {
  const type = lesson.replacements[0]?.replacement.type;
  if (lesson.status === 'cancelled' || type === 'cancel') return 'ОТМЕНЕНО';
  if (type === 'replace') return 'ЗАМЕНЕНО';
  if (type === 'add') return 'ДОБАВЛЕНО';
  if (type === 'move') return 'ПЕРЕНЕСЕНО';
  return null;
};

const createVariant = (
  variant: LessonVariant,
  selectedSubgroup: string | null,
): HTMLElement => {
  const otherSubgroup =
    selectedSubgroup !== null &&
    variant.subgroup !== undefined &&
    variant.subgroup !== selectedSubgroup;
  const item = createElement(
    'div',
    [
      'lesson-variant',
      variant.subgroup ? `subgroup-gradient-${variant.subgroup}` : '',
      isRemoteVariant(variant) ? 'lesson-remote-variant' : '',
      otherSubgroup ? 'lesson-variant-muted' : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  const details = [displayRoom(variant.room), variant.teacher]
    .filter(Boolean)
    .join(' · ');
  const location = createElement(
    'p',
    'text-sm text-stone-600 dark:text-stone-300',
  );
  location.textContent = details;
  const title = createElement('strong', 'block font-medium');
  title.textContent = variant.subject || 'Предмет не указан';
  item.append(location, title);
  if (variant.subgroup) {
    const chip = createElement('span', 'chip');
    chip.textContent = `Подгруппа ${variant.subgroup}${isRemoteVariant(variant) ? ' · 💻' : ''}`;
    item.append(chip);
  } else if (isRemoteVariant(variant)) {
    const chip = createElement('span', 'chip');
    chip.textContent = '💻 ДОТ';
    item.append(chip);
  }
  return item;
};

const createLesson = (
  lesson: Lesson | ActualLesson,
  variants: readonly LessonVariant[],
  actual: boolean,
  selectedSubgroup: string | null,
  replacementDetails: string | null,
): HTMLElement => {
  const actualLesson = lesson as ActualLesson;
  const card = createElement(
    'article',
    `lesson-card${actual && actualLesson.status === 'cancelled' ? ' lesson-cancelled' : ''}`,
  );
  card.dataset.lessonNumber = String(lesson.number);
  const numberColumn = createElement('div', 'lesson-number-column');
  const number = createElement('div', 'lesson-number');
  const changed =
    actual &&
    (actualLesson.status === 'cancelled' ||
      actualLesson.replacements.length > 0);
  number.textContent = `${lesson.number}${changed ? ' ✳' : ''}`;
  const time = createLessonTiming(variants);
  numberColumn.append(number, time);
  const content = createElement('div', 'min-w-0 space-y-2');
  const label = actual ? replacementLabel(actualLesson) : null;
  if (label) {
    const badge = createElement('span', 'state-badge');
    badge.textContent = label;
    content.append(badge);
  }
  for (const variant of variants)
    content.append(createVariant(variant, selectedSubgroup));
  if (actual && actualLesson.replacements.length) {
    if (replacementDetails) {
      const note = createElement(
        'p',
        'text-sm leading-5 text-stone-600 dark:text-stone-300',
      );
      note.textContent = replacementDetails;
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
 * сохраняются, а остальные варианты можно оставить второстепенными.
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
      .map((lesson) => ({
        lesson,
        variants: displayedVariants(
          lesson.variants,
          options.subgroup,
          options.showOtherSubgroups,
        ),
        replacementDetails: actualGroup
          ? describeLessonReplacement(
              lesson as ActualLesson,
              baseDay?.lessons,
              actualDate?.weekType,
            )
          : null,
      }))
      .filter(
        (item) =>
          item.variants.length > 0 ||
          (actualGroup && (item.lesson as ActualLesson).status === 'cancelled'),
      );
    const isRemoteDay =
      lessons.length > 0 &&
      lessons.every((item) =>
        item.variants.every((variant) =>
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
      for (const { lesson, variants, replacementDetails } of lessons)
        list.append(
          createLesson(
            lesson,
            variants,
            Boolean(actualGroup),
            options.subgroup,
            replacementDetails,
          ),
        );
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
