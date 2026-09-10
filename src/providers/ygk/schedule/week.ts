import type { WeekType } from '../../../types.ts';
import { isRedLike } from '../../../xlsx/colors.ts';
import type { XlsxFill, XlsxMerge } from '../../../xlsx/types.ts';

/**
 * В текущем шаблоне ЯГК красная заливка помечает знаменатель.
 *
 * Название намеренно не привязано к цвету: если колледж поменяет визуальное
 * оформление, менять нужно будет только классификацию, а не модель пары.
 */
export type WeekFillClass = 'denominator' | 'neutral' | 'unknown';

export const classifyWeekFill = (fill: XlsxFill | undefined): WeekFillClass => {
  if (!fill || fill.patternType !== 'solid') return 'neutral';
  if (isRedLike(fill.foreground.resolvedRgb)) return 'denominator';
  if (fill.foreground.type === 'none' || fill.foreground.type === 'auto')
    return 'neutral';
  if (fill.foreground.type === 'theme' && fill.foreground.theme === 0)
    return 'neutral';
  if (
    fill.foreground.resolvedRgb === '000000' ||
    fill.foreground.resolvedRgb === 'FFFFFF'
  )
    return 'neutral';
  return 'unknown';
};

export const cellAppliesToWholeLesson = (
  merge: XlsxMerge | undefined,
  startRow: number,
  endRow: number,
): boolean =>
  Boolean(merge && merge.startRow <= startRow && merge.endRow >= endRow);

export const resolveVariantWeekType = (
  denominator: boolean,
  unknownColor: boolean,
  allRelevantFieldsSpanLesson: boolean,
  hasDistinctSibling: boolean,
): WeekType => {
  if (!hasDistinctSibling && allRelevantFieldsSpanLesson) return 'both';
  if (unknownColor) return 'unknown';
  if (!hasDistinctSibling && !denominator) return 'both';
  return denominator ? 'denominator' : 'numerator';
};
