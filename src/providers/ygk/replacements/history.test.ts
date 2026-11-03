import { describe, expect, it } from 'vitest';
import type {
  CanonicalReplacements,
  DayOfWeek,
  ParsedReplacements,
  ReplacementPageSource,
  ReplacementShift,
  WeekType,
} from '../../../types.ts';
import { mergeReplacementHistory } from './history.ts';
import { createDiagnostic } from '../../../diagnostics/index.ts';

const source = (
  shift: ReplacementShift,
  sha256: string,
): ReplacementPageSource => ({
  id: `rasp_${shift}.html`,
  fileName: `rasp_${shift}.html`,
  sha256,
  fetchedAt: '2026-09-04T10:00:00.000Z',
  shift,
});

const parsed = (
  date: string,
  shift: ReplacementShift,
  sha256: string,
  day: DayOfWeek = 'Пятница',
  weekType: WeekType = 'numerator',
): { parsed: ParsedReplacements; source: ReplacementPageSource } => ({
  source: source(shift, sha256),
  parsed: {
    hasChanges: true,
    date,
    day,
    shift,
    weekType,
    replacements: [
      {
        date,
        group: 'СТ1-11',
        lessonNumbers: [1],
        type: 'add',
        original: null,
        replacement: { raw: `Замена ${sha256}` },
        source: {
          shift,
          row: 1,
          rawGroupName: 'СТ1-11',
          rawLessonNumbers: '1',
          rawOriginal: '',
          rawReplacement: `Замена ${sha256}`,
          rawRoom: '',
        },
      },
    ],
    diagnostics: [],
  },
});

const canonical = (
  result: ReturnType<typeof mergeReplacementHistory>,
): CanonicalReplacements => ({
  schemaVersion: 5,
  provider: 'ygk',
  generatedAt: '2026-09-04T10:00:00.000Z',
  sources: [],
  version: {
    schemaVersion: 5,
    sourceSetHash: 'source-set',
    parserHash: 'parser',
    configHash: 'config',
    value: 'replacement-version',
  },
  dates: result.dates,
  diagnostics: result.diagnostics,
  semanticHash: 'semantic',
});

describe('YGK replacement history', () => {
  it('attributes historical diagnostics to the actual date, shift and snapshot without changing their fingerprints', () => {
    const page = parsed('2026-09-28', 'first', 'first-28', 'Понедельник');
    const warning = createDiagnostic({
      code: 'UNKNOWN_REPLACEMENT_TYPE',
      severity: 'warning',
      message: 'Неизвестная замена',
      normalizedGroup: 'СД2-31',
      context: { existing: 'kept' },
    });
    page.parsed.diagnostics.push(warning);
    const initial = mergeReplacementHistory(null, [page]);
    const result = mergeReplacementHistory(canonical(initial), [
      parsed('2026-09-29', 'first', 'first-29', 'Вторник'),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        fingerprint: warning.fingerprint,
        context: {
          existing: 'kept',
          date: '2026-09-28',
          shift: 'first',
          sourceSha256: 'first-28',
        },
      }),
    ]);
    expect(
      result.dates['2026-09-28']?.shifts?.first?.diagnostics[0]?.context,
    ).toEqual({ existing: 'kept' });
  });

  it('replaces only the revised shift diagnostics on the same date', () => {
    const first = parsed('2026-09-28', 'first', 'first-old', 'Понедельник');
    const second = parsed('2026-09-28', 'second', 'second-old', 'Понедельник');
    const warning = createDiagnostic({
      code: 'UNKNOWN_REPLACEMENT_TYPE',
      severity: 'warning',
      message: 'Предупреждение',
    });
    first.parsed.diagnostics.push(warning);
    second.parsed.diagnostics.push(warning);
    const initial = mergeReplacementHistory(null, [first, second]);
    const revised = mergeReplacementHistory(canonical(initial), [
      parsed('2026-09-28', 'first', 'first-new', 'Понедельник'),
    ]);
    expect(revised.diagnostics).toHaveLength(1);
    expect(revised.diagnostics[0]?.context).toMatchObject({
      date: '2026-09-28',
      shift: 'second',
      sourceSha256: 'second-old',
    });
  });

  it('finalizes only the previous snapshot of the same shift', () => {
    const first = mergeReplacementHistory(null, [
      parsed('2026-09-04', 'first', 'first-04'),
      parsed('2026-09-04', 'second', 'second-04'),
    ]);
    const second = mergeReplacementHistory(canonical(first), [
      parsed('2026-09-05', 'first', 'first-05', 'Суббота', 'denominator'),
      parsed('2026-09-04', 'second', 'second-04-revised'),
    ]);

    expect(second.dates['2026-09-04']?.shifts?.first).toMatchObject({
      status: 'finalized',
      source: { sha256: 'first-04' },
      finalizedBy: {
        date: '2026-09-05',
        sourceId: 'rasp_first.html',
        sourceSha256: 'first-05',
      },
    });
    expect(second.dates['2026-09-04']?.shifts?.second).toMatchObject({
      status: 'mutable',
      source: { sha256: 'second-04-revised' },
    });
    expect(second.dates['2026-09-05']?.shifts?.first).toMatchObject({
      status: 'mutable',
      source: { sha256: 'first-05' },
    });
  });

  it('does not overwrite a finalized snapshot when a page returns to its date', () => {
    const initial = mergeReplacementHistory(null, [
      parsed('2026-09-04', 'first', 'first-04'),
    ]);
    const finalized = mergeReplacementHistory(canonical(initial), [
      parsed('2026-09-05', 'first', 'first-05', 'Суббота', 'denominator'),
    ]);
    const returned = mergeReplacementHistory(canonical(finalized), [
      parsed('2026-09-04', 'first', 'first-04-unexpected'),
    ]);

    expect(returned.dates['2026-09-04']?.shifts?.first).toMatchObject({
      status: 'finalized',
      source: { sha256: 'first-04' },
    });
    expect(returned.diagnostics).toEqual([
      expect.objectContaining({
        code: 'REPLACEMENT_FINALIZED_SNAPSHOT_REAPPEARED',
        severity: 'warning',
      }),
    ]);
  });
});
