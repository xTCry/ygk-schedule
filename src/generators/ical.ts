import { createHash } from 'node:crypto';
import type {
  CanonicalSchedule,
  DayOfWeek,
  GroupSchedule,
  WeekType,
} from '../types.ts';
import { weekTypeForDate } from '../calendar/academic-year.ts';

export interface LessonTime {
  start: string;
  end: string;
}

export interface IcalOptions {
  group: string;
  termStart: string;
  termEnd: string;
  referenceDate: string;
  referenceWeekType?: 'numerator' | 'denominator';
  lessonTimes: Record<number, LessonTime>;
  timezone?: string;
  productId?: string;
}

const dayOffsets: Record<DayOfWeek, number> = {
  Понедельник: 1,
  Вторник: 2,
  Среда: 3,
  Четверг: 4,
  Пятница: 5,
  Суббота: 6,
};

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
  return [Number(match[1]), Number(match[2])];
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

const formatLocalDateTime = (date: Date, time: string): string => {
  const [hour, minute] = parseTime(time);
  return `${dateKey(date)}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
};

const uid = (
  group: string,
  day: string,
  number: number,
  weekType: WeekType,
  index: number,
): string =>
  `${createHash('sha1').update([group, day, number, weekType, index].join('\0')).digest('hex')}@ygk-schedule`;

const getGroup = (
  schedule: CanonicalSchedule,
  group: string,
): GroupSchedule => {
  const value = schedule.groups[group];
  if (!value) throw new Error(`Group not found: ${group}`);
  return value;
};

export const generateIcal = (
  schedule: CanonicalSchedule,
  options: IcalOptions,
): string => {
  const group = getGroup(schedule, options.group);
  const termStart = parseDate(options.termStart);
  const termEnd = parseDate(options.termEnd);
  const referenceDate = parseDate(options.referenceDate);
  const referenceWeekType = options.referenceWeekType ?? 'numerator';
  const timezone = options.timezone ?? 'Europe/Moscow';
  const productId = options.productId ?? '-//ygk-schedule//Schedule//RU';
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${productId}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const day of group.days) {
    for (const lesson of day.lessons) {
      const time = options.lessonTimes[lesson.number];
      if (!time) continue;
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
        const description = [variant.teacher, variant.room]
          .filter(Boolean)
          .join('\n');
        lines.push(
          'BEGIN:VEVENT',
          `UID:${uid(group.group, day.day, lesson.number, variant.weekType, index)}`,
          `DTSTAMP:${now}`,
          `DTSTART;TZID=${timezone}:${formatLocalDateTime(firstDate, time.start)}`,
          `DTEND;TZID=${timezone}:${formatLocalDateTime(firstDate, time.end)}`,
          `RRULE:FREQ=WEEKLY;INTERVAL=${interval};UNTIL=${dateKey(termEnd)}T235959Z`,
          `SUMMARY:${escapeIcal(variant.subject || `Пара ${lesson.number}`)}`,
          ...(variant.room ? [`LOCATION:${escapeIcal(variant.room)}`] : []),
          ...(description ? [`DESCRIPTION:${escapeIcal(description)}`] : []),
          'END:VEVENT',
        );
      });
    }
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
};
