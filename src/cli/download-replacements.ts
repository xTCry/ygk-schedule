import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  YGK_REPLACEMENT_FIRST_PAGE_URL,
  YGK_REPLACEMENT_SECOND_PAGE_URL,
} from '../providers/ygk/constants.ts';
import {
  downloadReplacementPage,
  type DownloadedReplacementPage,
} from '../providers/ygk/replacements/download.ts';
import {
  fileExists,
  writeFileAtomic,
  writeFileIfChangedAtomic,
} from '../utils/fs.ts';

export interface DownloadReplacementPagesOptions {
  outputDir: string;
  firstUrl: string;
  secondUrl: string;
}

export interface DownloadReplacementPagesResult {
  outputDir: string;
  pages: {
    shift: DownloadedReplacementPage['source']['shift'];
    archivePath: string;
    archiveChanged: boolean;
    latestPath: string;
    latestChanged: boolean;
    source: DownloadedReplacementPage['source'];
  }[];
}

interface MoscowTimestamp {
  date: string;
  time: string;
}

/**
 * Форматирует время загрузки для локального архива в часовом поясе Ярославля.
 *
 * В имени используется дата фактического получения страницы, а не дата из её
 * заголовка. Например, файл с заменами на завтра, скачанный 11 сентября,
 * должен оставаться снимком `11.09.2026`.
 */
const moscowTimestamp = (now: Date): MoscowTimestamp => {
  const values = new Map(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const day = values.get('day');
  const month = values.get('month');
  const year = values.get('year');
  const hour = values.get('hour');
  const minute = values.get('minute');
  const second = values.get('second');
  if (!day || !month || !year || !hour || !minute || !second)
    throw new Error('Could not format local replacement download timestamp');
  return {
    date: `${day}.${month}.${year}`,
    time: `${hour}-${minute}-${second}`,
  };
};

const archiveBaseName = (
  shift: DownloadedReplacementPage['source']['shift'],
): string => `rasp_${shift}`;

/**
 * Сохраняет не более одного архивного снимка одинакового содержимого.
 *
 * Первая версия за день получает короткое имя с датой. Если сайт вернул
 * изменённую страницу в тот же день, добавляем время загрузки и сохраняем
 * обе версии для ручного сравнения. Стабильный файл `rasp_<shift>.html`
 * обновляется отдельно как вход для `make update-replacements-local`.
 */
const writeReplacementArchive = async (
  outputDir: string,
  page: DownloadedReplacementPage,
  now: Date,
): Promise<{ archivePath: string; archiveChanged: boolean }> => {
  const timestamp = moscowTimestamp(now);
  const baseName = archiveBaseName(page.source.shift);
  const datedPath = join(outputDir, `${baseName}-${timestamp.date}.html`);

  if (!(await fileExists(datedPath))) {
    await writeFileAtomic(datedPath, page.html);
    return { archivePath: datedPath, archiveChanged: true };
  }
  if ((await readFile(datedPath, 'utf8')) === page.html)
    return { archivePath: datedPath, archiveChanged: false };

  for (let suffix = 1; ; suffix += 1) {
    const suffixText =
      suffix === 1 ? timestamp.time : `${timestamp.time}-${suffix}`;
    const archivePath = join(
      outputDir,
      `${baseName}-${timestamp.date}-${suffixText}.html`,
    );
    if (!(await fileExists(archivePath))) {
      await writeFileAtomic(archivePath, page.html);
      return { archivePath, archiveChanged: true };
    }
    if ((await readFile(archivePath, 'utf8')) === page.html)
      return { archivePath, archiveChanged: false };
  }
};

/**
 * Разбирает параметры отдельной команды скачивания raw HTML-страниц замен.
 *
 * По умолчанию результат остаётся в `.tmp/timetable/`: это рабочий снимок
 * для локального разбора и не предназначен для commit в `main`.
 */
export const parseDownloadReplacementPagesArgs = (
  args: string[],
): DownloadReplacementPagesOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  return {
    outputDir: values.get('output-dir') ?? '.tmp/timetable',
    firstUrl: values.get('first-url') ?? YGK_REPLACEMENT_FIRST_PAGE_URL,
    secondUrl: values.get('second-url') ?? YGK_REPLACEMENT_SECOND_PAGE_URL,
  };
};

/**
 * Скачивает обе страницы замен в стабильные локальные пути.
 *
 * В `.tmp/timetable/` остаются как архивные версии с датой загрузки, так и
 * стабильные `rasp_first.html` / `rasp_second.html` для локального parser-а.
 */
export const downloadReplacementPages = async (
  options: DownloadReplacementPagesOptions,
  now = new Date(),
): Promise<DownloadReplacementPagesResult> => {
  const [first, second] = await Promise.all([
    downloadReplacementPage(options.firstUrl, 'first'),
    downloadReplacementPage(options.secondUrl, 'second'),
  ]);
  const pages = await Promise.all(
    [first, second].map(async (page) => {
      const latestPath = join(
        options.outputDir,
        `${archiveBaseName(page.source.shift)}.html`,
      );
      const archive = await writeReplacementArchive(
        options.outputDir,
        page,
        now,
      );
      return {
        shift: page.source.shift,
        ...archive,
        latestPath,
        latestChanged: await writeFileIfChangedAtomic(latestPath, page.html),
        source: page.source,
      };
    }),
  );
  return { outputDir: options.outputDir, pages };
};

/**
 * Формирует компактный результат для ручного локального запуска.
 */
export const formatDownloadReplacementPagesCliOutput = (
  result: DownloadReplacementPagesResult,
): string => `${JSON.stringify(result, null, 2)}\n`;

export const runDownloadReplacementPagesCli = async (
  args = process.argv.slice(2),
): Promise<void> => {
  const result = await downloadReplacementPages(
    parseDownloadReplacementPagesArgs(args),
  );
  process.stdout.write(formatDownloadReplacementPagesCliOutput(result));
};

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect)
  runDownloadReplacementPagesCli().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
