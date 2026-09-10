import { describe, expect, it } from 'vitest';
import { replacementSourceUrlForGroup } from './replacement-source.ts';

describe('replacement source link', () => {
  it('adds a browser Text Fragment for the selected group', () => {
    expect(
      replacementSourceUrlForGroup(
        'https://menu.sttec.yar.ru/timetable/rasp_first.html',
        'СД2-31',
      ),
    ).toBe(
      'https://menu.sttec.yar.ru/timetable/rasp_first.html#:~:text=%D0%A1%D0%942%2D31',
    );
  });

  it('preserves an invalid source URL', () => {
    expect(replacementSourceUrlForGroup('not a URL', 'СД2-31')).toBe(
      'not a URL',
    );
  });
});
