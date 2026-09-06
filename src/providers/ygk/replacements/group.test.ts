import { describe, expect, it } from 'vitest';
import type { ReplacementAliases } from './config.ts';
import { resolveYgkReplacementGroup } from './group.ts';

const aliases = (): ReplacementAliases => ({
  groups: new Map(),
  subjects: new Map(),
  teachers: new Map(),
  rooms: new Map(),
});

describe('YGK replacement group resolver', () => {
  it('matches a numbered specialty group exactly', () => {
    expect(
      resolveYgkReplacementGroup(
        '36 ЭМЕХ',
        ['36 ЭМЕХ', '2 БПЛА', '4 ИКС'],
        aliases(),
      ),
    ).toEqual({
      group: '36 ЭМЕХ',
      strategy: 'exact',
      candidates: ['36 ЭМЕХ'],
    });
  });

  it('keeps a group unresolved when it is absent from the base schedule', () => {
    expect(
      resolveYgkReplacementGroup('4 ИКС', ['5 ИКС', '6 ИКС'], aliases()),
    ).toEqual({
      group: null,
      strategy: 'unresolved',
      candidates: [],
    });
  });

  it('prioritizes an explicit alias over an exact match', () => {
    const configuredAliases = aliases();
    configuredAliases.groups = new Map([['4икс', '6 ИКС']]);

    expect(
      resolveYgkReplacementGroup(
        '4 ИКС',
        ['4 ИКС', '6 ИКС'],
        configuredAliases,
      ),
    ).toEqual({
      group: '6 ИКС',
      strategy: 'alias',
      candidates: ['6 ИКС'],
    });
  });
});
