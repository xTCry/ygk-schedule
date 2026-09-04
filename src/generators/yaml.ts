import { stringify } from 'yaml';
import type { CanonicalSchedule } from '../types.ts';
import { normalizeScheduleForSerialization } from './json.ts';

/**
 * Сериализует JSON-совместимое значение в стабильный YAML.
 *
 * В generated-артефактах ссылки на один объект не являются частью публичной
 * модели. Поэтому aliases отключены: наличие общей ссылки в памяти не должно
 * менять текст YAML между двумя одинаковыми выгрузками.
 */
export const serializeYaml = (value: unknown): string =>
  stringify(value, { aliasDuplicateObjects: false, indent: 2 });

/**
 * Сериализует каноническое расписание в YAML.
 */
export const serializeScheduleYaml = (schedule: CanonicalSchedule): string =>
  serializeYaml(normalizeScheduleForSerialization(schedule));
