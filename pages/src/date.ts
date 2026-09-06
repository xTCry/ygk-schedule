import type { DayOfWeek } from './types.ts';

export const dayOrder: DayOfWeek[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

const formatter = (options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    ...options,
  });

/**
 * Возвращает календарную дату по Москве, а не по часовому поясу браузера.
 */
export const isoDate = (date: Date): string => {
  const values = new Map(
    formatter({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day)
    throw new Error('Не удалось определить текущую дату по Москве');
  return `${year}-${month}-${day}`;
};

export const dayName = (date: Date): DayOfWeek | null =>
  formatter({ weekday: 'long' })
    .format(date)
    .replace(/^\p{L}/u, (letter) => letter.toUpperCase()) as DayOfWeek;

export const russianDate = (date: Date): string =>
  formatter({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(date)
    .replace(/^\p{L}/u, (letter) => letter.toUpperCase());

export const formatUpdate = (value: string | null): string => {
  if (!value) return 'нет данных';
  return formatter({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

/** Форматирует дату расписания без несуществующего для неё времени суток. */
export const formatScheduleDate = (value: string): string =>
  formatter({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00+03:00`));

export const nextStudyDates = (): Date[] => {
  const result: Date[] = [];
  for (let offset = 0; result.length < 7 && offset < 14; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    if (dayOrder.includes(dayName(date) ?? 'Понедельник')) result.push(date);
  }
  return result;
};
