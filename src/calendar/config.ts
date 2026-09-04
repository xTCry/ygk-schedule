import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DayOfWeek } from '../types.ts';
import type {
  LessonTime,
  LessonTimeOverride,
  LessonTimeSlots,
} from '../generators/ical.ts';

export interface CalendarTerm {
  start: string;
  end: string;
  referenceDate: string;
  referenceWeekType: 'numerator' | 'denominator';
}

export interface CalendarProfile {
  lessonTimes: Record<number, LessonTimeSlots>;
  lessonTimesByDay: Partial<
    Record<DayOfWeek, Record<number, LessonTimeOverride>>
  >;
}

export interface YgkCalendarConfig {
  timezone: string;
  term: CalendarTerm;
  profiles: Record<string, CalendarProfile>;
  groupProfiles: Record<string, string>;
}

const days: readonly DayOfWeek[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Calendar config requires a non-empty string at ${path}`);
  return value;
};

const readTime = (value: unknown, path: string): LessonTime => {
  if (!isRecord(value))
    throw new Error(`Calendar config requires a time object at ${path}`);
  const start = readString(value.start, `${path}.start`);
  const end = readString(value.end, `${path}.end`);
  const startMinutes = timeToMinutes(start, `${path}.start`);
  const endMinutes = timeToMinutes(end, `${path}.end`);
  if (endMinutes <= startMinutes)
    throw new Error(`Calendar config requires end after start at ${path}`);
  return { start, end };
};

const timeToMinutes = (value: string, path: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Calendar config requires HH:MM at ${path}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

const readSlots = (value: unknown, path: string): LessonTimeSlots => {
  if (Array.isArray(value)) {
    if (!value.length)
      throw new Error(`Calendar config requires at least one slot at ${path}`);
    return value.map((item, index) => readTime(item, `${path}[${index}]`));
  }
  return readTime(value, path);
};

const readTimes = (
  value: unknown,
  path: string,
): Record<number, LessonTimeSlots> => {
  if (!isRecord(value))
    throw new Error(`Calendar config requires an object at ${path}`);
  const result: Record<number, LessonTimeSlots> = {};
  for (const [rawNumber, rawSlots] of Object.entries(value)) {
    const number = Number(rawNumber);
    if (!Number.isSafeInteger(number) || number < 0)
      throw new Error(`Calendar config has invalid lesson number at ${path}`);
    result[number] = readSlots(rawSlots, `${path}.${rawNumber}`);
  }
  return result;
};

const readDayOverrides = (
  value: unknown,
  path: string,
): Record<number, LessonTimeOverride> => {
  if (!isRecord(value))
    throw new Error(`Calendar config requires an object at ${path}`);
  const result: Record<number, LessonTimeOverride> = {};
  for (const [rawNumber, rawSlots] of Object.entries(value)) {
    const number = Number(rawNumber);
    if (!Number.isSafeInteger(number) || number < 0)
      throw new Error(`Calendar config has invalid lesson number at ${path}`);
    result[number] =
      rawSlots === null ? null : readSlots(rawSlots, `${path}.${rawNumber}`);
  }
  return result;
};

const readProfile = (value: unknown, path: string): CalendarProfile => {
  if (!isRecord(value))
    throw new Error(`Calendar config requires an object at ${path}`);
  const rawDayTimes = value.lessonTimesByDay;
  const lessonTimesByDay: CalendarProfile['lessonTimesByDay'] = {};
  if (rawDayTimes !== undefined) {
    if (!isRecord(rawDayTimes))
      throw new Error(
        `Calendar config requires an object at ${path}.lessonTimesByDay`,
      );
    for (const day of days) {
      const rawTimes = rawDayTimes[day];
      if (rawTimes === undefined) continue;
      lessonTimesByDay[day] = readDayOverrides(
        rawTimes,
        `${path}.lessonTimesByDay.${day}`,
      );
    }
  }
  return {
    lessonTimes: readTimes(value.lessonTimes, `${path}.lessonTimes`),
    lessonTimesByDay,
  };
};

/**
 * Загружает проверяемую конфигурацию календаря ЯГК.
 *
 * Привязка `groupProfiles` остается явной: пока не подтвержден корпус группы,
 * генератор не имеет права угадывать время ее звонков.
 */
export const loadYgkCalendarConfig = async (
  file = resolve(process.cwd(), 'config', 'ygk', 'calendar.json'),
): Promise<YgkCalendarConfig> => {
  const parsed: unknown = JSON.parse(await readFile(resolve(file), 'utf8'));
  if (!isRecord(parsed))
    throw new Error('Calendar config root must be an object');
  if (!isRecord(parsed.term))
    throw new Error('Calendar config requires a term object');
  if (!isRecord(parsed.profiles))
    throw new Error('Calendar config requires a profiles object');
  if (!isRecord(parsed.groupProfiles))
    throw new Error('Calendar config requires a groupProfiles object');

  const profiles: Record<string, CalendarProfile> = {};
  for (const [name, profile] of Object.entries(parsed.profiles))
    profiles[name] = readProfile(profile, `profiles.${name}`);

  const groupProfiles: Record<string, string> = {};
  for (const [group, profile] of Object.entries(parsed.groupProfiles)) {
    const profileName = readString(profile, `groupProfiles.${group}`);
    if (!profiles[profileName])
      throw new Error(
        `Calendar config profile "${profileName}" for group "${group}" was not found`,
      );
    groupProfiles[group] = profileName;
  }

  const referenceWeekType = parsed.term.referenceWeekType;
  if (
    referenceWeekType !== 'numerator' &&
    referenceWeekType !== 'denominator'
  ) {
    throw new Error(
      'Calendar config referenceWeekType must be numerator or denominator',
    );
  }
  return {
    timezone: readString(parsed.timezone, 'timezone'),
    term: {
      start: readString(parsed.term.start, 'term.start'),
      end: readString(parsed.term.end, 'term.end'),
      referenceDate: readString(
        parsed.term.referenceDate,
        'term.referenceDate',
      ),
      referenceWeekType,
    },
    profiles,
    groupProfiles,
  };
};
