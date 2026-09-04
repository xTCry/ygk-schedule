import { describe, expect, it } from 'vitest';
import { getReplacementGroupFileName } from './replacements.ts';

describe('replacement artifact file names', () => {
  it('keeps readable external group names without URL encoding', () => {
    expect(getReplacementGroupFileName('4 ИКС')).toBe('4 ИКС');
    expect(getReplacementGroupFileName(' СТ1-11 ')).toBe('СТ1-11');
  });

  it('encodes only characters unsafe for file paths', () => {
    expect(getReplacementGroupFileName('Группа/1')).toBe('Группа%2F1');
  });
});
