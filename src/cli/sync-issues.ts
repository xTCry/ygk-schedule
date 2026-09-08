import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCHEDULE_DIAGNOSTIC_LABEL,
  withDiagnosticIssueLinks,
  type DiagnosticIssueDraft,
  type DiagnosticsScope,
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
  scope: DiagnosticsScope;
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
  sourceArchiveUrlTemplate?: string;
  currentDate: string;
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

const isDiagnosticsScope = (value: unknown): value is DiagnosticsScope =>
  value === 'base' || value === 'replacements' || value === 'actual';

const scopeFromDiagnosticsPath = (path: string): DiagnosticsScope => {
  const scope = basename(dirname(path));
  if (!isDiagnosticsScope(scope))
    throw new Error(`Cannot infer diagnostics scope from path: ${path}`);
  return scope;
};

const issueObservedDate = (
  issue: Record<string, unknown>,
): string | undefined =>
  typeof issue.observedDate === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/u.test(issue.observedDate)
    ? issue.observedDate
    : undefined;

const readDiagnosticsReport = async (
  path: string,
): Promise<DiagnosticsReportInput> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!value || typeof value !== 'object')
    throw new Error('Diagnostics report must be a JSON object');
  const report = value as Record<string, unknown>;
  const issues = report.issues;
  if (!Array.isArray(issues) || !issues.every(isDiagnosticIssueDraft))
    throw new Error('Diagnostics report has an invalid issues array');
  return {
    scope: isDiagnosticsScope(report.scope)
      ? report.scope
      : scopeFromDiagnosticsPath(path),
    // Старые reports до schema v4 не содержат labels. Это нужно, чтобы
    // workflow мог синхронно мигрировать data-ветку без ручного шага.
    issues: issues.map((rawIssue) => {
      const issue = rawIssue as Record<string, unknown>;
      const labels =
        Array.isArray(issue.labels) && issue.labels.length
          ? [...new Set(issue.labels as string[])].sort((left, right) =>
              left.localeCompare(right),
            )
          : [SCHEDULE_DIAGNOSTIC_LABEL];
      const observedDate = issueObservedDate(issue);
      const lifecycle =
        issue.lifecycle === 'dated' || observedDate ? 'dated' : 'persistent';
      const observationKeys = Array.isArray(issue.observationKeys)
        ? [
            ...new Set(
              issue.observationKeys.filter(
                (key): key is string =>
                  typeof key === 'string' && /^[a-f0-9]{64}$/u.test(key),
              ),
            ),
          ].sort((left, right) => left.localeCompare(right))
        : [];
      return {
        ...issue,
        familyKey:
          typeof issue.familyKey === 'string' &&
          /^[a-f0-9]{64}$/u.test(issue.familyKey)
            ? issue.familyKey
            : issue.key,
        lifecycle,
        ...(lifecycle === 'dated' && observedDate ? { observedDate } : {}),
        observationKeys,
        labels,
      } as DiagnosticIssueDraft;
    }),
  };
};

const moscowDate = (): string => {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

/**
 * Проверяет шаблон внешнего архива исходных XLSX/HTML. URL нужен только для
 * ссылок в Issue, поэтому относительные пути и шаблоны без source SHA не
 * принимаются: они не позволят открыть конкретную версию источника.
 */
const sourceArchiveUrlTemplate = (
  value: string | undefined,
): string | undefined => {
  if (!value) return undefined;
  if (!value.includes('{sha256}'))
    throw new Error(
      '--source-archive-url-template must include the {sha256} placeholder',
    );
  const example = value
    .replaceAll('{sha256}', 'a'.repeat(64))
    .replaceAll('{fileName}', 'source.xlsx');
  try {
    const url = new URL(example);
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new Error('Unsupported protocol');
  } catch {
    throw new Error(
      '--source-archive-url-template must resolve to an absolute HTTP(S) URL',
    );
  }
  return value;
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
  const sourceArchiveTemplate = sourceArchiveUrlTemplate(
    values.get('source-archive-url-template'),
  );
  const currentDate = values.get('current-date') ?? moscowDate();
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
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(currentDate))
    throw new Error('--current-date must have the YYYY-MM-DD format');
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
    ...(sourceArchiveTemplate
      ? { sourceArchiveUrlTemplate: sourceArchiveTemplate }
      : {}),
    currentDate,
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
 * Читает только имена опубликованных raw-источников. Это защищает Issue от
 * ссылок на XLSX, которые ещё не были опубликованы текущей data-веткой.
 */
const availableRawSourcePaths = async (
  dataRoot: string | undefined,
): Promise<Set<string> | undefined> => {
  if (!dataRoot) return undefined;
  const result = new Set<string>();
  await Promise.all(
    (['replacements', 'schedule'] as const).map(async (kind) => {
      try {
        const entries = await readdir(resolve(dataRoot, 'sources', kind), {
          withFileTypes: true,
        });
        for (const entry of entries)
          if (entry.isFile()) result.add(`sources/${kind}/${entry.name}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  );
  return result;
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
  const rawSourcePaths = await availableRawSourcePaths(options.dataRoot);
  const parserRevision = options.parserRevision ?? process.env.GITHUB_SHA;
  const drafts = loadedReports
    .flatMap((report) => report.issues)
    .filter(
      (issue) =>
        issue.lifecycle !== 'dated' ||
        !issue.observedDate ||
        issue.observedDate >= options.currentDate,
    )
    .map((issue) =>
      withDiagnosticIssueLinks(issue, {
        repository: options.repository,
        ...(dataRevision ? { dataRevision } : {}),
        ...(parserRevision ? { parserRevision } : {}),
        ...(options.sourceArchiveUrlTemplate
          ? { sourceArchiveUrlTemplate: options.sourceArchiveUrlTemplate }
          : {}),
        ...(rawSourcePaths ? { availableRawSourcePaths: rawSourcePaths } : {}),
      }),
    );
  const result = await syncDiagnosticIssues(
    drafts,
    new GitHubDiagnosticIssuesClient(options),
    {
      maxWriteOperations: options.maxWriteOperations,
      scopes: loadedReports.map((report) => report.scope),
      currentDate: options.currentDate,
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
