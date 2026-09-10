import { describe, expect, it } from 'vitest';
import { describeLessonReplacement } from './replacement-summary.ts';
import type { ActualLesson, Lesson } from './types.ts';

const baseLessons: Lesson[] = [
  {
    number: 2,
    variants: [
      {
        subject: 'МДК.06.01 Т.1.1. Сметная документация п/гр1',
        teacher: 'Силантьева С.И.',
        room: 'Б406',
        weekType: 'numerator',
        subgroup: '1',
        timing: { slots: [] },
      },
      {
        subject: 'МДК.06.01 Т.1.1. Сметная документация п/гр2',
        teacher: 'Силантьева С.И.',
        room: 'Б406',
        weekType: 'denominator',
        subgroup: '2',
        timing: { slots: [] },
      },
    ],
  },
];

const actualLesson: ActualLesson = {
  number: 2,
  variants: [],
  status: 'scheduled',
  replacements: [
    {
      replacement: {
        type: 'replace',
        original: null,
        replacement: { raw: 'по расписанию', room: 'ДОТ' },
        source: { shift: 'first', row: 44 },
      },
    },
  ],
};

describe('replacement summary', () => {
  it('expands “по расписанию” with the current base subject and room change', () => {
    expect(
      describeLessonReplacement(actualLesson, baseLessons, 'denominator'),
    ).toBe(
      'По расписанию: «МДК.06.01 Т.1.1. Сметная документация п/гр2» · подгруппа 2 · Б406 → ДОТ',
    );
  });
});
