import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDiagnosticsReport } from '../generators/diagnostics.ts';
import {
  updateYgkReplacements,
  type UpdateReplacementsOptions,
  type UpdateReplacementsResult,
} from '../providers/ygk/replacements/update.ts';

const parseArgs = (args: string[]): UpdateReplacementsOptions => {
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

  const firstInput = values.get('first-input');
  const secondInput = values.get('second-input');
  if (Boolean(firstInput) !== Boolean(secondInput))
    throw new Error('Specify both --first-input and --second-input together');

  const firstUrl = values.get('first-url');
  const secondUrl = values.get('second-url');
  if (Boolean(firstUrl) !== Boolean(secondUrl))
    throw new Error('Specify both --first-url and --second-url together');

  return {
    baseSchedule,
    outputDir,
    ...(firstInput ? { firstInput } : {}),
    ...(secondInput ? { secondInput } : {}),
    ...(firstUrl ? { firstUrl } : {}),
    ...(secondUrl ? { secondUrl } : {}),
    ...(values.get('project-root')
      ? { projectRoot: values.get('project-root')! }
      : {}),
  };
};

/**
 * Формирует компактный итог обновления замен для terminal и GitHub Actions.
 */
export const formatUpdateReplacementsCliOutput = (
  result: UpdateReplacementsResult,
): string => {
  const diagnostics = buildDiagnosticsReport(result.actual);
  return `${JSON.stringify(
    {
      written: result.written,
      replacementsChanged: result.replacementsChanged,
      actualChanged: result.actualChanged,
      replacementDates: Object.keys(result.replacements.dates).length,
      replacements: Object.values(result.replacements.dates).reduce(
        (count, date) => count + date.replacements.length,
        0,
      ),
      actualDates: Object.keys(result.actual.dates).length,
      diagnostics: diagnostics.summary,
    },
    null,
    2,
  )}\n`;
};

export const runUpdateReplacementsCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const result = await updateYgkReplacements(parseArgs(args));
  process.stdout.write(formatUpdateReplacementsCliOutput(result));
};

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  runUpdateReplacementsCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
