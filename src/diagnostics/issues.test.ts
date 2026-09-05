import { describe, expect, it } from 'vitest';
import {
  formatDiagnosticIssue,
  isIssueCandidate,
  withDiagnosticIssueLinks,
} from './issues.ts';
import type {
  Diagnostic,
  ReplacementPageSource,
  ScheduleSource,
} from '../types.ts';

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
    expect(issue.title).toBe(
      '[schedule][base][error] INVALID_LESSON_NUMBER — ЮР1-33/ЮР1-34',
    );
    expect(issue.labels).toEqual([
      'area:parser',
      'diagnostic:error',
      'diagnostic:invalid-lesson-number',
      'schedule-diagnostic',
      'scope:base',
    ]);
    expect(issue.occurrenceCount).toBe(2);
    expect(issue.body).toContain('<!-- parser-issue-key:');
    expect(issue.body).toContain('<!-- parser-fingerprint: fingerprint -->');
    expect(issue.body).toContain('| Файл | out.xlsx |');
    expect(issue.body).toContain(
      '| ЮР1-31 | 69 | 1 | ЮР1-33/ЮР1-34 | — | — | 0 |',
    );
    expect(issue.body).toContain(
      '| ЮР1-31 | 70 | 1 | ЮР1-33/ЮР1-34 | — | — | 0 |',
    );
  });

  it('aggregates unresolved replacements from one source, date and reason', () => {
    const replacementSource: ReplacementPageSource = {
      ...source,
      fileName: 'rasp_first.html',
      shift: 'first',
    };
    const first: Diagnostic = {
      ...diagnostic,
      code: 'UNRESOLVED_REPLACEMENT',
      message:
        'Исходная дисциплина из замены не совпала с парой базового расписания',
      fingerprint: 'first-fingerprint',
      row: 3,
      normalizedGroup: 'СТ1-15',
      rawValue: 'Теория',
      context: {
        date: '2026-09-05',
        lessonNumber: 1,
        type: 'replace',
        reason: 'original-not-matched',
      },
    };
    const second: Diagnostic = {
      ...first,
      fingerprint: 'second-fingerprint',
      row: 4,
      normalizedGroup: 'РК1-11',
      rawValue: 'Информатика',
      context: { ...first.context, lessonNumber: 2 },
    };

    const issue = formatDiagnosticIssue([first, second], replacementSource);

    expect(issue.occurrenceCount).toBe(2);
    expect(issue.title).toBe(
      '[schedule][base][error] UNRESOLVED_REPLACEMENT / original-not-matched — 2026-09-05, первая смена',
    );
    expect(issue.labels).toEqual([
      'area:resolver',
      'diagnostic:error',
      'diagnostic:unresolved-replacement',
      'reason:original-not-matched',
      'schedule-diagnostic',
      'scope:base',
      'shift:first',
    ]);
    expect(issue.body).toContain('| Причина | original-not-matched |');
    expect(issue.body).toContain('| Дата замен | 2026-09-05 |');
    expect(issue.body).toContain('| Смена | первая смена |');
    expect(issue.body).toContain('| СТ1-15 | 1 | replace | Теория |');
    expect(issue.body).toContain('| РК1-11 | 2 | replace | Информатика |');
  });

  it('adds immutable data and parser links only for Issue evidence', () => {
    const issue = formatDiagnosticIssue([diagnostic], source, {
      scope: 'base',
      evidence: {
        diagnosticsJsonPath: 'base/90-diagnostics.json',
        diagnosticsYamlPath: 'base/90-diagnostics.yaml',
        directory: 'base/91-issue-evidence',
      },
    });

    const linked = withDiagnosticIssueLinks(issue, {
      repository: 'xTCry/ygk-schedule',
      dataRevision: 'a'.repeat(40),
      parserRevision: 'b'.repeat(40),
    });

    expect(linked.body).toContain('## Ревизии и данные');
    expect(linked.body).toContain(
      'https://github.com/xTCry/ygk-schedule/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/base/91-issue-evidence/',
    );
    expect(linked.body).toContain(
      'https://github.com/xTCry/ygk-schedule/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );
  });
});
