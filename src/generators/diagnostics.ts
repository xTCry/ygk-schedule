import { stringify } from 'yaml';
import {
  formatDiagnosticIssue,
  isIssueCandidate,
} from '../diagnostics/issues.ts';
import type {
  CanonicalSchedule,
  Diagnostic,
  ScheduleSource,
} from '../types.ts';

export interface DiagnosticsReportItem extends Diagnostic {
  source: ScheduleSource | null;
  issueFingerprint: string | null;
}

export interface DiagnosticsReport {
  schemaVersion: 2;
  generatedAt: string;
  scheduleVersion: string;
  summary: Record<'info' | 'warning' | 'error' | 'fatal', number>;
  diagnostics: DiagnosticsReportItem[];
  issues: ReturnType<typeof formatDiagnosticIssue>[];
}

const compareDiagnostics = (left: Diagnostic, right: Diagnostic): number =>
  left.severity.localeCompare(right.severity) ||
  left.code.localeCompare(right.code) ||
  (left.sourceId ?? '').localeCompare(right.sourceId ?? '') ||
  (left.sheet ?? '').localeCompare(right.sheet ?? '', 'ru-RU') ||
  (left.row ?? 0) - (right.row ?? 0);

const diagnosticIssueGroupKey = (
  diagnostic: Diagnostic,
  source: ScheduleSource | null,
): string => `${source?.id ?? ''}\0${diagnostic.fingerprint}`;

/**
 * Собирает метаданные diagnostics и черновики Issue для data/meta.
 */
export const buildDiagnosticsReport = (
  schedule: CanonicalSchedule,
): DiagnosticsReport => {
  const sources = new Map(
    schedule.sources.map((source) => [source.id, source]),
  );
  const summary: DiagnosticsReport['summary'] = {
    info: 0,
    warning: 0,
    error: 0,
    fatal: 0,
  };
  const issueGroups = new Map<
    string,
    { source: ScheduleSource | null; diagnostics: Diagnostic[] }
  >();
  const diagnostics = [...schedule.diagnostics]
    .sort(compareDiagnostics)
    .map((diagnostic) => {
      summary[diagnostic.severity] += 1;
      const source = diagnostic.sourceId
        ? (sources.get(diagnostic.sourceId) ?? null)
        : null;
      const issueFingerprint = isIssueCandidate(diagnostic)
        ? diagnostic.fingerprint
        : null;
      if (issueFingerprint) {
        const key = diagnosticIssueGroupKey(diagnostic, source);
        const group = issueGroups.get(key);
        if (group) group.diagnostics.push(diagnostic);
        else issueGroups.set(key, { source, diagnostics: [diagnostic] });
      }
      return {
        ...diagnostic,
        source,
        issueFingerprint,
      };
    });
  const issues = [...issueGroups.values()].map(({ source, diagnostics }) =>
    formatDiagnosticIssue(diagnostics, source ?? undefined),
  );

  return {
    schemaVersion: 2,
    generatedAt: schedule.generatedAt,
    scheduleVersion: schedule.version.value,
    summary,
    diagnostics,
    issues,
  };
};

/**
 * Сериализует diagnostics metadata для последующей публикации или GitHub Issue.
 */
export const serializeDiagnosticsReport = (
  schedule: CanonicalSchedule,
): string => `${JSON.stringify(buildDiagnosticsReport(schedule), null, 2)}\n`;

/**
 * Сериализует diagnostics metadata в YAML с отступом в два пробела.
 */
export const serializeDiagnosticsReportYaml = (
  schedule: CanonicalSchedule,
): string => stringify(buildDiagnosticsReport(schedule), { indent: 2 });
