import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSchedules, semanticScheduleHash } from '../compare/schedule.ts';
import type { ScheduleDiff } from '../compare/schedule.ts';
import { hasFatalDiagnostics } from '../diagnostics/index.ts';
import {
  getScheduleArtifactFiles,
  getScheduleArtifactPaths,
  writeScheduleArtifacts,
} from '../generators/artifacts.ts';
import type { ScheduleArtifactPaths } from '../generators/artifacts.ts';
import { serializeSchedule } from '../generators/json.ts';
import { aggregateYgkSchedules } from '../providers/ygk/schedule/aggregate.ts';
import { discoverScheduleFiles } from '../providers/ygk/schedule/discover.ts';
import { downloadScheduleFile } from '../providers/ygk/schedule/download.ts';
import { parseYgkSchedule } from '../providers/ygk/schedule/parse.ts';
import type { CanonicalSchedule, ScheduleSource } from '../types.ts';
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
  schedule: CanonicalSchedule;
  diff: ReturnType<typeof compareSchedules>;
}

export interface UpdateCliOutput {
  written: boolean;
  versionChanged: boolean;
  semanticChanged: boolean;
  schedule: Pick<CanonicalSchedule, 'groups' | 'diagnostics'>;
  diff: ScheduleDiff;
}

interface LoadedScheduleSource {
  buffer: Buffer;
  source: ScheduleSource;
}

interface OutputTarget {
  json: string;
  artifacts?: ScheduleArtifactPaths;
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

const loadSources = async (
  options: UpdateOptions,
): Promise<LoadedScheduleSource[]> => {
  const sourceOptionCount = [
    options.input,
    options.url,
    options.pageUrl,
  ].filter(Boolean).length;
  if (sourceOptionCount !== 1)
    throw new Error('Specify exactly one of input, url or pageUrl');

  if (options.url) {
    const downloaded = await downloadScheduleFile(options.url);
    return [
      {
        buffer: downloaded.buffer,
        source: {
          id: sourceIdFromUrl(options.url),
          fileName: downloaded.fileName,
          sha256: downloaded.sha256,
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

  const input = resolve(options.input!);
  const buffer = await readFile(input);
  const fileName = basename(input);
  return [
    {
      buffer,
      source: { id: fileName, fileName, sha256: sha256(buffer) },
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
      written: false,
      versionChanged: false,
      semanticChanged: false,
      schedule: previous,
      diff,
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

  if (hasFatalDiagnostics(schedule.diagnostics)) {
    return {
      written: false,
      versionChanged,
      semanticChanged: diff.changed,
      schedule,
      diff,
    };
  }

  if (output.artifacts)
    await writeScheduleArtifacts(output.artifacts, schedule);
  else await writeFileAtomic(output.json, serializeSchedule(schedule));
  return {
    written: true,
    versionChanged,
    semanticChanged: diff.changed,
    schedule,
    diff,
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
  const url = values.get('url');
  const pageUrl = values.get('page-url');
  const sourceOptionCount = [input, url, pageUrl].filter(Boolean).length;
  if (sourceOptionCount !== 1)
    throw new Error('Specify exactly one of --input, --url or --page-url');
  return {
    ...(output ? { output } : {}),
    ...(input ? { input } : {}),
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
      groups: Object.keys(result.schedule.groups).length,
      diagnostics: result.schedule.diagnostics.length,
      diff,
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
