import { describe, expect, it } from 'vitest';
import { selectHolidayVariants } from './holiday-replacements.ts';

describe('holiday replacement selection', () => {
  it('keeps only the added subgroup and hides the unchanged lesson', () => {
    const original = { subject: 'Математика', room: 'А101', subgroup: '1' };
    const added = { subject: 'Физкультура', room: 'Спортзал', subgroup: '2' };
    const result = selectHolidayVariants(
      [original, added],
      [original],
      [{ type: 'add', raw: 'Физкультура' }],
    );
    expect(result.variants).toEqual([added]);
    expect(result.unmatched).toEqual([]);
  });

  it('does not guess when a replacement matches multiple variants', () => {
    const result = selectHolidayVariants(
      [
        { subject: 'Математика', room: 'А101', subgroup: '1' },
        { subject: 'Математика', room: 'А101', subgroup: '2' },
      ],
      [],
      [{ type: 'replace', raw: 'Математика' }],
    );
    expect(result.variants).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
  });

  it('recognizes a room-only change without selecting the untouched subgroup', () => {
    const base = [
      { subject: 'МДК', room: 'Б406', subgroup: '1' },
      { subject: 'МДК', room: 'Б406', subgroup: '2' },
    ];
    const changed = { ...base[1]!, room: 'ДОТ' };
    const result = selectHolidayVariants([base[0]!, changed], base, [
      { type: 'replace', raw: 'по расписанию', strategy: 'scheduled-room' },
    ]);
    expect(result.variants).toEqual([changed]);
    expect(result.unmatched).toEqual([]);
  });
});
