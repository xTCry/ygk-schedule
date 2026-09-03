import { describe, expect, it } from 'vitest';
import type {
  GroupSchedule,
  ParsedSchedule,
  ScheduleSource,
} from '../../../types.ts';
import { aggregateYgkSchedules } from './aggregate.ts';

const source = (id: string): ScheduleSource => ({
  id,
  fileName: `${id}.xlsx`,
  sha256: `${id}-sha256`,
  fetchedAt: '2026-09-03T00:00:00.000Z',
});

const group = (code: string): GroupSchedule => ({
  group: code,
  sourceGroups: [code],
  sourceBlocks: [
    {
      sheet: 'Лист 1',
      rowStart: 1,
      rowEnd: 10,
      rawGroupName: code,
    },
  ],
  days: [
    {
      day: 'Понедельник',
      lessons: [
        {
          number: 1,
          source: {
            sheet: 'Лист 1',
            rowStart: 3,
            rowEnd: 4,
            rawGroupName: code,
          },
          variants: [
            {
              subject: 'Математика',
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

const parsed = (groups: Record<string, GroupSchedule>): ParsedSchedule => ({
  groups,
  diagnostics: [],
});

describe('aggregation of YGK schedule sources', () => {
  it('combines groups from different source files and records their source IDs', () => {
    const result = aggregateYgkSchedules([
      { source: source('oit'), parsed: parsed({ 'ОИТ-11': group('ОИТ-11') }) },
      { source: source('so'), parsed: parsed({ 'СО-11': group('СО-11') }) },
    ]);

    expect(Object.keys(result.groups)).toEqual(['ОИТ-11', 'СО-11']);
    expect(result.groups['ОИТ-11']?.sourceBlocks[0]?.sourceId).toBe('oit');
    expect(result.groups['СО-11']?.days[0]?.lessons[0]?.source.sourceId).toBe(
      'so',
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('blocks publication when the same group is found in different source files', () => {
    const result = aggregateYgkSchedules([
      { source: source('first'), parsed: parsed({ 'СО-11': group('СО-11') }) },
      { source: source('second'), parsed: parsed({ 'СО-11': group('СО-11') }) },
    ]);

    expect(Object.keys(result.groups)).toEqual(['СО-11']);
    expect(result.groups['СО-11']?.sourceBlocks[0]?.sourceId).toBe('first');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'DUPLICATE_GROUP_ACROSS_SOURCES',
        severity: 'fatal',
        normalizedGroup: 'СО-11',
        context: {
          sourceIds: ['first', 'second'],
          fileNames: ['first.xlsx', 'second.xlsx'],
        },
      }),
    );
  });
});
