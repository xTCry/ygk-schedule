import { sha256 } from '../utils/hash.ts';
import type { Diagnostic, DiagnosticCode, ScheduleSource } from '../types.ts';

export type DiagnosticsScope = 'base' | 'replacements' | 'actual';

export interface DiagnosticIssueEvidenceReference {
  diagnosticsJsonPath: string;
  diagnosticsYamlPath: string;
  jsonPath: string;
  yamlPath: string;
}

export interface DiagnosticIssueDraft {
  key: string;
  /**
   * Устойчивый ключ семьи одной проблемы. В отличие от `key`, не зависит от
   * fingerprint конкретной диагностики и помогает обновить Issue после
   * небольшой корректировки parser-а.
   */
  familyKey: string;
  fingerprint: string;
  scope: DiagnosticsScope;
  /**
   * Постоянные diagnostics base и ограниченные одной датой diagnostics замен
   * имеют разный lifecycle в GitHub.
   */
  lifecycle: 'persistent' | 'dated';
  /**
   * Дата наблюдения для временной Issue замен в формате YYYY-MM-DD.
   */
  observedDate?: string;
  title: string;
  body: string;
  labels: string[];
  occurrenceCount: number;
  /**
   * Стабильные идентификаторы строк внутри одной Issue. Они не отображаются
   * пользователю, но позволяют посчитать дельту между двумя снимками.
   */
  observationKeys: string[];
  evidence?: DiagnosticIssueEvidenceReference;
}

export const DIAGNOSTIC_ISSUE_KEY_MARKER = 'parser-issue-key';
export const DIAGNOSTIC_ISSUE_FAMILY_KEY_MARKER = 'diagnostic-family-key';
export const DIAGNOSTIC_ISSUE_LIFECYCLE_MARKER = 'diagnostic-lifecycle';
export const DIAGNOSTIC_ISSUE_OBSERVATIONS_MARKER =
  'diagnostic-observation-keys';
export const SCHEDULE_DIAGNOSTIC_LABEL = 'schedule-diagnostic';

const diagnosticLabelPrefix = 'diagnostic:';
const reasonLabelPrefix = 'reason:';
const shiftLabelPrefix = 'shift:';
const scopeLabelPrefix = 'scope:';
const areaLabelPrefix = 'area:';

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

const diagnosticsScopeTitle = (scope: DiagnosticsScope): string =>
  ({
    base: 'base',
    replacements: 'replacements',
    actual: 'actual',
  })[scope];

const diagnosticArea = (
  diagnostic: Diagnostic,
  scope: DiagnosticsScope,
): 'parser' | 'resolver' => {
  if (
    scope === 'actual' ||
    diagnostic.code === 'UNRESOLVED_REPLACEMENT' ||
    diagnostic.code === 'AMBIGUOUS_REPLACEMENT'
  )
    return 'resolver';
  return 'parser';
};

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

const normalizedContext = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizedContext);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizedContext(item)]),
  );
};

/**
 * Идентифицирует отдельную строку внутри агрегированной Issue. В ключ не
 * входят временные metadata загрузки, поэтому повторная проверка того же
 * источника не создаёт ложную дельту.
 */
const diagnosticObservationKey = (diagnostic: Diagnostic): string =>
  sha256(
    JSON.stringify({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      sourceId: diagnostic.sourceId,
      sheet: diagnostic.sheet,
      row: diagnostic.row,
      column: diagnostic.column,
      normalizedGroup: diagnostic.normalizedGroup,
      rawValue: diagnostic.rawValue,
      context: normalizedContext(diagnostic.context),
    }),
  );

/**
 * Возвращает ключ семьи Issue без volatile fingerprint. Он намеренно
 * консервативен: разные источник, группа или ячейка base-расписания не
 * объединяются автоматически.
 */
export const getDiagnosticIssueFamilyKey = (
  diagnostic: Diagnostic,
  source: ScheduleSource | undefined,
  scope: DiagnosticsScope,
): string => {
  if (diagnostic.code === 'UNRESOLVED_REPLACEMENT')
    return sha256(
      [
        'replacement',
        scope,
        source?.id ?? '',
        diagnostic.code,
        diagnostic.severity,
        contextString(diagnostic, 'reason') ?? '',
        contextString(diagnostic, 'date') ?? '',
      ].join('\0'),
    );

  return sha256(
    [
      'diagnostic',
      scope,
      source?.id ?? '',
      diagnostic.code,
      diagnostic.severity,
      diagnostic.normalizedGroup ?? '',
      diagnostic.sheet ?? '',
      String(diagnostic.row ?? ''),
      String(diagnostic.column ?? ''),
    ].join('\0'),
  );
};

const issueLabels = (
  diagnostic: Diagnostic,
  source: ScheduleSource | undefined,
  scope: DiagnosticsScope,
): string[] => {
  const reason = contextString(diagnostic, 'reason');
  const shift = replacementShift(source);
  return [
    SCHEDULE_DIAGNOSTIC_LABEL,
    `${scopeLabelPrefix}${scope}`,
    `${areaLabelPrefix}${diagnosticArea(diagnostic, scope)}`,
    `${diagnosticLabelPrefix}${diagnostic.severity}`,
    `${diagnosticLabelPrefix}${labelSegment(diagnostic.code)}`,
    ...(reason ? [`${reasonLabelPrefix}${labelSegment(reason)}`] : []),
    ...(shift ? [`${shiftLabelPrefix}${shift}`] : []),
  ].sort((left, right) => left.localeCompare(right));
};

const issueTitle = (
  diagnostics: readonly Diagnostic[],
  source: ScheduleSource | undefined,
  scope: DiagnosticsScope,
): string => {
  const diagnostic = diagnostics[0];
  if (!diagnostic)
    throw new Error('Cannot create an Issue title without diagnostics');
  const group = commonGroup(diagnostics);
  const prefix = `[schedule][${diagnosticsScopeTitle(scope)}][${diagnostic.severity}] ${diagnostic.code}`;
  if (diagnostic.code !== 'UNRESOLVED_REPLACEMENT')
    return `${prefix}${group ? ` — ${group}` : ''}`;

  const reason = commonContextString(diagnostics, 'reason') ?? 'unknown-reason';
  const date = commonContextString(diagnostics, 'date');
  const shift = replacementShiftLabel(source);
  const replacementScope = [date, shift].filter(Boolean).join(', ');
  return `${prefix} / ${reason}${replacementScope ? ` — ${replacementScope}` : ''}`;
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

const markerValue = (body: string | null, marker: string): string | null => {
  const match = body?.match(new RegExp(`<!-- ${marker}: ([^\\n]+) -->`));
  return match?.[1] ?? null;
};

/** Извлекает ключ семьи из managed Issue нового формата. */
export const getDiagnosticIssueFamilyKeyFromBody = (
  body: string | null,
): string | null => {
  const value = markerValue(body, DIAGNOSTIC_ISSUE_FAMILY_KEY_MARKER);
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : null;
};

/**
 * Извлекает lifecycle Issue. Старые Issue замен распознаются по видимой дате,
 * чтобы при миграции корректно закрываться как исторические.
 */
export const getDiagnosticIssueLifecycleFromBody = (
  body: string | null,
): { lifecycle: 'persistent' | 'dated'; observedDate?: string } => {
  const lifecycle = markerValue(body, DIAGNOSTIC_ISSUE_LIFECYCLE_MARKER);
  const observedDate = body?.match(
    /^\| Дата замен \| (\d{4}-\d{2}-\d{2}) \|$/mu,
  )?.[1];
  return {
    lifecycle: lifecycle === 'dated' || observedDate ? 'dated' : 'persistent',
    ...(observedDate ? { observedDate } : {}),
  };
};

/** Извлекает набор строк предыдущего снимка Issue для построения дельты. */
export const getDiagnosticIssueObservationKeysFromBody = (
  body: string | null,
): string[] => {
  const value = markerValue(body, DIAGNOSTIC_ISSUE_OBSERVATIONS_MARKER);
  if (!value) return [];
  const keys = value.split(',').filter((key) => /^[a-f0-9]{64}$/u.test(key));
  return [...new Set(keys)].sort((left, right) => left.localeCompare(right));
};

/**
 * Определяет, нужно ли создавать или обновлять Issue для этой диагностики.
 */
export const isIssueCandidate = (diagnostic: Diagnostic): boolean =>
  diagnostic.severity === 'error' ||
  diagnostic.severity === 'fatal' ||
  issueWarningCodes.has(diagnostic.code);

export interface DiagnosticIssueFormattingOptions {
  scope?: DiagnosticsScope;
  evidence?: Omit<DiagnosticIssueEvidenceReference, 'jsonPath' | 'yamlPath'> & {
    directory: string;
  };
}

export interface DiagnosticIssueLinkOptions {
  repository: string;
  dataRevision?: string;
  parserRevision?: string;
}

const commitLink = (
  repository: string,
  revision: string | undefined,
): string =>
  revision
    ? `[\`${revision.slice(0, 12)}\`](https://github.com/${repository}/commit/${revision})`
    : '—';

const dataFileLink = (
  repository: string,
  revision: string | undefined,
  path: string,
): string =>
  revision
    ? `[\`${path}\`](https://github.com/${repository}/blob/${revision}/${path})`
    : `\`${path}\``;

/**
 * Добавляет к черновику ссылки на неизменяемые revision code и data.
 *
 * Сами diagnostics остаются независимыми от GitHub: ссылки появляются только
 * перед синхронизацией Issue в workflow либо при локальном запуске с `--repo`.
 */
export const withDiagnosticIssueLinks = (
  issue: DiagnosticIssueDraft,
  options: DiagnosticIssueLinkOptions,
): DiagnosticIssueDraft => {
  if (!issue.evidence) return issue;
  const body = `${issue.body}
<!-- diagnostics-links: ${options.dataRevision ?? 'unpublished'} -->

## Ревизии и данные

| Поле | Значение |
| --- | --- |
| Ревизия parser | ${commitLink(options.repository, options.parserRevision)} |
| Ревизия data | ${commitLink(options.repository, options.dataRevision)} |
| Diagnostics JSON | ${dataFileLink(options.repository, options.dataRevision, issue.evidence.diagnosticsJsonPath)} |
| Diagnostics YAML | ${dataFileLink(options.repository, options.dataRevision, issue.evidence.diagnosticsYamlPath)} |
| Evidence JSON | ${dataFileLink(options.repository, options.dataRevision, issue.evidence.jsonPath)} |
| Evidence YAML | ${dataFileLink(options.repository, options.dataRevision, issue.evidence.yamlPath)} |
`;
  return { ...issue, body };
};

/**
 * Формирует один структурированный черновик GitHub Issue для повторяющейся
 * проблемы. Все diagnostics должны относиться к одному fingerprint.
 */
export const formatDiagnosticIssue = (
  diagnostics: readonly Diagnostic[],
  source?: ScheduleSource,
  options: DiagnosticIssueFormattingOptions = {},
): DiagnosticIssueDraft => {
  const diagnostic = diagnostics[0];
  if (!diagnostic)
    throw new Error('Cannot create an Issue draft without diagnostics');

  const scope = options.scope ?? 'base';
  const fingerprint = issueFingerprint(diagnostic, source);
  const key = getDiagnosticIssueKey(fingerprint, source);
  const observedDate = commonContextString(diagnostics, 'date');
  const lifecycle =
    diagnostic.code === 'UNRESOLVED_REPLACEMENT' && observedDate
      ? 'dated'
      : 'persistent';
  const observationKeys = diagnostics
    .map(diagnosticObservationKey)
    .sort((left, right) => left.localeCompare(right));
  const familyKey = getDiagnosticIssueFamilyKey(diagnostic, source, scope);
  const locations = diagnostics
    .map((item) => {
      const lessonNumber = contextNumber(item, 'lessonNumber');
      const replacementType = contextString(item, 'type');
      return `| ${formatTableValue(item.sheet)} | ${formatTableValue(item.row)} | ${formatTableValue(item.column)} | ${formatTableValue(item.normalizedGroup)} | ${formatTableValue(lessonNumber)} | ${formatTableValue(replacementType)} | ${formatTableValue(item.rawValue)} |`;
    })
    .join('\n');

  return {
    key,
    familyKey,
    fingerprint,
    scope,
    lifecycle,
    ...(lifecycle === 'dated' && observedDate ? { observedDate } : {}),
    title: issueTitle(diagnostics, source, scope),
    labels: issueLabels(diagnostic, source, scope),
    occurrenceCount: diagnostics.length,
    observationKeys,
    ...(options.evidence
      ? {
          evidence: {
            diagnosticsJsonPath: options.evidence.diagnosticsJsonPath,
            diagnosticsYamlPath: options.evidence.diagnosticsYamlPath,
            jsonPath: `${options.evidence.directory}/${key}.json`,
            yamlPath: `${options.evidence.directory}/${key}.yaml`,
          },
        }
      : {}),
    body: `<!-- ${DIAGNOSTIC_ISSUE_KEY_MARKER}: ${key} -->
<!-- ${DIAGNOSTIC_ISSUE_FAMILY_KEY_MARKER}: ${familyKey} -->
<!-- ${DIAGNOSTIC_ISSUE_LIFECYCLE_MARKER}: ${lifecycle} -->
<!-- ${DIAGNOSTIC_ISSUE_OBSERVATIONS_MARKER}: ${observationKeys.join(',')} -->
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
