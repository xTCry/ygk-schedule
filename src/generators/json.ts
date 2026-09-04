import type { CanonicalSchedule, GroupSchedule } from '../types.ts';

/**
 * Нормализует вложенные массивы одной группы перед сериализацией.
 */
export const normalizeGroupScheduleForSerialization = (
  group: GroupSchedule,
): GroupSchedule => ({
  ...group,
  sourceGroups: [...group.sourceGroups].sort((a, b) =>
    a.localeCompare(b, 'ru-RU'),
  ),
  sourceBlocks: [...group.sourceBlocks].sort(
    (a, b) =>
      a.sheet.localeCompare(b.sheet, 'ru-RU') || a.rowStart - b.rowStart,
  ),
  days: group.days.map((day) => ({
    ...day,
    lessons: [...day.lessons].sort(
      (a, b) => a.number - b.number || a.source.rowStart - b.source.rowStart,
    ),
  })),
});

/**
 * Нормализует порядок полей и элементов перед сериализацией в публичные файлы.
 */
export const normalizeScheduleForSerialization = (
  schedule: CanonicalSchedule,
): CanonicalSchedule => {
  return {
    ...schedule,
    sources: [...schedule.sources].sort((a, b) => a.id.localeCompare(b.id)),
    groups: Object.fromEntries(
      Object.entries(schedule.groups)
        .sort(([a], [b]) => a.localeCompare(b, 'ru-RU'))
        .map(([key, value]) => [
          key,
          normalizeGroupScheduleForSerialization(value),
        ]),
    ),
    diagnostics: [...schedule.diagnostics].sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) ||
        (a.sheet ?? '').localeCompare(b.sheet ?? '', 'ru-RU') ||
        (a.row ?? 0) - (b.row ?? 0) ||
        a.code.localeCompare(b.code),
    ),
  };
};

/**
 * Сериализует каноническое расписание в форматированный JSON
 */
export const serializeSchedule = (schedule: CanonicalSchedule): string => {
  const normalized = normalizeScheduleForSerialization(schedule);
  return `${JSON.stringify(normalized, null, 2)}\n`;
};
