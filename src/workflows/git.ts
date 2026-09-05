import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Выполняет ограниченную Git-команду в worktree generated data и возвращает
 * stdout без завершающего перевода строки.
 */
export const runGit = async (
  workingDirectory: string,
  args: readonly string[],
): Promise<string> => {
  const result = await execFileAsync('git', [...args], {
    cwd: workingDirectory,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
};

/**
 * Проверяет наличие staged-изменений без разбора текстового Git diff.
 */
export const hasStagedChanges = async (
  workingDirectory: string,
): Promise<boolean> => {
  try {
    await runGit(workingDirectory, ['diff', '--cached', '--quiet']);
    return false;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) return true;
    throw error;
  }
};
