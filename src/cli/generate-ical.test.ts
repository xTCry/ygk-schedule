import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { CalendarConfigDocument } from '../calendar/config.ts';
import { generateIcalArtifacts } from './generate-ical.ts';
import type {
  CanonicalSchedule,
  ScheduleSource,
  ScheduleVersion,
} from '../types.ts';

const source: ScheduleSource = {
  id: 'test.xlsx',
  fileName: 'test.xlsx',
  sha256: 'source',
  fetchedAt: '2026-09-04T00:00:00.000Z',
};

const version: ScheduleVersion = {
  schemaVersion: 5,
  sourceSetHash: 'source',
  parserHash: 'parser',
  configHash: 'config',
  value: 'version',
};

const schedule: CanonicalSchedule = {
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-04T00:00:00.000Z',
  sources: [source],
  version,
  semanticHash: 'semantic',
  diagnostics: [],
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [
        { sheet: 'Лист', rowStart: 1, rowEnd: 2, rawGroupName: 'СТ1-11' },
      ],
      days: [
        {
          day: 'Понедельник',
          lessons: [
            {
              number: 1,
              source: {
                sheet: 'Лист',
                rowStart: 1,
                rowEnd: 2,
                rawGroupName: 'СТ1-11',
              },
              variants: [
                {
                  subject: 'Тестовая пара',
                  teacher: '',
                  room: 'А101',
                  weekType: 'both',
                  sourceRow: 1,
                },
                {
                  subject: 'Тестовая пара подгруппы 1',
                  teacher: '',
                  room: 'А101',
                  weekType: 'both',
                  subgroup: '1',
                  sourceRow: 2,
                },
                {
                  subject: 'Тестовая пара подгруппы 2',
                  teacher: '',
                  room: 'А101',
                  weekType: 'both',
                  subgroup: '2',
                  sourceRow: 3,
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

describe('generate iCalendar CLI', () => {
  it('generates a selected group by the lesson room profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-generate-ical-'));
    const baseDirectory = join(root, 'base');
    const configPath = join(root, 'calendar.yaml');
    await mkdir(baseDirectory, { recursive: true });
    await writeFile(
      join(baseDirectory, '00-schedule.json'),
      JSON.stringify(schedule),
    );
    await writeFile(
      configPath,
      stringify(
        {
          timezone: 'Europe/Moscow',
          term: {
            first: { start: '09-01', end: '12-31' },
            second: { start: '01-12', end: '06-30' },
            fallback_week_anchor: {
              date: '2026-09-07',
              week_type: 'numerator',
            },
            group_ranges: {
              'СТ1-11': {
                first: { start: '09-01', end: '12-20' },
              },
            },
          },
          profiles: {
            local: {
              lesson_times: {
                1: { start: '09:20', end: '10:50' },
              },
            },
          },
          room_profiles: {
            buildings: {
              А: { profile: 'local' },
            },
          },
          publication: {
            source_url_template: 'https://example.test/ical/{kind}/{group}.ics',
            refresh_interval: 'PT2H',
          },
        } satisfies CalendarConfigDocument,
        { indent: 2 },
      ),
    );

    const result = await generateIcalArtifacts({
      baseSchedule: join(baseDirectory, '00-schedule.json'),
      outputDir: root,
      config: configPath,
      group: 'СТ1-11',
      calendarDate: new Date('2026-09-05T12:00:00Z'),
    });

    expect(result.generatedGroups).toEqual(['СТ1-11']);
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11.ics'), 'utf8'),
    ).resolves.toContain('SUMMARY:Тестовая пара');
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11.ics'), 'utf8'),
    ).resolves.toContain('UNTIL=20261220T235959Z');
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11.ics'), 'utf8'),
    ).resolves.toContain(
      'SOURCE;VALUE=URI:https://example.test/ical/base/СТ1-11.ics',
    );
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11-1.ics'), 'utf8'),
    ).resolves.toContain('SUMMARY:Тестовая пара подгруппы 1');
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11-1.ics'), 'utf8'),
    ).resolves.not.toContain('SUMMARY:Тестовая пара подгруппы 2');
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11-2.ics'), 'utf8'),
    ).resolves.toContain(
      'SOURCE;VALUE=URI:https://example.test/ical/base/СТ1-11-2.ics',
    );

    const noProfileResult = await generateIcalArtifacts({
      baseSchedule: join(baseDirectory, '00-schedule.json'),
      outputDir: root,
      config: configPath,
    });
    expect(noProfileResult.generatedGroups).toEqual(['СТ1-11']);
    await expect(
      readFile(join(root, 'ical', 'base', 'СТ1-11.ics'), 'utf8'),
    ).resolves.toContain('SUMMARY:Тестовая пара');
  });
});
