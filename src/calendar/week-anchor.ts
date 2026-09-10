import type { WeekType } from '../types.ts';
import type { CalendarWeekAnchor } from './config.ts';

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Приводит дату замены к понедельнику ее учебной недели.
 *
 * Опорная дата обязательно должна быть началом недели: иначе чередование
 * числителя и знаменателя в генераторе ICS сменится посреди недели.
 */
export const mondayForIsoDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid ISO date: ${value}`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return isoDate(date);
};

/**
 * Выбирает последнюю опубликованную неделю замен как источник истины для
 * чередования недель. Пока таких данных нет, остается fallback из конфига.
 */
export const resolveWeekAnchor = (
  fallback: CalendarWeekAnchor,
  actual: {
    dates: Record<string, { date: string; weekType: WeekType }>;
  } | null,
  term: { start: string; end: string },
): CalendarWeekAnchor => {
  const candidate = Object.values(actual?.dates ?? {})
    .filter(
      (date) =>
        (date.weekType === 'numerator' || date.weekType === 'denominator') &&
        date.date >= term.start &&
        date.date <= term.end,
    )
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  if (!candidate) return fallback;
  if (
    candidate.weekType !== 'numerator' &&
    candidate.weekType !== 'denominator'
  )
    return fallback;
  return {
    date: mondayForIsoDate(candidate.date),
    weekType: candidate.weekType,
  };
};
