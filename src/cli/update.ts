import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSchedules, semanticScheduleHash } from '../compare/schedule.ts';
import { hasFatalDiagnostics } from '../diagnostics/index.ts';
import { serializeSchedule } from '../generators/json.ts';
import { parseYgkSchedule } from '../providers/ygk/schedule/parse.ts';
import { downloadScheduleFile } from '../providers/ygk/schedule/download.ts';
import type { CanonicalSchedule, ScheduleSource } from '../types.ts';
import { readJsonIfExists, writeFileAtomic } from '../utils/fs.ts';
import { sha256 } from '../utils/hash.ts';
import {
  buildScheduleVersion,
  calculateProjectHashes,
  SCHEMA_VERSION,
} from '../version.ts';

export interface UpdateOptions {
  input?: string;
  url?: string;
  output: string;
  projectRoot?: string;
}

export interface UpdateResult {
  written: boolean;
  versionChanged: boolean;
  semanticChanged: boolean;
  schedule: CanonicalSchedule;
  diff: ReturnType<typeof compareSchedules>;
}

const loadSource = async (
  options: UpdateOptions,
): Promise<{ buffer: Buffer; source: ScheduleSource }> => {
  if (options.url) {
    const downloaded = await downloadScheduleFile(options.url);
    return {
      buffer: downloaded.buffer,
      source: {
        fileName: downloaded.fileName,
        sha256: downloaded.sha256,
        url: downloaded.url,
        ...(downloaded.etag ? { etag: downloaded.etag } : {}),
        ...(downloaded.lastModified
          ? { lastModified: downloaded.lastModified }
          : {}),
      },
    };
  }

  if (!options.input) throw new Error('Either input or url must be provided');
  const input = resolve(options.input);
  const buffer = await readFile(input);
  return {
    buffer,
    source: { fileName: basename(input), sha256: sha256(buffer) },
  };
};

export const updateSchedule = async (
  options: UpdateOptions,
): Promise<UpdateResult> => {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const output = resolve(options.output);
  const previous = await readJsonIfExists<CanonicalSchedule>(output);
  const { buffer, source } = await loadSource(options);
  const { parserHash, configHash } = await calculateProjectHashes(projectRoot);
  const version = buildScheduleVersion({
    sourceHash: source.sha256,
    parserHash,
    configHash,
  });
  const versionChanged = previous?.version.value !== version.value;

  if (!versionChanged && previous) {
    const diff = compareSchedules(previous, previous);
    return {
      written: false,
      versionChanged: false,
      semanticChanged: false,
      schedule: previous,
      diff,
    };
  }

  const parsed = await parseYgkSchedule(buffer);
  const semanticHash = semanticScheduleHash(parsed.groups);
  const schedule: CanonicalSchedule = {
    schemaVersion: SCHEMA_VERSION,
    provider: 'ygk',
    generatedAt: new Date().toISOString(),
    source,
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

  await writeFileAtomic(output, serializeSchedule(schedule));
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
  if (!output) throw new Error('Missing --output');
  const input = values.get('input');
  const url = values.get('url');
  if (!input && !url) throw new Error('Missing --input or --url');
  return {
    output,
    ...(input ? { input } : {}),
    ...(url ? { url } : {}),
    ...(values.get('project-root')
      ? { projectRoot: values.get('project-root')! }
      : {}),
  };
};

export const runUpdateCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const result = await updateSchedule(parseArgs(args));
  process.stdout.write(
    `${JSON.stringify(
      {
        written: result.written,
        versionChanged: result.versionChanged,
        semanticChanged: result.semanticChanged,
        groups: Object.keys(result.schedule.groups).length,
        diagnostics: result.schedule.diagnostics.length,
        diff: result.diff,
      },
      null,
      2,
    )}\n`,
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
