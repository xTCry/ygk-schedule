import { describe, expect, it } from 'vitest';
import {
  normalizeDashes,
  normalizeSingleLine,
  normalizeText,
} from '../../../parser/text.ts';
import { normalizeGroupCode, parseGroupCandidate } from './group.ts';

describe('YGK group parsing', () => {
  it('normalizes text, spaces and line breaks', () => {
    expect(normalizeText('  A\u00a0  B\r\n C \t D  ')).toBe('A B\nC D');
    expect(normalizeSingleLine('A\r\nB\n C')).toBe('A B C');
  });

  it('normalizes typographic dashes', () => {
    expect(normalizeDashes('СТ1–11 СТ1—12 СТ1−13')).toBe(
      'СТ1-11 СТ1-12 СТ1-13',
    );
  });

  it('replaces Latin look-alikes only in group codes', () => {
    expect(normalizeGroupCode('cт1–11')).toBe('СТ1-11');
    expect(normalizeGroupCode('CT1-12')).toBe('СТ1-12');
  });

  it('extracts multiple groups and removes duplicates', () => {
    expect(parseGroupCandidate(' CТ1-33 / СТ1-34 / СТ1-37 / СТ1-37 ')).toEqual({
      raw: 'CТ1-33 / СТ1-34 / СТ1-37 / СТ1-37',
      normalizedSource: 'СТ1-33 / СТ1-34 / СТ1-37 / СТ1-37',
      groups: ['СТ1-33', 'СТ1-34', 'СТ1-37'],
    });
  });

  it('rejects service rows and ordinary text', () => {
    expect(parseGroupCandidate('* с ДОТ')).toBeNull();
    expect(parseGroupCandidate('Понедельник')).toBeNull();
    expect(parseGroupCandidate('Обычная строка')).toBeNull();
  });
});
