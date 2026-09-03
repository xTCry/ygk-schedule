import { describe, expect, it } from 'vitest';
import type { CanonicalSchedule } from '../types.ts';
import { buildDiagnosticsReport } from './diagnostics.ts';

const schedule: CanonicalSchedule = {
  schemaVersion: 3,
  provider: 'ygk',
  generatedAt: '2026-09-03T12:00:00.000Z',
  sources: [
    {
      id: 'source',
      fileName: 'out.xlsx',
      url: 'https://ygk.example/out.xlsx',
      sha256: 'hash',
      fetchedAt: '2026-09-03T12:00:00.000Z',
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
  diagnostics: [
    {
      provider: 'ygk',
      code: 'INVALID_LESSON_NUMBER',
      severity: 'error',
      message: 'Номер пары должен быть положительным целым числом: 0',
      fingerprint: 'fingerprint',
      sourceId: 'source',
      sheet: 'ЮР1-31',
      row: 69,
      column: 1,
    },
    {
      provider: 'ygk',
      code: 'INVALID_LESSON_NUMBER',
      severity: 'error',
      message: 'Номер пары должен быть положительным целым числом: 0',
      fingerprint: 'fingerprint',
      sourceId: 'source',
      sheet: 'ЮР1-31',
      row: 70,
      column: 1,
    },
  ],
  semanticHash: 'semantic',
};

describe('diagnostics metadata generator', () => {
  it('includes source data and an Issue draft for actionable diagnostics', () => {
    const report = buildDiagnosticsReport(schedule);
    expect(report.summary).toEqual({
      info: 0,
      warning: 0,
      error: 2,
      fatal: 0,
    });
    expect(report.diagnostics[0]).toMatchObject({
      source: {
        fileName: 'out.xlsx',
        sha256: 'hash',
        fetchedAt: '2026-09-03T12:00:00.000Z',
      },
      issueFingerprint: 'fingerprint',
    });
    expect(report.issues).toEqual([
      expect.objectContaining({
        fingerprint: 'fingerprint',
        title: '[schedule] INVALID_LESSON_NUMBER: out.xlsx',
        occurrenceCount: 2,
      }),
    ]);
  });
});
