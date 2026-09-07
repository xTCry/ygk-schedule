import { describe, expect, it } from 'vitest';
import {
  findUniqueMentionedSubject,
  findUniqueSimilarSubject,
  subjectSimilarityPercent,
} from './subject-match.ts';

describe('YGK replacement subject similarity', () => {
  it('finds one abbreviated subject in a compound manual value', () => {
    expect(
      findUniqueMentionedSubject('Теор.вер. Физкул.', [
        {
          index: 0,
          subject: 'Теория вероятностей и математическая статистика',
        },
        { index: 1, subject: 'Основы программирования' },
      ]),
    ).toEqual({ index: 0 });
  });

  it('recognizes an initialism for a subject', () => {
    expect(
      findUniqueMentionedSubject('ОБиЗР', [
        {
          index: 0,
          subject: 'Основы безопасности и защиты Родины',
        },
      ]),
    ).toEqual({ index: 0 });
  });

  it('matches a short word abbreviation inside a longer subject mention', () => {
    expect(
      findUniqueMentionedSubject('Рус.яз.и культ.речи', [
        { index: 0, subject: 'Русский язык и культура речи' },
      ]),
    ).toEqual({ index: 0 });
  });

  it('matches one long abbreviated word from a compound manual value', () => {
    expect(
      findUniqueMentionedSubject('Рисунок Живоп.', [
        { index: 0, subject: 'Живопись с основами цветоведения' },
      ]),
    ).toEqual({ index: 0 });
  });

  it('normalizes the stable shorthand for physical education', () => {
    expect(
      findUniqueMentionedSubject('Теор.вер. Физкул.', [
        { index: 0, subject: 'Физическая культура' },
      ]),
    ).toEqual({ index: 0 });
  });

  it('keeps a shared short mention ambiguous', () => {
    expect(
      findUniqueMentionedSubject('История', [
        { index: 0, subject: 'История России' },
        { index: 1, subject: 'История Ярославского края' },
      ]),
    ).toBeNull();
  });

  it('normalizes spacing and punctuation before calculating a percentage', () => {
    expect(subjectSimilarityPercent('МДК 01.01', 'МДК.01.01')).toBe(100);
  });

  it('selects one high-confidence misspelled candidate', () => {
    expect(
      findUniqueSimilarSubject('Математека', [
        { index: 0, subject: 'Математика' },
        { index: 1, subject: 'Физическая культура' },
      ]),
    ).toEqual({ index: 0, similarity: 90 });
  });

  it('keeps equally close candidates unresolved', () => {
    expect(
      findUniqueSimilarSubject('Математека', [
        { index: 0, subject: 'Математика' },
        { index: 1, subject: 'Математика' },
      ]),
    ).toBeNull();
  });
});
