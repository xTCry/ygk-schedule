import type {
  CanonicalSchedule,
  DayOfWeek,
  GroupSchedule,
  LessonVariant,
} from '../types.ts';
import { sha256 } from '../utils/hash.ts';

export interface SemanticLesson {
  variants: Array<{
    subject: string;
    teacher: string;
    room: string;
    weekType: LessonVariant['weekType'];
    subgroup: string | null;
  }>;
}

type SemanticVariant = SemanticLesson['variants'][number];

export interface LessonChange {
  group: string;
  day: DayOfWeek;
  lessonNumber: number;
  before: SemanticLesson | null;
  after: SemanticLesson | null;
}

export interface ScheduleDiff {
  changed: boolean;
  addedGroups: string[];
  removedGroups: string[];
  changedGroups: string[];
  lessonChanges: LessonChange[];
}

const dayOrder: DayOfWeek[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

const variantSortKey = (variant: SemanticVariant): string =>
  [
    variant.weekType,
    variant.subgroup ?? '',
    variant.subject,
    variant.teacher,
    variant.room,
  ].join('\0');

const semanticLesson = (variants: LessonVariant[]): SemanticLesson => ({
  variants: variants
    .map((variant) => ({
      subject: variant.subject,
      teacher: variant.teacher,
      room: variant.room,
      weekType: variant.weekType,
      subgroup: variant.subgroup ?? null,
    }))
    .sort((left, right) =>
      variantSortKey(left).localeCompare(variantSortKey(right), 'ru-RU'),
    ),
});

const semanticGroup = (group: GroupSchedule): unknown => ({
  group: group.group,
  days: [...group.days]
    .sort(
      (left, right) => dayOrder.indexOf(left.day) - dayOrder.indexOf(right.day),
    )
    .map((day) => ({
      day: day.day,
      lessons: [...day.lessons]
        .sort((left, right) => left.number - right.number)
        .map((lesson) => ({
          number: lesson.number,
          ...semanticLesson(lesson.variants),
        })),
    })),
});

const lessonKey = (day: DayOfWeek, lessonNumber: number): string =>
  `${day}\0${lessonNumber}`;

const getSemanticLessons = (
  group: GroupSchedule,
): Map<
  string,
  { day: DayOfWeek; lessonNumber: number; lesson: SemanticLesson }
> => {
  const lessons = new Map<
    string,
    { day: DayOfWeek; lessonNumber: number; lesson: SemanticLesson }
  >();
  for (const day of group.days) {
    for (const lesson of day.lessons) {
      lessons.set(lessonKey(day.day, lesson.number), {
        day: day.day,
        lessonNumber: lesson.number,
        lesson: semanticLesson(lesson.variants),
      });
    }
  }
  return lessons;
};

const compareLessons = (
  group: string,
  previous: GroupSchedule,
  current: GroupSchedule,
): LessonChange[] => {
  const previousLessons = getSemanticLessons(previous);
  const currentLessons = getSemanticLessons(current);
  const keys = new Set([...previousLessons.keys(), ...currentLessons.keys()]);

  return [...keys]
    .map((key) => {
      const before = previousLessons.get(key);
      const after = currentLessons.get(key);
      if (
        JSON.stringify(before?.lesson ?? null) ===
        JSON.stringify(after?.lesson ?? null)
      )
        return null;

      const location = after ?? before;
      if (!location) return null;
      return {
        group,
        day: location.day,
        lessonNumber: location.lessonNumber,
        before: before?.lesson ?? null,
        after: after?.lesson ?? null,
      } satisfies LessonChange;
    })
    .filter((change): change is LessonChange => change !== null)
    .sort(
      (left, right) =>
        dayOrder.indexOf(left.day) - dayOrder.indexOf(right.day) ||
        left.lessonNumber - right.lessonNumber,
    );
};

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
      lessonChanges: [],
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
  const lessonChanges = changedGroups.flatMap((group) =>
    compareLessons(group, previous.groups[group]!, current.groups[group]!),
  );

  return {
    changed:
      addedGroups.length > 0 ||
      removedGroups.length > 0 ||
      changedGroups.length > 0,
    addedGroups,
    removedGroups,
    changedGroups,
    lessonChanges,
  };
};
