export type WeekType = 'numerator' | 'denominator' | 'both' | 'unknown';

export type DayOfWeek =
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'fatal';

export type DiagnosticCode =
  | 'HIDDEN_ROW_WITH_DATA'
  | 'UNKNOWN_GROUP'
  | 'GROUP_NAME_NORMALIZED'
  | 'DUPLICATE_GROUP'
  | 'DUPLICATE_GROUP_ACROSS_SOURCES'
  | 'UNKNOWN_WEEK_COLOR'
  | 'CONFLICTING_WEEK_COLOR'
  | 'INVALID_LESSON_NUMBER'
  | 'LESSON_OUTSIDE_DAY'
  | 'UNEXPECTED_MERGE'
  | 'CONFLICTING_GROUP_BLOCK'
  | 'EMPTY_SCHEDULE_BLOCK'
  | 'UNKNOWN_DAY'
  | 'DATA_OUTSIDE_EXPECTED_COLUMNS';

export interface SourceReference {
  sourceId?: string;
  sheet: string;
  rowStart: number;
  rowEnd: number;
  rawGroupName: string;
}

export interface LessonVariant {
  subject: string;
  teacher: string;
  room: string;
  weekType: WeekType;
  subgroup?: string;
  rawSubject?: string;
  rawTeacher?: string;
  rawRoom?: string;
  sourceRow: number;
}

export interface Lesson {
  number: number;
  variants: LessonVariant[];
  source: SourceReference;
}

export interface ScheduleDay {
  day: DayOfWeek;
  lessons: Lesson[];
}

export interface GroupSchedule {
  group: string;
  sourceGroups: string[];
  sourceBlocks: SourceReference[];
  days: ScheduleDay[];
}

export interface Diagnostic {
  provider: 'ygk';
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fingerprint: string;
  sourceId?: string;
  sourceUrl?: string;
  sheet?: string;
  row?: number;
  column?: number;
  normalizedGroup?: string;
  rawValue?: string;
  context?: Record<string, unknown>;
}

export interface ScheduleSource {
  id: string;
  fileName: string;
  sha256: string;
  url?: string;
  etag?: string;
  lastModified?: string;
}

export interface ScheduleVersion {
  schemaVersion: number;
  sourceSetHash: string;
  parserHash: string;
  configHash: string;
  value: string;
}

export interface CanonicalSchedule {
  schemaVersion: number;
  provider: 'ygk';
  generatedAt: string;
  sources: ScheduleSource[];
  version: ScheduleVersion;
  groups: Record<string, GroupSchedule>;
  diagnostics: Diagnostic[];
  semanticHash: string;
}

export interface ParsedSchedule {
  groups: Record<string, GroupSchedule>;
  diagnostics: Diagnostic[];
}
