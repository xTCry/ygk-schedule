import { describe, expect, it } from 'vitest';
import type { CanonicalSchedule, ReplacementPageSource } from '../types.ts';
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

  it('groups unresolved replacements with a shared source and reason', () => {
    const replacementSource: ReplacementPageSource = {
      ...schedule.sources[0]!,
      fileName: 'rasp_first.html',
      shift: 'first',
    };
    const report = buildDiagnosticsReport({
      ...schedule,
      sources: [replacementSource],
      diagnostics: [
        {
          ...schedule.diagnostics[0]!,
          code: 'UNRESOLVED_REPLACEMENT',
          fingerprint: 'replacement-one',
          context: {
            date: '2026-09-05',
            lessonNumber: 1,
            type: 'replace',
            reason: 'original-not-matched',
          },
        },
        {
          ...schedule.diagnostics[1]!,
          code: 'UNRESOLVED_REPLACEMENT',
          fingerprint: 'replacement-two',
          context: {
            date: '2026-09-05',
            lessonNumber: 2,
            type: 'replace',
            reason: 'original-not-matched',
          },
        },
      ],
    });

    expect(report.schemaVersion).toBe(4);
    expect(report.issues).toHaveLength(1);
    const issueFingerprint = report.issues[0]?.fingerprint;
    if (!issueFingerprint)
      throw new Error('Expected generated Issue fingerprint');
    expect(report.issues[0]?.occurrenceCount).toBe(2);
    expect(report.issues[0]?.labels).toContain('reason:original-not-matched');
    expect(report.issues[0]?.labels).toContain('shift:first');
    expect(report.diagnostics.map((item) => item.issueFingerprint)).toEqual([
      issueFingerprint,
      issueFingerprint,
    ]);
  });
});
