import { describe, expect, it } from 'vitest';
import { getGroupFileName } from './group-file-name.ts';

describe('group artifact file names', () => {
  it('keeps readable numbered specialty group names', () => {
    expect(getGroupFileName('1 БПЛА')).toBe('1 БПЛА');
    expect(getGroupFileName(' 36 ЭМЕХ ')).toBe('36 ЭМЕХ');
  });

  it('encodes only characters unsafe for file paths', () => {
    expect(getGroupFileName('Группа/1')).toBe('Группа%2F1');
  });
});
