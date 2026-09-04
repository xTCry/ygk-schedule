import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { semanticScheduleHash } from '../compare/schedule.ts';
import type { CanonicalSchedule, GroupScheduleArtifact } from '../types.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import {
  serializeDiagnosticsReport,
  serializeDiagnosticsReportYaml,
} from './diagnostics.ts';
import {
  normalizeGroupScheduleForSerialization,
  serializeSchedule,
} from './json.ts';
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
    json: join(directory, 'base', '00-schedule.json'),
    yaml: join(directory, 'base', '00-schedule.yaml'),
    groupJsonDirectory: join(directory, 'base', '10-groups'),
    groupYamlDirectory: join(directory, 'base', '10-groups'),
    diagnosticsJson: join(directory, 'base', '90-diagnostics.json'),
    diagnosticsYaml: join(directory, 'base', '90-diagnostics.yaml'),
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

/**
 * Создает компактный публичный артефакт одной группы без общих metadata.
 */
const createGroupScheduleArtifact = (
  schedule: CanonicalSchedule,
  group: string,
): GroupScheduleArtifact => {
  const groupSchedule = schedule.groups[group];
  if (!groupSchedule) throw new Error(`Group not found: ${group}`);

  return {
    schemaVersion: schedule.schemaVersion,
    provider: schedule.provider,
    group: normalizeGroupScheduleForSerialization(groupSchedule),
    diagnostics: schedule.diagnostics.filter(
      (diagnostic) => diagnostic.normalizedGroup === group,
    ),
    semanticHash: semanticScheduleHash({ [group]: groupSchedule }),
  };
};

const serializeGroupScheduleArtifact = (
  artifact: GroupScheduleArtifact,
): string => `${JSON.stringify(artifact, null, 2)}\n`;

const serializeGroupScheduleArtifactYaml = (
  artifact: GroupScheduleArtifact,
): string => stringify(artifact, { indent: 2 });

const syncGroupDirectory = async (
  directory: string,
  expectedPaths: readonly string[],
): Promise<void> => {
  const expected = new Set(expectedPaths.map((path) => resolve(path)));
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
        .map((entry) => join(directory, entry.name))
        .filter((path) => !expected.has(resolve(path)))
        .map((path) => unlink(path)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
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
  const groups = Object.keys(schedule.groups).sort((left, right) =>
    left.localeCompare(right, 'ru-RU'),
  );
  const groupArtifacts = groups.flatMap((group) => {
    const groupPaths = getGroupArtifactPaths(paths, group);
    const artifact = createGroupScheduleArtifact(schedule, group);
    return [
      writeFileAtomic(
        groupPaths.json,
        serializeGroupScheduleArtifact(artifact),
      ),
      writeFileAtomic(
        groupPaths.yaml,
        serializeGroupScheduleArtifactYaml(artifact),
      ),
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

  await syncGroupDirectory(
    paths.groupJsonDirectory,
    groups.flatMap((group) => {
      const groupPaths = getGroupArtifactPaths(paths, group);
      return [groupPaths.json, groupPaths.yaml];
    }),
  );
};
