import { describe, expect, it } from 'vitest';
import {
  diagnosticIsCommon,
  diagnosticIsForDate,
} from './diagnostic-visibility.ts';
import type { Diagnostic } from './types.ts';

describe('diagnostic date visibility', () => {
  const historical: Diagnostic = {
    severity: 'warning',
    code: 'UNKNOWN_REPLACEMENT_TYPE',
    message: 'Поход',
    context: { date: '2026-09-28', shift: 'first', sourceSha256: 'old' },
  };
  it('shows a historical diagnostic only on its own date', () => {
    expect(diagnosticIsCommon(historical)).toBe(false);
    expect(diagnosticIsForDate(historical, '2026-09-28')).toBe(true);
    expect(diagnosticIsForDate(historical, '2026-11-03')).toBe(false);
  });
  it('keeps undated base diagnostics in the common section', () => {
    expect(diagnosticIsCommon({ ...historical, context: {} })).toBe(true);
  });
});
