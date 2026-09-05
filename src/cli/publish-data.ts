import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasStagedChanges, runGit } from '../workflows/git.ts';
import {
  appendGitHubSummary,
  setGitHubOutput,
} from '../workflows/github-actions.ts';
import { formatPublishSummary } from '../workflows/summary.ts';

type PublishKind = 'schedule' | 'replacements';

interface PublishDataOptions {
  outputDir: string;
  kind: PublishKind;
}

const publishTargets: Record<
  PublishKind,
  { directories: string[]; message: string }
> = {
  schedule: {
    directories: ['base', 'ical'],
    message: 'chore(data): update schedule',
  },
  replacements: {
    directories: ['replacements', 'actual', 'ical'],
    message: 'chore(data): update replacements',
  },
};

const parseArgs = (args: string[]): PublishDataOptions => {
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
  const kind = values.get('kind');
  if (!outputDir || (kind !== 'schedule' && kind !== 'replacements'))
    throw new Error('Specify --output-dir and --kind schedule|replacements');
  return { outputDir: resolve(outputDir), kind };
};

/**
 * Публикует только принадлежащие текущему потоку каталоги data-ветки.
 * `base/` никогда не добавляется workflow замен.
 */
export const publishData = async (
  options: PublishDataOptions,
): Promise<{ changed: boolean; files: number; revision: string }> => {
  const target = publishTargets[options.kind];
  await runGit(options.outputDir, ['add', ...target.directories]);
  if (!(await hasStagedChanges(options.outputDir))) {
    const revision = await runGit(options.outputDir, ['rev-parse', 'HEAD']);
    await appendGitHubSummary(
      formatPublishSummary(target.directories, false, 0, revision),
    );
    await setGitHubOutput('status', 'unchanged');
    await setGitHubOutput('data_revision', revision);
    return { changed: false, files: 0, revision };
  }

  const stagedFiles = await runGit(options.outputDir, [
    'diff',
    '--cached',
    '--name-only',
    '--',
    ...target.directories,
  ]);
  const files = stagedFiles ? stagedFiles.split('\n').length : 0;
  await runGit(options.outputDir, [
    'config',
    'user.name',
    'github-actions[bot]',
  ]);
  await runGit(options.outputDir, [
    'config',
    'user.email',
    '41898282+github-actions[bot]@users.noreply.github.com',
  ]);
  await runGit(options.outputDir, ['commit', '-m', target.message]);
  await runGit(options.outputDir, ['push', 'origin', 'HEAD:data']);
  const revision = await runGit(options.outputDir, ['rev-parse', 'HEAD']);
  await appendGitHubSummary(
    formatPublishSummary(target.directories, true, files, revision),
  );
  await setGitHubOutput('status', 'published');
  await setGitHubOutput('data_revision', revision);
  return { changed: true, files, revision };
};

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  publishData(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
