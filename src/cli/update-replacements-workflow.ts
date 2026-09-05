import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcalArtifacts } from './generate-ical.ts';
import { updateYgkReplacements } from '../providers/ygk/replacements/update.ts';
import type { DiagnosticsReport } from '../generators/diagnostics.ts';
import type { ActualSchedule, CanonicalReplacements } from '../types.ts';
import { readJsonIfExists } from '../utils/fs.ts';
import { runGit } from '../workflows/git.ts';
import {
  appendGitHubSummary,
  setGitHubOutput,
} from '../workflows/github-actions.ts';
import { formatReplacementsUpdateSummary } from '../workflows/summary.ts';

interface UpdateReplacementsWorkflowOptions {
  outputDir: string;
  baseSchedule: string;
  firstUrl: string;
  secondUrl: string;
  projectRoot?: string;
  calendarConfig?: string;
  baseDataRevision?: string;
}

const parseArgs = (args: string[]): UpdateReplacementsWorkflowOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const outputDir = values.get('output-dir');
  const baseSchedule = values.get('base-schedule');
  const firstUrl = values.get('first-url');
  const secondUrl = values.get('second-url');
  if (!outputDir || !baseSchedule || !firstUrl || !secondUrl)
    throw new Error(
      'Specify --output-dir, --base-schedule, --first-url and --second-url',
    );
  return {
    outputDir: resolve(outputDir),
    baseSchedule: resolve(baseSchedule),
    firstUrl,
    secondUrl,
    ...(values.get('project-root')
      ? { projectRoot: resolve(values.get('project-root')!) }
      : {}),
    ...(values.get('calendar-config')
      ? { calendarConfig: resolve(values.get('calendar-config')!) }
      : {}),
    ...(values.get('base-data-revision')
      ? { baseDataRevision: values.get('base-data-revision')! }
      : {}),
  };
};

/**
 * Обновляет HTML-замены, actual-расписание и связанные ICS в одном шаге
 * workflow, сохраняя базовый commit как provenance финализированных дат.
 */
export const updateReplacementsWorkflow = async (
  options: UpdateReplacementsWorkflowOptions,
): Promise<void> => {
  const baseDataRevision =
    options.baseDataRevision ??
    (await runGit(options.outputDir, ['rev-parse', 'HEAD']));
  const result = await updateYgkReplacements({
    baseSchedule: options.baseSchedule,
    outputDir: options.outputDir,
    firstUrl: options.firstUrl,
    secondUrl: options.secondUrl,
    baseDataRevision,
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
  });
  const ical = await generateIcalArtifacts({
    baseSchedule: options.baseSchedule,
    outputDir: options.outputDir,
    ...(options.calendarConfig ? { config: options.calendarConfig } : {}),
  });
  const replacements = await readJsonIfExists<CanonicalReplacements>(
    resolve(options.outputDir, 'replacements/00-replacements.json'),
  );
  const actual = await readJsonIfExists<ActualSchedule>(
    resolve(options.outputDir, 'actual/00-schedule.json'),
  );
  const diagnostics = await readJsonIfExists<DiagnosticsReport>(
    resolve(options.outputDir, 'actual/90-diagnostics.json'),
  );
  if (!replacements || !actual || !diagnostics)
    throw new Error('Replacement artifacts were not generated');

  const changed = result.replacementsChanged || result.actualChanged;
  await appendGitHubSummary(
    formatReplacementsUpdateSummary(replacements, actual, diagnostics, changed),
  );
  await setGitHubOutput('data_changed', String(changed));
  await setGitHubOutput('ical_files', String(ical.files.length));
  process.stdout.write(
    `${JSON.stringify(
      {
        replacementsChanged: result.replacementsChanged,
        actualChanged: result.actualChanged,
        generatedIcalFiles: ical.files.length,
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
  updateReplacementsWorkflow(parseArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
