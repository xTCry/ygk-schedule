import { describe, expect, it } from 'vitest';
import { getPublishStageArgs } from './publish-data.ts';

describe('data publication staging', () => {
  it('force-adds all controlled schedule artifacts from a whitelisted data branch', () => {
    expect(getPublishStageArgs('schedule')).toEqual([
      'add',
      '--force',
      'base',
      'ical',
      'meta',
      'sources',
    ]);
  });

  it('force-adds all controlled replacement artifacts from a whitelisted data branch', () => {
    expect(getPublishStageArgs('replacements')).toEqual([
      'add',
      '--force',
      'replacements',
      'actual',
      'ical',
      'meta',
      'sources',
    ]);
  });
});
