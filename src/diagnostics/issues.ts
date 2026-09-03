import type { Diagnostic, DiagnosticCode, ScheduleSource } from '../types.ts';

export interface DiagnosticIssueDraft {
  fingerprint: string;
  title: string;
  body: string;
  occurrenceCount: number;
}

const issueWarningCodes = new Set<DiagnosticCode>([
  'CONFLICTING_WEEK_COLOR',
  'DUPLICATE_GROUP',
  'EMPTY_SCHEDULE_BLOCK',
]);

const formatTableValue = (value: string | number | undefined): string =>
  value === undefined || value === ''
    ? '—'
    : String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

const sourceValue = (
  source: ScheduleSource | undefined,
  key: keyof ScheduleSource,
): string | undefined => source?.[key];

/**
 * Определяет, нужно ли создавать или обновлять Issue для этой диагностики.
 */
export const isIssueCandidate = (diagnostic: Diagnostic): boolean =>
  diagnostic.severity === 'error' ||
  diagnostic.severity === 'fatal' ||
  issueWarningCodes.has(diagnostic.code);

/**
 * Формирует один структурированный черновик GitHub Issue для повторяющейся
 * проблемы. Все diagnostics должны относиться к одному fingerprint.
 */
export const formatDiagnosticIssue = (
  diagnostics: readonly Diagnostic[],
  source?: ScheduleSource,
): DiagnosticIssueDraft => {
  const diagnostic = diagnostics[0];
  if (!diagnostic)
    throw new Error('Cannot create an Issue draft without diagnostics');

  const sourceLabel =
    source?.fileName ?? diagnostic.sourceId ?? 'unknown-source';
  const locations = diagnostics
    .map(
      (item) =>
        `| ${formatTableValue(item.sheet)} | ${formatTableValue(item.row)} | ${formatTableValue(item.column)} | ${formatTableValue(item.normalizedGroup)} | ${formatTableValue(item.rawValue)} |`,
    )
    .join('\n');

  return {
    fingerprint: diagnostic.fingerprint,
    title: `[schedule] ${diagnostic.code}: ${sourceLabel}`,
    occurrenceCount: diagnostics.length,
    body: `<!-- parser-fingerprint: ${diagnostic.fingerprint} -->

## Причина

${diagnostic.message}

## Источник

| Поле | Значение |
| --- | --- |
| Файл | ${formatTableValue(sourceValue(source, 'fileName'))} |
| URL | ${formatTableValue(sourceValue(source, 'url'))} |
| SHA-256 | ${formatTableValue(sourceValue(source, 'sha256'))} |
| Загружен | ${formatTableValue(sourceValue(source, 'fetchedAt'))} |
| Уровень | ${diagnostic.severity} |
| Код | ${diagnostic.code} |

## Затронутые ячейки

| Лист | Строка | Колонка | Группа | Исходное значение |
| --- | --- | --- | --- | --- |
${locations}
`,
  };
};
