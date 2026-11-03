import type { Diagnostic } from './types.ts';

/** Недатированные проблемы относятся к группе, а не конкретному дню. */
export const diagnosticIsCommon = (diagnostic: Diagnostic): boolean =>
  typeof diagnostic.context?.date !== 'string';

/** Историческое предупреждение показываем только на относящуюся к нему дату. */
export const diagnosticIsForDate = (
  diagnostic: Diagnostic,
  date: string,
): boolean => diagnostic.context?.date === date;
