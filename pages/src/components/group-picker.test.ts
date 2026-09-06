import { describe, expect, it } from 'vitest';
import {
  filterGroupCodes,
  resolveGroupCode,
  sortGroupCodes,
} from './group-picker.ts';

describe('group picker helpers', () => {
  const groups = ['СТ1-11', 'ИБ2-31', 'СТ1-12', 'СТ1-11'];

  it('sorts and deduplicates group codes', () => {
    expect(sortGroupCodes(groups)).toEqual(['ИБ2-31', 'СТ1-11', 'СТ1-12']);
  });

  it('filters independently of case and spaces', () => {
    expect(filterGroupCodes(groups, ' ст1 ')).toEqual([
      'СТ1-11',
      'СТ1-12',
      'СТ1-11',
    ]);
  });

  it('only resolves exact known group codes', () => {
    expect(resolveGroupCode(groups, 'ст1-11')).toBe('СТ1-11');
    expect(resolveGroupCode(groups, 'СТ1')).toBeNull();
  });
});
