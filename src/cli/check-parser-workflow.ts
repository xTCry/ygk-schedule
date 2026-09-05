import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { appendGitHubSummary } from '../workflows/github-actions.ts';
import { formatParserCheckSummary } from '../workflows/summary.ts';

/**
 * Запускает полный набор проверок и записывает краткий итог в Job Summary.
 * Вывод npm остается в логе GitHub Actions без повторения в YAML workflow.
 */
export const checkParserWorkflow = async (): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    const command = spawn('npm', ['run', 'check'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    command.once('error', reject);
    command.once('exit', (code, signal) => {
      if (code === 0) {
        appendGitHubSummary(formatParserCheckSummary())
          .then(resolvePromise)
          .catch(reject);
        return;
      }
      reject(
        new Error(
          `Parser check failed with ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}`,
        ),
      );
    });
  });

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  checkParserWorkflow().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
