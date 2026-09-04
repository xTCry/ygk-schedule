import type {
  CalendarProfile,
  CalendarRoomProfileRule,
  CalendarRoomProfiles,
} from '../../../calendar/config.ts';
import type {
  LessonTimeResolution,
  LessonTimeResolver,
} from '../../../calendar/lesson-times.ts';

export type YgkRoomKind = 'physical' | 'remote' | 'sport' | 'unknown';

export interface YgkRoomLocation {
  kind: YgkRoomKind;
  raw: string;
  normalized: string;
  building?: string;
}

/**
 * Приводит текст аудитории к форме, пригодной для строгого сопоставления
 * с явными сокращениями из конфигурации.
 */
const normalizeRoom = (value: string): string =>
  value
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

/**
 * Выделяет обозначение корпуса только из физической аудитории с номером.
 *
 * Строки «ДОТ», «спортзал» и похожие наименование помещений намеренно не
 * попадают под это правило: первая буква в них не означает корпус.
 */
const physicalRoomPattern =
  /(?:^|[\s,;(/])([АБВМТФ])\s*(?:№\s*)?(\d{1,4})(?=$|[\s,;.)/])/u;

/**
 * Определяет тип места проведения занятия, не пытаясь угадать незнакомое
 * сокращение как физический корпус.
 */
export const parseYgkRoomLocation = (
  room: string,
  specialRooms: Record<string, Exclude<YgkRoomKind, 'physical'>>,
): YgkRoomLocation => {
  const normalized = normalizeRoom(room);
  const specialKind = specialRooms[normalized];
  if (specialKind)
    return {
      kind: specialKind,
      raw: room,
      normalized,
    };

  const physical = physicalRoomPattern.exec(normalized);
  if (physical)
    return {
      kind: 'physical',
      raw: room,
      normalized,
      building: physical[1]!,
    };

  return { kind: 'unknown', raw: room, normalized };
};

const courseForGroup = (group: string): number | null => {
  const match = /-(?<course>[1-4])\d(?:$|[-/])/u.exec(group);
  return match?.groups?.course ? Number(match.groups.course) : null;
};

const profileForRule = (
  rule: CalendarRoomProfileRule,
  group: string,
): string | null => {
  const manualProfile = rule.groupOverrides[group];
  if (manualProfile) return manualProfile;

  const course = courseForGroup(group);
  return (
    (course === null ? undefined : rule.courseProfiles[course]) ??
    rule.profile ??
    null
  );
};

const missingResolution = (reason: string): LessonTimeResolution => ({
  slots: [],
  reason,
});

/**
 * Создает resolver времени занятия ЯГК.
 *
 * Корпус определяется по тексту аудитории конкретного варианта занятия.
 * Код группы используется лишь как дополнительное условие для корпусов,
 * где таблица звонков различается по курсу или явно перечисленным группам.
 */
export const createYgkRoomTimeResolver = (
  profiles: Record<string, CalendarProfile>,
  roomProfiles: CalendarRoomProfiles,
): LessonTimeResolver => {
  return ({ group, day, lessonNumber, room }): LessonTimeResolution => {
    const location = parseYgkRoomLocation(room, roomProfiles.specialRooms);
    if (location.kind !== 'physical') {
      return missingResolution(
        location.kind === 'unknown'
          ? `Не удалось определить корпус по аудитории «${room || 'не указана'}»`
          : `Для места «${room}» пока не подтверждено расписание звонков`,
      );
    }

    const rule = roomProfiles.buildings[location.building!];
    if (!rule)
      return missingResolution(
        `Для корпуса «${location.building}» не настроен профиль звонков`,
      );

    const profileName = profileForRule(rule, group);
    if (!profileName)
      return missingResolution(
        `Для корпуса «${location.building}» и группы «${group}» не определен профиль звонков`,
      );

    const profile = profiles[profileName];
    if (!profile)
      return missingResolution(
        `Профиль звонков «${profileName}» не найден в конфигурации`,
      );

    const dayOverrides = profile.lessonTimesByDay[day];
    if (dayOverrides && Object.hasOwn(dayOverrides, lessonNumber)) {
      const override = dayOverrides[lessonNumber];
      return override
        ? {
            slots: 'start' in override ? [override] : [...override],
            profile: profileName,
          }
        : missingResolution(
            `Для пары ${lessonNumber} в ${day} нет подтвержденного времени`,
          );
    }

    const slots = profile.lessonTimes[lessonNumber];
    return slots
      ? {
          slots: 'start' in slots ? [slots] : [...slots],
          profile: profileName,
        }
      : missingResolution(
          `Для пары ${lessonNumber} в профиле «${profileName}» нет времени`,
        );
  };
};
