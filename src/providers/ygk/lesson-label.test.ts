import { describe, expect, it } from 'vitest';
import { formatYgkLessonSummary } from './lesson-label.ts';

describe('YGK calendar lesson labels', () => {
  it('always shows a lesson number and gives an explicit subgroup priority', () => {
    expect(
      formatYgkLessonSummary(3, {
        subject: 'Иностранный язык п/гр.1',
        teacher: 'Темофеева Е.Н.',
        subgroup: '1',
      }),
    ).toBe('3. [1] Иностранный язык');
  });

  it('uses teacher surnames only as an informational foreign-language label', () => {
    expect(
      formatYgkLessonSummary(1, {
        subject: 'Иностранный язык',
        teacher: 'Темофеева Е.Н.\nМишуринская Е.Ю.',
      }),
    ).toBe('1. [Темофеева / Мишуринская] Иностранный язык');
  });

  it('does not turn other lessons with several teachers into subgroups', () => {
    expect(
      formatYgkLessonSummary(2, {
        subject: 'Информатика',
        teacher: 'Иванов И.И.\nПетров П.П.',
      }),
    ).toBe('2. Информатика');
  });
});
