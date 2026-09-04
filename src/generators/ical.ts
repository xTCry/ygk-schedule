import { createHash } from 'node:crypto';
import type {
  CanonicalSchedule,
  DayOfWeek,
  GroupSchedule,
  WeekType,
} from '../types.ts';
import { weekTypeForDate } from '../calendar/academic-year.ts';
import type {
  LessonTime,
  LessonTimeOverride,
  LessonTimeResolver,
  LessonTimeSlots,
} from '../calendar/lesson-times.ts';

export type {
  LessonTime,
  LessonTimeOverride,
  LessonTimeResolver,
  LessonTimeSlots,
} from '../calendar/lesson-times.ts';

export interface IcalDateEvent {
  date: string;
  lessonNumber: number;
  key: string;
  summary: string;
  description?: string;
  room?: string;
  /**
   * Аудитория, по которой определяется время. Может отличаться от LOCATION:
   * например, в замене новая аудитория не указана, но известна исходная пара.
   */
  timeRoom?: string;
}

export interface IcalSkippedEvent {
  group: string;
  day: DayOfWeek;
  date?: string;
  lessonNumber: number;
  room: string;
  summary: string;
  reason: string;
}

export interface IcalGenerationResult {
  content: string;
  skippedEvents: IcalSkippedEvent[];
}

export interface IcalOptions {
  group: string;
  termStart: string;
  termEnd: string;
  referenceDate: string;
  referenceWeekType?: 'numerator' | 'denominator';
  /**
   * Время пар по умолчанию. Один номер может состоять из нескольких частей:
   * например, в корпусе А/М вторая пара первого курса разделена переменой.
   */
  lessonTimes?: Record<number, LessonTimeSlots>;
  /**
   * Временные слоты, переопределяющие общую таблицу на конкретный день.
   * `null` явно запрещает публикацию пары, для которой в расписании звонков
   * нет времени. Используется, в частности, для субботы.
   */
  lessonTimesByDay?: Partial<
    Record<DayOfWeek, Record<number, LessonTimeOverride>>
  >;
  /**
   * Выбор времени занятия по его фактической аудитории. При наличии resolver
   * имеет приоритет над устаревшей единой таблицей времени группы.
   */
  lessonTimeResolver?: LessonTimeResolver;
  timezone?: string;
  productId?: string;
  calendarName?: string;
  /**
   * Постоянный публичный адрес этого ICS. Он остается внутри файла для
   * клиентов, которые получили календарь не через прямую подписку.
   */
  sourceUrl?: string;
  /**
   * Рекомендуемый интервал повторного чтения `sourceUrl` в ISO 8601 duration.
   * Клиент календаря может проигнорировать эту рекомендацию.
   */
  refreshInterval?: string;
  /**
   * Даты, на которых recurring-события базового расписания не должны
   * отображаться. Ключ — номер пары.
   */
  excludedDates?: Record<number, readonly string[]>;
  /**
   * Одноразовые события: примененные замены и безопасно отображаемые
   * неразрешенные строки.
   */
  additionalEvents?: readonly IcalDateEvent[];
}

interface IcalEventDetails {
  uid: string;
  start: string;
  end: string;
  summary: string;
  room?: string;
  description?: string;
  rule?: string;
  excludedDates?: readonly string[];
}

const dayOffsets: Record<DayOfWeek, number> = {
  Понедельник: 1,
  Вторник: 2,
  Среда: 3,
  Четверг: 4,
  Пятница: 5,
  Суббота: 6,
};

const stableTimestamp = '20000101T000000Z';

const parseDate = (value: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date: ${value}`);
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
};

const parseTime = (value: string): [number, number] => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid time: ${value}`);
  return [hour, minute];
};

const dateKey = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;

const escapeIcal = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

const fold = (line: string): string => {
  const chunks: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 73) {
      chunks.push(current);
      current = ` ${char}`;
    } else current += char;
  }
  chunks.push(current);
  return chunks.join('\r\n');
};

const firstDateForDay = (start: Date, day: DayOfWeek): Date => {
  const result = new Date(start);
  const target = dayOffsets[day];
  const current = result.getUTCDay() || 7;
  const delta = (target - current + 7) % 7;
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
};

const firstDateForWeekType = (
  start: Date,
  day: DayOfWeek,
  weekType: WeekType,
  referenceDate: Date,
  referenceWeekType: 'numerator' | 'denominator',
): Date => {
  const first = firstDateForDay(start, day);
  if (weekType === 'both' || weekType === 'unknown') return first;
  if (weekTypeForDate(first, referenceDate, referenceWeekType) === weekType)
    return first;
  const next = new Date(first);
  next.setUTCDate(next.getUTCDate() + 7);
  return next;
};

const dayForDate = (date: Date): DayOfWeek => {
  const weekday = date.getUTCDay();
  const days: Record<number, DayOfWeek> = {
    1: 'Понедельник',
    2: 'Вторник',
    3: 'Среда',
    4: 'Четверг',
    5: 'Пятница',
    6: 'Суббота',
  };
  const day = days[weekday];
  if (!day) throw new Error(`Unsupported calendar weekday: ${weekday}`);
  return day;
};

const toTimeSlots = (value: LessonTimeSlots | undefined): LessonTime[] =>
  !value ? [] : 'start' in value ? [value] : [...value];

const timesForDay = (
  options: IcalOptions,
  day: DayOfWeek,
  lessonNumber: number,
): LessonTime[] =>
  (() => {
    const overrides = options.lessonTimesByDay?.[day];
    if (overrides && Object.hasOwn(overrides, lessonNumber)) {
      const override = overrides[lessonNumber];
      return override ? toTimeSlots(override) : [];
    }
    return toTimeSlots(options.lessonTimes?.[lessonNumber]);
  })();

const resolveTimes = (
  options: IcalOptions,
  group: string,
  day: DayOfWeek,
  lessonNumber: number,
  room: string,
): { slots: readonly LessonTime[]; reason?: string } => {
  if (options.lessonTimeResolver)
    return options.lessonTimeResolver({ group, day, lessonNumber, room });
  const slots = timesForDay(options, day, lessonNumber);
  return slots.length
    ? { slots }
    : {
        slots: [],
        reason: `Для пары ${lessonNumber} не настроено время`,
      };
};

const formatLocalDateTime = (date: Date, time: string): string => {
  const [hour, minute] = parseTime(time);
  return `${dateKey(date)}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
};

const stableUid = (...parts: readonly string[]): string =>
  `${createHash('sha1').update(parts.join('\0')).digest('hex')}@ygk-schedule`;

const getGroup = (
  schedule: CanonicalSchedule,
  group: string,
): GroupSchedule => {
  const value = schedule.groups[group];
  if (!value) throw new Error(`Group not found: ${group}`);
  return value;
};

const descriptionForLesson = (
  teacher: string,
  room: string,
): string | undefined => {
  const description = [teacher, room].filter(Boolean).join('\n');
  return description || undefined;
};

const sortedDates = (dates: readonly string[] | undefined): string[] =>
  [...new Set(dates ?? [])].sort((left, right) => left.localeCompare(right));

const serializeEvent = (
  event: IcalEventDetails,
  timezone: string,
): string[] => [
  'BEGIN:VEVENT',
  `UID:${event.uid}`,
  `DTSTAMP:${stableTimestamp}`,
  `DTSTART;TZID=${timezone}:${event.start}`,
  `DTEND;TZID=${timezone}:${event.end}`,
  ...(event.rule ? [event.rule] : []),
  ...(event.excludedDates?.length
    ? [
        `EXDATE;TZID=${timezone}:${event.excludedDates
          .map((date) => `${date.replaceAll('-', '')}T${event.start.slice(9)}`)
          .join(',')}`,
      ]
    : []),
  `SUMMARY:${escapeIcal(event.summary)}`,
  ...(event.room ? [`LOCATION:${escapeIcal(event.room)}`] : []),
  ...(event.description
    ? [`DESCRIPTION:${escapeIcal(event.description)}`]
    : []),
  'END:VEVENT',
];

/**
 * Генерирует recurring ICS базового расписания и при необходимости добавляет
 * одноразовые исключения для actual-календаря.
 *
 * `DTSTAMP` намеренно стабилен: изменение глобального времени выгрузки не
 * должно переписывать ICS всех неизменных групп.
 */
export const generateIcalWithReport = (
  schedule: CanonicalSchedule,
  options: IcalOptions,
): IcalGenerationResult => {
  const group = getGroup(schedule, options.group);
  const termStart = parseDate(options.termStart);
  const termEnd = parseDate(options.termEnd);
  const referenceDate = parseDate(options.referenceDate);
  const referenceWeekType = options.referenceWeekType ?? 'numerator';
  const timezone = options.timezone ?? 'Europe/Moscow';
  const productId = options.productId ?? '-//ygk-schedule//Schedule//RU';
  const skippedEvents: IcalSkippedEvent[] = [];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(options.calendarName
      ? [`X-WR-CALNAME:${escapeIcal(options.calendarName)}`]
      : []),
    `X-WR-TIMEZONE:${timezone}`,
    ...(options.sourceUrl
      ? [`URL:${options.sourceUrl}`, `SOURCE;VALUE=URI:${options.sourceUrl}`]
      : []),
    ...(options.refreshInterval
      ? [`REFRESH-INTERVAL;VALUE=DURATION:${options.refreshInterval}`]
      : []),
  ];

  for (const day of group.days) {
    for (const lesson of day.lessons) {
      lesson.variants.forEach((variant, index) => {
        if (variant.weekType === 'unknown') return;
        const firstDate = firstDateForWeekType(
          termStart,
          day.day,
          variant.weekType,
          referenceDate,
          referenceWeekType,
        );
        if (firstDate > termEnd) return;
        const interval = variant.weekType === 'both' ? 1 : 2;
        const resolution = resolveTimes(
          options,
          group.group,
          day.day,
          lesson.number,
          variant.room,
        );
        if (!resolution.slots.length) {
          skippedEvents.push({
            group: group.group,
            day: day.day,
            lessonNumber: lesson.number,
            room: variant.room,
            summary: variant.subject || `Пара ${lesson.number}`,
            reason: resolution.reason ?? 'Не удалось определить время пары',
          });
          return;
        }
        resolution.slots.forEach((time, timeIndex) => {
          const description = descriptionForLesson(
            variant.teacher,
            variant.room,
          );
          lines.push(
            ...serializeEvent(
              {
                uid: stableUid(
                  'base',
                  group.group,
                  day.day,
                  String(lesson.number),
                  variant.weekType,
                  String(index),
                  String(timeIndex),
                ),
                start: formatLocalDateTime(firstDate, time.start),
                end: formatLocalDateTime(firstDate, time.end),
                rule: `RRULE:FREQ=WEEKLY;INTERVAL=${interval};UNTIL=${dateKey(termEnd)}T235959Z`,
                excludedDates: sortedDates(
                  options.excludedDates?.[lesson.number],
                ),
                summary: variant.subject || `Пара ${lesson.number}`,
                ...(variant.room ? { room: variant.room } : {}),
                ...(description ? { description } : {}),
              },
              timezone,
            ),
          );
        });
      });
    }
  }

  for (const event of [...(options.additionalEvents ?? [])].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.lessonNumber - right.lessonNumber ||
      left.key.localeCompare(right.key),
  )) {
    const date = parseDate(event.date);
    const day = dayForDate(date);
    const resolution = resolveTimes(
      options,
      group.group,
      day,
      event.lessonNumber,
      event.timeRoom ?? event.room ?? '',
    );
    if (!resolution.slots.length) {
      skippedEvents.push({
        group: group.group,
        day,
        date: event.date,
        lessonNumber: event.lessonNumber,
        room: event.timeRoom ?? event.room ?? '',
        summary: event.summary,
        reason: resolution.reason ?? 'Не удалось определить время пары',
      });
      continue;
    }
    resolution.slots.forEach((time, timeIndex) => {
      lines.push(
        ...serializeEvent(
          {
            uid: stableUid(
              'actual',
              group.group,
              event.date,
              String(event.lessonNumber),
              event.key,
              String(timeIndex),
            ),
            start: formatLocalDateTime(date, time.start),
            end: formatLocalDateTime(date, time.end),
            summary: event.summary,
            ...(event.room ? { room: event.room } : {}),
            ...(event.description ? { description: event.description } : {}),
          },
          timezone,
        ),
      );
    });
  }

  lines.push('END:VCALENDAR');
  return {
    content: `${lines.map(fold).join('\r\n')}\r\n`,
    skippedEvents,
  };
};

/**
 * Генерирует текст ICS. Для публикации с диагностикой времени используется
 * `generateIcalWithReport`, а этот wrapper сохраняет простой интерфейс тестов
 * и других потребителей генератора.
 */
export const generateIcal = (
  schedule: CanonicalSchedule,
  options: IcalOptions,
): string => generateIcalWithReport(schedule, options).content;
