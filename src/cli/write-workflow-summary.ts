import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendGitHubSummary } from '../workflows/github-actions.ts';
import { formatWorkflowStatusSummary } from '../workflows/summary.ts';

interface WorkflowSummaryOptions {
  event: string;
  parserRevision: string;
  check: string;
  update: string;
  ical: string;
  publish: string;
  issues: string;
}

const parseArgs = (args: string[]): WorkflowSummaryOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const required = [
    'event',
    'parser-revision',
    'check',
    'update',
    'ical',
    'publish',
    'issues',
  ] as const;
  for (const key of required) {
    if (!values.get(key)) throw new Error(`Specify --${key}`);
  }
  return {
    event: values.get('event')!,
    parserRevision: values.get('parser-revision')!,
    check: values.get('check')!,
    update: values.get('update')!,
    ical: values.get('ical')!,
    publish: values.get('publish')!,
    issues: values.get('issues')!,
  };
};

/** Записывает итог состояний шагов в единый GitHub Actions Job Summary. */
export const writeWorkflowSummary = async (
  options: WorkflowSummaryOptions,
): Promise<void> => appendGitHubSummary(formatWorkflowStatusSummary(options));

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  writeWorkflowSummary(parseArgs(process.argv.slice(2))).catch(
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
