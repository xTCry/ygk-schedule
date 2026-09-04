import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DiagnosticIssueDraft } from '../diagnostics/issues.ts';
import {
  GitHubDiagnosticIssuesClient,
  syncDiagnosticIssues,
} from '../github/diagnostic-issues.ts';

interface DiagnosticsReportInput {
  issues: DiagnosticIssueDraft[];
}

interface SyncIssuesOptions {
  diagnostics: string[];
  repository: string;
  token: string;
  maxWriteOperations: number;
  report?: string;
}

const isDiagnosticIssueDraft = (
  value: unknown,
): value is DiagnosticIssueDraft => {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.key === 'string' &&
    typeof draft.fingerprint === 'string' &&
    typeof draft.title === 'string' &&
    typeof draft.body === 'string' &&
    typeof draft.occurrenceCount === 'number'
  );
};

const readDiagnosticsReport = async (
  path: string,
): Promise<DiagnosticsReportInput> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object')
    throw new Error('Diagnostics report must be a JSON object');
  const issues = (value as Record<string, unknown>).issues;
  if (!Array.isArray(issues) || !issues.every(isDiagnosticIssueDraft))
    throw new Error('Diagnostics report has an invalid issues array');
  return { issues };
};

const parseArgs = (args: string[]): SyncIssuesOptions => {
  const diagnostics: string[] = [];
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      if (key === '--diagnostics') diagnostics.push(resolve(value));
      else values.set(key.slice(2), value);
      index += 1;
    }
  }
  const repository = values.get('repo');
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const maxWriteOperations = Number.parseInt(
    values.get('max-writes') ?? '2',
    10,
  );
  if (!diagnostics.length || !repository || !token)
    throw new Error(
      'Specify at least one --diagnostics, --repo and set GITHUB_TOKEN or GH_TOKEN',
    );
  if (!Number.isSafeInteger(maxWriteOperations) || maxWriteOperations < 1)
    throw new Error('--max-writes must be a positive integer');
  return {
    diagnostics,
    repository,
    token,
    maxWriteOperations,
    ...(values.get('report') ? { report: resolve(values.get('report')!) } : {}),
  };
};

/**
 * Синхронизирует Issue по diagnostics report, созданному в ветке data.
 */
export const runSyncIssuesCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const options = parseArgs(args);
  const reports = await Promise.all(
    options.diagnostics.map(readDiagnosticsReport),
  );
  const result = await syncDiagnosticIssues(
    reports.flatMap((report) => report.issues),
    new GitHubDiagnosticIssuesClient(options),
    { maxWriteOperations: options.maxWriteOperations },
  );
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.report) await writeFile(options.report, output);
  process.stdout.write(output);
};

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  runSyncIssuesCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
