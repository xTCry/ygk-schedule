import { stringify } from 'yaml';
import type { CanonicalSchedule } from '../types.ts';
import { normalizeScheduleForSerialization } from './json.ts';

/**
 * Сериализует каноническое расписание в YAML
 */
export const serializeScheduleYaml = (schedule: CanonicalSchedule): string =>
  stringify(normalizeScheduleForSerialization(schedule), { indent: 2 });
