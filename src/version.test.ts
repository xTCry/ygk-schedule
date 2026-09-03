import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareSchedules, semanticScheduleHash } from './compare/schedule.ts';
import type { GroupSchedule, ScheduleSource } from './types.ts';
import {
  buildScheduleVersion,
  calculateProjectHashes,
  calculateSourceSetHash,
} from './version.ts';

const makeGroup = (group: string, subject = 'Физика'): GroupSchedule => ({
  group,
  sourceGroups: [group],
  sourceBlocks: [
    { sheet: 'Лист', rowStart: 1, rowEnd: 10, rawGroupName: group },
  ],
  days: [
    {
      day: 'Понедельник',
      lessons: [
        {
          number: 1,
          source: {
            sheet: 'Лист',
            rowStart: 3,
            rowEnd: 4,
            rawGroupName: group,
          },
          variants: [
            {
              subject,
              teacher: 'Иванов И.И.',
              room: '101',
              weekType: 'both',
              sourceRow: 3,
            },
          ],
        },
      ],
    },
  ],
});

describe('versions and semantic schedule comparison', () => {
  it('keeps the semantic hash stable across key ordering and source metadata', () => {
    const a = { 'СТ1-12': makeGroup('СТ1-12'), 'СТ1-11': makeGroup('СТ1-11') };
    const b = {
      'СТ1-11': { ...makeGroup('СТ1-11'), sourceGroups: ['OTHER'] },
      'СТ1-12': makeGroup('СТ1-12'),
    };
    expect(semanticScheduleHash(a)).toBe(semanticScheduleHash(b));
  });

  it('detects added, removed and changed groups', () => {
    const previous = { groups: { A: makeGroup('A'), B: makeGroup('B') } };
    const current = {
      groups: { B: makeGroup('B', 'Математика'), C: makeGroup('C') },
    };
    expect(compareSchedules(previous, current)).toEqual({
      changed: true,
      addedGroups: ['C'],
      removedGroups: ['A'],
      changedGroups: ['B'],
      lessonChanges: [
        {
          group: 'B',
          day: 'Понедельник',
          lessonNumber: 1,
          before: {
            variants: [
              {
                subject: 'Физика',
                teacher: 'Иванов И.И.',
                room: '101',
                weekType: 'both',
                subgroup: null,
              },
            ],
          },
          after: {
            variants: [
              {
                subject: 'Математика',
                teacher: 'Иванов И.И.',
                room: '101',
                weekType: 'both',
                subgroup: null,
              },
            ],
          },
        },
      ],
    });
  });

  it('reports additions and removals of individual lessons', () => {
    const previous = { groups: { A: makeGroup('A') } };
    const currentGroup = makeGroup('A');
    currentGroup.days[0]?.lessons.push({
      number: 2,
      source: {
        sheet: 'Лист',
        rowStart: 5,
        rowEnd: 6,
        rawGroupName: 'A',
      },
      variants: [
        {
          subject: 'История',
          teacher: 'Петров П.П.',
          room: '202',
          weekType: 'numerator',
          sourceRow: 5,
        },
      ],
    });
    const result = compareSchedules(previous, {
      groups: { A: currentGroup },
    });
    expect(result.lessonChanges).toEqual([
      {
        group: 'A',
        day: 'Понедельник',
        lessonNumber: 2,
        before: null,
        after: {
          variants: [
            {
              subject: 'История',
              teacher: 'Петров П.П.',
              room: '202',
              weekType: 'numerator',
              subgroup: null,
            },
          ],
        },
      },
    ]);
  });

  it('changes the version when source, parser, config or schema changes', () => {
    const base = buildScheduleVersion({
      sourceSetHash: 's',
      parserHash: 'p',
      configHash: 'c',
      schemaVersion: 1,
    });
    expect(base.value).not.toBe(
      buildScheduleVersion({
        sourceSetHash: 's2',
        parserHash: 'p',
        configHash: 'c',
        schemaVersion: 1,
      }).value,
    );
    expect(base.value).not.toBe(
      buildScheduleVersion({
        sourceSetHash: 's',
        parserHash: 'p2',
        configHash: 'c',
        schemaVersion: 1,
      }).value,
    );
    expect(base.value).not.toBe(
      buildScheduleVersion({
        sourceSetHash: 's',
        parserHash: 'p',
        configHash: 'c2',
        schemaVersion: 1,
      }).value,
    );
    expect(base.value).not.toBe(
      buildScheduleVersion({
        sourceSetHash: 's',
        parserHash: 'p',
        configHash: 'c',
        schemaVersion: 2,
      }).value,
    );
  });

  it('calculates a source set hash independently of discovery order', () => {
    const sources: ScheduleSource[] = [
      { id: 'https://ygk.example/so.xlsx', fileName: 'so.xlsx', sha256: 'so' },
      {
        id: 'https://ygk.example/oit.xlsx',
        fileName: 'oit.xlsx',
        sha256: 'oit',
      },
    ];
    expect(calculateSourceSetHash(sources)).toBe(
      calculateSourceSetHash([...sources].reverse()),
    );
    expect(calculateSourceSetHash(sources)).not.toBe(
      calculateSourceSetHash([
        { ...sources[0]!, sha256: 'changed' },
        sources[1]!,
      ]),
    );
  });

  it('ignores generators and changes on parser or config edits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-hash-'));
    for (const path of [
      'src/parser',
      'src/xlsx',
      'src/diagnostics',
      'src/providers/ygk',
      'src/generators',
      'config',
    ])
      await mkdir(join(root, path), { recursive: true });
    await writeFile(join(root, 'src/types.ts'), 'export type A = string;');
    await writeFile(join(root, 'src/parser/a.ts'), 'export const a = 1;');
    await writeFile(
      join(root, 'src/generators/ical.ts'),
      'export const a = 1;',
    );
    await writeFile(join(root, 'config/a.json'), '{}');

    const initial = await calculateProjectHashes(root);
    await writeFile(
      join(root, 'src/generators/ical.ts'),
      'export const a = 2;',
    );
    await expect(calculateProjectHashes(root)).resolves.toEqual(initial);

    await writeFile(join(root, 'src/parser/a.ts'), 'export const a = 2;');
    const parserChanged = await calculateProjectHashes(root);
    expect(parserChanged.parserHash).not.toBe(initial.parserHash);
    expect(parserChanged.configHash).toBe(initial.configHash);

    await writeFile(join(root, 'config/a.json'), '{"x":1}');
    const configChanged = await calculateProjectHashes(root);
    expect(configChanged.configHash).not.toBe(initial.configHash);
  });
});
