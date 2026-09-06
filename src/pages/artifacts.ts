import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadYgkCalendarConfig } from '../calendar/config.ts';
import type {
  ActualGroupScheduleArtifact,
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
  GroupReplacementsArtifact,
  GroupScheduleArtifact,
} from '../types.ts';
import { fileExists, readJsonIfExists } from '../utils/fs.ts';
import {
  presentActualGroupScheduleArtifact,
  presentGroupScheduleArtifact,
} from './presentation.ts';

export interface PagesApiGroup {
  code: string;
  hasActual: boolean;
  hasReplacements: boolean;
  calendars: {
    base: string[];
    actual: string[];
  };
}

export interface PagesApiSource {
  id: string;
  fileName: string;
  url?: string;
}

export interface PagesApiUpdates {
  schedule: string;
  replacements: string | null;
  actual: string | null;
}

export interface PagesApiIndex {
  schemaVersion: 1;
  provider: 'ygk';
  scheduleVersion: string;
  updates: PagesApiUpdates;
  sources: PagesApiSource[];
  groups: PagesApiGroup[];
}

export interface PreparePagesPublicDirectoryOptions {
  dataDirectory: string;
  publicDirectory: string;
  calendarConfigPath?: string;
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
const calendarsForGroup = async (
  dataDirectory: string,
  kind: 'base' | 'actual',
  group: string,
): Promise<string[]> => {
  const directory = join(dataDirectory, 'ical', kind);
  if (!(await fileExists(directory))) return [];
  const names = await readdir(directory);
  return names
    .filter(
      (name) =>
        name.endsWith('.ics') &&
        (name === `${group}.ics` || name.startsWith(`${group}-`)),
    )
    .sort((left, right) => left.localeCompare(right, 'ru-RU'));
};

const copyGroupJsonArtifacts = async (
  dataDirectory: string,
  publicDirectory: string,
  kind: 'base' | 'actual' | 'replacements',
  calendarConfigPath?: string,
): Promise<void> => {
  const sourceDirectory = join(dataDirectory, kind, '10-groups');
  if (!(await fileExists(sourceDirectory))) return;
  const destinationDirectory = join(publicDirectory, 'api', kind, 'groups');
  await mkdir(destinationDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  const calendarConfig = calendarConfigPath
    ? await loadYgkCalendarConfig(calendarConfigPath)
    : null;
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const source = join(sourceDirectory, entry.name);
        const destination = join(destinationDirectory, entry.name);
        if (!calendarConfig) {
          await cp(source, destination);
          return;
        }
        if (kind === 'base') {
          const artifact =
            await readJsonIfExists<GroupScheduleArtifact>(source);
          if (!artifact)
            throw new Error(`Group artifact was not found: ${source}`);
          await writeFile(
            destination,
            `${JSON.stringify(
              presentGroupScheduleArtifact(artifact, calendarConfig),
              null,
              2,
            )}\n`,
          );
          return;
        }
        if (kind === 'actual') {
          const artifact =
            await readJsonIfExists<ActualGroupScheduleArtifact>(source);
          if (!artifact)
            throw new Error(`Group artifact was not found: ${source}`);
          await writeFile(
            destination,
            `${JSON.stringify(
              presentActualGroupScheduleArtifact(artifact, calendarConfig),
              null,
              2,
            )}\n`,
          );
          return;
        }
        await cp(source, destination);
      }),
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
  const [replacements, actual] = await Promise.all([
    readJsonIfExists<CanonicalReplacements>(
      join(dataDirectory, 'replacements', '00-replacements.json'),
    ),
    readJsonIfExists<ActualSchedule>(
      join(dataDirectory, 'actual', '00-schedule.json'),
    ),
  ]);

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
        const [baseCalendars, actualCalendars] = await Promise.all([
          calendarsForGroup(dataDirectory, 'base', code),
          calendarsForGroup(dataDirectory, 'actual', code),
        ]);
        return {
          code,
          hasActual: Boolean(actual),
          hasReplacements: Boolean(replacements),
          calendars: {
            base: baseCalendars,
            actual: actualCalendars,
          },
        };
      }),
  );
  const index: PagesApiIndex = {
    schemaVersion: 1,
    provider: 'ygk',
    scheduleVersion: schedule.version.value,
    updates: {
      schedule: schedule.generatedAt,
      replacements: replacements?.generatedAt ?? null,
      actual: actual?.generatedAt ?? null,
    },
    sources: schedule.sources.map((source) => ({
      id: source.id,
      fileName: source.fileName,
      ...(source.url ? { url: source.url } : {}),
    })),
    groups,
  };

  await Promise.all([
    copyGroupJsonArtifacts(
      dataDirectory,
      publicDirectory,
      'base',
      options.calendarConfigPath,
    ),
    copyGroupJsonArtifacts(
      dataDirectory,
      publicDirectory,
      'actual',
      options.calendarConfigPath,
    ),
    copyGroupJsonArtifacts(
      dataDirectory,
      publicDirectory,
      'replacements',
      options.calendarConfigPath,
    ),
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
