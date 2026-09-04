import { resolve } from 'node:path';
import type { ScheduleSource, ScheduleVersion } from './types.ts';
import { hashPath, hashPaths, sha256 } from './utils/hash.ts';

export const SCHEMA_VERSION = 5;

export interface VersionInput {
  sourceSetHash: string;
  parserHash: string;
  configHash: string;
  schemaVersion?: number;
}

/**
 * Возвращает hash набора источников независимо от порядка их обнаружения.
 */
export const calculateSourceSetHash = (sources: ScheduleSource[]): string =>
  sha256(
    sources
      .map((source) => `${source.id}\0${source.sha256}`)
      .sort()
      .join('\0'),
  );

export const buildScheduleVersion = (input: VersionInput): ScheduleVersion => {
  const schemaVersion = input.schemaVersion ?? SCHEMA_VERSION;
  const value = sha256(
    [
      input.sourceSetHash,
      input.parserHash,
      input.configHash,
      String(schemaVersion),
    ].join('\0'),
  );
  return {
    schemaVersion,
    sourceSetHash: input.sourceSetHash,
    parserHash: input.parserHash,
    configHash: input.configHash,
    value,
  };
};

/**
 * Считает hash кода, влияющего только на базовое XLSX-расписание.
 *
 * Код HTML-замен и генераторов намеренно не входит в этот hash: иначе их
 * изменение заставляет заново публиковать всё базовое расписание.
 */
export const calculateProjectHashes = async (
  projectRoot = process.cwd(),
): Promise<{ parserHash: string; configHash: string }> => ({
  parserHash: await hashPaths([
    resolve(projectRoot, 'src/parser'),
    resolve(projectRoot, 'src/xlsx'),
    resolve(projectRoot, 'src/diagnostics'),
    resolve(projectRoot, 'src/providers/ygk/schedule'),
    resolve(projectRoot, 'src/types.ts'),
  ]),
  configHash: await hashPath(resolve(projectRoot, 'config', 'ygk', 'schedule')),
});

/**
 * Считает hash кода, влияющего на разбор и разрешение HTML-замен.
 */
export const calculateReplacementProjectHashes = async (
  projectRoot = process.cwd(),
): Promise<{ parserHash: string; configHash: string }> => ({
  parserHash: await hashPaths([
    resolve(projectRoot, 'src/parser'),
    resolve(projectRoot, 'src/diagnostics'),
    resolve(projectRoot, 'src/providers/ygk/replacements'),
    resolve(projectRoot, 'src/providers/ygk/schedule/group.ts'),
    resolve(projectRoot, 'src/types.ts'),
  ]),
  configHash: await hashPath(
    resolve(projectRoot, 'config', 'ygk', 'replacements.json'),
  ),
});
