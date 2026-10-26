import { describe, expect, it } from 'vitest';
import type {
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
  ReplacementPageSource,
  ScheduleSource,
} from '../types.ts';
import type { DiagnosticsReport } from '../generators/diagnostics.ts';
import {
  formatReplacementsUpdateSummary,
  formatScheduleUpdateSummary,
} from './summary.ts';

const source = (fileName: string, url: string): ScheduleSource => ({
  id: fileName,
  fileName,
  sha256: 'hash',
  fetchedAt: '2026-10-26T12:00:00.000Z',
  url,
});

const diagnostics = {
  summary: { info: 0, warning: 0, error: 0, fatal: 0 },
} as DiagnosticsReport;

const schedule = (sources: ScheduleSource[]): CanonicalSchedule => ({
  schemaVersion: 1,
  provider: 'ygk',
  generatedAt: '2026-10-26T12:00:00.000Z',
  sources,
  version: {
    schemaVersion: 1,
    sourceSetHash: 'source-set-hash',
    parserHash: 'parser-hash',
    configHash: 'config-hash',
    value: 'schedule-version',
  },
  groups: {
    'ТЕСТ-11': {
      group: 'ТЕСТ-11',
      sourceGroups: [],
      sourceBlocks: [],
      days: [
        {
          day: 'Понедельник',
          lessons: [
            {
              number: 1,
              variants: [],
              source: {
                sheet: 'Лист1',
                rowStart: 1,
                rowEnd: 1,
                rawGroupName: 'ТЕСТ-11',
              },
            },
            {
              number: 2,
              variants: [],
              source: {
                sheet: 'Лист1',
                rowStart: 2,
                rowEnd: 2,
                rawGroupName: 'ТЕСТ-11',
              },
            },
          ],
        },
      ],
    },
  },
  diagnostics: [],
  semanticHash: 'semantic-hash',
});

const replacementSource = (
  shift: ReplacementPageSource['shift'],
): ReplacementPageSource => ({
  ...source(`rasp_${shift}.html`, `https://example.test/rasp_${shift}.html`),
  shift,
});

const replacements = (
  sources: ReplacementPageSource[],
): CanonicalReplacements => ({
  schemaVersion: 1,
  provider: 'ygk',
  generatedAt: '2026-10-26T12:00:00.000Z',
  sources,
  version: {
    schemaVersion: 1,
    sourceSetHash: 'source-set-hash',
    parserHash: 'parser-hash',
    configHash: 'config-hash',
    value: 'replacement-version',
  },
  dates: {
    '2026-10-27': {
      date: '2026-10-27',
      day: 'Вторник',
      weekType: 'numerator',
      replacements: [],
    },
  },
  diagnostics: [],
  semanticHash: 'semantic-hash',
});

const actual: ActualSchedule = {
  schemaVersion: 1,
  provider: 'ygk',
  generatedAt: '2026-10-26T12:00:00.000Z',
  sources: [],
  version: {
    schemaVersion: 1,
    sourceSetHash: 'source-set-hash',
    parserHash: 'parser-hash',
    configHash: 'config-hash',
    value: 'actual-version',
  },
  baseScheduleVersion: 'schedule-version',
  replacementVersion: 'replacement-version',
  dates: {
    '2026-10-27': {
      date: '2026-10-27',
      day: 'Вторник',
      weekType: 'numerator',
      groups: {
        'ТЕСТ-11': {
          group: 'ТЕСТ-11',
          date: '2026-10-27',
          day: 'Вторник',
          lessons: [
            {
              number: 1,
              variants: [],
              source: null,
              status: 'scheduled',
              replacements: [],
            },
          ],
          unresolvedReplacements: [],
        },
      },
    },
  },
  diagnostics: [],
  semanticHash: 'semantic-hash',
};

describe('workflow source health summary', () => {
  it('lists all discovered XLSX files and reports a healthy source set', () => {
    const summary = formatScheduleUpdateSummary(
      schedule([
        source('first.xlsx', 'https://example.test/first.xlsx'),
        source('second.xlsx', 'https://example.test/second.xlsx'),
      ]),
      diagnostics,
      true,
    );

    expect(summary).toContain('Пар в шаблоне: **2**');
    expect(summary).toContain('✅ Обнаружено файлов: **2**');
    expect(summary).toContain('[first.xlsx](https://example.test/first.xlsx)');
    expect(summary).not.toContain('Необычно мало XLSX');
  });

  it('marks an unexpectedly small XLSX source set as suspicious', () => {
    const summary = formatScheduleUpdateSummary(
      schedule([source('only.xlsx', 'https://example.test/only.xlsx')]),
      diagnostics,
      false,
    );

    expect(summary).toContain('⚠️ Обнаружено файлов: **1**');
    expect(summary).toContain('Необычно мало XLSX');
  });

  it('shows the state of both replacement pages and missing shifts', () => {
    const healthy = formatReplacementsUpdateSummary(
      replacements([replacementSource('first'), replacementSource('second')]),
      actual,
      diagnostics,
      true,
    );
    const missingSecond = formatReplacementsUpdateSummary(
      replacements([replacementSource('first')]),
      actual,
      diagnostics,
      false,
    );

    expect(healthy).toContain('✅ Страницы: первая смена, вторая смена');
    expect(healthy).toContain('Пар в actual-расписании: **1**');
    expect(missingSecond).toContain('вторая смена — отсутствует');
    expect(missingSecond).toContain(
      'Отсутствует одна из обязательных страниц замен',
    );
  });
});
