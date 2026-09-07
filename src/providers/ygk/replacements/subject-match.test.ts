import { describe, expect, it } from 'vitest';
import {
  findUniqueSimilarSubject,
  subjectSimilarityPercent,
} from './subject-match.ts';

describe('YGK replacement subject similarity', () => {
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
