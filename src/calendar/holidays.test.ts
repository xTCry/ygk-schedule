import { describe, expect, it } from 'vitest';
import { calendarDayKind } from './holidays.ts';

describe('calendarDayKind', () => {
  const holidays = ['01-01', '01-02', '05-01', '05-09', '06-12', '11-04'];

  it('detects holidays and their immediately preceding days across years', () => {
    expect(calendarDayKind('2026-11-04', holidays)).toBe('holiday');
    expect(calendarDayKind('2026-11-03', holidays)).toBe('preholiday');
    expect(calendarDayKind('2026-12-31', holidays)).toBe('preholiday');
    expect(calendarDayKind('2027-01-01', holidays)).toBe('holiday');
  });

  it('does not classify a holiday before another holiday as preholiday', () => {
    expect(calendarDayKind('2027-01-01', holidays)).toBe('holiday');
    expect(calendarDayKind('2026-05-07', holidays)).toBe('regular');
  });
});
