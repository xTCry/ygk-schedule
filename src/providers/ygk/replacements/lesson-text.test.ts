import { describe, expect, it } from 'vitest';
import { parseYgkReplacementLessonText } from './lesson-text.ts';

describe('YGK replacement lesson text parser', () => {
  it('extracts a compact subject, subgroup and teacher', () => {
    expect(
      parseYgkReplacementLessonText('Инф.технол.п/гр.1 Сердцева О.Д.'),
    ).toEqual({
      subject: 'Инф.технол.',
      teachers: ['Сердцева О.Д.'],
      subgroups: ['1'],
      theory: false,
    });
  });

  it('supports a subgroup list before the marker', () => {
    expect(parseYgkReplacementLessonText('1,2 пгр. Грехова Е.И.')).toEqual({
      subject: '',
      teachers: ['Грехова Е.И.'],
      subgroups: ['1', '2'],
      theory: false,
    });
  });

  it('does not treat the module code suffix as a subgroup number', () => {
    expect(parseYgkReplacementLessonText('МДК 01.05 п/гр')).toEqual({
      subject: 'МДК 01.05',
      teachers: [],
      subgroups: [],
      theory: false,
    });
  });

  it('keeps a practice code before a subgroup marker', () => {
    expect(parseYgkReplacementLessonText('УП 04 пгр')).toEqual({
      subject: 'УП 04',
      teachers: [],
      subgroups: [],
      theory: false,
    });
  });

  it('removes theory and finds adjacent teacher names', () => {
    expect(
      parseYgkReplacementLessonText('МДК 03.02/теория Юров А.А.Байдина Ю.А.'),
    ).toEqual({
      subject: 'МДК 03.02',
      teachers: ['Юров А.А.', 'Байдина Ю.А.'],
      subgroups: [],
      theory: true,
    });
  });
});
