import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  CalendarProfile,
  CalendarPublication,
  CalendarTerm,
} from '../calendar/config.ts';
import type { ActualSchedule, CanonicalSchedule } from '../types.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import { generateActualIcal } from './actual-ical.ts';
import { generateIcal } from './ical.ts';

export interface IcalArtifactPaths {
  baseDirectory: string;
  actualDirectory: string;
}

export interface IcalArtifactsResult {
  generatedGroups: string[];
  skippedGroups: string[];
  files: string[];
}

export interface WriteIcalArtifactsOptions {
  profiles: Record<string, CalendarProfile>;
  groupProfiles: Record<string, string>;
  term: CalendarTerm;
  timezone: string;
  publication?: CalendarPublication;
  groups?: readonly string[];
  /**
   * Очистка нужна только для полной пересборки. Локальный запуск одной группы
   * не должен удалить календарные файлы остальных групп.
   */
  synchronize?: boolean;
}

const compareGroups = (left: string, right: string): number =>
  left.localeCompare(right, 'ru-RU');

const groupFileName = (group: string): string => {
  if (!/^[\p{L}\p{N}-]+$/u.test(group))
    throw new Error(`Group code cannot be used as a file name: ${group}`);
  return group;
};

/**
 * Возвращает стабильные директории base и actual календарей в ветке данных.
 */
export const getIcalArtifactPaths = (
  outputDirectory: string,
): IcalArtifactPaths => {
  const directory = resolve(outputDirectory);
  return {
    baseDirectory: join(directory, 'ical', 'base'),
    actualDirectory: join(directory, 'ical', 'actual'),
  };
};

const syncIcalDirectory = async (
  directory: string,
  expectedPaths: readonly string[],
): Promise<void> => {
  const expected = new Set(expectedPaths.map((path) => resolve(path)));
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ics'))
        .map((entry) => join(directory, entry.name))
        .filter((path) => !expected.has(resolve(path)))
        .map((path) => unlink(path)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const profileForGroup = (
  group: string,
  groupProfiles: Record<string, string>,
  profiles: Record<string, CalendarProfile>,
): CalendarProfile | null => {
  const profileName = groupProfiles[group];
  if (!profileName) return null;
  const profile = profiles[profileName];
  if (!profile)
    throw new Error(
      `Calendar profile "${profileName}" for group "${group}" was not found`,
    );
  return profile;
};

const calendarSourceUrl = (
  publication: CalendarPublication | undefined,
  kind: 'base' | 'actual',
  group: string,
): string | undefined => {
  const template = publication?.sourceUrlTemplate;
  if (!template) return undefined;
  const urlGroup = /^[\p{L}\p{N}-]+$/u.test(group)
    ? group
    : encodeURIComponent(group);
  return template.replaceAll('{kind}', kind).replaceAll('{group}', urlGroup);
};

/**
 * Создает base и actual ICS только для групп с явно назначенным профилем
 * звонков. Неизвестный корпус не является поводом подставлять время наугад.
 */
export const writeIcalArtifacts = async (
  paths: IcalArtifactPaths,
  schedule: CanonicalSchedule,
  actual: ActualSchedule | null,
  options: WriteIcalArtifactsOptions,
): Promise<IcalArtifactsResult> => {
  const requestedGroups = options.groups ?? Object.keys(options.groupProfiles);
  const generatedGroups: string[] = [];
  const skippedGroups: string[] = [];
  const writes: Promise<void>[] = [];
  const baseFiles: string[] = [];
  const actualFiles: string[] = [];

  for (const group of [...new Set(requestedGroups)].sort(compareGroups)) {
    if (!schedule.groups[group]) throw new Error(`Group not found: ${group}`);
    const profile = profileForGroup(
      group,
      options.groupProfiles,
      options.profiles,
    );
    if (!profile) {
      skippedGroups.push(group);
      continue;
    }

    const baseFile = join(paths.baseDirectory, `${groupFileName(group)}.ics`);
    const baseSourceUrl = calendarSourceUrl(options.publication, 'base', group);
    writes.push(
      writeFileAtomic(
        baseFile,
        generateIcal(schedule, {
          group,
          calendarName: `ЯГК: ${group}`,
          termStart: options.term.start,
          termEnd: options.term.end,
          referenceDate: options.term.referenceDate,
          referenceWeekType: options.term.referenceWeekType,
          timezone: options.timezone,
          lessonTimes: profile.lessonTimes,
          lessonTimesByDay: profile.lessonTimesByDay,
          ...(baseSourceUrl ? { sourceUrl: baseSourceUrl } : {}),
          ...(options.publication?.refreshInterval
            ? { refreshInterval: options.publication.refreshInterval }
            : {}),
        }),
      ),
    );
    baseFiles.push(baseFile);

    if (actual) {
      const actualFile = join(
        paths.actualDirectory,
        `${groupFileName(group)}.ics`,
      );
      const actualSourceUrl = calendarSourceUrl(
        options.publication,
        'actual',
        group,
      );
      writes.push(
        writeFileAtomic(
          actualFile,
          generateActualIcal(schedule, actual, {
            group,
            termStart: options.term.start,
            termEnd: options.term.end,
            referenceDate: options.term.referenceDate,
            referenceWeekType: options.term.referenceWeekType,
            timezone: options.timezone,
            lessonTimes: profile.lessonTimes,
            lessonTimesByDay: profile.lessonTimesByDay,
            ...(actualSourceUrl ? { sourceUrl: actualSourceUrl } : {}),
            ...(options.publication?.refreshInterval
              ? { refreshInterval: options.publication.refreshInterval }
              : {}),
          }),
        ),
      );
      actualFiles.push(actualFile);
    }
    generatedGroups.push(group);
  }

  await Promise.all(writes);
  const shouldSynchronize =
    options.synchronize ??
    (!options.groups?.length && requestedGroups.length > 0);
  if (shouldSynchronize) {
    await Promise.all([
      syncIcalDirectory(paths.baseDirectory, baseFiles),
      ...(actual
        ? [syncIcalDirectory(paths.actualDirectory, actualFiles)]
        : []),
    ]);
  }

  return {
    generatedGroups,
    skippedGroups,
    files: [...baseFiles, ...actualFiles],
  };
};
