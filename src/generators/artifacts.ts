import { join, resolve } from 'node:path';
import { semanticScheduleHash } from '../compare/schedule.ts';
import type { CanonicalSchedule } from '../types.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import {
  serializeDiagnosticsReport,
  serializeDiagnosticsReportYaml,
} from './diagnostics.ts';
import { serializeSchedule } from './json.ts';
import { serializeScheduleYaml } from './yaml.ts';

export interface ScheduleArtifactPaths {
  json: string;
  yaml: string;
  groupJsonDirectory: string;
  groupYamlDirectory: string;
  diagnosticsJson: string;
  diagnosticsYaml: string;
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
    groupJsonDirectory: join(directory, 'json', '10-groups'),
    groupYamlDirectory: join(directory, 'yaml', '10-groups'),
    diagnosticsJson: join(directory, 'meta', '90-diagnostics.json'),
    diagnosticsYaml: join(directory, 'meta', '90-diagnostics.yaml'),
  };
};

const getGroupFileName = (group: string): string => {
  if (!/^[\p{L}\p{N}-]+$/u.test(group))
    throw new Error(`Group code cannot be used as a file name: ${group}`);
  return group;
};

/**
 * Возвращает пути JSON и YAML для одной нормализованной группы.
 */
export const getGroupArtifactPaths = (
  paths: ScheduleArtifactPaths,
  group: string,
): Pick<ScheduleArtifactPaths, 'json' | 'yaml'> => {
  const fileName = getGroupFileName(group);
  return {
    json: join(paths.groupJsonDirectory, `${fileName}.json`),
    yaml: join(paths.groupYamlDirectory, `${fileName}.yaml`),
  };
};

const createGroupSchedule = (
  schedule: CanonicalSchedule,
  group: string,
): CanonicalSchedule => {
  const groupSchedule = schedule.groups[group];
  if (!groupSchedule) throw new Error(`Group not found: ${group}`);

  const groups = { [group]: groupSchedule };
  return {
    ...schedule,
    groups,
    diagnostics: schedule.diagnostics.filter(
      (diagnostic) => diagnostic.normalizedGroup === group,
    ),
    semanticHash: semanticScheduleHash(groups),
  };
};

/**
 * Список файлов, которые должны существовать для полной выгрузки расписания.
 */
export const getScheduleArtifactFiles = (
  paths: ScheduleArtifactPaths,
  schedule: CanonicalSchedule,
): string[] => [
  paths.json,
  paths.yaml,
  paths.diagnosticsJson,
  paths.diagnosticsYaml,
  ...Object.keys(schedule.groups)
    .sort((left, right) => left.localeCompare(right, 'ru-RU'))
    .flatMap((group) => {
      const groupPaths = getGroupArtifactPaths(paths, group);
      return [groupPaths.json, groupPaths.yaml];
    }),
];

/**
 * Записывает общие и групповые JSON/YAML без ручной синхронизации между ними.
 */
export const writeScheduleArtifacts = async (
  paths: ScheduleArtifactPaths,
  schedule: CanonicalSchedule,
): Promise<void> => {
  const groupArtifacts = Object.keys(schedule.groups)
    .sort((left, right) => left.localeCompare(right, 'ru-RU'))
    .flatMap((group) => {
      const groupPaths = getGroupArtifactPaths(paths, group);
      const groupSchedule = createGroupSchedule(schedule, group);
      return [
        writeFileAtomic(groupPaths.json, serializeSchedule(groupSchedule)),
        writeFileAtomic(groupPaths.yaml, serializeScheduleYaml(groupSchedule)),
      ];
    });

  await Promise.all([
    writeFileAtomic(paths.json, serializeSchedule(schedule)),
    writeFileAtomic(paths.yaml, serializeScheduleYaml(schedule)),
    writeFileAtomic(
      paths.diagnosticsJson,
      serializeDiagnosticsReport(schedule),
    ),
    writeFileAtomic(
      paths.diagnosticsYaml,
      serializeDiagnosticsReportYaml(schedule),
    ),
    ...groupArtifacts,
  ]);
};
