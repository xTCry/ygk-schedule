import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildDiagnosticsReport } from '../../../generators/diagnostics.ts';
import {
  getReplacementArtifactFiles,
  getReplacementArtifactPaths,
  writeReplacementArtifacts,
} from '../../../generators/replacements.ts';
import type {
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
  Diagnostic,
  ReplacementPageSource,
  ReplacementShift,
} from '../../../types.ts';
import { fileExists, readJsonIfExists } from '../../../utils/fs.ts';
import { sha256 } from '../../../utils/hash.ts';
import {
  SCHEMA_VERSION,
  buildScheduleVersion,
  calculateProjectHashes,
  calculateSourceSetHash,
} from '../../../version.ts';
import {
  YGK_REPLACEMENT_FIRST_PAGE_URL,
  YGK_REPLACEMENT_SECOND_PAGE_URL,
} from '../constants.ts';
import { downloadReplacementPage } from './download.ts';
import { parseYgkReplacements } from './parse.ts';
import { buildActualSchedule, semanticReplacementHash } from './resolve.ts';

export interface UpdateReplacementsOptions {
  baseSchedule: string;
  outputDir: string;
  firstInput?: string;
  secondInput?: string;
  firstUrl?: string;
  secondUrl?: string;
  projectRoot?: string;
}

export interface UpdateReplacementsResult {
  written: boolean;
  replacementsChanged: boolean;
  actualChanged: boolean;
  replacements: CanonicalReplacements;
  actual: ActualSchedule;
}

interface LoadedReplacementPage {
  html: string;
  source: ReplacementPageSource;
}

const readLocalPage = async (
  input: string,
  shift: ReplacementShift,
): Promise<LoadedReplacementPage> => {
  const path = resolve(input);
  const html = await readFile(path, 'utf8');
  return {
    html,
    source: {
      id: basename(path),
      fileName: basename(path),
      sha256: sha256(html),
      fetchedAt: new Date().toISOString(),
      shift,
    },
  };
};

const loadPages = async (
  options: UpdateReplacementsOptions,
): Promise<LoadedReplacementPage[]> => {
  const hasFirstInput = Boolean(options.firstInput);
  const hasSecondInput = Boolean(options.secondInput);
  if (hasFirstInput !== hasSecondInput)
    throw new Error('Specify both firstInput and secondInput together');

  if (options.firstInput && options.secondInput) {
    return Promise.all([
      readLocalPage(options.firstInput, 'first'),
      readLocalPage(options.secondInput, 'second'),
    ]);
  }

  return Promise.all([
    downloadReplacementPage(
      options.firstUrl ?? YGK_REPLACEMENT_FIRST_PAGE_URL,
      'first',
    ),
    downloadReplacementPage(
      options.secondUrl ?? YGK_REPLACEMENT_SECOND_PAGE_URL,
      'second',
    ),
  ]);
};

const withSource = (
  diagnostics: readonly Diagnostic[],
  source: ReplacementPageSource,
): Diagnostic[] =>
  diagnostics.map((diagnostic) => ({
    ...diagnostic,
    sourceId: source.id,
    ...(source.url ? { sourceUrl: source.url } : {}),
  }));

const buildCanonicalReplacements = (
  pages: readonly LoadedReplacementPage[],
  parserHash: string,
  configHash: string,
): CanonicalReplacements => {
  const diagnostics: Diagnostic[] = [];
  const dates = new Map<string, CanonicalReplacements['dates'][string]>();

  for (const page of pages) {
    const parsed = parseYgkReplacements(page.html, page.source.shift);
    diagnostics.push(...withSource(parsed.diagnostics, page.source));
    if (!parsed.date || !parsed.day) continue;

    const current = dates.get(parsed.date);
    if (!current) {
      dates.set(parsed.date, {
        date: parsed.date,
        day: parsed.day,
        weekType: parsed.weekType,
        replacements: [...parsed.replacements],
      });
      continue;
    }

    if (current.day !== parsed.day || current.weekType !== parsed.weekType) {
      diagnostics.push(
        ...withSource(
          [
            {
              provider: 'ygk',
              code: 'UNKNOWN_REPLACEMENT_LAYOUT',
              severity: 'error',
              message:
                'Страницы замен содержат несовместимые дату, день недели или тип недели',
              fingerprint: sha256(
                [
                  'ygk',
                  'UNKNOWN_REPLACEMENT_LAYOUT',
                  parsed.date,
                  current.day,
                  parsed.day,
                  current.weekType,
                  parsed.weekType,
                ].join('\0'),
              ),
              rawValue: `${current.day} / ${current.weekType}; ${parsed.day} / ${parsed.weekType}`,
            },
          ],
          page.source,
        ),
      );
      continue;
    }
    current.replacements.push(...parsed.replacements);
  }

  const replacements: CanonicalReplacements = {
    schemaVersion: SCHEMA_VERSION,
    provider: 'ygk',
    generatedAt: new Date().toISOString(),
    sources: pages
      .map((page) => page.source)
      .sort((left, right) => left.id.localeCompare(right.id)),
    version: buildScheduleVersion({
      sourceSetHash: calculateSourceSetHash(pages.map((page) => page.source)),
      parserHash,
      configHash,
    }),
    dates: Object.fromEntries(
      [...dates.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    diagnostics,
    semanticHash: '',
  };
  replacements.semanticHash = semanticReplacementHash(replacements);
  return replacements;
};

const allArtifactsExist = async (paths: readonly string[]): Promise<boolean> =>
  (await Promise.all(paths.map((path) => fileExists(path)))).every(Boolean);

/**
 * Загружает обе страницы замен, записывает raw JSON/YAML и строит actual data.
 *
 * Базовые файлы `base/` никогда не перезаписываются: результат наложения
 * замен публикуется только в отдельной директории `actual/`.
 */
export const updateYgkReplacements = async (
  options: UpdateReplacementsOptions,
): Promise<UpdateReplacementsResult> => {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const artifactPaths = getReplacementArtifactPaths(options.outputDir);
  const baseSchedule = await readJsonIfExists<CanonicalSchedule>(
    resolve(options.baseSchedule),
  );
  if (!baseSchedule)
    throw new Error(`Base schedule was not found: ${options.baseSchedule}`);

  const previousReplacements = await readJsonIfExists<CanonicalReplacements>(
    artifactPaths.replacementsJson,
  );
  const pages = await loadPages(options);
  const { parserHash, configHash } = await calculateProjectHashes(projectRoot);
  const nextReplacements = buildCanonicalReplacements(
    pages,
    parserHash,
    configHash,
  );
  const replacements =
    previousReplacements?.version.value === nextReplacements.version.value
      ? previousReplacements
      : nextReplacements;
  const replacementsChanged =
    previousReplacements?.version.value !== replacements.version.value;
  const actual = buildActualSchedule(
    baseSchedule,
    replacements,
    parserHash,
    configHash,
  );
  const previousActual = await readJsonIfExists<ActualSchedule>(
    artifactPaths.actualJson,
  );
  const actualChanged = previousActual?.version.value !== actual.version.value;
  const artifactFiles = getReplacementArtifactFiles(
    artifactPaths,
    replacements,
    actual,
  );
  const artifactsExist = await allArtifactsExist(artifactFiles);

  if (!replacementsChanged && !actualChanged && artifactsExist) {
    return {
      written: false,
      replacementsChanged: false,
      actualChanged: false,
      replacements,
      actual: previousActual ?? actual,
    };
  }

  await writeReplacementArtifacts(artifactPaths, replacements, actual);
  return {
    written: true,
    replacementsChanged,
    actualChanged,
    replacements,
    actual,
  };
};

/**
 * Формирует компактный diagnostics report для CLI и workflow.
 */
export const replacementDiagnosticsReport = (
  result: UpdateReplacementsResult,
): ReturnType<typeof buildDiagnosticsReport> =>
  buildDiagnosticsReport(result.actual);
