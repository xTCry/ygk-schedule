import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import type { DayOfWeek } from '../types.ts';
import type {
  LessonTime,
  LessonTimeOverride,
  LessonTimeSlots,
} from './lesson-times.ts';

export interface CalendarTerm {
  start: string;
  end: string;
  referenceDate: string;
  referenceWeekType: 'numerator' | 'denominator';
}

export interface CalendarPublication {
  sourceUrlTemplate: string;
  refreshInterval?: string;
}

export interface CalendarProfile {
  lessonTimes: Record<number, LessonTimeSlots>;
  lessonTimesByDay: Partial<
    Record<DayOfWeek, Record<number, LessonTimeOverride>>
  >;
  preholidayLessonTimes?: Record<number, LessonTimeSlots>;
}

export interface CalendarProfileDocument {
  lesson_times: Record<number, LessonTimeSlots>;
  lesson_times_by_day?: Partial<
    Record<DayOfWeek, Record<number, LessonTimeOverride>>
  >;
  preholiday_lesson_times?: Record<number, LessonTimeSlots>;
}

export interface CalendarRoomProfileDocument {
  profile?: string;
  course_profiles?: Record<string, string>;
  group_overrides?: Record<string, string>;
}

export interface CalendarRoomProfilesDocument {
  buildings: Record<string, CalendarRoomProfileDocument>;
  special_rooms?: Record<string, 'remote' | 'sport' | 'unknown'>;
}

export interface CalendarConfigDocument {
  schema_version?: number;
  timezone: string;
  term: {
    start: string;
    end: string;
    reference_date: string;
    reference_week_type: 'numerator' | 'denominator';
  };
  bells_file?: string;
  regulations_file?: string;
  profiles?: Record<string, CalendarProfileDocument>;
  room_profiles: CalendarRoomProfilesDocument;
  publication?: {
    source_url_template: string;
    refresh_interval?: string;
  };
}

export interface CalendarRoomProfileRule {
  profile?: string;
  courseProfiles: Record<number, string>;
  groupOverrides: Record<string, string>;
}

export interface CalendarRoomProfiles {
  buildings: Record<string, CalendarRoomProfileRule>;
  specialRooms: Record<string, 'remote' | 'sport' | 'unknown'>;
}

export interface YgkCalendarConfig {
  timezone: string;
  term: CalendarTerm;
  profiles: Record<string, CalendarProfile>;
  roomProfiles: CalendarRoomProfiles;
  publication?: CalendarPublication;
}

interface BellVariant {
  id: string;
  periods: Record<number, LessonTimeSlots>;
}

interface BellScheduleSet {
  regular: Record<number, LessonTimeSlots>;
  variants: BellVariant[];
  saturday: Record<number, LessonTimeOverride>;
  preholiday: Record<number, LessonTimeSlots>;
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

const timeToMinutes = (value: string, path: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Calendar config requires HH:MM at ${path}`);
  return Number(match[1]) * 60 + Number(match[2]);
};

const readTime = (value: unknown, path: string): LessonTime => {
  if (!isRecord(value))
    throw new Error(`Calendar config requires a time object at ${path}`);
  const start = readString(value.start, `${path}.start`);
  const end = readString(value.end, `${path}.end`);
  if (
    timeToMinutes(end, `${path}.end`) <= timeToMinutes(start, `${path}.start`)
  ) {
    throw new Error(`Calendar config requires end after start at ${path}`);
  }
  return { start, end };
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
  const rawDayTimes = value.lesson_times_by_day;
  const lessonTimesByDay: CalendarProfile['lessonTimesByDay'] = {};
  if (rawDayTimes !== undefined) {
    if (!isRecord(rawDayTimes)) {
      throw new Error(
        `Calendar config requires an object at ${path}.lesson_times_by_day`,
      );
    }
    for (const day of days) {
      const rawTimes = rawDayTimes[day];
      if (rawTimes === undefined) continue;
      lessonTimesByDay[day] = readDayOverrides(
        rawTimes,
        `${path}.lesson_times_by_day.${day}`,
      );
    }
  }
  const rawPreholiday = value.preholiday_lesson_times;
  return {
    lessonTimes: readTimes(value.lesson_times, `${path}.lesson_times`),
    lessonTimesByDay,
    ...(rawPreholiday
      ? {
          preholidayLessonTimes: readTimes(
            rawPreholiday,
            `${path}.preholiday_lesson_times`,
          ),
        }
      : {}),
  };
};

const readYaml = async (file: string): Promise<Record<string, unknown>> => {
  const raw = await readFile(file, 'utf8');
  const parsed: unknown = parse(raw);
  if (!isRecord(parsed))
    throw new Error(`Calendar YAML root must be an object: ${file}`);
  return parsed;
};

const readPeriods = (
  value: unknown,
  path: string,
): Record<number, LessonTimeSlots> => {
  if (!isRecord(value))
    throw new Error(`Bell schedule requires periods at ${path}`);
  const result: Record<number, LessonTimeSlots> = {};
  for (const [rawNumber, rawPeriod] of Object.entries(value)) {
    const number = Number(rawNumber);
    if (!Number.isSafeInteger(number) || number < 0)
      throw new Error(`Bell schedule has invalid lesson number at ${path}`);
    if (!isRecord(rawPeriod))
      throw new Error(`Bell schedule requires a period object at ${path}`);
    result[number] = readSlots(
      rawPeriod.segments,
      `${path}.${rawNumber}.segments`,
    );
  }
  return result;
};

const readBellScheduleSet = (value: unknown, path: string): BellScheduleSet => {
  if (!isRecord(value))
    throw new Error(`Bell schedule requires an object at ${path}`);
  if (!isRecord(value.regular))
    throw new Error(`Bell schedule requires regular at ${path}`);
  const regular = readPeriods(value.regular.common_periods, `${path}.regular`);
  const rawVariants = value.regular.variants;
  if (!Array.isArray(rawVariants))
    throw new Error(`Bell schedule requires variants at ${path}.regular`);
  const variants = rawVariants.map((rawVariant, index): BellVariant => {
    if (!isRecord(rawVariant))
      throw new Error(`Bell schedule requires a variant at ${path}.regular`);
    return {
      id: readString(rawVariant.id, `${path}.regular.variants[${index}].id`),
      periods: readPeriods(
        rawVariant.periods,
        `${path}.regular.variants[${index}].periods`,
      ),
    };
  });
  const saturday: Record<number, LessonTimeOverride> = {};
  if (isRecord(value.saturday)) {
    const notListed = value.saturday.not_listed;
    if (Array.isArray(notListed)) {
      for (const rawNumber of notListed) {
        const number = Number(rawNumber);
        if (!Number.isSafeInteger(number) || number < 0) {
          throw new Error(
            `Bell schedule has invalid Saturday period at ${path}`,
          );
        }
        saturday[number] = null;
      }
    }
    if (value.saturday.periods_1_to_4 === 'use_regular_schedule') {
      for (const number of Object.keys(regular).map(Number)) {
        if (number < 1 || number > 4) saturday[number] = null;
      }
    }
    if (isRecord(value.saturday.period_overrides)) {
      for (const [rawNumber, rawOverride] of Object.entries(
        value.saturday.period_overrides,
      )) {
        const number = Number(rawNumber);
        if (!Number.isSafeInteger(number) || number < 0) {
          throw new Error(
            `Bell schedule has invalid Saturday period at ${path}`,
          );
        }
        if (!isRecord(rawOverride) || rawOverride.segments === undefined)
          continue;
        saturday[number] = readSlots(
          rawOverride.segments,
          `${path}.saturday.period_overrides.${rawNumber}.segments`,
        );
      }
    }
  }
  const preholiday = isRecord(value.preholiday)
    ? readPeriods(value.preholiday.periods, `${path}.preholiday.periods`)
    : {};
  return { regular, variants, saturday, preholiday };
};

const mergeTimes = (
  common: Record<number, LessonTimeSlots>,
  variant: BellVariant,
): Record<number, LessonTimeSlots> => ({ ...common, ...variant.periods });

const bellProfile = (
  scheduleSet: BellScheduleSet,
  variantId: string,
): CalendarProfile => {
  const variant = scheduleSet.variants.find((item) => item.id === variantId);
  if (!variant)
    throw new Error(`Bell schedule variant was not found: ${variantId}`);
  return {
    lessonTimes: mergeTimes(scheduleSet.regular, variant),
    lessonTimesByDay: { Суббота: scheduleSet.saturday },
    ...(Object.keys(scheduleSet.preholiday).length
      ? { preholidayLessonTimes: scheduleSet.preholiday }
      : {}),
  };
};

/**
 * Преобразует исходный документ звонков в профили генератора ICS.
 *
 * Таблица звонков хранится отдельно от привязки групп: корпус конкретной
 * группы нельзя надежно получить из названия группы или листа XLSX.
 */
const profilesFromBells = (
  bells: Record<string, unknown>,
): Record<string, CalendarProfile> => {
  if (!isRecord(bells.schedule_sets))
    throw new Error('Bell schedule requires schedule_sets');
  const sets = bells.schedule_sets;
  const abvm = readBellScheduleSet(sets.abvm, 'schedule_sets.abvm');
  const t = readBellScheduleSet(sets.t, 'schedule_sets.t');
  const f = readBellScheduleSet(sets.f, 'schedule_sets.f');
  return {
    'a-m': bellProfile(abvm, 'a_m'),
    'b-v': bellProfile(abvm, 'b_v'),
    't-year-1': bellProfile(t, 'professions_and_specialty_year_1'),
    't-years-2-4': bellProfile(t, 'specialty_years_2_4'),
    'f-year-1': bellProfile(f, 'listed_year_1_groups'),
    'f-years-2-4': bellProfile(f, 'years_2_4'),
  };
};

const readPublication = (
  value: unknown,
  path: string,
): CalendarPublication | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value))
    throw new Error(`Calendar config requires an object at ${path}`);
  const sourceUrlTemplate = readString(
    value.source_url_template,
    `${path}.source_url_template`,
  );
  if (
    !sourceUrlTemplate.includes('{kind}') ||
    !sourceUrlTemplate.includes('{group}')
  ) {
    throw new Error(
      `${path}.source_url_template must contain {kind} and {group}`,
    );
  }
  try {
    new URL(
      sourceUrlTemplate
        .replaceAll('{kind}', 'base')
        .replaceAll('{group}', 'group'),
    );
  } catch {
    throw new Error(`${path}.source_url_template must be a valid URL`);
  }
  const refreshInterval =
    value.refresh_interval === undefined
      ? undefined
      : readString(value.refresh_interval, `${path}.refresh_interval`);
  if (
    refreshInterval &&
    !/^P(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/.test(refreshInterval)
  ) {
    throw new Error(`${path}.refresh_interval must be an ISO 8601 duration`);
  }
  return {
    sourceUrlTemplate,
    ...(refreshInterval ? { refreshInterval } : {}),
  };
};

const readRoomProfiles = (
  value: unknown,
  profiles: Record<string, CalendarProfile>,
): CalendarRoomProfiles => {
  if (!isRecord(value))
    throw new Error('Calendar config requires a room_profiles object');
  if (!isRecord(value.buildings))
    throw new Error('Calendar config requires room_profiles.buildings');

  const profileName = (raw: unknown, path: string): string => {
    const name = readString(raw, path);
    if (!profiles[name])
      throw new Error(
        `Calendar config profile "${name}" at ${path} was not found`,
      );
    return name;
  };
  const buildings: CalendarRoomProfiles['buildings'] = {};
  for (const [rawBuilding, rawRule] of Object.entries(value.buildings)) {
    const building = normalizeRoomCode(rawBuilding);
    if (!isRecord(rawRule)) {
      throw new Error(
        `Calendar config requires an object at room_profiles.buildings.${rawBuilding}`,
      );
    }
    const courseProfiles: Record<number, string> = {};
    if (rawRule.course_profiles !== undefined) {
      if (!isRecord(rawRule.course_profiles)) {
        throw new Error(
          `Calendar config requires an object at room_profiles.buildings.${rawBuilding}.course_profiles`,
        );
      }
      for (const [rawCourse, rawProfile] of Object.entries(
        rawRule.course_profiles,
      )) {
        const course = Number(rawCourse);
        if (!Number.isSafeInteger(course) || course < 1 || course > 4) {
          throw new Error(
            `Calendar config has invalid course at room_profiles.buildings.${rawBuilding}.course_profiles`,
          );
        }
        courseProfiles[course] = profileName(
          rawProfile,
          `room_profiles.buildings.${rawBuilding}.course_profiles.${rawCourse}`,
        );
      }
    }
    const groupOverrides: Record<string, string> = {};
    if (rawRule.group_overrides !== undefined) {
      if (!isRecord(rawRule.group_overrides)) {
        throw new Error(
          `Calendar config requires an object at room_profiles.buildings.${rawBuilding}.group_overrides`,
        );
      }
      for (const [group, rawProfile] of Object.entries(
        rawRule.group_overrides,
      )) {
        groupOverrides[group] = profileName(
          rawProfile,
          `room_profiles.buildings.${rawBuilding}.group_overrides.${group}`,
        );
      }
    }
    const profile =
      rawRule.profile === undefined
        ? undefined
        : profileName(
            rawRule.profile,
            `room_profiles.buildings.${rawBuilding}.profile`,
          );
    if (
      !profile &&
      !Object.keys(courseProfiles).length &&
      !Object.keys(groupOverrides).length
    ) {
      throw new Error(
        `Calendar config requires a profile rule at room_profiles.buildings.${rawBuilding}`,
      );
    }
    buildings[building] = {
      ...(profile ? { profile } : {}),
      courseProfiles,
      groupOverrides,
    };
  }

  const specialRooms: CalendarRoomProfiles['specialRooms'] = {};
  if (value.special_rooms !== undefined) {
    if (!isRecord(value.special_rooms))
      throw new Error('Calendar config requires room_profiles.special_rooms');
    for (const [rawRoom, rawKind] of Object.entries(value.special_rooms)) {
      if (rawKind !== 'remote' && rawKind !== 'sport' && rawKind !== 'unknown')
        throw new Error(
          `Calendar config has invalid room kind at room_profiles.special_rooms.${rawRoom}`,
        );
      specialRooms[normalizeRoomCode(rawRoom)] = rawKind;
    }
  }
  return { buildings, specialRooms };
};

const normalizeRoomCode = (value: string): string =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Загружает проверяемую YAML-конфигурацию календаря ЯГК.
 *
 * `bells_file` и `regulations_file` сохраняют исходные документы раздельно.
 * Время выбирается по аудитории конкретного занятия. Группа уточняет правило
 * только для корпусов с разными графиками по курсам.
 */
export const loadYgkCalendarConfig = async (
  file = resolve(process.cwd(), 'config', 'ygk', 'calendar.yaml'),
): Promise<YgkCalendarConfig> => {
  const configPath = resolve(file);
  const parsed = await readYaml(configPath);
  if (!isRecord(parsed.term))
    throw new Error('Calendar config requires a term object');

  const profiles = parsed.bells_file
    ? profilesFromBells(
        await readYaml(
          resolve(
            dirname(configPath),
            readString(parsed.bells_file, 'bells_file'),
          ),
        ),
      )
    : (() => {
        if (!isRecord(parsed.profiles)) {
          throw new Error(
            'Calendar config requires bells_file or a profiles object',
          );
        }
        const result: Record<string, CalendarProfile> = {};
        for (const [name, profile] of Object.entries(parsed.profiles))
          result[name] = readProfile(profile, `profiles.${name}`);
        return result;
      })();

  if (parsed.regulations_file) {
    const regulations = await readYaml(
      resolve(
        dirname(configPath),
        readString(parsed.regulations_file, 'regulations_file'),
      ),
    );
    if (!isRecord(regulations.group_distribution)) {
      throw new Error('Regulations config requires group_distribution');
    }
  }

  const roomProfiles = readRoomProfiles(parsed.room_profiles, profiles);

  const referenceWeekType = parsed.term.reference_week_type;
  if (
    referenceWeekType !== 'numerator' &&
    referenceWeekType !== 'denominator'
  ) {
    throw new Error(
      'Calendar config reference_week_type must be numerator or denominator',
    );
  }
  const publication = readPublication(parsed.publication, 'publication');
  return {
    timezone: readString(parsed.timezone, 'timezone'),
    term: {
      start: readString(parsed.term.start, 'term.start'),
      end: readString(parsed.term.end, 'term.end'),
      referenceDate: readString(
        parsed.term.reference_date,
        'term.reference_date',
      ),
      referenceWeekType,
    },
    profiles,
    roomProfiles,
    ...(publication ? { publication } : {}),
  };
};
