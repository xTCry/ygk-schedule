import { normalizeSingleLine, normalizeText } from '../../parser/text.ts';
import { stripYgkSubgroupMarkers } from './subgroup.ts';
import type { LessonVariant } from '../../types.ts';

type LessonLabelVariant = Pick<
  LessonVariant,
  'subject' | 'teacher' | 'room' | 'subgroup'
>;

interface LessonLabelContext {
  changed?: boolean;
}

const foreignLanguageSubject = (subject: string): boolean => {
  const normalized = normalizeSingleLine(subject)
    .replace(/\./g, '')
    .toLocaleLowerCase('ru-RU');
  return (
    normalized === 'иностранный язык' ||
    normalized.startsWith('иностранный язык в ') ||
    normalized === 'ин язык'
  );
};

/**
 * Возвращает фамилии преподавателей из объединенной ячейки XLSX.
 *
 * Перенос строки в колонке преподавателя не меняет модель занятия: это лишь
 * подсказка студенту, что иностранный язык может идти у разных преподавателей.
 */
const teacherSurnames = (teacher: string): string[] => {
  const result: string[] = [];
  for (const line of normalizeText(teacher).split('\n')) {
    const surname = /^([\p{L}-]+)/u.exec(line.trim())?.[1];
    if (surname && !result.includes(surname)) result.push(surname);
  }
  return result;
};

/**
 * Формирует понятное пользователю название события календаря ЯГК.
 *
 * Явная подгруппа имеет приоритет. Для иностранного языка без подгруппы
 * фамилии преподавателей выводятся только как визуальная метка: отдельных
 * teacher-specific вариантов и календарей при этом не создается.
 */
export const formatYgkLessonSummary = (
  lessonNumber: number,
  variant: LessonLabelVariant,
  context?: LessonLabelContext,
): string => {
  const subject = stripYgkSubgroupMarkers(variant.subject).text;
  const label = variant.subgroup
    ? variant.subgroup
    : foreignLanguageSubject(subject)
      ? teacherSurnames(variant.teacher).join(' / ')
      : '';
  const remote = /(?:дот|дистанцион)/iu.test(variant.room);
  return `${lessonNumber}. ${context?.changed ? '✳ ' : ''}${label ? `[${label}] ` : ''}${remote ? '💻 ' : ''}${subject || `Пара ${lessonNumber}`}`;
};
