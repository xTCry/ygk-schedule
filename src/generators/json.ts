import type { CanonicalSchedule, GroupSchedule } from '../types.ts';

const sortGroup = (group: GroupSchedule): GroupSchedule => ({
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

export const serializeSchedule = (schedule: CanonicalSchedule): string => {
  const normalized: CanonicalSchedule = {
    ...schedule,
    groups: Object.fromEntries(
      Object.entries(schedule.groups)
        .sort(([a], [b]) => a.localeCompare(b, 'ru-RU'))
        .map(([key, value]) => [key, sortGroup(value)]),
    ),
    diagnostics: [...schedule.diagnostics].sort(
      (a, b) =>
        a.severity.localeCompare(b.severity) ||
        (a.sheet ?? '').localeCompare(b.sheet ?? '', 'ru-RU') ||
        (a.row ?? 0) - (b.row ?? 0) ||
        a.code.localeCompare(b.code),
    ),
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
};
