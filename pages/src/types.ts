export type DayOfWeek =
  'Понедельник' | 'Вторник' | 'Среда' | 'Четверг' | 'Пятница' | 'Суббота';

export interface LessonTiming {
  slots: Array<{ start: string; end: string }>;
  preholidaySlots?: Array<{ start: string; end: string }>;
  preholidayChanged?: boolean;
  profile?: string;
  breakAfterMinutes?: number;
}

export interface LessonVariant {
  subject: string;
  rawSubject?: string;
  teacher: string;
  room: string;
  weekType: 'numerator' | 'denominator' | 'both' | 'unknown';
  subgroup?: string;
  timing: LessonTiming;
}

export interface Lesson {
  number: number;
  variants: LessonVariant[];
}

export interface Diagnostic {
  severity: 'info' | 'warning' | 'error' | 'fatal';
  code: string;
  message: string;
  normalizedGroup?: string;
  context?: Record<string, unknown>;
}

export interface BaseGroupArtifact {
  group: {
    group: string;
    sourceBlocks: Array<{ sourceId?: string }>;
    days: Array<{ day: DayOfWeek; lessons: Lesson[] }>;
  };
  diagnostics: Diagnostic[];
}

export interface AppliedReplacement {
  strategy?: string;
  replacement: {
    type: 'replace' | 'cancel' | 'add' | 'move' | 'unknown';
    original: { raw: string } | null;
    replacement: { raw: string; room?: string } | null;
    source: { shift: 'first' | 'second'; row: number };
  };
}

export interface ActualLesson extends Lesson {
  status: 'scheduled' | 'cancelled';
  replacements: AppliedReplacement[];
}

export interface ActualGroup {
  lessons: ActualLesson[];
  frozenBase?: {
    lessons: Array<{
      number: number;
      variants: Array<Pick<LessonVariant, 'subject' | 'room' | 'subgroup'>>;
    }>;
  };
  unresolvedReplacements: Array<{
    lessonNumber: number;
    reason: string;
    event: { summary: string; description: string; room?: string };
  }>;
}

export interface ActualDate {
  date: string;
  day: DayOfWeek;
  weekType: 'numerator' | 'denominator' | 'both' | 'unknown';
  shifts?: Partial<
    Record<
      'first' | 'second',
      {
        status: 'mutable' | 'finalized';
        source: { url?: string; fileName: string; fetchedAt?: string };
      }
    >
  >;
  groups: Record<string, ActualGroup>;
}

export interface ActualGroupArtifact {
  dates: Record<string, ActualDate>;
  diagnostics: Diagnostic[];
}

export interface PagesApiGroup {
  code: string;
  hasActual: boolean;
  hasReplacements: boolean;
  calendars: {
    base: string[];
    actual: string[];
  };
}

export interface PagesApiIndex {
  holidays?: string[];
  updates: {
    schedule: string;
    replacements: string | null;
    actual: string | null;
  };
  sources: Array<{ id: string; fileName: string; url?: string }>;
  groups: PagesApiGroup[];
}
