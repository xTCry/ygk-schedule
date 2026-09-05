import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  CalendarProfile,
  CalendarPublication,
  CalendarRoomProfiles,
  CalendarTerm,
} from '../calendar/config.ts';
import type { ActualSchedule, CanonicalSchedule } from '../types.ts';
import { createYgkRoomTimeResolver } from '../providers/ygk/calendar/room-profile.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import { generateActualIcalWithReport } from './actual-ical.ts';
import { generateIcalWithReport, type IcalSkippedEvent } from './ical.ts';

export interface IcalArtifactPaths {
  baseDirectory: string;
  actualDirectory: string;
}

export interface IcalArtifactsResult {
  generatedGroups: string[];
  skippedGroups: string[];
  skippedEvents: IcalSkippedEvent[];
  files: string[];
}

export interface WriteIcalArtifactsOptions {
  profiles: Record<string, CalendarProfile>;
  roomProfiles: CalendarRoomProfiles;
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

const calendarFileName = (
  group: string,
  subgroup: string | undefined,
): string => groupFileName(`${group}${subgroup ? `-${subgroup}` : ''}`);

const subgroupsForGroup = (
  schedule: CanonicalSchedule,
  group: string,
): string[] =>
  [
    ...new Set(
      schedule.groups[group]?.days.flatMap((day) =>
        day.lessons.flatMap((lesson) =>
          lesson.variants.flatMap((variant) =>
            variant.subgroup ? [variant.subgroup] : [],
          ),
        ),
      ) ?? [],
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru-RU'));

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

const calendarSourceUrl = (
  publication: CalendarPublication | undefined,
  kind: 'base' | 'actual',
  calendarFileName: string,
): string | undefined => {
  const template = publication?.sourceUrlTemplate;
  if (!template) return undefined;
  const urlGroup = /^[\p{L}\p{N}-]+$/u.test(calendarFileName)
    ? calendarFileName
    : encodeURIComponent(calendarFileName);
  return template.replaceAll('{kind}', kind).replaceAll('{group}', urlGroup);
};

/**
 * Создает base и actual ICS для всех групп. Время каждого события определяется
 * по аудитории занятия; при неясном месте событие пропускается и попадает в
 * `skippedEvents`, а не получает придуманное время.
 */
export const writeIcalArtifacts = async (
  paths: IcalArtifactPaths,
  schedule: CanonicalSchedule,
  actual: ActualSchedule | null,
  options: WriteIcalArtifactsOptions,
): Promise<IcalArtifactsResult> => {
  const requestedGroups = options.groups ?? Object.keys(schedule.groups);
  const generatedGroups: string[] = [];
  const skippedGroups: string[] = [];
  const skippedEvents: IcalSkippedEvent[] = [];
  const writes: Promise<void>[] = [];
  const baseFiles: string[] = [];
  const actualFiles: string[] = [];
  const lessonTimeResolver = createYgkRoomTimeResolver(
    options.profiles,
    options.roomProfiles,
  );

  for (const group of [...new Set(requestedGroups)].sort(compareGroups)) {
    if (!schedule.groups[group]) throw new Error(`Group not found: ${group}`);
    // У отдельных групп может быть свой срок семестра, но опорная неделя
    // остается общей для опубликованной версии расписания.
    const termRange = options.term.groupRanges[group] ?? options.term;

    for (const subgroup of [undefined, ...subgroupsForGroup(schedule, group)]) {
      const fileName = calendarFileName(group, subgroup);
      const subgroupLabel = subgroup ? `, подгруппа ${subgroup}` : '';
      const baseFile = join(paths.baseDirectory, `${fileName}.ics`);
      const baseSourceUrl = calendarSourceUrl(
        options.publication,
        'base',
        fileName,
      );
      const baseIcal = generateIcalWithReport(schedule, {
        group,
        ...(subgroup ? { subgroup } : {}),
        calendarName: `ЯГК: ${group}${subgroupLabel}`,
        termStart: termRange.start,
        termEnd: termRange.end,
        referenceDate: options.term.weekAnchor.date,
        referenceWeekType: options.term.weekAnchor.weekType,
        timezone: options.timezone,
        lessonTimeResolver,
        ...(baseSourceUrl ? { sourceUrl: baseSourceUrl } : {}),
        ...(options.publication?.refreshInterval
          ? { refreshInterval: options.publication.refreshInterval }
          : {}),
      });
      writes.push(writeFileAtomic(baseFile, baseIcal.content));
      if (!subgroup) skippedEvents.push(...baseIcal.skippedEvents);
      baseFiles.push(baseFile);

      if (actual) {
        const actualFile = join(paths.actualDirectory, `${fileName}.ics`);
        const actualSourceUrl = calendarSourceUrl(
          options.publication,
          'actual',
          fileName,
        );
        const actualIcal = generateActualIcalWithReport(schedule, actual, {
          group,
          ...(subgroup ? { subgroup } : {}),
          calendarName: `ЯГК: ${group}${subgroupLabel} (actual)`,
          termStart: termRange.start,
          termEnd: termRange.end,
          referenceDate: options.term.weekAnchor.date,
          referenceWeekType: options.term.weekAnchor.weekType,
          timezone: options.timezone,
          lessonTimeResolver,
          ...(actualSourceUrl ? { sourceUrl: actualSourceUrl } : {}),
          ...(options.publication?.refreshInterval
            ? { refreshInterval: options.publication.refreshInterval }
            : {}),
        });
        writes.push(writeFileAtomic(actualFile, actualIcal.content));
        if (!subgroup) skippedEvents.push(...actualIcal.skippedEvents);
        actualFiles.push(actualFile);
      }
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
    skippedEvents,
    files: [...baseFiles, ...actualFiles],
  };
};
