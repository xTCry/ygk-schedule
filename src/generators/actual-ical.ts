import type {
  ActualGroupSchedule,
  ActualLesson,
  ActualSchedule,
  CanonicalSchedule,
} from '../types.ts';
import { sha256 } from '../utils/hash.ts';
import { generateIcal, type IcalDateEvent, type IcalOptions } from './ical.ts';

const addExcludedDate = (
  excludedDates: Map<number, Set<string>>,
  lessonNumber: number,
  date: string,
): void => {
  const dates = excludedDates.get(lessonNumber) ?? new Set<string>();
  dates.add(date);
  excludedDates.set(lessonNumber, dates);
};

const toExcludedDates = (
  excludedDates: ReadonlyMap<number, ReadonlySet<string>>,
): Record<number, string[]> =>
  Object.fromEntries(
    [...excludedDates.entries()]
      .sort(([left], [right]) => left - right)
      .map(([lessonNumber, dates]) => [
        lessonNumber,
        [...dates].sort((left, right) => left.localeCompare(right)),
      ]),
  );

const actualLessonEvents = (
  date: string,
  lesson: ActualLesson,
  prefix: string,
): IcalDateEvent[] =>
  lesson.variants.map((variant, index) => ({
    date,
    lessonNumber: lesson.number,
    key: `${prefix}:${index}:${sha256(
      [variant.subject, variant.teacher, variant.room, variant.weekType].join(
        '\0',
      ),
    )}`,
    summary: variant.subject || `Пара ${lesson.number}`,
    ...(variant.room ? { room: variant.room } : {}),
    ...(variant.teacher
      ? { description: `Преподаватель: ${variant.teacher}` }
      : {}),
  }));

const addReplacementEvents = (
  date: string,
  lesson: ActualLesson,
): IcalDateEvent[] =>
  lesson.replacements
    .filter((applied) => applied.replacement.type === 'add')
    .flatMap((applied, index) => {
      const replacement = applied.replacement.replacement;
      if (!replacement) return [];
      const description = [
        'Добавленная замена.',
        replacement.room ? `Аудитория: ${replacement.room}.` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return [
        {
          date,
          lessonNumber: lesson.number,
          key: `add:${index}:${sha256(
            [
              applied.replacement.source.shift,
              String(applied.replacement.source.row),
              replacement.raw,
              replacement.room ?? '',
            ].join('\0'),
          )}`,
          summary: replacement.raw || `Добавленная пара ${lesson.number}`,
          ...(replacement.room ? { room: replacement.room } : {}),
          description,
        },
      ];
    });

const hasReplacementType = (
  lesson: ActualLesson,
  type: 'replace' | 'cancel',
): boolean =>
  lesson.replacements.some((applied) => applied.replacement.type === type);

const addFrozenDate = (
  schedule: CanonicalSchedule,
  group: string,
  date: string,
  actualGroup: ActualGroupSchedule,
  excludedDates: Map<number, Set<string>>,
  events: IcalDateEvent[],
): void => {
  const baseDay = schedule.groups[group]?.days.find(
    (item) => item.day === actualGroup.day,
  );
  for (const lesson of baseDay?.lessons ?? [])
    addExcludedDate(excludedDates, lesson.number, date);

  for (const lesson of actualGroup.lessons) {
    if (lesson.status === 'cancelled') continue;
    events.push(...actualLessonEvents(date, lesson, 'frozen'));
  }
};

/**
 * Генерирует actual ICS: recurring base-уроки, исключения для замен и
 * одноразовые события для замен/необработанных строк.
 *
 * Для финализированной даты используется полный `frozenBase`-снимок группы:
 * это защищает прошлые занятия от будущей смены XLSX-расписания.
 */
export const generateActualIcal = (
  schedule: CanonicalSchedule,
  actual: ActualSchedule,
  options: IcalOptions,
): string => {
  const excludedDates = new Map<number, Set<string>>();
  const events: IcalDateEvent[] = [];

  for (const [date, actualDate] of Object.entries(actual.dates)) {
    const actualGroup = actualDate.groups[options.group];
    if (!actualGroup) continue;

    if (actualGroup.frozenBase) {
      addFrozenDate(
        schedule,
        options.group,
        date,
        actualGroup,
        excludedDates,
        events,
      );
    } else {
      for (const lesson of actualGroup.lessons) {
        const isReplacement = hasReplacementType(lesson, 'replace');
        const isCancelled = hasReplacementType(lesson, 'cancel');
        if (isReplacement || isCancelled)
          addExcludedDate(excludedDates, lesson.number, date);
        if (isReplacement && lesson.status !== 'cancelled')
          events.push(...actualLessonEvents(date, lesson, 'replace'));
        if (!isReplacement && !isCancelled)
          events.push(...addReplacementEvents(date, lesson));
      }
    }

    for (const unresolved of actualGroup.unresolvedReplacements) {
      events.push({
        date,
        lessonNumber: unresolved.lessonNumber,
        key: `unresolved:${sha256(
          [
            unresolved.reason,
            unresolved.replacement.source.shift,
            String(unresolved.replacement.source.row),
            unresolved.replacement.original?.raw ?? '',
            unresolved.replacement.replacement?.raw ?? '',
          ].join('\0'),
        )}`,
        summary: unresolved.event.summary,
        description: unresolved.event.description,
        ...(unresolved.event.room ? { room: unresolved.event.room } : {}),
      });
    }
  }

  return generateIcal(schedule, {
    ...options,
    excludedDates: toExcludedDates(excludedDates),
    additionalEvents: events,
    calendarName: options.calendarName ?? `ЯГК: ${options.group} (actual)`,
  });
};
