import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYgkCalendarConfig } from '../calendar/config.ts';
import {
  getIcalArtifactPaths,
  writeIcalArtifacts,
} from '../generators/ical-artifacts.ts';
import type { ActualSchedule, CanonicalSchedule } from '../types.ts';
import { readJsonIfExists } from '../utils/fs.ts';

export interface GenerateIcalOptions {
  baseSchedule: string;
  outputDir: string;
  config?: string;
  actualSchedule?: string;
  group?: string;
}

const parseArgs = (args: string[]): GenerateIcalOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const baseSchedule = values.get('base-schedule');
  const outputDir = values.get('output-dir');
  if (!baseSchedule || !outputDir)
    throw new Error('Specify --base-schedule and --output-dir');
  return {
    baseSchedule,
    outputDir,
    ...(values.get('config') ? { config: values.get('config')! } : {}),
    ...(values.get('actual-schedule')
      ? { actualSchedule: values.get('actual-schedule')! }
      : {}),
    ...(values.get('group') ? { group: values.get('group')! } : {}),
  };
};

/**
 * Создает подписываемые base/actual ICS из опубликованных JSON-артефактов.
 *
 * Время каждой пары определяется по ее аудитории. Опция `--group` ограничивает
 * локальную проверку одной группой, но не меняет правила выбора корпуса.
 */
export const generateIcalArtifacts = async (
  options: GenerateIcalOptions,
): Promise<Awaited<ReturnType<typeof writeIcalArtifacts>>> => {
  const outputDir = resolve(options.outputDir);
  const schedule = await readJsonIfExists<CanonicalSchedule>(
    resolve(options.baseSchedule),
  );
  if (!schedule)
    throw new Error(`Base schedule was not found: ${options.baseSchedule}`);
  const actualPath = resolve(
    options.actualSchedule ?? `${outputDir}/actual/00-schedule.json`,
  );
  const actual = await readJsonIfExists<ActualSchedule>(actualPath);
  const config = await loadYgkCalendarConfig(options.config);

  return writeIcalArtifacts(getIcalArtifactPaths(outputDir), schedule, actual, {
    profiles: config.profiles,
    roomProfiles: config.roomProfiles,
    term: config.term,
    timezone: config.timezone,
    ...(config.publication ? { publication: config.publication } : {}),
    ...(options.group ? { groups: [options.group] } : {}),
  });
};

export const runGenerateIcalCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const result = await generateIcalArtifacts(parseArgs(args));
  process.stdout.write(
    `${JSON.stringify(
      {
        generatedGroups: result.generatedGroups,
        skippedGroups: result.skippedGroups,
        skippedEvents: result.skippedEvents.length,
        files: result.files.length,
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
  runGenerateIcalCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
