import type {
  ActualGroupSchedule,
  ActualLesson,
  ActualSchedule,
  AppliedReplacement,
  CanonicalSchedule,
  DayOfWeek,
  LessonVariant,
  WeekType,
} from '../types.ts';
import { sha256 } from '../utils/hash.ts';
import {
  generateIcalWithReport,
  defaultIcalLessonSummary,
  type IcalDateEvent,
  type IcalGenerationResult,
  type IcalLessonSummaryFormatter,
  type IcalOptions,
  type IcalVariantExclusion,
} from './ical.ts';

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

const variantExclusionKey = (
  lessonNumber: number,
  subgroup: string | undefined,
): string => `${lessonNumber}\0${subgroup ?? ''}`;

const addVariantExclusion = (
  exclusions: Map<string, Set<string>>,
  lessonNumber: number,
  subgroup: string | undefined,
  date: string,
): void => {
  const key = variantExclusionKey(lessonNumber, subgroup);
  const dates = exclusions.get(key) ?? new Set<string>();
  dates.add(date);
  exclusions.set(key, dates);
};

const toVariantExclusions = (
  exclusions: ReadonlyMap<string, ReadonlySet<string>>,
): IcalVariantExclusion[] =>
  [...exclusions.entries()]
    .map(([key, dates]) => {
      const [rawLessonNumber, subgroup] = key.split('\0');
      return {
        lessonNumber: Number(rawLessonNumber),
        ...(subgroup ? { subgroup } : {}),
        dates: [...dates].sort((left, right) => left.localeCompare(right)),
      };
    })
    .sort(
      (left, right) =>
        left.lessonNumber - right.lessonNumber ||
        (left.subgroup ?? '').localeCompare(right.subgroup ?? ''),
    );

const actualLessonEvents = (
  date: string,
  lesson: ActualLesson,
  prefix: string,
  fallbackTimeRoom: string,
  subgroups?: ReadonlySet<string | undefined>,
  formatLessonSummary: IcalLessonSummaryFormatter = defaultIcalLessonSummary,
  timeRoomForVariant?: (variant: LessonVariant) => string,
): IcalDateEvent[] =>
  lesson.variants
    .filter((variant) => !subgroups || subgroups.has(variant.subgroup))
    .map((variant, index) => {
      const timeRoom =
        timeRoomForVariant?.(variant) || variant.room || fallbackTimeRoom;
      return {
        date,
        lessonNumber: lesson.number,
        key: `${prefix}:${index}:${sha256(
          [
            variant.subject,
            variant.teacher,
            variant.room,
            variant.weekType,
            variant.subgroup ?? '',
          ].join('\0'),
        )}`,
        summary: formatLessonSummary(lesson.number, variant, {
          changed: lesson.replacements.length > 0,
        }),
        ...(variant.subgroup ? { subgroup: variant.subgroup } : {}),
        ...(variant.room ? { room: variant.room } : {}),
        ...(timeRoom ? { timeRoom } : {}),
        ...(variant.teacher
          ? { description: `Преподаватель: ${variant.teacher}` }
          : {}),
      };
    });

/**
 * Находит вариант, созданный из примененной строки замен.
 *
 * `sourceRow` в base XLSX и HTML замен имеют разные системы координат и могут
 * случайно совпасть, поэтому он используется только как последний fallback.
 */
const replacementVariantForApplied = (
  lesson: ActualLesson,
  applied: AppliedReplacement,
): LessonVariant | undefined => {
  const rawReplacement = applied.replacement.replacement?.raw;
  if (rawReplacement) {
    const byRawSubject = lesson.variants.find(
      (variant) => variant.rawSubject === rawReplacement,
    );
    if (byRawSubject) return byRawSubject;
    const bySubject = lesson.variants.find(
      (variant) => variant.subject === rawReplacement,
    );
    if (bySubject) return bySubject;
  }
  return lesson.variants.find(
    (variant) => variant.sourceRow === applied.replacement.source.row,
  );
};

const addReplacementEvents = (
  date: string,
  lesson: ActualLesson,
  fallbackTimeRoom: string,
  formatLessonSummary: IcalLessonSummaryFormatter = defaultIcalLessonSummary,
): IcalDateEvent[] =>
  lesson.replacements
    .filter((applied) => applied.replacement.type === 'add')
    .flatMap((applied, index) => {
      const replacement = applied.replacement.replacement;
      if (!replacement) return [];
      const variant = replacementVariantForApplied(lesson, applied);
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
          summary: variant
            ? formatLessonSummary(lesson.number, variant, { changed: true })
            : defaultIcalLessonSummary(
                lesson.number,
                {
                  subject: replacement.raw,
                  teacher: '',
                  room: replacement.room ?? '',
                },
                { changed: true },
              ),
          ...(variant?.subgroup ? { subgroup: variant.subgroup } : {}),
          ...(replacement.room ? { room: replacement.room } : {}),
          ...(replacement.room || fallbackTimeRoom
            ? { timeRoom: replacement.room || fallbackTimeRoom }
            : {}),
          description,
        },
      ];
    });

/**
 * Пытается восстановить подгруппу измененной базовой пары.
 *
 * Resolver применяет replace/cancel только к единственному совпадению, поэтому
 * точное совпадение исходного предмета позволяет календарю исключить только
 * соответствующий recurring-вариант. При alias или иной неоднозначности
 * возвращается undefined: такая замена считается общей и не скрывает
 * произвольную подгруппу.
 */
const subgroupForAppliedReplacement = (
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  weekType: WeekType,
  lesson: ActualLesson,
  applied: AppliedReplacement,
): string | undefined => {
  const replacementVariant = replacementVariantForApplied(lesson, applied);
  if (replacementVariant) return replacementVariant.subgroup;

  const original = applied.replacement.original?.raw;
  if (!original) return undefined;
  const variants = schedule.groups[group]?.days
    .find((item) => item.day === day)
    ?.lessons.find((item) => item.number === lesson.number)
    ?.variants.filter(
      (variant) =>
        (variant.weekType === 'both' ||
          variant.weekType === weekType ||
          weekType === 'unknown') &&
        variant.subject === original,
    );
  return variants?.length === 1 ? variants[0]?.subgroup : undefined;
};

const subgroupsForReplacementType = (
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  weekType: WeekType,
  lesson: ActualLesson,
  type: 'replace' | 'cancel',
): Set<string | undefined> =>
  new Set(
    lesson.replacements
      .filter((applied) => applied.replacement.type === type)
      .flatMap((applied) =>
        applied.strategy === 'scheduled-room'
          ? lesson.variants.map((variant) => variant.subgroup)
          : [
              subgroupForAppliedReplacement(
                schedule,
                group,
                day,
                weekType,
                lesson,
                applied,
              ),
            ],
      ),
  );

/**
 * Формирует прозрачное уведомление об отмененной паре.
 *
 * Recurring-событие уже исключено через EXDATE, но отдельная запись делает
 * отмену заметной в календаре, а не превращает ее в тихое исчезновение.
 */
const cancelledLessonEvents = (
  date: string,
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  weekType: WeekType,
  lesson: ActualLesson,
  subgroups: ReadonlySet<string | undefined>,
): IcalDateEvent[] =>
  [...subgroups].map((subgroup, index) => ({
    date,
    lessonNumber: lesson.number,
    key: `cancel:${index}:${subgroup ?? 'all'}:${sha256(
      lesson.replacements
        .filter((applied) => applied.replacement.type === 'cancel')
        .map((applied) =>
          [
            applied.replacement.source.shift,
            String(applied.replacement.source.row),
            applied.replacement.original?.raw ?? '',
          ].join('\0'),
        )
        .join('\0'),
    )}`,
    summary: `${lesson.number}. ✳ ${subgroup ? `[${subgroup}] ` : ''}ОТМЕНЕНО`,
    ...(subgroup ? { subgroup } : {}),
    description: 'Занятие отменено опубликованной заменой.',
    transparency: 'transparent',
    timeRoom: baseRoomForVariant(
      schedule,
      group,
      day,
      lesson.number,
      weekType,
      subgroup,
    ),
  }));

const addFrozenDate = (
  schedule: CanonicalSchedule,
  group: string,
  date: string,
  actualGroup: ActualGroupSchedule,
  excludedDates: Map<number, Set<string>>,
  events: IcalDateEvent[],
  formatLessonSummary: IcalLessonSummaryFormatter,
): void => {
  const baseDay = schedule.groups[group]?.days.find(
    (item) => item.day === actualGroup.day,
  );
  for (const lesson of baseDay?.lessons ?? [])
    addExcludedDate(excludedDates, lesson.number, date);

  for (const lesson of actualGroup.lessons) {
    if (lesson.status === 'cancelled') {
      const cancelledSubgroups = subgroupsForReplacementType(
        schedule,
        group,
        actualGroup.day,
        'both',
        lesson,
        'cancel',
      );
      if (cancelledSubgroups.size)
        events.push(
          ...cancelledLessonEvents(
            date,
            schedule,
            group,
            actualGroup.day,
            'both',
            lesson,
            cancelledSubgroups,
          ),
        );
      continue;
    }
    events.push(
      ...actualLessonEvents(
        date,
        lesson,
        'frozen',
        baseRoomForLesson(
          schedule,
          group,
          actualGroup.day,
          lesson.number,
          'both',
        ),
        undefined,
        formatLessonSummary,
      ),
    );
  }
};

/**
 * Возвращает аудиторию исходной пары как fallback для определения времени
 * добавленной или неразрешенной замены без собственной аудитории.
 */
const baseRoomForLesson = (
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  lessonNumber: number,
  weekType: WeekType,
): string => {
  const lesson = schedule.groups[group]?.days
    .find((item) => item.day === day)
    ?.lessons.find((item) => item.number === lessonNumber);
  return (
    lesson?.variants.find(
      (variant) =>
        variant.weekType === 'both' ||
        variant.weekType === weekType ||
        weekType === 'unknown',
    )?.room ?? ''
  );
};

/**
 * Возвращает аудиторию исходного варианта пары.
 *
 * В строке «по расписанию → ДОТ» LOCATION меняется на ДОТ, но время пары
 * продолжает определяться исходным корпусом и не распадается на сегменты А/М.
 */
const baseRoomForVariant = (
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  lessonNumber: number,
  weekType: WeekType,
  subgroup: string | undefined,
): string => {
  const lesson = schedule.groups[group]?.days
    .find((item) => item.day === day)
    ?.lessons.find((item) => item.number === lessonNumber);
  return (
    lesson?.variants.find(
      (variant) =>
        (variant.weekType === 'both' ||
          variant.weekType === weekType ||
          weekType === 'unknown') &&
        variant.subgroup === subgroup,
    )?.room ?? baseRoomForLesson(schedule, group, day, lessonNumber, weekType)
  );
};

/**
 * Генерирует actual ICS: recurring base-уроки, исключения для замен и
 * одноразовые события для замен/необработанных строк.
 *
 * Для финализированной даты используется полный `frozenBase`-снимок группы:
 * это защищает прошлые занятия от будущей смены XLSX-расписания.
 */
export const generateActualIcalWithReport = (
  schedule: CanonicalSchedule,
  actual: ActualSchedule,
  options: IcalOptions,
): IcalGenerationResult => {
  const excludedDates = new Map<number, Set<string>>();
  const excludedDatesByVariant = new Map<string, Set<string>>();
  const events: IcalDateEvent[] = [];
  const formatLessonSummary =
    options.formatLessonSummary ?? defaultIcalLessonSummary;

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
        formatLessonSummary,
      );
    } else {
      for (const lesson of actualGroup.lessons) {
        const fallbackTimeRoom = baseRoomForLesson(
          schedule,
          options.group,
          actualDate.day,
          lesson.number,
          actualDate.weekType,
        );
        const replacedSubgroups = subgroupsForReplacementType(
          schedule,
          options.group,
          actualDate.day,
          actualDate.weekType,
          lesson,
          'replace',
        );
        const cancelledSubgroups = subgroupsForReplacementType(
          schedule,
          options.group,
          actualDate.day,
          actualDate.weekType,
          lesson,
          'cancel',
        );
        for (const subgroup of [...replacedSubgroups, ...cancelledSubgroups])
          addVariantExclusion(
            excludedDatesByVariant,
            lesson.number,
            subgroup,
            date,
          );
        if (cancelledSubgroups.size)
          events.push(
            ...cancelledLessonEvents(
              date,
              schedule,
              options.group,
              actualDate.day,
              actualDate.weekType,
              lesson,
              cancelledSubgroups,
            ),
          );
        if (replacedSubgroups.size && lesson.status !== 'cancelled') {
          const retainsBaseTimes = lesson.replacements.some(
            (applied) => applied.strategy === 'scheduled-room',
          );
          events.push(
            ...actualLessonEvents(
              date,
              lesson,
              'replace',
              fallbackTimeRoom,
              replacedSubgroups,
              formatLessonSummary,
              retainsBaseTimes
                ? (variant) =>
                    baseRoomForVariant(
                      schedule,
                      options.group,
                      actualDate.day,
                      lesson.number,
                      actualDate.weekType,
                      variant.subgroup,
                    )
                : undefined,
            ),
          );
        }
        if (!replacedSubgroups.size && !cancelledSubgroups.size)
          events.push(
            ...addReplacementEvents(
              date,
              lesson,
              fallbackTimeRoom,
              formatLessonSummary,
            ),
          );
      }
    }

    for (const unresolved of actualGroup.unresolvedReplacements) {
      const fallbackTimeRoom = baseRoomForLesson(
        schedule,
        options.group,
        actualDate.day,
        unresolved.lessonNumber,
        actualDate.weekType,
      );
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
        summary: `✳ ${unresolved.event.summary}`,
        description: unresolved.event.description,
        ...(unresolved.event.room ? { room: unresolved.event.room } : {}),
        ...(unresolved.event.room || fallbackTimeRoom
          ? { timeRoom: unresolved.event.room || fallbackTimeRoom }
          : {}),
      });
    }
  }

  return generateIcalWithReport(schedule, {
    ...options,
    excludedDates: toExcludedDates(excludedDates),
    excludedDatesByVariant: toVariantExclusions(excludedDatesByVariant),
    additionalEvents: events,
    calendarName: options.calendarName ?? `ЯГК: ${options.group} (actual)`,
  });
};

/**
 * Генерирует actual ICS без диагностического отчета.
 */
export const generateActualIcal = (
  schedule: CanonicalSchedule,
  actual: ActualSchedule,
  options: IcalOptions,
): string => generateActualIcalWithReport(schedule, actual, options).content;
