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
