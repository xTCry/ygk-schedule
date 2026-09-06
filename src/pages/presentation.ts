import type { CalendarProfile, YgkCalendarConfig } from '../calendar/config.ts';
import type { LessonTime, LessonTimeSlots } from '../calendar/lesson-times.ts';
import { createYgkRoomTimeResolver } from '../providers/ygk/calendar/room-profile.ts';
import type {
  ActualGroupScheduleArtifact,
  ActualLesson,
  DayOfWeek,
  GroupScheduleArtifact,
  Lesson,
  LessonVariant,
} from '../types.ts';

export interface PagesLessonTiming {
  slots: LessonTime[];
  profile?: string;
  breakAfterMinutes?: number;
}

export interface PagesLessonVariant extends LessonVariant {
  timing: PagesLessonTiming;
}

export interface PagesLesson extends Omit<Lesson, 'variants'> {
  variants: PagesLessonVariant[];
}

export interface PagesActualLesson extends Omit<ActualLesson, 'variants'> {
  variants: PagesLessonVariant[];
}

export interface PagesGroupScheduleArtifact extends Omit<
  GroupScheduleArtifact,
  'group'
> {
  group: Omit<GroupScheduleArtifact['group'], 'days'> & {
    days: Array<
      Omit<GroupScheduleArtifact['group']['days'][number], 'lessons'> & {
        lessons: PagesLesson[];
      }
    >;
  };
}

export interface PagesActualGroupScheduleArtifact extends Omit<
  ActualGroupScheduleArtifact,
  'dates'
> {
  dates: Record<
    string,
    Omit<ActualGroupScheduleArtifact['dates'][string], 'groups'> & {
      groups: Record<
        string,
        Omit<
          ActualGroupScheduleArtifact['dates'][string]['groups'][string],
          'lessons'
        > & {
          lessons: PagesActualLesson[];
        }
      >;
    }
  >;
}

const asSlots = (value: LessonTimeSlots | null | undefined): LessonTime[] => {
  if (!value) return [];
  return 'start' in value ? [value] : [...value];
};

const timeToMinutes = (value: string): number => {
  const [hours, minutes] = value.split(':').map(Number);
  if (hours === undefined || minutes === undefined)
    throw new Error(`Некорректное время пары: ${value}`);
  return hours * 60 + minutes;
};

const profileSlots = (
  profile: CalendarProfile | undefined,
  day: DayOfWeek,
  lessonNumber: number,
): LessonTime[] => {
  const override = profile?.lessonTimesByDay[day]?.[lessonNumber];
  return asSlots(override ?? profile?.lessonTimes[lessonNumber]);
};

const breakAfter = (
  profile: CalendarProfile | undefined,
  day: DayOfWeek,
  lessonNumber: number,
  slots: readonly LessonTime[],
): number | undefined => {
  const end = slots.at(-1)?.end;
  const nextStart = profileSlots(profile, day, lessonNumber + 1)[0]?.start;
  if (!end || !nextStart) return undefined;
  const result = timeToMinutes(nextStart) - timeToMinutes(end);
  return result > 0 ? result : undefined;
};

const addTiming = (
  group: string,
  day: DayOfWeek,
  lessonNumber: number,
  variant: LessonVariant,
  config: YgkCalendarConfig,
): PagesLessonVariant => {
  const resolution = createYgkRoomTimeResolver(
    config.profiles,
    config.roomProfiles,
  )({
    group,
    day,
    lessonNumber,
    room: variant.room,
  });
  const profile = resolution.profile
    ? config.profiles[resolution.profile]
    : undefined;
  const slots = [...resolution.slots];
  const pause = breakAfter(profile, day, lessonNumber, slots);
  return {
    ...variant,
    timing: {
      slots,
      ...(resolution.profile ? { profile: resolution.profile } : {}),
      ...(pause === undefined ? {} : { breakAfterMinutes: pause }),
    },
  };
};

/**
 * Добавляет к базовой группе только presentation-поля для Pages: время пар
 * вычисляется тем же resolver-ом, который использует генератор ICS.
 */
export const presentGroupScheduleArtifact = (
  artifact: GroupScheduleArtifact,
  config: YgkCalendarConfig,
): PagesGroupScheduleArtifact => ({
  ...artifact,
  group: {
    ...artifact.group,
    days: artifact.group.days.map((day) => ({
      ...day,
      lessons: day.lessons.map((lesson) => ({
        ...lesson,
        variants: lesson.variants.map((variant) =>
          addTiming(
            artifact.group.group,
            day.day,
            lesson.number,
            variant,
            config,
          ),
        ),
      })),
    })),
  },
});

/**
 * Добавляет presentation-поля к actual-парам. Состояние замен и канонические
 * данные не меняются — это отдельная проекция для браузера.
 */
export const presentActualGroupScheduleArtifact = (
  artifact: ActualGroupScheduleArtifact,
  config: YgkCalendarConfig,
): PagesActualGroupScheduleArtifact => ({
  ...artifact,
  dates: Object.fromEntries(
    Object.entries(artifact.dates).map(([date, actualDate]) => [
      date,
      {
        ...actualDate,
        groups: Object.fromEntries(
          Object.entries(actualDate.groups).map(([group, schedule]) => [
            group,
            {
              ...schedule,
              lessons: schedule.lessons.map((lesson) => ({
                ...lesson,
                variants: lesson.variants.map((variant) =>
                  addTiming(
                    group,
                    actualDate.day,
                    lesson.number,
                    variant,
                    config,
                  ),
                ),
              })),
            },
          ]),
        ),
      },
    ]),
  ),
});
