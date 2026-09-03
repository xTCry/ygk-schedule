import { resolve } from 'node:path';
import type { ScheduleVersion } from './types.ts';
import { hashPath, hashPaths, sha256 } from './utils/hash.ts';

export const SCHEMA_VERSION = 1;

export interface VersionInput {
  sourceHash: string;
  parserHash: string;
  configHash: string;
  schemaVersion?: number;
}

export const buildScheduleVersion = (input: VersionInput): ScheduleVersion => {
  const schemaVersion = input.schemaVersion ?? SCHEMA_VERSION;
  const value = sha256(
    [
      input.sourceHash,
      input.parserHash,
      input.configHash,
      String(schemaVersion),
    ].join('\0'),
  );
  return {
    schemaVersion,
    sourceHash: input.sourceHash,
    parserHash: input.parserHash,
    configHash: input.configHash,
    value,
  };
};

export const calculateProjectHashes = async (
  projectRoot = process.cwd(),
): Promise<{ parserHash: string; configHash: string }> => ({
  parserHash: await hashPaths([
    resolve(projectRoot, 'src/parser'),
    resolve(projectRoot, 'src/xlsx'),
    resolve(projectRoot, 'src/diagnostics'),
    resolve(projectRoot, 'src/providers/ygk'),
    resolve(projectRoot, 'src/types.ts'),
  ]),
  configHash: await hashPath(resolve(projectRoot, 'config')),
});
