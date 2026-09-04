import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { semanticScheduleHash } from '../compare/schedule.ts';
import {
  getScheduleArtifactPaths,
  writeScheduleArtifacts,
} from '../generators/artifacts.ts';
import type { CanonicalSchedule } from '../types.ts';
import {
  buildScheduleVersion,
  calculateProjectHashes,
  calculateSourceSetHash,
  SCHEMA_VERSION,
} from '../version.ts';

export interface RegenerateArtifactsOptions {
  input: string;
  outputDir: string;
  projectRoot?: string;
}

/**
 * Пересобирает JSON/YAML-артефакты из уже опубликованного полного расписания.
 *
 * Команда не обращается к сети и не читает XLSX. Она нужна для миграции
 * структуры generated-файлов после изменения сериализаторов.
 */
export const regenerateScheduleArtifacts = async (
  options: RegenerateArtifactsOptions,
): Promise<CanonicalSchedule> => {
  const input = resolve(options.input);
  const outputDirectory = resolve(options.outputDir);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const previous = JSON.parse(
    await readFile(input, 'utf8'),
  ) as CanonicalSchedule;
  const { parserHash, configHash } = await calculateProjectHashes(projectRoot);
  const schedule: CanonicalSchedule = {
    ...previous,
    schemaVersion: SCHEMA_VERSION,
    version: buildScheduleVersion({
      sourceSetHash: calculateSourceSetHash(previous.sources),
      parserHash,
      configHash,
    }),
    semanticHash: semanticScheduleHash(previous.groups),
  };

  await writeScheduleArtifacts(
    getScheduleArtifactPaths(outputDirectory),
    schedule,
  );
  return schedule;
};

const parseArgs = (args: string[]): RegenerateArtifactsOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const input = values.get('input');
  const outputDir = values.get('output-dir');
  if (!input || !outputDir)
    throw new Error('Specify both --input and --output-dir');
  return {
    input,
    outputDir,
    ...(values.get('project-root')
      ? { projectRoot: values.get('project-root')! }
      : {}),
  };
};

export const runRegenerateArtifactsCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const schedule = await regenerateScheduleArtifacts(parseArgs(args));
  process.stdout.write(
    `${JSON.stringify(
      {
        written: true,
        schemaVersion: schedule.schemaVersion,
        groups: Object.keys(schedule.groups).length,
        version: schedule.version.value,
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
  runRegenerateArtifactsCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
