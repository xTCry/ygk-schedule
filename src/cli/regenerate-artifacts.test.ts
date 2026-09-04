import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CanonicalSchedule } from '../types.ts';
import { SCHEMA_VERSION } from '../version.ts';
import { regenerateScheduleArtifacts } from './regenerate-artifacts.ts';

const schedule: CanonicalSchedule = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T14:04:25.053Z',
  sources: [
    {
      id: 'schedule.xlsx',
      fileName: 'schedule.xlsx',
      sha256: 'source-hash',
      fetchedAt: '2026-09-03T14:00:00.000Z',
    },
  ],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'old-source-hash',
    parserHash: 'old-parser-hash',
    configHash: 'old-config-hash',
    value: 'old-version',
  },
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [
        {
          sheet: 'Расписание',
          rowStart: 1,
          rowEnd: 4,
          rawGroupName: 'СТ1-11',
        },
      ],
      days: [],
    },
  },
  diagnostics: [],
  semanticHash: 'old-semantic-hash',
};

describe('artifact regeneration', () => {
  it('migrates an existing full schedule without downloading XLSX', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-regenerate-'));
    const input = join(root, 'previous.json');
    await writeFile(input, `${JSON.stringify(schedule)}\n`);

    const result = await regenerateScheduleArtifacts({
      input,
      outputDir: root,
      projectRoot: root,
    });

    expect(result.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.generatedAt).toBe(schedule.generatedAt);
    expect(result.version.value).not.toBe(schedule.version.value);
    await expect(
      readFile(join(root, 'base', '00-schedule.json'), 'utf8'),
    ).resolves.toContain(`"schemaVersion": ${SCHEMA_VERSION}`);
    await expect(
      readFile(join(root, 'base', '10-groups', 'СТ1-11.json'), 'utf8'),
    ).resolves.toEqual(expect.not.stringContaining('"generatedAt"'));
  });
});
