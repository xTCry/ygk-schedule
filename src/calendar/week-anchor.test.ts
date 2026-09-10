import { describe, expect, it } from 'vitest';
import { mondayForIsoDate, resolveWeekAnchor } from './week-anchor.ts';

const fallback = { date: '2026-09-07', weekType: 'numerator' } as const;

describe('published week anchor', () => {
  it('normalizes a replacement date to the Monday of its week', () => {
    expect(mondayForIsoDate('2026-09-11')).toBe('2026-09-07');
    expect(mondayForIsoDate('2026-09-13')).toBe('2026-09-07');
  });

  it('uses the latest replacement header in the active term', () => {
    const actual: {
      dates: Record<
        string,
        {
          date: string;
          weekType: 'numerator' | 'denominator';
        }
      >;
    } = {
      dates: {
        '2026-09-05': {
          date: '2026-09-05',
          weekType: 'numerator',
        },
        '2026-09-11': {
          date: '2026-09-11',
          weekType: 'denominator',
        },
        '2027-01-15': {
          date: '2027-01-15',
          weekType: 'numerator',
        },
      },
    };

    expect(
      resolveWeekAnchor(fallback, actual, {
        start: '2026-09-01',
        end: '2026-12-31',
      }),
    ).toEqual({
      date: '2026-09-07',
      weekType: 'denominator',
    });
  });

  it('keeps the configured fallback without published replacement headers', () => {
    expect(
      resolveWeekAnchor(fallback, null, {
        start: '2026-09-01',
        end: '2026-12-31',
      }),
    ).toEqual(fallback);
  });
});
