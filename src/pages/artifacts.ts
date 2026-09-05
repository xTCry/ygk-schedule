import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ActualGroupScheduleArtifact,
  CanonicalSchedule,
  GroupReplacementsArtifact,
  GroupScheduleArtifact,
} from '../types.ts';
import { fileExists, readJsonIfExists } from '../utils/fs.ts';

export interface PagesApiGroup {
  code: string;
  hasActual: boolean;
  hasReplacements: boolean;
}

export interface PagesApiIndex {
  schemaVersion: 1;
  provider: 'ygk';
  generatedAt: string;
  scheduleVersion: string;
  groups: PagesApiGroup[];
}

export interface PreparePagesPublicDirectoryOptions {
  dataDirectory: string;
  publicDirectory: string;
}

const copyIfExists = async (
  source: string,
  destination: string,
): Promise<void> => {
  if (!(await fileExists(source))) return;
  await mkdir(resolve(destination, '..'), { recursive: true });
  await cp(source, destination, { recursive: true });
};

/**
 * Копирует только JSON-артефакты групп: YAML остается удобным форматом ветки
 * `data`, но публичный API сайта намеренно имеет один компактный формат.
 */
const copyGroupJsonArtifacts = async (
  dataDirectory: string,
  publicDirectory: string,
  kind: 'base' | 'actual' | 'replacements',
): Promise<void> => {
  const sourceDirectory = join(dataDirectory, kind, '10-groups');
  if (!(await fileExists(sourceDirectory))) return;
  const destinationDirectory = join(publicDirectory, 'api', kind, 'groups');
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) =>
        cp(
          join(sourceDirectory, entry.name),
          join(destinationDirectory, entry.name),
        ),
      ),
  );
};

/**
 * Создает статический публичный API для Pages из уже опубликованной ветки
 * `data`. Клиент получает компактный индекс и JSON только выбранной группы,
 * поэтому не скачивает общий многомегабайтный файл расписания.
 */
export const preparePagesPublicDirectory = async (
  options: PreparePagesPublicDirectoryOptions,
): Promise<PagesApiIndex> => {
  const dataDirectory = resolve(options.dataDirectory);
  const publicDirectory = resolve(options.publicDirectory);
  const schedule = await readJsonIfExists<CanonicalSchedule>(
    join(dataDirectory, 'base', '00-schedule.json'),
  );
  if (!schedule)
    throw new Error(
      `Base schedule was not found in data directory: ${dataDirectory}`,
    );

  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(join(publicDirectory, 'api'), { recursive: true });

  const groups = await Promise.all(
    Object.keys(schedule.groups)
      .sort((left, right) => left.localeCompare(right, 'ru-RU'))
      .map(async (code): Promise<PagesApiGroup> => {
        const basePath = join(
          dataDirectory,
          'base',
          '10-groups',
          `${code}.json`,
        );
        const baseArtifact =
          await readJsonIfExists<GroupScheduleArtifact>(basePath);
        if (!baseArtifact)
          throw new Error(`Base group artifact was not found: ${basePath}`);
        const actual = await readJsonIfExists<ActualGroupScheduleArtifact>(
          join(dataDirectory, 'actual', '10-groups', `${code}.json`),
        );
        const replacements = await readJsonIfExists<GroupReplacementsArtifact>(
          join(dataDirectory, 'replacements', '10-groups', `${code}.json`),
        );
        return {
          code,
          hasActual: Boolean(actual),
          hasReplacements: Boolean(replacements),
        };
      }),
  );
  const index: PagesApiIndex = {
    schemaVersion: 1,
    provider: 'ygk',
    generatedAt: schedule.generatedAt,
    scheduleVersion: schedule.version.value,
    groups,
  };

  await Promise.all([
    copyGroupJsonArtifacts(dataDirectory, publicDirectory, 'base'),
    copyGroupJsonArtifacts(dataDirectory, publicDirectory, 'actual'),
    copyGroupJsonArtifacts(dataDirectory, publicDirectory, 'replacements'),
    copyIfExists(
      join(dataDirectory, 'base', '90-diagnostics.json'),
      join(publicDirectory, 'api', 'base', '90-diagnostics.json'),
    ),
    copyIfExists(
      join(dataDirectory, 'actual', '90-diagnostics.json'),
      join(publicDirectory, 'api', 'actual', '90-diagnostics.json'),
    ),
    copyIfExists(
      join(dataDirectory, 'replacements', '90-diagnostics.json'),
      join(publicDirectory, 'api', 'replacements', '90-diagnostics.json'),
    ),
    copyIfExists(join(dataDirectory, 'ical'), join(publicDirectory, 'ical')),
    writeFile(
      join(publicDirectory, 'api', 'index.json'),
      `${JSON.stringify(index, null, 2)}\n`,
    ),
  ]);
  return index;
};

/**
 * Читает JSON API, подготовленный для Pages. Небольшой helper нужен тестам,
 * чтобы публичный контракт index не зависел от Vite или DOM.
 */
export const readPagesApiIndex = async (
  publicDirectory: string,
): Promise<PagesApiIndex> =>
  JSON.parse(
    await readFile(join(resolve(publicDirectory), 'api', 'index.json'), 'utf8'),
  ) as PagesApiIndex;
