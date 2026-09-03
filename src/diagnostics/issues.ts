import { sha256 } from '../utils/hash.ts';
import type { Diagnostic, DiagnosticCode, ScheduleSource } from '../types.ts';

export interface DiagnosticIssueDraft {
  key: string;
  fingerprint: string;
  title: string;
  body: string;
  occurrenceCount: number;
}

export const DIAGNOSTIC_ISSUE_KEY_MARKER = 'parser-issue-key';

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
 * Возвращает ключ для синхронизации Issue. Один fingerprint может встретиться
 * в разных XLSX, поэтому в ключ добавляется стабильный идентификатор источника.
 */
export const getDiagnosticIssueKey = (
  fingerprint: string,
  source?: ScheduleSource,
): string => sha256([source?.id ?? '', fingerprint].join('\0'));

/**
 * Извлекает ключ Issue, которым управляет parser, из его скрытого маркера.
 */
export const getDiagnosticIssueKeyFromBody = (
  body: string | null,
): string | null => {
  const match = body?.match(
    new RegExp(`<!-- ${DIAGNOSTIC_ISSUE_KEY_MARKER}: ([a-f0-9]{64}) -->`),
  );
  return match?.[1] ?? null;
};

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
  const key = getDiagnosticIssueKey(diagnostic.fingerprint, source);
  const locations = diagnostics
    .map(
      (item) =>
        `| ${formatTableValue(item.sheet)} | ${formatTableValue(item.row)} | ${formatTableValue(item.column)} | ${formatTableValue(item.normalizedGroup)} | ${formatTableValue(item.rawValue)} |`,
    )
    .join('\n');

  return {
    key,
    fingerprint: diagnostic.fingerprint,
    title: `[schedule] ${diagnostic.code}: ${sourceLabel}`,
    occurrenceCount: diagnostics.length,
    body: `<!-- ${DIAGNOSTIC_ISSUE_KEY_MARKER}: ${key} -->
<!-- parser-fingerprint: ${diagnostic.fingerprint} -->

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
