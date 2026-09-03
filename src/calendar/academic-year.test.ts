import { describe, expect, it } from 'vitest';
import { inferAcademicYear, weekTypeForDate } from './academic-year.ts';

describe('academic year', () => {
  it('switches in September', () => {
    expect(inferAcademicYear(new Date('2026-08-31T12:00:00Z'))).toEqual({
      startYear: 2025,
      endYear: 2026,
      label: '2025/2026',
    });
    expect(inferAcademicYear(new Date('2026-09-01T00:00:00Z'))).toEqual({
      startYear: 2026,
      endYear: 2027,
      label: '2026/2027',
    });
    expect(inferAcademicYear(new Date('2027-01-15T00:00:00Z'))).toEqual({
      startYear: 2026,
      endYear: 2027,
      label: '2026/2027',
    });
  });

  it('alternates before and after the reference week', () => {
    const reference = new Date('2026-09-07T00:00:00Z');
    expect(weekTypeForDate(reference, reference)).toBe('numerator');
    expect(weekTypeForDate(new Date('2026-09-14T00:00:00Z'), reference)).toBe(
      'denominator',
    );
    expect(weekTypeForDate(new Date('2026-09-21T00:00:00Z'), reference)).toBe(
      'numerator',
    );
    expect(weekTypeForDate(new Date('2026-08-31T00:00:00Z'), reference)).toBe(
      'denominator',
    );
    expect(
      weekTypeForDate(
        new Date('2026-09-14T00:00:00Z'),
        reference,
        'denominator',
      ),
    ).toBe('numerator');
  });
});
