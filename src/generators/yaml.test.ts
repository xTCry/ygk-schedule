import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { CanonicalSchedule } from '../types.ts';
import { serializeSchedule } from './json.ts';
import { serializeScheduleYaml, serializeYaml } from './yaml.ts';

const schedule: CanonicalSchedule = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T00:00:00.000Z',
  sources: [
    {
      id: 'https://ygk.example/so.xlsx',
      fileName: 'so.xlsx',
      sha256: 'source',
      fetchedAt: '2026-09-03T00:00:00.000Z',
    },
  ],
  version: {
    schemaVersion: 3,
    sourceSetHash: 'source',
    parserHash: 'parser',
    configHash: 'config',
    value: 'version',
  },
  groups: {},
  diagnostics: [],
  semanticHash: 'semantic',
};

describe('YAML schedule generator', () => {
  it('uses two-space indentation and preserves the JSON data model', () => {
    const yaml = serializeScheduleYaml(schedule);
    expect(yaml).toContain('version:\n  schemaVersion: 3');
    expect(parse(yaml)).toEqual(JSON.parse(serializeSchedule(schedule)));
  });

  it('does not introduce aliases for repeated object references', () => {
    const source = {
      id: 'https://ygk.example/so.xlsx',
      sha256: 'source',
    };
    const value = { sources: [source], snapshot: { source } };

    const first = serializeYaml(value);
    const second = serializeYaml(value);

    expect(first).toBe(second);
    expect(first).not.toMatch(/(^|\s)[&*][A-Za-z]\d*/u);
    expect(parse(first)).toEqual(JSON.parse(JSON.stringify(value)));
  });
});
