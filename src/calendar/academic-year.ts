import type { WeekType } from '../types.ts';

export interface AcademicYear {
  startYear: number;
  endYear: number;
  label: string;
}

export const inferAcademicYear = (date = new Date()): AcademicYear => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const startYear = month >= 9 ? year : year - 1;
  return {
    startYear,
    endYear: startYear + 1,
    label: `${startYear}/${startYear + 1}`,
  };
};

const startOfUtcDay = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

export const weekTypeForDate = (
  date: Date,
  referenceDate: Date,
  referenceWeekType: Exclude<WeekType, 'both' | 'unknown'> = 'numerator',
): Exclude<WeekType, 'both' | 'unknown'> => {
  const delta =
    startOfUtcDay(date).getTime() - startOfUtcDay(referenceDate).getTime();
  const weeks = Math.floor(delta / 604_800_000);
  const even = Math.abs(weeks) % 2 === 0;
  if (even) return referenceWeekType;
  return referenceWeekType === 'numerator' ? 'denominator' : 'numerator';
};
