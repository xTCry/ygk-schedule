import { join, resolve } from 'node:path';
import type {
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
  Diagnostic,
  ScheduleSource,
} from '../types.ts';
import {
  readJsonIfExists,
  writeFileAtomic,
  writeFileIfChangedAtomic,
} from '../utils/fs.ts';
import { getGroupFileName } from './group-file-name.ts';
import { serializeYaml } from './yaml.ts';

const moscowTimeZone = 'Europe/Moscow';

type VersionedArtifact =
  CanonicalSchedule | CanonicalReplacements | ActualSchedule;

export interface PublicationArtifactStatus {
  generatedAt: string;
  version: string;
  parserHash: string;
  parserVersion: string;
  semanticHash: string;
}

export interface PublicationDiagnosticsStatus {
  info: number;
  warning: number;
  error: number;
  fatal: number;
}

/**
 * Состояние одного XLSX-источника для публикации в README.
 *
 * `updatedAt` — не время последней проверки. Это дата изменения содержимого:
 * HTTP Last-Modified при наличии либо момент первого получения текущего SHA.
 */
export interface PublicationScheduleSourceStatus {
  id: string;
  fileName: string;
  sha256: string;
  updatedAt: string;
  url?: string;
}

export interface PublicationScheduleSourcesStatus {
  schemaVersion: 1;
  sources: PublicationScheduleSourceStatus[];
}

/**
 * Компактные сведения о последней опубликованной выгрузке.
 *
 * Полные hashes остаются в JSON для проверки происхождения. Для README
 * отдельно сохраняется короткая версия hash, которая помещается в badge.
 */
export interface PublicationStatus {
  schemaVersion: 1;
  updatedAt: string;
  schedule: PublicationArtifactStatus & {
    groups: number;
    sources: number;
    sourceFiles: PublicationScheduleSourceStatus[];
    diagnostics: PublicationDiagnosticsStatus;
  };
  replacements: PublicationArtifactStatus | null;
  actual: PublicationArtifactStatus | null;
}

export interface BadgeEndpoint {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  labelColor: string;
}

export interface PublicationStatusPaths {
  statusJson: string;
  statusYaml: string;
  scheduleSourcesJson: string;
  scheduleSourcesYaml: string;
  scheduleBadge: string;
  replacementsBadge: string;
  scheduleParserBadge: string;
  replacementsParserBadge: string;
  scheduleSourcesBadgesDirectory: string;
}

const compactHash = (hash: string): string => hash.slice(0, 12);

const diagnosticsSummary = (
  diagnostics: readonly Diagnostic[],
): PublicationDiagnosticsStatus =>
  diagnostics.reduce<PublicationDiagnosticsStatus>(
    (summary, diagnostic) => {
      summary[diagnostic.severity] += 1;
      return summary;
    },
    { info: 0, warning: 0, error: 0, fatal: 0 },
  );

const artifactStatus = (
  artifact: VersionedArtifact | null,
): PublicationArtifactStatus | null => {
  if (!artifact) return null;
  return {
    generatedAt: artifact.generatedAt,
    version: artifact.version.value,
    parserHash: artifact.version.parserHash,
    parserVersion: compactHash(artifact.version.parserHash),
    semanticHash: artifact.semanticHash,
  };
};

/**
 * Форматирует ISO-время выгрузки в короткий вид, независимый от timezone
 * runner-а GitHub Actions.
 */
const formatMoscowDateTime = (value: string): string => {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: moscowTimeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('day')}.${part('month')}.${part('year')}, ${part('hour')}:${part('minute')} МСК`;
};

const newestTimestamp = (
  values: readonly (PublicationArtifactStatus | null)[],
): string => {
  const timestamps = values
    .map((value) => value?.generatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const newest = timestamps.at(-1);
  if (!newest)
    throw new Error('Publication status requires at least one artifact');
  return newest;
};

const badge = (
  label: string,
  message: string,
  color: string,
): BadgeEndpoint => ({
  schemaVersion: 1,
  label,
  message,
  color,
  labelColor: '334155',
});

const artifactBadge = (
  label: string,
  artifact: PublicationArtifactStatus | null,
  color: string,
): BadgeEndpoint =>
  artifact
    ? badge(label, formatMoscowDateTime(artifact.generatedAt), color)
    : badge(label, 'нет данных', '6b7280');

const scheduleSourceBadge = (
  source: PublicationScheduleSourceStatus,
): BadgeEndpoint =>
  badge(source.fileName, formatMoscowDateTime(source.updatedAt), '0369a1');

const parserBadge = (
  label: string,
  artifact: PublicationArtifactStatus | null,
): BadgeEndpoint =>
  artifact
    ? badge(label, artifact.parserVersion, '475569')
    : badge(label, 'нет данных', '6b7280');

/**
 * Возвращает стабильные пути metadata и endpoint JSON для Shields.io.
 */
export const getPublicationStatusPaths = (
  outputDirectory: string,
): PublicationStatusPaths => {
  const metadataDirectory = join(resolve(outputDirectory), 'meta');
  const badgesDirectory = join(metadataDirectory, '10-badges');
  return {
    statusJson: join(metadataDirectory, '00-status.json'),
    statusYaml: join(metadataDirectory, '00-status.yaml'),
    scheduleSourcesJson: join(metadataDirectory, '01-schedule-sources.json'),
    scheduleSourcesYaml: join(metadataDirectory, '01-schedule-sources.yaml'),
    scheduleBadge: join(badgesDirectory, 'schedule.json'),
    replacementsBadge: join(badgesDirectory, 'replacements.json'),
    scheduleParserBadge: join(badgesDirectory, 'xlsx-parser.json'),
    replacementsParserBadge: join(badgesDirectory, 'replacements-parser.json'),
    scheduleSourcesBadgesDirectory: join(badgesDirectory, 'schedule-sources'),
  };
};

export const getScheduleSourceBadgePath = (
  outputDirectory: string,
  fileName: string,
): string =>
  join(
    getPublicationStatusPaths(outputDirectory).scheduleSourcesBadgesDirectory,
    `${getGroupFileName(fileName)}.json`,
  );

const asIsoDate = (value: string | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

const sourceUpdatedAt = (source: ScheduleSource): string =>
  asIsoDate(source.lastModified) ?? source.fetchedAt;

/**
 * Обновляет отдельный manifest XLSX-источников.
 *
 * Одинаковый SHA сохраняет прежнюю дату изменения даже при новой загрузке.
 * Благодаря этому repeated workflow не меняет badges и не создаёт ложный
 * сигнал, будто расписание на сайте обновилось.
 */
export const buildPublicationScheduleSourcesStatus = (
  sources: readonly ScheduleSource[],
  previous: PublicationScheduleSourcesStatus | null,
): PublicationScheduleSourcesStatus => {
  const previousById = new Map(
    previous?.sources.map((source) => [source.id, source]) ?? [],
  );
  return {
    schemaVersion: 1,
    sources: sources
      .map((source) => {
        const previousSource = previousById.get(source.id);
        return {
          id: source.id,
          fileName: source.fileName,
          sha256: source.sha256,
          updatedAt:
            previousSource?.sha256 === source.sha256
              ? previousSource.updatedAt
              : sourceUpdatedAt(source),
          ...(source.url ? { url: source.url } : {}),
        };
      })
      .sort(
        (left, right) =>
          left.fileName.localeCompare(right.fileName, 'ru-RU') ||
          left.id.localeCompare(right.id),
      ),
  };
};

/**
 * Сохраняет даты изменения XLSX и endpoint-файлы Shields.
 *
 * Функция вызывается прямо из update, поэтому фиксирует новый источник даже
 * если его байты изменились, но parser не нашёл изменения учебных занятий.
 */
export const writePublicationScheduleSourcesStatus = async (
  outputDirectory: string,
  sources: readonly ScheduleSource[],
): Promise<{
  changed: boolean;
  status: PublicationScheduleSourcesStatus;
}> => {
  const paths = getPublicationStatusPaths(outputDirectory);
  const previous = await readJsonIfExists<PublicationScheduleSourcesStatus>(
    paths.scheduleSourcesJson,
  );
  const status = buildPublicationScheduleSourcesStatus(sources, previous);
  const written = await Promise.all([
    writeFileIfChangedAtomic(paths.scheduleSourcesJson, serializeJson(status)),
    writeFileIfChangedAtomic(paths.scheduleSourcesYaml, serializeYaml(status)),
    ...status.sources.map((source) =>
      writeFileIfChangedAtomic(
        getScheduleSourceBadgePath(outputDirectory, source.fileName),
        serializeJson(scheduleSourceBadge(source)),
      ),
    ),
  ]);
  return { changed: written.some(Boolean), status };
};

/**
 * Собирает значения для README из уже сохраненных data-артефактов.
 */
export const buildPublicationStatus = async (
  outputDirectory: string,
): Promise<PublicationStatus> => {
  const directory = resolve(outputDirectory);
  const [schedule, replacements, actual] = await Promise.all([
    readJsonIfExists<CanonicalSchedule>(
      join(directory, 'base', '00-schedule.json'),
    ),
    readJsonIfExists<CanonicalReplacements>(
      join(directory, 'replacements', '00-replacements.json'),
    ),
    readJsonIfExists<ActualSchedule>(
      join(directory, 'actual', '00-schedule.json'),
    ),
  ]);
  if (!schedule)
    throw new Error(
      `Base schedule was not found for publication status: ${directory}`,
    );

  const scheduleStatus = artifactStatus(schedule);
  if (!scheduleStatus) throw new Error('Expected base schedule status');
  const paths = getPublicationStatusPaths(directory);
  const savedScheduleSources =
    await readJsonIfExists<PublicationScheduleSourcesStatus>(
      paths.scheduleSourcesJson,
    );
  const scheduleSources =
    savedScheduleSources?.sources ??
    (await writePublicationScheduleSourcesStatus(directory, schedule.sources))
      .status.sources;
  const replacementsStatus = artifactStatus(replacements);
  const actualStatus = artifactStatus(actual);
  return {
    schemaVersion: 1,
    updatedAt: newestTimestamp([
      scheduleStatus,
      replacementsStatus,
      actualStatus,
    ]),
    schedule: {
      ...scheduleStatus,
      groups: Object.keys(schedule.groups).length,
      sources: schedule.sources.length,
      sourceFiles: scheduleSources,
      diagnostics: diagnosticsSummary(schedule.diagnostics),
    },
    replacements: replacementsStatus,
    actual: actualStatus,
  };
};

const serializeJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

/**
 * Записывает общую status metadata и четыре endpoint JSON для README badges.
 */
export const writePublicationStatus = async (
  outputDirectory: string,
): Promise<PublicationStatus> => {
  const status = await buildPublicationStatus(outputDirectory);
  const paths = getPublicationStatusPaths(outputDirectory);
  await Promise.all([
    writeFileAtomic(paths.statusJson, serializeJson(status)),
    writeFileAtomic(paths.statusYaml, serializeYaml(status)),
    writeFileAtomic(
      paths.scheduleBadge,
      serializeJson(artifactBadge('Расписание', status.schedule, '0f766e')),
    ),
    writeFileAtomic(
      paths.replacementsBadge,
      serializeJson(artifactBadge('Замены', status.replacements, '7e22ce')),
    ),
    writeFileAtomic(
      paths.scheduleParserBadge,
      serializeJson(parserBadge('XLSX parser', status.schedule)),
    ),
    writeFileAtomic(
      paths.replacementsParserBadge,
      serializeJson(parserBadge('HTML parser', status.replacements)),
    ),
    ...status.schedule.sourceFiles.map((source) =>
      writeFileAtomic(
        getScheduleSourceBadgePath(outputDirectory, source.fileName),
        serializeJson(scheduleSourceBadge(source)),
      ),
    ),
  ]);
  return status;
};
