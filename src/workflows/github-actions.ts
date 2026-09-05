import { appendFile } from 'node:fs/promises';

/**
 * Добавляет Markdown к Job Summary, если команда выполняется внутри GitHub
 * Actions. При локальном запуске функция намеренно ничего не пишет.
 */
export const appendGitHubSummary = async (markdown: string): Promise<void> => {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  await appendFile(path, `${markdown.trim()}\n\n`);
};

/**
 * Передает короткое значение следующему шагу GitHub Actions. Локальный запуск
 * не требует эмуляции служебных env-файлов и остается безопасным.
 */
export const setGitHubOutput = async (
  name: string,
  value: string,
): Promise<void> => {
  const path = process.env.GITHUB_OUTPUT;
  if (!path) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
    throw new Error(`Invalid GitHub Actions output name: ${name}`);
  if (value.includes('\n') || value.includes('\r'))
    throw new Error(`GitHub Actions output ${name} must be a single line`);
  await appendFile(path, `${name}=${value}\n`);
};
