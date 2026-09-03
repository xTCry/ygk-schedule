import type { DayOfWeek } from '../../types.ts';

export const YGK_SCHEDULE_PAGE_URL = 'https://ygk.edu.yar.ru/raspisanie.html';
export const YGK_REPLACEMENT_FIRST_PAGE_URL =
  'https://menu.sttec.yar.ru/timetable/rasp_first.html';
export const YGK_REPLACEMENT_SECOND_PAGE_URL =
  'https://menu.sttec.yar.ru/timetable/rasp_second.html';
export const YGK_EXPECTED_COLUMNS = 9;

export const YGK_DAYS: DayOfWeek[] = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];

export const YGK_DAY_INDEX = new Map(
  YGK_DAYS.map((day, index) => [day.toLocaleLowerCase('ru-RU'), index]),
);
