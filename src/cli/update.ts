import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSchedules, semanticScheduleHash } from '../compare/schedule.ts';
import type { ScheduleDiff } from '../compare/schedule.ts';
import {
  diagnosticSemanticHash,
  hasFatalDiagnostics,
} from '../diagnostics/index.ts';
import {
  getScheduleArtifactFiles,
  getScheduleArtifactPaths,
  writeScheduleArtifacts,
} from '../generators/artifacts.ts';
import type { ScheduleArtifactPaths } from '../generators/artifacts.ts';
import { serializeSchedule } from '../generators/json.ts';
import { writePublicationScheduleSourcesStatus } from '../generators/publication-status.ts';
import { writeRawSourceArtifact } from '../generators/sources.ts';
import { aggregateYgkSchedules } from '../providers/ygk/schedule/aggregate.ts';
import { discoverScheduleFiles } from '../providers/ygk/schedule/discover.ts';
import { downloadScheduleFile } from '../providers/ygk/schedule/download.ts';
import { parseYgkSchedule } from '../providers/ygk/schedule/parse.ts';
import type {
  CanonicalSchedule,
  DayOfWeek,
  ScheduleSource,
  SourceReference,
} from '../types.ts';
import { fileExists, readJsonIfExists, writeFileAtomic } from '../utils/fs.ts';
import { sha256 } from '../utils/hash.ts';
import {
  buildScheduleVersion,
  calculateProjectHashes,
  calculateSourceSetHash,
  SCHEMA_VERSION,
} from '../version.ts';

export interface UpdateOptions {
  input?: string;
  inputDir?: string;
  url?: string;
  pageUrl?: string;
  output?: string;
  outputDir?: string;
  projectRoot?: string;
}

export interface UpdateResult {
  written: boolean;
  versionChanged: boolean;
  semanticChanged: boolean;
  sourcesChanged: boolean;
  schedule: CanonicalSchedule;
  diff: ReturnType<typeof compareSchedules>;
  sourceChanges: ScheduleSourceChange[];
}

export interface UpdateCliOutput {
  written: boolean;
  versionChanged: boolean;
  semanticChanged: boolean;
  sourcesChanged?: boolean;
  schedule: Pick<CanonicalSchedule, 'groups' | 'diagnostics'>;
  diff: ScheduleDiff;
  sourceChanges?: ScheduleSourceChange[];
}

interface LoadedScheduleSource {
  buffer: Buffer;
  source: ScheduleSource;
}

interface OutputTarget {
  json: string;
  artifacts?: ScheduleArtifactPaths;
}

export interface SourceLessonChangeLocation {
  group: string;
  day: DayOfWeek;
  lessonNumber: number;
  before: SourceReference | null;
  after: SourceReference | null;
}

export interface ScheduleSourceChange {
  id: string;
  fileName: string;
  beforeSha256: string | null;
  afterSha256: string | null;
  lessonChanges: SourceLessonChangeLocation[];
}

const resolveOutputTarget = (options: UpdateOptions): OutputTarget => {
  if (Boolean(options.output) === Boolean(options.outputDir))
    throw new Error('Specify exactly one of output or outputDir');

  if (options.output) return { json: resolve(options.output) };
  const artifacts = getScheduleArtifactPaths(options.outputDir!);
  return { json: artifacts.json, artifacts };
};

const sourceIdFromUrl = (url: string): string => {
  const normalized = new URL(url);
  normalized.hash = '';
  return normalized.toString();
};

const lessonSource = (
  schedule: CanonicalSchedule,
  group: string,
  day: DayOfWeek,
  lessonNumber: number,
): SourceReference | null =>
  schedule.groups[group]?.days
    .find((item) => item.day === day)
    ?.lessons.find((lesson) => lesson.number === lessonNumber)?.source ?? null;

/**
 * Сопоставляет изменившиеся XLSX с затронутыми парами канонического diff.
 *
 * В отчёт попадают только пары, для которых parser сохранил `sourceId`.
 * Отсутствие привязки не является ошибкой: часть изменений может относиться к
 * структуре источника, а не к опубликованной паре.
 */
export const buildScheduleSourceChanges = (
  previous: CanonicalSchedule | null,
  currentSources: readonly ScheduleSource[],
  current: CanonicalSchedule,
  diff: ScheduleDiff,
): ScheduleSourceChange[] => {
  const previousSources = new Map(
    previous?.sources.map((source) => [source.id, source]) ?? [],
  );
  const nextSources = new Map(
    currentSources.map((source) => [source.id, source]),
  );
  const changedSourceIds = new Set(
    [...new Set([...previousSources.keys(), ...nextSources.keys()])].filter(
      (id) => previousSources.get(id)?.sha256 !== nextSources.get(id)?.sha256,
    ),
  );

  return [...changedSourceIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const before = previousSources.get(id);
      const after = nextSources.get(id);
      const lessonChanges = diff.lessonChanges
        .map((change) => ({
          group: change.group,
          day: change.day,
          lessonNumber: change.lessonNumber,
          before: previous
            ? lessonSource(
                previous,
                change.group,
                change.day,
                change.lessonNumber,
              )
            : null,
          after: lessonSource(
            current,
            change.group,
            change.day,
            change.lessonNumber,
          ),
        }))
        .filter(
          (change) =>
            change.before?.sourceId === id || change.after?.sourceId === id,
        );
      return {
        id,
        fileName: after?.fileName ?? before?.fileName ?? id,
        beforeSha256: before?.sha256 ?? null,
        afterSha256: after?.sha256 ?? null,
        lessonChanges,
      };
    });
};

const loadSources = async (
  options: UpdateOptions,
): Promise<LoadedScheduleSource[]> => {
  const sourceOptionCount = [
    options.input,
    options.inputDir,
    options.url,
    options.pageUrl,
  ].filter(Boolean).length;
  if (sourceOptionCount !== 1)
    throw new Error('Specify exactly one of input, inputDir, url or pageUrl');

  if (options.url) {
    const downloaded = await downloadScheduleFile(options.url);
    return [
      {
        buffer: downloaded.buffer,
        source: {
          id: sourceIdFromUrl(options.url),
          fileName: downloaded.fileName,
          sha256: downloaded.sha256,
          fetchedAt: downloaded.fetchedAt,
          url: downloaded.url,
          ...(downloaded.etag ? { etag: downloaded.etag } : {}),
          ...(downloaded.lastModified
            ? { lastModified: downloaded.lastModified }
            : {}),
        },
      },
    ];
  }

  if (options.pageUrl) {
    const files = await discoverScheduleFiles(options.pageUrl);
    return Promise.all(
      files.map(async (file) => {
        const downloaded = await downloadScheduleFile(file.url);
        return {
          buffer: downloaded.buffer,
          source: {
            id: sourceIdFromUrl(file.url),
            fileName: downloaded.fileName,
            sha256: downloaded.sha256,
            fetchedAt: downloaded.fetchedAt,
            url: downloaded.url,
            ...(downloaded.etag ? { etag: downloaded.etag } : {}),
            ...(downloaded.lastModified
              ? { lastModified: downloaded.lastModified }
              : {}),
          },
        };
      }),
    );
  }

  if (options.inputDir) {
    const directory = resolve(options.inputDir);
    const entries = await readdir(directory, { withFileTypes: true });
    const fileNames = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.toLocaleLowerCase('en-US').endsWith('.xlsx'),
      )
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'ru-RU'));
    if (!fileNames.length)
      throw new Error(`No XLSX files found in input directory: ${directory}`);

    return Promise.all(
      fileNames.map(async (fileName) => {
        const buffer = await readFile(resolve(directory, fileName));
        return {
          buffer,
          source: {
            id: fileName,
            fileName,
            sha256: sha256(buffer),
            fetchedAt: new Date().toISOString(),
          },
        };
      }),
    );
  }

  const input = resolve(options.input!);
  const buffer = await readFile(input);
  const fileName = basename(input);
  return [
    {
      buffer,
      source: {
        id: fileName,
        fileName,
        sha256: sha256(buffer),
        fetchedAt: new Date().toISOString(),
      },
    },
  ];
};

export const updateSchedule = async (
  options: UpdateOptions,
): Promise<UpdateResult> => {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const output = resolveOutputTarget(options);
  const previous = await readJsonIfExists<CanonicalSchedule>(output.json);
  const sources = await loadSources(options);
  const sourcesChanged = output.artifacts
    ? (
        await Promise.all(
          sources.map(({ buffer, source }) =>
            writeRawSourceArtifact(
              options.outputDir!,
              'schedule',
              source.fileName,
              buffer,
            ),
          ),
        )
      ).some(Boolean)
    : false;
  const sourceStatusChanged = output.artifacts
    ? (
        await writePublicationScheduleSourcesStatus(
          options.outputDir!,
          sources.map((loadedSource) => loadedSource.source),
        )
      ).changed
    : false;
  const { parserHash, configHash } = await calculateProjectHashes(projectRoot);
  const version = buildScheduleVersion({
    sourceSetHash: calculateSourceSetHash(
      sources.map((loadedSource) => loadedSource.source),
    ),
    parserHash,
    configHash,
  });
  const versionChanged = previous?.version.value !== version.value;
  const artifactFiles =
    output.artifacts && previous
      ? getScheduleArtifactFiles(output.artifacts, previous)
      : output.artifacts
        ? [output.artifacts.json, output.artifacts.yaml]
        : [output.json];
  const allArtifactsExist = (
    await Promise.all(artifactFiles.map((path) => fileExists(path)))
  ).every(Boolean);

  if (!versionChanged && previous && allArtifactsExist) {
    const diff = compareSchedules(previous, previous);
    return {
      written: sourcesChanged || sourceStatusChanged,
      versionChanged: false,
      semanticChanged: false,
      sourcesChanged,
      schedule: previous,
      diff,
      sourceChanges: [],
    };
  }

  const parsed = aggregateYgkSchedules(
    await Promise.all(
      sources.map(async ({ buffer, source }) => ({
        source,
        parsed: await parseYgkSchedule(buffer),
      })),
    ),
  );
  const semanticHash = semanticScheduleHash(parsed.groups);
  const schedule: CanonicalSchedule = {
    schemaVersion: SCHEMA_VERSION,
    provider: 'ygk',
    generatedAt: new Date().toISOString(),
    sources: sources
      .map((loadedSource) => loadedSource.source)
      .sort((left, right) => left.id.localeCompare(right.id)),
    version,
    groups: parsed.groups,
    diagnostics: parsed.diagnostics,
    semanticHash,
  };
  const diff = compareSchedules(previous, schedule);
  const diagnosticsChanged =
    !previous ||
    diagnosticSemanticHash(previous.diagnostics) !==
      diagnosticSemanticHash(schedule.diagnostics);
  const schemaChanged =
    !previous ||
    previous.schemaVersion !== schedule.schemaVersion ||
    previous.version.schemaVersion !== schedule.version.schemaVersion;
  const semanticChanged = diff.changed || diagnosticsChanged;
  const sourceChanges = buildScheduleSourceChanges(
    previous,
    sources.map((loadedSource) => loadedSource.source),
    schedule,
    diff,
  );

  if (hasFatalDiagnostics(schedule.diagnostics)) {
    return {
      written: sourcesChanged || sourceStatusChanged,
      versionChanged,
      semanticChanged,
      sourcesChanged,
      schedule,
      diff,
      sourceChanges,
    };
  }

  if (!semanticChanged && !schemaChanged) {
    if (!allArtifactsExist) {
      if (output.artifacts)
        await writeScheduleArtifacts(output.artifacts, previous);
      else await writeFileAtomic(output.json, serializeSchedule(previous));
      return {
        written: true,
        versionChanged,
        semanticChanged: false,
        sourcesChanged,
        schedule: previous,
        diff,
        sourceChanges,
      };
    }
    return {
      written: sourcesChanged || sourceStatusChanged,
      versionChanged,
      semanticChanged: false,
      sourcesChanged,
      schedule: previous,
      diff,
      sourceChanges,
    };
  }

  if (output.artifacts)
    await writeScheduleArtifacts(output.artifacts, schedule);
  else await writeFileAtomic(output.json, serializeSchedule(schedule));
  return {
    written: true,
    versionChanged,
    semanticChanged,
    sourcesChanged,
    schedule,
    diff,
    sourceChanges,
  };
};

const parseArgs = (args: string[]): UpdateOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const output = values.get('output');
  const outputDir = values.get('output-dir');
  if (Boolean(output) === Boolean(outputDir))
    throw new Error('Specify exactly one of --output or --output-dir');
  const input = values.get('input');
  const inputDir = values.get('input-dir');
  const url = values.get('url');
  const pageUrl = values.get('page-url');
  const sourceOptionCount = [input, inputDir, url, pageUrl].filter(
    Boolean,
  ).length;
  if (sourceOptionCount !== 1)
    throw new Error(
      'Specify exactly one of --input, --input-dir, --url or --page-url',
    );
  return {
    ...(output ? { output } : {}),
    ...(input ? { input } : {}),
    ...(inputDir ? { inputDir } : {}),
    ...(url ? { url } : {}),
    ...(pageUrl ? { pageUrl } : {}),
    ...(outputDir ? { outputDir } : {}),
    ...(values.get('project-root')
      ? { projectRoot: values.get('project-root')! }
      : {}),
  };
};

/**
 * Формирует компактный вывод CLI, раскрывая детальные изменения пар только по флагу.
 */
export const formatUpdateCliOutput = (
  result: UpdateCliOutput,
  includeLessonChanges: boolean,
): string => {
  const diff = includeLessonChanges
    ? result.diff
    : {
        changed: result.diff.changed,
        addedGroups: result.diff.addedGroups,
        removedGroups: result.diff.removedGroups,
        changedGroups: result.diff.changedGroups,
      };
  return `${JSON.stringify(
    {
      written: result.written,
      versionChanged: result.versionChanged,
      semanticChanged: result.semanticChanged,
      sourcesChanged: result.sourcesChanged,
      groups: Object.keys(result.schedule.groups).length,
      diagnostics: result.schedule.diagnostics.length,
      diff,
      sourceChanges: (result.sourceChanges ?? []).map((source) => ({
        id: source.id,
        fileName: source.fileName,
        beforeSha256: source.beforeSha256,
        afterSha256: source.afterSha256,
        lessonChanges: includeLessonChanges ? source.lessonChanges : undefined,
        changedLessons: source.lessonChanges.length,
      })),
    },
    null,
    2,
  )}\n`;
};

export const runUpdateCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const result = await updateSchedule(parseArgs(args));
  process.stdout.write(
    formatUpdateCliOutput(result, args.includes('--verbose-diff')),
  );
};

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  runUpdateCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
