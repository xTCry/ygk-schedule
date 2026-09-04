import { sha256 } from '../utils/hash.ts';
import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from '../types.ts';

export interface DiagnosticInput {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  sheet?: string;
  row?: number;
  column?: number;
  normalizedGroup?: string;
  rawValue?: string;
  context?: Record<string, unknown>;
  fingerprintContext?: string[];
}

export const createDiagnostic = (input: DiagnosticInput): Diagnostic => {
  const fingerprint = sha256(
    [
      'ygk',
      input.code,
      input.normalizedGroup ?? '',
      ...(input.fingerprintContext ?? []),
    ].join('\0'),
  );

  return {
    provider: 'ygk',
    code: input.code,
    severity: input.severity,
    message: input.message,
    fingerprint,
    ...(input.sheet ? { sheet: input.sheet } : {}),
    ...(input.row !== undefined ? { row: input.row } : {}),
    ...(input.column !== undefined ? { column: input.column } : {}),
    ...(input.normalizedGroup
      ? { normalizedGroup: input.normalizedGroup }
      : {}),
    ...(input.rawValue ? { rawValue: input.rawValue } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
};

export const hasFatalDiagnostics = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === 'fatal');

/**
 * Возвращает детерминированное JSON-совместимое представление значения.
 *
 * Контекст diagnostics собирается разными слоями parser-а, поэтому порядок
 * ключей не должен влиять на решение о публикации.
 */
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'ru-RU'))
      .map(([key, item]) => [key, stableValue(item)]),
  );
};

/**
 * Считает hash diagnostics без технических метаданных выгрузки.
 *
 * Он используется при semantic publish gate: одинаковые warnings и errors не
 * должны создавать commit только из-за нового времени запуска parser-а.
 */
export const diagnosticSemanticHash = (diagnostics: Diagnostic[]): string =>
  sha256(
    JSON.stringify(
      [...diagnostics]
        .map((diagnostic) => stableValue(diagnostic))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right), 'ru-RU'),
        ),
    ),
  );
