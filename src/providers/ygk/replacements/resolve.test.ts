import { describe, expect, it } from 'vitest';
import { buildActualSchedule } from './resolve.ts';
import type {
  CanonicalReplacements,
  CanonicalSchedule,
  Replacement,
  SourceReference,
} from '../../../types.ts';

const source: SourceReference = {
  sheet: 'Тест',
  rowStart: 1,
  rowEnd: 1,
  rawGroupName: 'СТ1-11',
};

const baseSchedule: CanonicalSchedule = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T12:00:00.000Z',
  sources: [],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'source',
    parserHash: 'parser',
    configHash: 'config',
    value: 'base-version',
  },
  groups: {
    'СТ1-11': {
      group: 'СТ1-11',
      sourceGroups: ['СТ1-11'],
      sourceBlocks: [source],
      days: [
        {
          day: 'Пятница',
          lessons: [
            {
              number: 0,
              variants: [
                {
                  subject: 'Разг. о важном',
                  teacher: '',
                  room: '',
                  weekType: 'both',
                  sourceRow: 1,
                },
              ],
              source,
            },
            {
              number: 2,
              variants: [
                {
                  subject: 'Математика',
                  teacher: '',
                  room: '',
                  weekType: 'numerator',
                  sourceRow: 2,
                },
              ],
              source,
            },
            {
              number: 4,
              variants: [
                {
                  subject: 'Физика',
                  teacher: '',
                  room: '',
                  weekType: 'both',
                  sourceRow: 3,
                },
              ],
              source,
            },
          ],
        },
      ],
    },
  },
  diagnostics: [],
  semanticHash: 'base-semantic',
};

const replacement = (
  lessonNumbers: number[],
  type: Replacement['type'],
  original: string | null,
  next: string | null,
): Replacement => ({
  date: '2026-09-04',
  group: 'СТ1-11',
  lessonNumbers,
  type,
  original: original ? { raw: original } : null,
  replacement: next ? { raw: next, room: 'А201' } : null,
  source: {
    shift: 'first',
    row: lessonNumbers[0] ?? 0,
    rawGroupName: 'СТ1-11',
    rawLessonNumbers: lessonNumbers.join(','),
    rawOriginal: original ?? '',
    rawReplacement: next ?? '',
    rawRoom: 'А201',
  },
});

const replacements: CanonicalReplacements = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T12:30:00.000Z',
  sources: [
    {
      id: 'first',
      fileName: 'rasp_first.html',
      sha256: 'source-hash',
      fetchedAt: '2026-09-03T12:30:00.000Z',
      shift: 'first',
    },
  ],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'replacement-source',
    parserHash: 'parser',
    configHash: 'config',
    value: 'replacement-version',
  },
  dates: {
    '2026-09-04': {
      date: '2026-09-04',
      day: 'Пятница',
      weekType: 'numerator',
      replacements: [
        replacement([0], 'cancel', 'Разг. о важном', 'Снято'),
        replacement([2], 'replace', 'Математика', 'История'),
        replacement([4], 'add', null, 'Биология'),
        replacement([5], 'replace', 'Неизвестный предмет', 'История'),
      ],
    },
  },
  diagnostics: [],
  semanticHash: 'replacement-semantic',
};

describe('actual YGK schedule', () => {
  it('applies only unambiguous replacements and preserves unresolved ones', () => {
    const actual = buildActualSchedule(
      baseSchedule,
      replacements,
      'actual-parser',
      'config',
    );
    const group = actual.dates['2026-09-04']?.groups['СТ1-11'];
    const cancelled = group?.lessons.find((lesson) => lesson.number === 0);
    const replaced = group?.lessons.find((lesson) => lesson.number === 2);
    const added = group?.lessons.find((lesson) => lesson.number === 4);

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      variants: [],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 0 }],
    });
    expect(replaced).toMatchObject({
      status: 'scheduled',
      variants: [{ subject: 'История', room: 'А201' }],
      replacements: [{ strategy: 'exact-subject', lessonNumber: 2 }],
    });
    expect(added).toMatchObject({
      variants: [{ subject: 'Физика' }, { subject: 'Биология', room: 'А201' }],
      replacements: [{ strategy: 'add', lessonNumber: 4 }],
    });
    expect(group?.unresolvedReplacements).toEqual([
      expect.objectContaining({
        lessonNumber: 5,
        reason: 'lesson-not-found',
      }),
    ]);
    expect(actual.diagnostics).toEqual([
      expect.objectContaining({
        code: 'UNRESOLVED_REPLACEMENT',
        severity: 'error',
      }),
    ]);
  });
});
