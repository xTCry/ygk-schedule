import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { preparePagesPublicDirectory } from '../pages/artifacts.ts';

interface BuildPagesOptions {
  dataDirectory: string;
  outputDirectory: string;
  base: string;
}

const projectDirectory = resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
);

const parseArgs = (args: string[]): BuildPagesOptions => {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    const value = args[index + 1];
    if (key?.startsWith('--') && value && !value.startsWith('--')) {
      values.set(key.slice(2), value);
      index += 1;
    }
  }
  const dataDirectory = values.get('data-dir');
  const outputDirectory = values.get('output-dir');
  const base = values.get('base') ?? '/';
  if (!dataDirectory || !outputDirectory)
    throw new Error('Specify --data-dir and --output-dir');
  if (!base.startsWith('/') || !base.endsWith('/'))
    throw new Error('--base must start and end with "/"');
  return {
    dataDirectory: resolve(dataDirectory),
    outputDirectory: resolve(outputDirectory),
    base,
  };
};

/**
 * Собирает статический сайт Pages вместе с snapshot ветки `data`.
 * В публикации нет server-side логики: `/api/` — обычные JSON-файлы.
 */
export const buildPages = async (options: BuildPagesOptions): Promise<void> => {
  const publicDirectory = resolve(
    options.outputDirectory,
    '..',
    'pages-public',
  );
  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  const index = await preparePagesPublicDirectory({
    dataDirectory: options.dataDirectory,
    publicDirectory,
  });
  await build({
    configFile: false,
    root: resolve(projectDirectory, 'pages'),
    base: options.base,
    publicDir: publicDirectory,
    build: {
      outDir: options.outputDirectory,
      emptyOutDir: true,
    },
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        groups: index.groups.length,
        outputDirectory: options.outputDirectory,
        apiBase: `${options.base}api/`,
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
  buildPages(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
