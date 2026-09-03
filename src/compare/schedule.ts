import type { CanonicalSchedule, GroupSchedule } from '../types.ts';
import { sha256 } from '../utils/hash.ts';

export interface ScheduleDiff {
  changed: boolean;
  addedGroups: string[];
  removedGroups: string[];
  changedGroups: string[];
}

const semanticGroup = (group: GroupSchedule): unknown => ({
  group: group.group,
  days: group.days.map((day) => ({
    day: day.day,
    lessons: day.lessons.map((lesson) => ({
      number: lesson.number,
      variants: lesson.variants.map((variant) => ({
        subject: variant.subject,
        teacher: variant.teacher,
        room: variant.room,
        weekType: variant.weekType,
        subgroup: variant.subgroup ?? null,
      })),
    })),
  })),
});

export const semanticScheduleHash = (
  groups: Record<string, GroupSchedule>,
): string =>
  sha256(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b, 'ru-RU'))
          .map(([key, value]) => [key, semanticGroup(value)]),
      ),
    ),
  );

export const compareSchedules = (
  previous: Pick<CanonicalSchedule, 'groups'> | null,
  current: Pick<CanonicalSchedule, 'groups'>,
): ScheduleDiff => {
  if (!previous) {
    return {
      changed: true,
      addedGroups: Object.keys(current.groups).sort(),
      removedGroups: [],
      changedGroups: [],
    };
  }

  const previousKeys = new Set(Object.keys(previous.groups));
  const currentKeys = new Set(Object.keys(current.groups));
  const addedGroups = [...currentKeys]
    .filter((key) => !previousKeys.has(key))
    .sort();
  const removedGroups = [...previousKeys]
    .filter((key) => !currentKeys.has(key))
    .sort();
  const changedGroups = [...currentKeys]
    .filter((key) => previousKeys.has(key))
    .filter(
      (key) =>
        JSON.stringify(semanticGroup(previous.groups[key]!)) !==
        JSON.stringify(semanticGroup(current.groups[key]!)),
    )
    .sort();

  return {
    changed:
      addedGroups.length > 0 ||
      removedGroups.length > 0 ||
      changedGroups.length > 0,
    addedGroups,
    removedGroups,
    changedGroups,
  };
};
