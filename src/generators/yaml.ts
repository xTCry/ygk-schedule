import { stringify } from 'yaml';
import type { CanonicalSchedule } from '../types.ts';
import { normalizeScheduleForSerialization } from './json.ts';

/**
 * Сериализует JSON-совместимое значение в стабильный YAML.
 *
 * Повторяющиеся ссылки сохраняются как YAML anchors/aliases. Это уменьшает
 * размер групповых выгрузок замен: одна и та же строка доступна и в общей
 * проекции даты, и в снимке конкретной смены без дублирования текста.
 *
 * Стабильность обеспечивается детерминированной нормализацией входных
 * объектов: одинаковый граф данных должен давать одинаковый текст YAML.
 */
export const serializeYaml = (value: unknown): string =>
  stringify(value, { aliasDuplicateObjects: true, indent: 2 });

/**
 * Сериализует каноническое расписание в YAML.
 */
export const serializeScheduleYaml = (schedule: CanonicalSchedule): string =>
  serializeYaml(normalizeScheduleForSerialization(schedule));
