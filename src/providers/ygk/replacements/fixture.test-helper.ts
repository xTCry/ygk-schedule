import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ReplacementShift } from '../../../types.ts';

const fixtureFileName: Record<ReplacementShift, string> = {
  first: '2026-09-04-first.html',
  second: '2026-09-04-second.html',
};

export const replacementFixturePath = (shift: ReplacementShift): string =>
  fileURLToPath(
    new URL(`./fixtures/${fixtureFileName[shift]}`, import.meta.url),
  );

export const readReplacementFixture = (
  shift: ReplacementShift,
): Promise<string> => readFile(replacementFixturePath(shift), 'utf8');
