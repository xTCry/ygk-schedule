import { describe, expect, it } from 'vitest';
import { createDiagnostic, hasFatalDiagnostics } from './index.ts';

describe('diagnostics', () => {
  it('keeps the fingerprint stable when source rows move', () => {
    const first = createDiagnostic({
      code: 'UNKNOWN_WEEK_COLOR',
      severity: 'error',
      message: 'A',
      sheet: 'Лист 1',
      row: 10,
      normalizedGroup: 'СТ1-11',
      fingerprintContext: ['Физика'],
    });
    const second = createDiagnostic({
      code: 'UNKNOWN_WEEK_COLOR',
      severity: 'error',
      message: 'B',
      sheet: 'Лист 2',
      row: 200,
      normalizedGroup: 'СТ1-11',
      fingerprintContext: ['Физика'],
    });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it('changes the fingerprint when semantic context changes', () => {
    const first = createDiagnostic({
      code: 'UNKNOWN_WEEK_COLOR',
      severity: 'error',
      message: 'A',
      normalizedGroup: 'СТ1-11',
      fingerprintContext: ['Физика'],
    });
    const second = createDiagnostic({
      code: 'UNKNOWN_WEEK_COLOR',
      severity: 'error',
      message: 'A',
      normalizedGroup: 'СТ1-11',
      fingerprintContext: ['Математика'],
    });
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it('only blocks on fatal diagnostics', () => {
    const warning = createDiagnostic({
      code: 'EMPTY_SCHEDULE_BLOCK',
      severity: 'warning',
      message: 'A',
    });
    const fatal = createDiagnostic({
      code: 'UNKNOWN_GROUP',
      severity: 'fatal',
      message: 'B',
    });
    expect(hasFatalDiagnostics([warning])).toBe(false);
    expect(hasFatalDiagnostics([warning, fatal])).toBe(true);
  });
});
