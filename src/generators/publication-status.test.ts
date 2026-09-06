import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalReplacements,
  CanonicalSchedule,
  ScheduleVersion,
} from '../types.ts';
import {
  getPublicationStatusPaths,
  writePublicationStatus,
} from './publication-status.ts';

const version = (parserHash: string): ScheduleVersion => ({
  schemaVersion: 5,
  sourceSetHash: 'sources',
  parserHash,
  configHash: 'config',
  value: 'version',
});

const schedule: CanonicalSchedule = {
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-04T20:32:25.329Z',
  sources: [
    {
      id: 'test.xlsx',
      fileName: 'test.xlsx',
      sha256: 'source',
      fetchedAt: '2026-09-04T20:32:25.329Z',
    },
  ],
  version: version('1234567890abcdef1234567890abcdef'),
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [],
      days: [],
    },
  },
  diagnostics: [
    {
      provider: 'ygk',
      code: 'UNKNOWN_GROUP',
      severity: 'warning',
      message: 'Тест',
      fingerprint: 'warning',
    },
  ],
  semanticHash: 'schedule-semantic',
};

const replacements: CanonicalReplacements = {
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-05T13:16:53.414Z',
  sources: [],
  version: version('abcdef1234567890abcdef1234567890'),
  dates: {},
  diagnostics: [],
  semanticHash: 'replacements-semantic',
};

describe('publication status generator', () => {
  it('writes readable Moscow-time badges from published data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-publication-status-'));
    await Promise.all([
      mkdir(join(root, 'base'), { recursive: true }),
      mkdir(join(root, 'replacements'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(root, 'base', '00-schedule.json'),
        JSON.stringify(schedule),
      ),
      writeFile(
        join(root, 'replacements', '00-replacements.json'),
        JSON.stringify(replacements),
      ),
    ]);

    const status = await writePublicationStatus(root);
    const paths = getPublicationStatusPaths(root);
    const [statusYaml, scheduleBadge, replacementsBadge] = await Promise.all([
      readFile(paths.statusYaml, 'utf8'),
      readFile(paths.scheduleBadge, 'utf8'),
      readFile(paths.replacementsBadge, 'utf8'),
    ]);

    expect(status).toMatchObject({
      updatedAt: '2026-09-05T13:16:53.414Z',
      schedule: {
        parserVersion: '1234567890ab',
        groups: 1,
        diagnostics: { warning: 1 },
      },
      replacements: {
        parserVersion: 'abcdef123456',
      },
    });
    expect(parse(statusYaml)).toEqual(status);
    expect(JSON.parse(scheduleBadge)).toEqual({
      schemaVersion: 1,
      label: 'Расписание',
      message: '04.09.2026, 23:32 МСК',
      color: '0f766e',
      labelColor: '334155',
    });
    expect(JSON.parse(replacementsBadge)).toMatchObject({
      label: 'Замены',
      message: '05.09.2026, 16:16 МСК',
    });
  });
});
