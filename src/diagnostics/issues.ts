import { sha256 } from '../utils/hash.ts';
import type { Diagnostic, DiagnosticCode, ScheduleSource } from '../types.ts';

export interface DiagnosticIssueDraft {
  key: string;
  fingerprint: string;
  title: string;
  body: string;
  labels: string[];
  occurrenceCount: number;
}

export const DIAGNOSTIC_ISSUE_KEY_MARKER = 'parser-issue-key';
export const SCHEDULE_DIAGNOSTIC_LABEL = 'schedule-diagnostic';

const diagnosticLabelPrefix = 'diagnostic:';
const reasonLabelPrefix = 'reason:';
const shiftLabelPrefix = 'shift:';

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

const contextString = (
  diagnostic: Diagnostic,
  key: string,
): string | undefined => {
  const value = diagnostic.context?.[key];
  return typeof value === 'string' && value ? value : undefined;
};

const contextNumber = (
  diagnostic: Diagnostic,
  key: string,
): number | undefined => {
  const value = diagnostic.context?.[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

const labelSegment = (value: string): string =>
  value.toLocaleLowerCase('en-US').replace(/_/g, '-');

const replacementShift = (
  source: ScheduleSource | undefined,
): 'first' | 'second' | undefined => {
  const shift = (source as { shift?: unknown } | undefined)?.shift;
  return shift === 'first' || shift === 'second' ? shift : undefined;
};

const replacementShiftLabel = (
  source: ScheduleSource | undefined,
): string | undefined => {
  const shift = replacementShift(source);
  if (!shift) return undefined;
  return shift === 'first' ? 'первая смена' : 'вторая смена';
};

const commonContextString = (
  diagnostics: readonly Diagnostic[],
  key: string,
): string | undefined => {
  const values = new Set(
    diagnostics
      .map((diagnostic) => contextString(diagnostic, key))
      .filter((value): value is string => Boolean(value)),
  );
  return values.size === 1 ? [...values][0] : undefined;
};

const commonGroup = (
  diagnostics: readonly Diagnostic[],
): string | undefined => {
  const groups = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.normalizedGroup)
      .filter((group): group is string => Boolean(group)),
  );
  return groups.size === 1 ? [...groups][0] : undefined;
};

/**
 * Возвращает ключ агрегации для Issue.
 *
 * Замены с одинаковой причиной на одной странице и дату составляют одну
 * проблему: строка HTML может описывать несколько групп или пар. Остальные
 * diagnostics по-прежнему группируются по своему стабильному fingerprint.
 */
export const getDiagnosticIssueGroupKey = (
  diagnostic: Diagnostic,
  source?: ScheduleSource,
): string => {
  if (diagnostic.code !== 'UNRESOLVED_REPLACEMENT')
    return `fingerprint\0${source?.id ?? ''}\0${diagnostic.fingerprint}`;

  return [
    'replacement',
    source?.id ?? '',
    diagnostic.code,
    diagnostic.severity,
    contextString(diagnostic, 'reason') ?? '',
    contextString(diagnostic, 'date') ?? '',
  ].join('\0');
};

const issueFingerprint = (
  diagnostic: Diagnostic,
  source: ScheduleSource | undefined,
): string =>
  diagnostic.code === 'UNRESOLVED_REPLACEMENT'
    ? sha256(getDiagnosticIssueGroupKey(diagnostic, source))
    : diagnostic.fingerprint;

const issueLabels = (
  diagnostic: Diagnostic,
  source: ScheduleSource | undefined,
): string[] => {
  const reason = contextString(diagnostic, 'reason');
  const shift = replacementShift(source);
  return [
    SCHEDULE_DIAGNOSTIC_LABEL,
    `${diagnosticLabelPrefix}${diagnostic.severity}`,
    `${diagnosticLabelPrefix}${labelSegment(diagnostic.code)}`,
    ...(reason ? [`${reasonLabelPrefix}${labelSegment(reason)}`] : []),
    ...(shift ? [`${shiftLabelPrefix}${shift}`] : []),
  ].sort((left, right) => left.localeCompare(right));
};

const issueTitle = (
  diagnostics: readonly Diagnostic[],
  source: ScheduleSource | undefined,
): string => {
  const diagnostic = diagnostics[0];
  if (!diagnostic)
    throw new Error('Cannot create an Issue title without diagnostics');
  const sourceLabel =
    source?.fileName ?? diagnostic.sourceId ?? 'unknown-source';
  const group = commonGroup(diagnostics);
  if (diagnostic.code !== 'UNRESOLVED_REPLACEMENT')
    return `[schedule] ${diagnostic.code}: ${sourceLabel}${group ? ` — ${group}` : ''}`;

  const reason = commonContextString(diagnostics, 'reason') ?? 'unknown-reason';
  const date = commonContextString(diagnostics, 'date');
  const shift = replacementShiftLabel(source);
  const scope = [date, shift].filter(Boolean).join(', ');
  return `[schedule] ${diagnostic.code} / ${reason}: ${sourceLabel}${scope ? ` (${scope})` : ''}`;
};

const issueClassificationRows = (
  diagnostics: readonly Diagnostic[],
  source: ScheduleSource | undefined,
): string[] => {
  const diagnostic = diagnostics[0];
  if (!diagnostic) return [];
  const reason = commonContextString(diagnostics, 'reason');
  const date = commonContextString(diagnostics, 'date');
  const shift = replacementShiftLabel(source);
  return [
    `| Уровень | ${formatTableValue(diagnostic.severity)} |`,
    `| Код | ${formatTableValue(diagnostic.code)} |`,
    ...(reason ? [`| Причина | ${formatTableValue(reason)} |`] : []),
    ...(date ? [`| Дата замен | ${formatTableValue(date)} |`] : []),
    ...(shift ? [`| Смена | ${formatTableValue(shift)} |`] : []),
    `| Строк в Issue | ${diagnostics.length} |`,
  ];
};

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

  const fingerprint = issueFingerprint(diagnostic, source);
  const key = getDiagnosticIssueKey(fingerprint, source);
  const locations = diagnostics
    .map((item) => {
      const lessonNumber = contextNumber(item, 'lessonNumber');
      const replacementType = contextString(item, 'type');
      return `| ${formatTableValue(item.sheet)} | ${formatTableValue(item.row)} | ${formatTableValue(item.column)} | ${formatTableValue(item.normalizedGroup)} | ${formatTableValue(lessonNumber)} | ${formatTableValue(replacementType)} | ${formatTableValue(item.rawValue)} |`;
    })
    .join('\n');

  return {
    key,
    fingerprint,
    title: issueTitle(diagnostics, source),
    labels: issueLabels(diagnostic, source),
    occurrenceCount: diagnostics.length,
    body: `<!-- ${DIAGNOSTIC_ISSUE_KEY_MARKER}: ${key} -->
<!-- parser-fingerprint: ${fingerprint} -->

## Причина

${diagnostic.message}

## Классификация

| Поле | Значение |
| --- | --- |
${issueClassificationRows(diagnostics, source).join('\n')}

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

| Лист | Строка | Колонка | Группа | Пара | Тип | Исходное значение |
| --- | --- | --- | --- | --- | --- | --- |
${locations}
`,
  };
};
