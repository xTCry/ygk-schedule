import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEDULE_DIAGNOSTIC_LABEL,
  withDiagnosticIssueLinks,
  type DiagnosticIssueDraft,
} from '../diagnostics/issues.ts';
import {
  GitHubDiagnosticIssuesClient,
  syncDiagnosticIssues,
} from '../github/diagnostic-issues.ts';
import { runGit } from '../workflows/git.ts';
import {
  appendGitHubSummary,
  setGitHubOutput,
} from '../workflows/github-actions.ts';
import { formatIssueSyncSummary } from '../workflows/summary.ts';

interface DiagnosticsReportInput {
  issues: DiagnosticIssueDraft[];
}

interface SyncIssuesOptions {
  diagnostics: string[];
  repository: string;
  token: string;
  maxWriteOperations: number;
  report?: string;
  dataRoot?: string;
  dataRevision?: string;
  parserRevision?: string;
}

const isDiagnosticIssueDraft = (
  value: unknown,
): value is Omit<DiagnosticIssueDraft, 'labels'> & { labels?: unknown } => {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.key === 'string' &&
    typeof draft.fingerprint === 'string' &&
    (draft.scope === undefined ||
      draft.scope === 'base' ||
      draft.scope === 'replacements' ||
      draft.scope === 'actual') &&
    typeof draft.title === 'string' &&
    typeof draft.body === 'string' &&
    typeof draft.occurrenceCount === 'number' &&
    (draft.labels === undefined ||
      (Array.isArray(draft.labels) &&
        draft.labels.every((label) => typeof label === 'string')))
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
  return {
    // Старые reports до schema v4 не содержат labels. Это нужно, чтобы
    // workflow мог синхронно мигрировать data-ветку без ручного шага.
    issues: issues.map((issue) => {
      const labels =
        Array.isArray(issue.labels) && issue.labels.length
          ? [...new Set(issue.labels as string[])].sort((left, right) =>
              left.localeCompare(right),
            )
          : [SCHEDULE_DIAGNOSTIC_LABEL];
      return { ...issue, labels };
    }),
  };
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
  const dataRoot = values.get('output-dir');
  if (!diagnostics.length && dataRoot) {
    diagnostics.push(
      ...[
        'base/90-diagnostics.json',
        'replacements/90-diagnostics.json',
        'actual/90-diagnostics.json',
      ].map((path) => resolve(dataRoot, path)),
    );
  }
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
    ...(dataRoot ? { dataRoot: resolve(dataRoot) } : {}),
    ...(values.get('data-revision')
      ? { dataRevision: values.get('data-revision')! }
      : {}),
    ...(values.get('parser-revision')
      ? { parserRevision: values.get('parser-revision')! }
      : {}),
  };
};

const managedLinksMarker = '<!-- diagnostics-links: ';

const withoutManagedLinks = (body: string): string =>
  body.split(managedLinksMarker, 1)[0]?.trimEnd() ?? body;

/**
 * Если диагностика не изменилась, сохраняет уже опубликованные immutable
 * ссылки. Иначе каждое стороннее обновление data-ветки вызывало бы PATCH всех
 * Issue только из-за нового SHA commit.
 */
const preserveExistingLinks = (
  current: DiagnosticIssueDraft,
  previousBody: string | undefined,
): DiagnosticIssueDraft =>
  previousBody &&
  withoutManagedLinks(previousBody) === withoutManagedLinks(current.body) &&
  previousBody.includes(managedLinksMarker)
    ? { ...current, body: previousBody }
    : current;

const getDataRevision = async (
  options: SyncIssuesOptions,
): Promise<string | undefined> => {
  if (options.dataRevision) return options.dataRevision;
  if (!options.dataRoot) return undefined;
  return runGit(options.dataRoot, ['rev-parse', 'HEAD']);
};

/**
 * Синхронизирует Issue по diagnostics report, созданному в ветке data.
 */
export const runSyncIssuesCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const options = parseArgs(args);
  const reports = await Promise.all(
    options.diagnostics.map(async (diagnosticsPath) => {
      const path = resolve(diagnosticsPath);
      try {
        return await readDiagnosticsReport(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    }),
  );
  const loadedReports = reports.filter(
    (report): report is DiagnosticsReportInput => report !== null,
  );
  if (!loadedReports.length)
    throw new Error(
      'No diagnostics reports were found for Issue synchronization',
    );
  const dataRevision = await getDataRevision(options);
  const parserRevision = options.parserRevision ?? process.env.GITHUB_SHA;
  const drafts = loadedReports
    .flatMap((report) => report.issues)
    .map((issue) =>
      withDiagnosticIssueLinks(issue, {
        repository: options.repository,
        ...(dataRevision ? { dataRevision } : {}),
        ...(parserRevision ? { parserRevision } : {}),
      }),
    );
  const result = await syncDiagnosticIssues(
    drafts,
    new GitHubDiagnosticIssuesClient(options),
    {
      maxWriteOperations: options.maxWriteOperations,
      prepareDraft: (issue, existing) =>
        preserveExistingLinks(issue, existing?.body),
    },
  );
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.report) await writeFile(options.report, output);
  await appendGitHubSummary(formatIssueSyncSummary(drafts.length, result));
  await setGitHubOutput('status', result.deferred ? 'deferred' : 'success');
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
