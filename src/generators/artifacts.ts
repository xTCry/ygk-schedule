import { join, resolve } from 'node:path';
import type { CanonicalSchedule } from '../types.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import { serializeSchedule } from './json.ts';
import { serializeScheduleYaml } from './yaml.ts';

export interface ScheduleArtifactPaths {
  json: string;
  yaml: string;
}

/**
 * Возвращает стабильные пути общих артефактов внутри локальной папки данных.
 */
export const getScheduleArtifactPaths = (
  outputDirectory: string,
): ScheduleArtifactPaths => {
  const directory = resolve(outputDirectory);
  return {
    json: join(directory, 'json', '00-schedule.json'),
    yaml: join(directory, 'yaml', '00-schedule.yaml'),
  };
};

/**
 * Записывает JSON и YAML из одной канонической модели без ручной синхронизации.
 */
export const writeScheduleArtifacts = async (
  paths: ScheduleArtifactPaths,
  schedule: CanonicalSchedule,
): Promise<void> => {
  await Promise.all([
    writeFileAtomic(paths.json, serializeSchedule(schedule)),
    writeFileAtomic(paths.yaml, serializeScheduleYaml(schedule)),
  ]);
};
