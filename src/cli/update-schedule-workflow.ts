import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateIcalArtifacts } from './generate-ical.ts';
import { updateSchedule } from './update.ts';
import type { CanonicalSchedule } from '../types.ts';
import { readJsonIfExists } from '../utils/fs.ts';
import type { DiagnosticsReport } from '../generators/diagnostics.ts';
import {
  appendGitHubSummary,
  setGitHubOutput,
} from '../workflows/github-actions.ts';
import { formatScheduleUpdateSummary } from '../workflows/summary.ts';

interface UpdateScheduleWorkflowOptions {
  outputDir: string;
  pageUrl: string;
  projectRoot?: string;
  calendarConfig?: string;
}

const parseArgs = (args: string[]): UpdateScheduleWorkflowOptions => {
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
  const pageUrl = values.get('page-url');
  if (!outputDir || !pageUrl)
    throw new Error('Specify --output-dir and --page-url');
  return {
    outputDir: resolve(outputDir),
    pageUrl,
    ...(values.get('project-root')
      ? { projectRoot: resolve(values.get('project-root')!) }
      : {}),
    ...(values.get('calendar-config')
      ? { calendarConfig: resolve(values.get('calendar-config')!) }
      : {}),
  };
};

/**
 * Выполняет обновление base и пересборку ICS как одну предметную операцию
 * workflow. Git commit намеренно остается отдельным явным шагом публикации.
 */
export const updateScheduleWorkflow = async (
  options: UpdateScheduleWorkflowOptions,
): Promise<void> => {
  const result = await updateSchedule({
    pageUrl: options.pageUrl,
    outputDir: options.outputDir,
    ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
  });
  const ical = await generateIcalArtifacts({
    baseSchedule: resolve(options.outputDir, 'base/00-schedule.json'),
    outputDir: options.outputDir,
    ...(options.calendarConfig ? { config: options.calendarConfig } : {}),
  });
  const schedule = await readJsonIfExists<CanonicalSchedule>(
    resolve(options.outputDir, 'base/00-schedule.json'),
  );
  const diagnostics = await readJsonIfExists<DiagnosticsReport>(
    resolve(options.outputDir, 'base/90-diagnostics.json'),
  );
  if (!schedule || !diagnostics)
    throw new Error('Base schedule artifacts were not generated');

  await appendGitHubSummary(
    formatScheduleUpdateSummary(schedule, diagnostics, result.written),
  );
  await setGitHubOutput('data_changed', String(result.written));
  await setGitHubOutput('ical_files', String(ical.files.length));
  process.stdout.write(
    `${JSON.stringify(
      {
        written: result.written,
        groups: Object.keys(schedule.groups).length,
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
  updateScheduleWorkflow(parseArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
