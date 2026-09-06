import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePublicationStatus } from '../generators/publication-status.ts';

const parseOutputDirectory = (args: string[]): string => {
  const index = args.indexOf('--output-dir');
  const outputDirectory = index >= 0 ? args[index + 1] : undefined;
  if (!outputDirectory) throw new Error('Specify --output-dir');
  return resolve(outputDirectory);
};

/**
 * Пересобирает metadata для README badges из уже опубликованных data-файлов.
 *
 * Команда не парсит источники и не обращается к сети: она полезна для
 * начальной миграции или проверки status-артефактов локально.
 */
export const runWritePublicationStatusCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const status = await writePublicationStatus(parseOutputDirectory(args));
  process.stdout.write(
    `${JSON.stringify(
      {
        updatedAt: status.updatedAt,
        scheduleParser: status.schedule.parserVersion,
        replacementsParser: status.replacements?.parserVersion ?? null,
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
  runWritePublicationStatusCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
