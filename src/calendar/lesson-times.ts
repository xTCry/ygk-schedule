import type { DayOfWeek } from '../types.ts';

/**
 * Один непрерывный отрезок времени пары.
 */
export interface LessonTime {
  start: string;
  end: string;
}

/**
 * Пара может состоять из нескольких сегментов, разделенных большой переменой.
 */
export type LessonTimeSlots = LessonTime | readonly LessonTime[];

export type LessonTimeOverride = LessonTimeSlots | null;

/**
 * Данные занятия, достаточные для выбора времени без знания структуры XLSX.
 */
export interface LessonTimeRequest {
  group: string;
  day: DayOfWeek;
  lessonNumber: number;
  room: string;
}

/**
 * Результат выбора времени пары.
 *
 * Пустой массив всегда сопровождается причиной: генератор не подставляет
 * время, если корпус или правило для него не удалось определить однозначно.
 */
export interface LessonTimeResolution {
  slots: readonly LessonTime[];
  profile?: string;
  reason?: string;
}

/**
 * Находит время конкретной пары по ее контексту.
 */
export type LessonTimeResolver = (
  request: LessonTimeRequest,
) => LessonTimeResolution;
