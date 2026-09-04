export type WeekType = 'numerator' | 'denominator' | 'both' | 'unknown';

export type DayOfWeek =
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота';

export type ReplacementShift = 'first' | 'second';

export type ReplacementType = 'replace' | 'cancel' | 'add' | 'move' | 'unknown';

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
  | 'DATA_OUTSIDE_EXPECTED_COLUMNS'
  | 'UNRESOLVED_REPLACEMENT'
  | 'AMBIGUOUS_REPLACEMENT'
  | 'REPLACEMENT_CHANGES_NOT_PUBLISHED'
  | 'MISSING_REPLACEMENT_DATE'
  | 'INVALID_REPLACEMENT_DATE'
  | 'UNKNOWN_REPLACEMENT_LAYOUT'
  | 'REPLACEMENT_SHIFT_MISMATCH'
  | 'INVALID_REPLACEMENT_LESSON_NUMBER'
  | 'UNKNOWN_REPLACEMENT_TYPE';

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
  fetchedAt: string;
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

/**
 * Публичная выгрузка базового расписания одной группы.
 *
 * Глобальные metadata намеренно остаются в `base/00-schedule.*` и
 * `base/90-diagnostics.*`: их обновление не должно переписывать файлы всех
 * групп, если само расписание группы не менялось.
 */
export interface GroupScheduleArtifact {
  schemaVersion: number;
  provider: 'ygk';
  group: GroupSchedule;
  diagnostics: Diagnostic[];
  semanticHash: string;
}

export interface ParsedSchedule {
  groups: Record<string, GroupSchedule>;
  diagnostics: Diagnostic[];
}

/**
 * Текст занятия из таблицы замен. На этом этапе он не сопоставляется
 * с дисциплиной, преподавателем или аудиторией базового расписания.
 */
export interface ReplacementLesson {
  raw: string;
  room?: string;
}

/**
 * Исходные данные строки HTML-таблицы, необходимые для диагностики
 * и последующего сопоставления с базовым расписанием.
 */
export interface ReplacementSource {
  shift: ReplacementShift;
  row: number;
  rawGroupName: string;
  rawLessonNumbers: string;
  rawOriginal: string;
  rawReplacement: string;
  rawRoom: string;
}

/**
 * Изменение одной или нескольких пар на конкретную дату.
 *
 * Группа нормализуется, когда ее формат однозначно распознан. Для старых
 * свободных обозначений сохраняется нормализованный исходный текст.
 */
export interface Replacement {
  date: string;
  group: string;
  lessonNumbers: number[];
  type: ReplacementType;
  original: ReplacementLesson | null;
  replacement: ReplacementLesson | null;
  source: ReplacementSource;
}

/**
 * Результат разбора страницы замен одной смены.
 *
 * При `hasChanges: false` страница не содержит опубликованного блока
 * «ИЗМЕНЕНИЯ», поэтому дата и день недели неизвестны.
 */
export interface ParsedReplacements {
  hasChanges: boolean;
  date: string | null;
  day: DayOfWeek | null;
  shift: ReplacementShift;
  weekType: WeekType;
  replacements: Replacement[];
  diagnostics: Diagnostic[];
}

/**
 * Метаданные HTML-страницы замен, загруженной для одной смены.
 */
export interface ReplacementPageSource extends ScheduleSource {
  shift: ReplacementShift;
}

export interface ReplacementDate {
  date: string;
  day: DayOfWeek;
  weekType: WeekType;
  replacements: Replacement[];
}

/**
 * Публикуемая коллекция необработанных замен с обеих HTML-страниц.
 */
export interface CanonicalReplacements {
  schemaVersion: number;
  provider: 'ygk';
  generatedAt: string;
  sources: ReplacementPageSource[];
  version: ScheduleVersion;
  dates: Record<string, ReplacementDate>;
  diagnostics: Diagnostic[];
  semanticHash: string;
}

/**
 * Публичная выгрузка замен, относящихся к одной группе.
 *
 * Общие сведения об источниках и версии замен хранятся в `00-replacements.*`
 * и diagnostics, поэтому не дублируются в каждом групповом файле.
 */
export interface GroupReplacementsArtifact {
  schemaVersion: number;
  provider: 'ygk';
  group: string;
  dates: Record<string, ReplacementDate>;
  diagnostics: Diagnostic[];
  semanticHash: string;
}

export type ReplacementApplyStrategy = 'add' | 'exact-subject';

export type UnresolvedReplacementReason =
  | 'group-not-found'
  | 'day-not-found'
  | 'lesson-not-found'
  | 'original-not-matched'
  | 'ambiguous-original'
  | 'unsupported-type';

/**
 * Примененная замена и правило, позволившее сделать это без догадки.
 */
export interface AppliedReplacement {
  replacement: Replacement;
  lessonNumber: number;
  strategy: ReplacementApplyStrategy;
}

/**
 * Замена, которую нельзя безопасно наложить на базовую пару.
 *
 * Она остается в actual-данных отдельным объектом, чтобы API и будущий
 * генератор iCalendar могли показать дополнительное событие пользователю.
 */
export interface UnresolvedReplacement {
  replacement: Replacement;
  lessonNumber: number;
  reason: UnresolvedReplacementReason;
}

export interface ActualLesson {
  number: number;
  variants: LessonVariant[];
  source: SourceReference | null;
  status: 'scheduled' | 'cancelled';
  replacements: AppliedReplacement[];
}

export interface ActualGroupSchedule {
  group: string;
  date: string;
  day: DayOfWeek;
  lessons: ActualLesson[];
  unresolvedReplacements: UnresolvedReplacement[];
}

export interface ActualScheduleDate {
  date: string;
  day: DayOfWeek;
  weekType: WeekType;
  groups: Record<string, ActualGroupSchedule>;
}

/**
 * Расписание на конкретные даты после наложения разрешенных замен.
 */
export interface ActualSchedule {
  schemaVersion: number;
  provider: 'ygk';
  generatedAt: string;
  sources: ScheduleSource[];
  version: ScheduleVersion;
  baseScheduleVersion: string;
  replacementVersion: string;
  dates: Record<string, ActualScheduleDate>;
  diagnostics: Diagnostic[];
  semanticHash: string;
}

/**
 * Публичная выгрузка actual-расписания одной группы на даты замен.
 *
 * Версии исходного расписания и замен доступны в общем `actual/00-schedule.*`
 * и не включаются сюда, чтобы метаданные не создавали массовые изменения.
 */
export interface ActualGroupScheduleArtifact {
  schemaVersion: number;
  provider: 'ygk';
  group: string;
  dates: Record<string, ActualScheduleDate>;
  diagnostics: Diagnostic[];
  semanticHash: string;
}
