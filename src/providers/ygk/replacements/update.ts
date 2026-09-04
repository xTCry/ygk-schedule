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
  ReplacementPageSource,
  ReplacementSnapshot,
  ReplacementShift,
} from '../../../types.ts';
import { fileExists, readJsonIfExists } from '../../../utils/fs.ts';
import { sha256 } from '../../../utils/hash.ts';
import {
  SCHEMA_VERSION,
  buildScheduleVersion,
  calculateReplacementProjectHashes,
  calculateSourceSetHash,
} from '../../../version.ts';
import {
  YGK_REPLACEMENT_FIRST_PAGE_URL,
  YGK_REPLACEMENT_SECOND_PAGE_URL,
} from '../constants.ts';
import { loadYgkReplacementAliases } from './config.ts';
import { downloadReplacementPage } from './download.ts';
import { mergeReplacementHistory } from './history.ts';
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
  /**
   * SHA commit ветки `data`, из которой прочитан базовый артефакт.
   * Локальная работа может не передавать Git provenance.
   */
  baseDataRevision?: string;
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

const buildCanonicalReplacements = (
  previous: CanonicalReplacements | null,
  pages: readonly LoadedReplacementPage[],
  parserHash: string,
  configHash: string,
): CanonicalReplacements => {
  const history = mergeReplacementHistory(
    previous,
    pages.map((page) => ({
      parsed: parseYgkReplacements(page.html, page.source.shift),
      source: page.source,
    })),
  );
  const sources = Object.values(history.dates)
    .flatMap((date) => Object.values(date.shifts ?? {}))
    .filter((snapshot): snapshot is ReplacementSnapshot => Boolean(snapshot))
    .map((snapshot) => snapshot.source)
    .sort((left, right) =>
      `${left.shift}\0${left.id}\0${left.sha256}`.localeCompare(
        `${right.shift}\0${right.id}\0${right.sha256}`,
      ),
    );

  const replacements: CanonicalReplacements = {
    schemaVersion: SCHEMA_VERSION,
    provider: 'ygk',
    generatedAt: new Date().toISOString(),
    sources,
    version: buildScheduleVersion({
      sourceSetHash: calculateSourceSetHash(sources),
      parserHash,
      configHash,
    }),
    dates: history.dates,
    diagnostics: history.diagnostics,
    semanticHash: '',
  };
  replacements.semanticHash = semanticReplacementHash(replacements);
  return replacements;
};

const allArtifactsExist = async (paths: readonly string[]): Promise<boolean> =>
  (await Promise.all(paths.map((path) => fileExists(path)))).every(Boolean);

/**
 * Старые generated YAML могли содержать aliases, зависящие от общих ссылок в
 * памяти. Один раз пересобираем такие артефакты новым стабильным serializer-ом.
 */
const hasGeneratedYamlAliases = async (path: string): Promise<boolean> =>
  /(^|\s)[&*]a\d+\b/mu.test(await readFile(path, 'utf8'));

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
  const { parserHash, configHash } =
    await calculateReplacementProjectHashes(projectRoot);
  const aliases = await loadYgkReplacementAliases(projectRoot);
  const nextReplacements = buildCanonicalReplacements(
    previousReplacements,
    pages,
    parserHash,
    configHash,
  );
  const replacements =
    previousReplacements &&
    previousReplacements.schemaVersion === nextReplacements.schemaVersion &&
    previousReplacements.semanticHash === nextReplacements.semanticHash
      ? previousReplacements
      : nextReplacements;
  const replacementsChanged = previousReplacements !== replacements;
  const previousActual = await readJsonIfExists<ActualSchedule>(
    artifactPaths.actualJson,
  );
  const actual = buildActualSchedule(
    baseSchedule,
    replacements,
    parserHash,
    configHash,
    aliases,
    {
      previousActual,
      ...(options.baseDataRevision
        ? { baseDataRevision: options.baseDataRevision }
        : {}),
    },
  );
  const actualChanged =
    previousActual?.schemaVersion !== actual.schemaVersion ||
    previousActual?.semanticHash !== actual.semanticHash;
  const artifactFiles = getReplacementArtifactFiles(
    artifactPaths,
    replacements,
    actual,
  );
  const artifactsExist =
    (await allArtifactsExist(artifactFiles)) &&
    !(await hasGeneratedYamlAliases(artifactPaths.replacementsYaml));

  if (!replacementsChanged && !actualChanged && artifactsExist) {
    return {
      written: false,
      replacementsChanged: false,
      actualChanged: false,
      replacements,
      actual: previousActual ?? actual,
    };
  }

  await writeReplacementArtifacts(
    artifactPaths,
    replacements,
    actualChanged ? actual : (previousActual ?? actual),
  );
  return {
    written: true,
    replacementsChanged,
    actualChanged,
    replacements,
    actual: actualChanged ? actual : (previousActual ?? actual),
  };
};

/**
 * Формирует компактный diagnostics report для CLI и workflow.
 */
export const replacementDiagnosticsReport = (
  result: UpdateReplacementsResult,
): ReturnType<typeof buildDiagnosticsReport> =>
  buildDiagnosticsReport(result.actual);
