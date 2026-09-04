import {
  formatDiagnosticIssue,
  getDiagnosticIssueGroupKey,
  isIssueCandidate,
} from '../diagnostics/issues.ts';
import type { Diagnostic, ScheduleSource, ScheduleVersion } from '../types.ts';
import { serializeYaml } from './yaml.ts';

export interface DiagnosticsReportItem extends Diagnostic {
  source: ScheduleSource | null;
  issueFingerprint: string | null;
}

export interface DiagnosticsReport {
  schemaVersion: 4;
  generatedAt: string;
  scheduleVersion: string;
  summary: Record<'info' | 'warning' | 'error' | 'fatal', number>;
  diagnostics: DiagnosticsReportItem[];
  issues: ReturnType<typeof formatDiagnosticIssue>[];
}

export interface DiagnosticsReportSubject {
  generatedAt: string;
  sources: ScheduleSource[];
  version: Pick<ScheduleVersion, 'value'>;
  diagnostics: Diagnostic[];
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
): string => getDiagnosticIssueGroupKey(diagnostic, source ?? undefined);

/**
 * Собирает метаданные diagnostics и черновики Issue для набора data-артефактов.
 */
export const buildDiagnosticsReport = (
  schedule: DiagnosticsReportSubject,
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
  const reportItems = [...schedule.diagnostics]
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
  const draftsByGroupKey = new Map(
    [...issueGroups.entries()].map(([key, { source, diagnostics }]) => [
      key,
      formatDiagnosticIssue(diagnostics, source ?? undefined),
    ]),
  );
  const diagnostics = reportItems.map((item) => ({
    ...item,
    issueFingerprint: item.issueFingerprint
      ? (draftsByGroupKey.get(diagnosticIssueGroupKey(item, item.source))
          ?.fingerprint ?? null)
      : null,
  }));
  const issues = [...draftsByGroupKey.values()];

  return {
    schemaVersion: 4,
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
  schedule: DiagnosticsReportSubject,
): string => `${JSON.stringify(buildDiagnosticsReport(schedule), null, 2)}\n`;

/**
 * Сериализует diagnostics metadata в YAML с отступом в два пробела.
 */
export const serializeDiagnosticsReportYaml = (
  schedule: DiagnosticsReportSubject,
): string => serializeYaml(buildDiagnosticsReport(schedule));
