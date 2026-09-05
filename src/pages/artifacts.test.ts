import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preparePagesPublicDirectory, readPagesApiIndex } from './artifacts.ts';

const writeJson = async (
  directory: string,
  path: string,
  value: unknown,
): Promise<void> => {
  const destination = join(directory, path);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
};

describe('Pages public API artifacts', () => {
  it('copies only group JSON, diagnostics and ICS with a compact group index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-pages-artifacts-'));
    const data = join(root, 'data');
    const output = join(root, 'public');
    await writeJson(data, 'base/00-schedule.json', {
      generatedAt: '2026-09-05T12:00:00.000Z',
      version: { value: 'schedule-version' },
      groups: { 'СТ1-11': {}, 'ДИ1-13': {} },
    });
    await writeJson(data, 'base/10-groups/СТ1-11.json', { group: 'СТ1-11' });
    await writeJson(data, 'base/10-groups/ДИ1-13.json', { group: 'ДИ1-13' });
    await writeFile(
      join(data, 'base', '10-groups', 'СТ1-11.yaml'),
      'group: СТ1-11\n',
    );
    await writeJson(data, 'actual/10-groups/СТ1-11.json', {
      group: 'СТ1-11',
    });
    await writeJson(data, 'replacements/10-groups/СТ1-11.json', {
      group: 'СТ1-11',
    });
    await writeJson(data, 'base/90-diagnostics.json', { diagnostics: [] });
    await mkdir(join(data, 'ical', 'actual'), { recursive: true });
    await writeFile(
      join(data, 'ical', 'actual', 'СТ1-11.ics'),
      'BEGIN:VCALENDAR',
    );

    await expect(
      preparePagesPublicDirectory({
        dataDirectory: data,
        publicDirectory: output,
      }),
    ).resolves.toEqual({
      schemaVersion: 1,
      provider: 'ygk',
      generatedAt: '2026-09-05T12:00:00.000Z',
      scheduleVersion: 'schedule-version',
      groups: [
        { code: 'ДИ1-13', hasActual: false, hasReplacements: false },
        { code: 'СТ1-11', hasActual: true, hasReplacements: true },
      ],
    });
    const publicIndex = await readPagesApiIndex(output);
    expect(
      publicIndex.groups.some(
        (group) =>
          group.code === 'СТ1-11' && group.hasActual && group.hasReplacements,
      ),
    ).toBe(true);
    await expect(
      readFile(join(output, 'api', 'base', 'groups', 'СТ1-11.json'), 'utf8'),
    ).resolves.toContain('СТ1-11');
    await expect(
      readFile(join(output, 'api', 'base', 'groups', 'СТ1-11.yaml'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(output, 'ical', 'actual', 'СТ1-11.ics'), 'utf8'),
    ).resolves.toBe('BEGIN:VCALENDAR');
  });
});
