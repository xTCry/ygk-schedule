import type { ActualLesson, Lesson, LessonVariant } from './types.ts';

const appliesToWeek = (
  variant: LessonVariant,
  weekType: 'numerator' | 'denominator' | 'both' | 'unknown' | undefined,
): boolean =>
  !weekType ||
  weekType === 'unknown' ||
  variant.weekType === 'unknown' ||
  variant.weekType === 'both' ||
  variant.weekType === weekType;

const baseVariantsForLesson = (
  lesson: ActualLesson,
  baseLessons: readonly Lesson[] | undefined,
  weekType: 'numerator' | 'denominator' | 'both' | 'unknown' | undefined,
): LessonVariant[] =>
  baseLessons
    ?.find((candidate) => candidate.number === lesson.number)
    ?.variants.filter((variant) => appliesToWeek(variant, weekType)) ?? [];

/**
 * Показывает служебную замену «по расписанию» как конкретную смену аудитории.
 *
 * В HTML ЯГК нет названия предмета в такой строке, поэтому оно берется из
 * базовой пары, а не подменяется бесполезным текстом «по расписанию».
 */
export const describeLessonReplacement = (
  lesson: ActualLesson,
  baseLessons?: readonly Lesson[],
  weekType?: 'numerator' | 'denominator' | 'both' | 'unknown',
): string | null =>
  lesson.replacements
    .map((item) => {
      const original = item.replacement.original?.raw;
      const replacement = item.replacement.replacement?.raw;
      const room = item.replacement.replacement?.room;
      if (replacement?.toLocaleLowerCase('ru-RU') === 'по расписанию') {
        const variants = baseVariantsForLesson(lesson, baseLessons, weekType);
        const details = variants.map((variant) => {
          const subgroup = variant.subgroup
            ? ` · подгруппа ${variant.subgroup}`
            : '';
          const rooms =
            room && room !== variant.room
              ? ` · ${variant.room || 'аудитория не указана'} → ${room}`
              : room
                ? ` · ${room}`
                : '';
          return `«${variant.subject}»${subgroup}${rooms}`;
        });
        return details.length
          ? `По расписанию: ${details.join('; ')}`
          : room
            ? `По расписанию · аудитория: ${room}`
            : 'По расписанию';
      }
      return original && replacement ? `${original} → ${replacement}` : null;
    })
    .filter((value): value is string => Boolean(value))
    .join('; ') || null;
