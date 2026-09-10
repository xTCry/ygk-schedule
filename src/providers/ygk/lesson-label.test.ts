import { describe, expect, it } from 'vitest';
import { formatYgkLessonSummary } from './lesson-label.ts';

describe('YGK calendar lesson labels', () => {
  it('always shows a lesson number and gives an explicit subgroup priority', () => {
    expect(
      formatYgkLessonSummary(3, {
        subject: 'Иностранный язык п/гр.1',
        teacher: 'Темофеева Е.Н.',
        room: '',
        subgroup: '1',
      }),
    ).toBe('3. [1] Иностранный язык');
  });

  it('uses teacher surnames only as an informational foreign-language label', () => {
    expect(
      formatYgkLessonSummary(1, {
        subject: 'Иностранный язык',
        teacher: 'Темофеева Е.Н.\nМишуринская Е.Ю.',
        room: '',
      }),
    ).toBe('1. [Темофеева / Мишуринская] Иностранный язык');
  });

  it('does not turn other lessons with several teachers into subgroups', () => {
    expect(
      formatYgkLessonSummary(2, {
        subject: 'Информатика',
        teacher: 'Иванов И.И.\nПетров П.П.',
        room: '',
      }),
    ).toBe('2. Информатика');
  });

  it('marks a changed remote lesson while keeping the subgroup before the subject', () => {
    expect(
      formatYgkLessonSummary(
        2,
        {
          subject: 'МДК.06.01',
          teacher: '',
          room: 'ДОТ',
          subgroup: '1',
        },
        { changed: true },
      ),
    ).toBe('2. ✳ [1] 💻 МДК.06.01');
  });
});
