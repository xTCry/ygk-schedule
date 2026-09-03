import { createDiagnostic } from '../../../diagnostics/index.ts';
import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';
import type {
  ActualGroupSchedule,
  ActualLesson,
  ActualSchedule,
  ActualScheduleDate,
  AppliedReplacement,
  CanonicalReplacements,
  CanonicalSchedule,
  Diagnostic,
  Lesson,
  LessonVariant,
  Replacement,
  ReplacementPageSource,
  UnresolvedReplacement,
  UnresolvedReplacementReason,
  WeekType,
} from '../../../types.ts';
import { sha256 } from '../../../utils/hash.ts';
import { SCHEMA_VERSION, buildScheduleVersion } from '../../../version.ts';

const subjectKey = (value: string): string =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const variantAppliesToWeek = (
  variant: LessonVariant,
  weekType: WeekType,
): boolean =>
  weekType === 'unknown' ||
  variant.weekType === 'unknown' ||
  variant.weekType === 'both' ||
  variant.weekType === weekType;

const toActualLesson = (lesson: Lesson, weekType: WeekType): ActualLesson => ({
  number: lesson.number,
  variants: lesson.variants
    .filter((variant) => variantAppliesToWeek(variant, weekType))
    .map((variant) => ({ ...variant })),
  source: { ...lesson.source },
  status: 'scheduled',
  replacements: [],
});

const createReplacementVariant = (
  replacement: Replacement,
): LessonVariant | null => {
  if (!replacement.replacement) return null;
  return {
    subject: replacement.replacement.raw,
    teacher: '',
    room: replacement.replacement.room ?? '',
    weekType: 'both',
    rawSubject: replacement.replacement.raw,
    ...(replacement.replacement.room
      ? { rawRoom: replacement.replacement.room }
      : {}),
    sourceRow: replacement.source.row,
  };
};

const sourceForReplacement = (
  sources: readonly ReplacementPageSource[],
  replacement: Replacement,
): ReplacementPageSource | undefined =>
  sources.find((source) => source.shift === replacement.source.shift);

const resolutionDiagnostic = (
  replacement: Replacement,
  lessonNumber: number,
  reason: UnresolvedReplacementReason,
  source: ReplacementPageSource | undefined,
): Diagnostic => {
  const reasonMessage: Record<UnresolvedReplacementReason, string> = {
    'group-not-found': 'Группа из замены не найдена в базовом расписании',
    'day-not-found': 'День замены отсутствует в базовом расписании группы',
    'lesson-not-found': 'Пара из замены отсутствует в базовом расписании',
    'original-not-matched':
      'Исходная дисциплина из замены не совпала с парой базового расписания',
    'ambiguous-original':
      'Исходная дисциплина из замены соответствует нескольким вариантам пары',
    'unsupported-type': 'Тип замены пока нельзя безопасно применить',
  };
  const rawValue =
    replacement.replacement?.raw ?? replacement.original?.raw ?? '';
  const diagnostic = createDiagnostic({
    code: 'UNRESOLVED_REPLACEMENT',
    severity: 'error',
    message: reasonMessage[reason],
    sheet: `Замены: ${replacement.source.shift === 'first' ? 'Первая смена' : 'Вторая смена'}`,
    row: replacement.source.row,
    context: {
      date: replacement.date,
      lessonNumber,
      type: replacement.type,
      reason,
    },
    fingerprintContext: [
      'replacements',
      replacement.date,
      replacement.group,
      String(lessonNumber),
      reason,
      replacement.original?.raw ?? '',
      replacement.replacement?.raw ?? '',
    ],
    ...(rawValue ? { rawValue } : {}),
    ...(replacement.group ? { normalizedGroup: replacement.group } : {}),
  });
  return {
    ...diagnostic,
    ...(source ? { sourceId: source.id } : {}),
    ...(source?.url ? { sourceUrl: source.url } : {}),
  };
};

const unresolved = (
  target: ActualGroupSchedule,
  replacement: Replacement,
  lessonNumber: number,
  reason: UnresolvedReplacementReason,
  sources: readonly ReplacementPageSource[],
  diagnostics: Diagnostic[],
): void => {
  const unresolvedReplacement: UnresolvedReplacement = {
    replacement,
    lessonNumber,
    reason,
  };
  target.unresolvedReplacements.push(unresolvedReplacement);
  diagnostics.push(
    resolutionDiagnostic(
      replacement,
      lessonNumber,
      reason,
      sourceForReplacement(sources, replacement),
    ),
  );
};

const applied = (
  lesson: ActualLesson,
  replacement: Replacement,
  lessonNumber: number,
  strategy: AppliedReplacement['strategy'],
): void => {
  lesson.replacements.push({ replacement, lessonNumber, strategy });
};

const findMatchingVariants = (
  lesson: ActualLesson,
  replacement: Replacement,
): number[] => {
  const original = replacement.original?.raw;
  if (!original) return [];
  const key = subjectKey(original);
  return lesson.variants
    .map((variant, index) => ({ index, key: subjectKey(variant.subject) }))
    .filter((candidate) => candidate.key === key)
    .map((candidate) => candidate.index);
};

const applyReplacement = (
  target: ActualGroupSchedule,
  replacement: Replacement,
  lessonNumber: number,
  sources: readonly ReplacementPageSource[],
  diagnostics: Diagnostic[],
): void => {
  const lesson = target.lessons.find((item) => item.number === lessonNumber);
  const replacementVariant = createReplacementVariant(replacement);

  if (replacement.type === 'add') {
    if (!replacementVariant) {
      unresolved(
        target,
        replacement,
        lessonNumber,
        'unsupported-type',
        sources,
        diagnostics,
      );
      return;
    }
    const actualLesson =
      lesson ??
      ({
        number: lessonNumber,
        variants: [],
        source: null,
        status: 'scheduled',
        replacements: [],
      } satisfies ActualLesson);
    if (!lesson) target.lessons.push(actualLesson);
    actualLesson.variants.push(replacementVariant);
    applied(actualLesson, replacement, lessonNumber, 'add');
    return;
  }

  if (replacement.type !== 'cancel' && replacement.type !== 'replace') {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'unsupported-type',
      sources,
      diagnostics,
    );
    return;
  }

  if (!lesson) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'lesson-not-found',
      sources,
      diagnostics,
    );
    return;
  }

  const matches = findMatchingVariants(lesson, replacement);
  if (!matches.length) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'original-not-matched',
      sources,
      diagnostics,
    );
    return;
  }
  if (matches.length > 1) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'ambiguous-original',
      sources,
      diagnostics,
    );
    return;
  }

  if (replacement.type === 'cancel') {
    lesson.variants = [];
    lesson.status = 'cancelled';
    applied(lesson, replacement, lessonNumber, 'exact-subject');
    return;
  }

  if (!replacementVariant) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'unsupported-type',
      sources,
      diagnostics,
    );
    return;
  }
  lesson.variants = [replacementVariant];
  lesson.status = 'scheduled';
  applied(lesson, replacement, lessonNumber, 'exact-subject');
};

const createActualDate = (
  schedule: CanonicalSchedule,
  date: string,
  day: ActualScheduleDate['day'],
  weekType: WeekType,
): ActualScheduleDate => {
  const groups: Record<string, ActualGroupSchedule> = {};
  for (const [group, scheduleGroup] of Object.entries(schedule.groups)) {
    const scheduleDay = scheduleGroup.days.find((item) => item.day === day);
    if (!scheduleDay) continue;
    groups[group] = {
      group,
      date,
      day,
      lessons: scheduleDay.lessons
        .map((lesson) => toActualLesson(lesson, weekType))
        .filter((lesson) => lesson.variants.length > 0),
      unresolvedReplacements: [],
    };
  }
  return { date, day, weekType, groups };
};

const replacementSemanticValue = (
  replacements: CanonicalReplacements,
): unknown => ({
  dates: Object.fromEntries(
    Object.entries(replacements.dates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => [
        date,
        {
          day: value.day,
          weekType: value.weekType,
          replacements: value.replacements,
        },
      ]),
  ),
});

export const semanticReplacementHash = (
  replacements: CanonicalReplacements,
): string => sha256(JSON.stringify(replacementSemanticValue(replacements)));

export const semanticActualScheduleHash = (actual: ActualSchedule): string =>
  sha256(
    JSON.stringify({
      baseScheduleVersion: actual.baseScheduleVersion,
      replacementVersion: actual.replacementVersion,
      dates: actual.dates,
    }),
  );

/**
 * Накладывает только однозначные замены на расписание для дат из HTML-страниц.
 *
 * Неразрешенные строки остаются видны в `unresolvedReplacements` и не меняют
 * базовую пару, поэтому ошибочная догадка не попадет в API или будущий ICS.
 */
export const buildActualSchedule = (
  schedule: CanonicalSchedule,
  replacements: CanonicalReplacements,
  parserHash: string,
  configHash: string,
): ActualSchedule => {
  const diagnostics = [...replacements.diagnostics];
  const dates: Record<string, ActualScheduleDate> = {};

  for (const [date, replacementDate] of Object.entries(replacements.dates)) {
    const actualDate = createActualDate(
      schedule,
      date,
      replacementDate.day,
      replacementDate.weekType,
    );
    dates[date] = actualDate;

    for (const replacement of replacementDate.replacements) {
      const group = actualDate.groups[replacement.group];
      if (!group) {
        const baseGroup = schedule.groups[replacement.group];
        const unresolvedGroup: ActualGroupSchedule = {
          group: replacement.group,
          date,
          day: replacementDate.day,
          lessons: [],
          unresolvedReplacements: [],
        };
        actualDate.groups[replacement.group] = unresolvedGroup;
        for (const lessonNumber of replacement.lessonNumbers)
          unresolved(
            unresolvedGroup,
            replacement,
            lessonNumber,
            baseGroup ? 'day-not-found' : 'group-not-found',
            replacements.sources,
            diagnostics,
          );
        continue;
      }

      for (const lessonNumber of replacement.lessonNumbers)
        applyReplacement(
          group,
          replacement,
          lessonNumber,
          replacements.sources,
          diagnostics,
        );
    }

    for (const group of Object.values(actualDate.groups)) {
      group.lessons.sort((left, right) => left.number - right.number);
      group.unresolvedReplacements.sort(
        (left, right) =>
          left.lessonNumber - right.lessonNumber ||
          left.reason.localeCompare(right.reason),
      );
    }
  }

  const version = buildScheduleVersion({
    sourceSetHash: sha256(
      [schedule.version.value, replacements.version.value].join('\0'),
    ),
    parserHash,
    configHash,
  });
  const actual: ActualSchedule = {
    schemaVersion: SCHEMA_VERSION,
    provider: 'ygk',
    generatedAt: replacements.generatedAt,
    sources: [...schedule.sources, ...replacements.sources].sort(
      (left, right) => left.id.localeCompare(right.id),
    ),
    version,
    baseScheduleVersion: schedule.version.value,
    replacementVersion: replacements.version.value,
    dates,
    diagnostics,
    semanticHash: '',
  };
  actual.semanticHash = semanticActualScheduleHash(actual);
  return actual;
};
