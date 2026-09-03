import { describe, expect, it } from 'vitest';
import { formatDiagnosticIssue, isIssueCandidate } from './issues.ts';
import type { Diagnostic, ScheduleSource } from '../types.ts';

const source: ScheduleSource = {
  id: 'https://ygk.example/out.xlsx',
  fileName: 'out.xlsx',
  url: 'https://ygk.example/out.xlsx',
  sha256: 'source-hash',
  fetchedAt: '2026-09-03T12:00:00.000Z',
};

const diagnostic: Diagnostic = {
  provider: 'ygk',
  code: 'INVALID_LESSON_NUMBER',
  severity: 'error',
  message: 'Номер пары должен быть положительным целым числом: 0',
  fingerprint: 'fingerprint',
  sourceId: source.id,
  sourceUrl: 'https://ygk.example/out.xlsx',
  sheet: 'ЮР1-31',
  row: 69,
  column: 1,
  normalizedGroup: 'ЮР1-33/ЮР1-34',
  rawValue: '0',
};

describe('diagnostic Issue drafts', () => {
  it('selects actionable diagnostics and renders their source context', () => {
    expect(isIssueCandidate(diagnostic)).toBe(true);
    expect(
      isIssueCandidate({
        ...diagnostic,
        code: 'HIDDEN_ROW_WITH_DATA',
        severity: 'warning',
      }),
    ).toBe(false);

    const issue = formatDiagnosticIssue(
      [diagnostic, { ...diagnostic, row: 70 }],
      source,
    );
    expect(issue.key).toHaveLength(64);
    expect(issue.fingerprint).toBe('fingerprint');
    expect(issue.title).toBe('[schedule] INVALID_LESSON_NUMBER: out.xlsx');
    expect(issue.occurrenceCount).toBe(2);
    expect(issue.body).toContain('<!-- parser-issue-key:');
    expect(issue.body).toContain('<!-- parser-fingerprint: fingerprint -->');
    expect(issue.body).toContain('| Файл | out.xlsx |');
    expect(issue.body).toContain('| ЮР1-31 | 69 | 1 | ЮР1-33/ЮР1-34 | 0 |');
    expect(issue.body).toContain('| ЮР1-31 | 70 | 1 | ЮР1-33/ЮР1-34 | 0 |');
  });
});
