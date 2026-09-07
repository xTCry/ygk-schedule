import { describe, expect, it } from 'vitest';
import { hasYgkSubgroupMarker, stripYgkSubgroupMarkers } from './subgroup.ts';

describe('YGK subgroup marker parser', () => {
  it.each([
    ['пгр1', ['1']],
    ['п/гр1', ['1']],
    ['пг 1', ['1']],
    ['п/гр 1', ['1']],
    ['пгр1,2', ['1', '2']],
    ['п/гр 1,2', ['1', '2']],
    ['1,2 пгр.', ['1', '2']],
  ])('recognizes %s', (marker, subgroups) => {
    expect(stripYgkSubgroupMarkers(`Математика ${marker}`)).toMatchObject({
      text: 'Математика',
      subgroups,
      hasMarker: true,
    });
  });

  it('treats a marker without a number as all subgroups', () => {
    expect(stripYgkSubgroupMarkers('Математика п/гр')).toEqual({
      text: 'Математика',
      subgroups: [],
      hasMarker: true,
    });
  });

  it('does not treat discipline codes as subgroup numbers', () => {
    expect(stripYgkSubgroupMarkers('МДК 01.05 п/гр')).toEqual({
      text: 'МДК 01.05',
      subgroups: [],
      hasMarker: true,
    });
    expect(hasYgkSubgroupMarker('УП04')).toBe(false);
  });
});
