import type { WeekType } from '../../../types.ts';
import { isRedLike } from '../../../xlsx/colors.ts';
import type { XlsxFill, XlsxMerge } from '../../../xlsx/types.ts';

export type WeekFillClass = 'numerator' | 'neutral' | 'unknown';

export const classifyWeekFill = (fill: XlsxFill | undefined): WeekFillClass => {
  if (!fill || fill.patternType !== 'solid') return 'neutral';
  if (isRedLike(fill.foreground.resolvedRgb)) return 'numerator';
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

export const isNumeratorFill = (fill: XlsxFill | undefined): boolean =>
  classifyWeekFill(fill) === 'numerator';

export const cellAppliesToWholeLesson = (
  merge: XlsxMerge | undefined,
  startRow: number,
  endRow: number,
): boolean =>
  Boolean(merge && merge.startRow <= startRow && merge.endRow >= endRow);

export const resolveVariantWeekType = (
  numerator: boolean,
  unknownColor: boolean,
  allRelevantFieldsSpanLesson: boolean,
  hasDistinctSibling: boolean,
): WeekType => {
  if (!hasDistinctSibling && allRelevantFieldsSpanLesson) return 'both';
  if (unknownColor) return 'unknown';
  if (!hasDistinctSibling && !numerator) return 'both';
  return numerator ? 'numerator' : 'denominator';
};
