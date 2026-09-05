import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type {
  ActualSchedule,
  CanonicalReplacements,
  Replacement,
  ReplacementPageSource,
  ScheduleVersion,
} from '../types.ts';
import {
  getReplacementArtifactPaths,
  getReplacementGroupFileName,
  writeReplacementArtifacts,
} from './replacements.ts';

const version: ScheduleVersion = {
  schemaVersion: 5,
  sourceSetHash: 'sources',
  parserHash: 'parser',
  configHash: 'config',
  value: 'version',
};

const source: ReplacementPageSource = {
  id: 'rasp_first.html',
  fileName: 'rasp_first.html',
  sha256: 'source',
  fetchedAt: '2026-09-05T00:00:00.000Z',
  shift: 'first',
};

const replacement = (group: string, row: number): Replacement => ({
  date: '2026-09-05',
  group,
  lessonNumbers: [1],
  type: 'replace',
  original: { raw: 'Исходный предмет' },
  replacement: { raw: 'Новый предмет', room: 'А101' },
  source: {
    shift: 'first',
    row,
    rawGroupName: group,
    rawLessonNumbers: '1',
    rawOriginal: 'Исходный предмет',
    rawReplacement: 'Новый предмет',
    rawRoom: 'А101',
  },
});

const actual: ActualSchedule = {
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-05T00:00:00.000Z',
  sources: [source],
  version,
  baseScheduleVersion: 'base',
  replacementVersion: 'replacements',
  dates: {},
  diagnostics: [],
  semanticHash: 'actual',
};

describe('replacement artifact file names', () => {
  it('keeps readable external group names without URL encoding', () => {
    expect(getReplacementGroupFileName('4 ИКС')).toBe('4 ИКС');
    expect(getReplacementGroupFileName(' СТ1-11 ')).toBe('СТ1-11');
  });

  it('encodes only characters unsafe for file paths', () => {
    expect(getReplacementGroupFileName('Группа/1')).toBe('Группа%2F1');
  });

  it('writes only one group into group replacements and reuses YAML aliases', async () => {
    const targetReplacement = replacement('СТ1-11', 1);
    const otherReplacement = replacement('ДИ1-11', 2);
    const replacements: CanonicalReplacements = {
      schemaVersion: 5,
      provider: 'ygk',
      generatedAt: '2026-09-05T00:00:00.000Z',
      sources: [source],
      version,
      dates: {
        '2026-09-05': {
          date: '2026-09-05',
          day: 'Суббота',
          weekType: 'numerator',
          shifts: {
            first: {
              date: '2026-09-05',
              day: 'Суббота',
              weekType: 'numerator',
              shift: 'first',
              status: 'mutable',
              source,
              replacements: [targetReplacement, otherReplacement],
              diagnostics: [],
            },
          },
          replacements: [targetReplacement, otherReplacement],
        },
      },
      diagnostics: [],
      semanticHash: 'replacements',
    };
    const root = await mkdtemp(join(tmpdir(), 'ygk-replacement-artifacts-'));

    await writeReplacementArtifacts(
      getReplacementArtifactPaths(root),
      replacements,
      actual,
    );

    const yaml = await readFile(
      join(root, 'replacements', '10-groups', 'СТ1-11.yaml'),
      'utf8',
    );
    const parsed = parse(yaml) as {
      dates: Record<
        string,
        {
          replacements: Replacement[];
          shifts?: { first?: { replacements: Replacement[] } };
        }
      >;
    };

    expect(yaml).toContain('&a1');
    expect(yaml).toContain('*a1');
    expect(yaml).not.toContain('ДИ1-11');
    expect(parsed.dates['2026-09-05']?.replacements).toHaveLength(1);
    expect(
      parsed.dates['2026-09-05']?.shifts?.first?.replacements,
    ).toHaveLength(1);
  });
});
