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
  FrozenActualBase,
  Lesson,
  LessonVariant,
  Replacement,
  ReplacementPageSource,
  ReplacementShift,
  ReplacementSnapshot,
  UnresolvedReplacement,
  UnresolvedReplacementReason,
  WeekType,
} from '../../../types.ts';
import { sha256 } from '../../../utils/hash.ts';
import { SCHEMA_VERSION, buildScheduleVersion } from '../../../version.ts';
import { resolveReplacementAlias, type ReplacementAliases } from './config.ts';
import { resolveYgkReplacementGroup } from './group.ts';
import { compatibleReplacementSnapshots } from './history.ts';
import { parseYgkReplacementLessonText } from './lesson-text.ts';
import {
  findUniqueMentionedSubject,
  findUniqueSimilarSubject,
} from './subject-match.ts';
import { hasYgkSubgroupMarker } from '../subgroup.ts';

const subjectKey = (value: string): string =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const subjectWords = (value: string): string[] =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Извлекает коды дисциплины из написаний «МДК 01.01» и «УП.04».
 *
 * Это не нечёткий поиск предмета: код в строке замен однозначно указывает
 * конкретную дисциплину или практику, когда одна ячейка перечисляет
 * несколько пар.
 */
const subjectCodes = (value: string): string[] =>
  [
    ...value.matchAll(
      /(?<kind>МДК|УП)\.?\s*(?<number>\d{1,2}(?:\.\d{1,2})?)/giu,
    ),
  ].map(
    (match) =>
      `${match.groups?.kind?.toLocaleUpperCase('ru-RU')}:${match.groups?.number}`,
  );

/**
 * Проверяет распространённое сокращённое название предмета, например
 * «Инф. технол.» для «Информационные технологии».
 *
 * Правило намеренно консервативно: сокращение должно содержать точки,
 * состоять из начала последовательности слов полного названия, а каждое
 * сокращённое слово должно быть длиной не менее двух символов и быть
 * префиксом полного слова.
 */
const isSubjectAbbreviationOf = (
  abbreviation: string,
  subject: string,
): boolean => {
  if (!abbreviation.includes('.')) return false;
  const abbreviationWords = subjectWords(abbreviation);
  const subjectFullWords = subjectWords(subject);
  return (
    abbreviationWords.length > 0 &&
    abbreviationWords.length <= subjectFullWords.length &&
    abbreviationWords.every(
      (word, index) =>
        word.length >= 2 && subjectFullWords[index]?.startsWith(word),
    )
  );
};

const emptyAliases = (): ReplacementAliases => ({
  groups: new Map(),
  subjects: new Map(),
  teachers: new Map(),
  rooms: new Map(),
});

/**
 * Определяет служебное написание ЯГК «по расписанию».
 *
 * Такая строка не добавляет новый предмет: исходная пара сохраняется, а
 * опубликованная аудитория применяется ко всем ее вариантам.
 */
const isScheduledAsUsualReplacement = (replacement: Replacement): boolean =>
  normalizeSingleLine(replacement.replacement?.raw ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU') === 'по расписанию';

/**
 * Проверяет узкий формат двух последовательных пар с многоточием.
 *
 * Рабочая гипотеза по таблицам ЯГК: записи вида «2,3 | Физкультура...»
 * и «2,3 | Математика...» означают замену существующей второй пары и
 * добавление того же занятия на третью. Многоточие пока не имеет
 * подтверждённой официальной семантики, поэтому правило намеренно не
 * распространяется на произвольные диапазоны, отмены или строки без
 * успешно сопоставленной предыдущей пары.
 */
const ellipsisContinuationPreviousLesson = (
  replacement: Replacement,
  lessonNumber: number,
): number | undefined => {
  if (
    replacement.type !== 'replace' ||
    !/(?:\.{3}|…)\s*$/u.test(replacement.original?.raw ?? '')
  )
    return undefined;

  const lessonNumbers = [...new Set(replacement.lessonNumbers)].sort(
    (left, right) => left - right,
  );
  const [previousLesson, continuationLesson] = lessonNumbers;
  return lessonNumbers.length === 2 &&
    previousLesson !== undefined &&
    continuationLesson === lessonNumber &&
    continuationLesson === previousLesson + 1
    ? previousLesson
    : undefined;
};

/**
 * Создаёт дополнительную пару только как продолжение уже применённой замены.
 *
 * Так мы не превращаем любой `lesson-not-found` в добавленное занятие: новая
 * пара допустима лишь для подтверждённого формата с многоточием и копирует
 * именно итог предыдущей пары из той же строки HTML.
 */
const applyEllipsisContinuation = (
  target: ActualGroupSchedule,
  replacement: Replacement,
  lessonNumber: number,
): boolean => {
  const previousLessonNumber = ellipsisContinuationPreviousLesson(
    replacement,
    lessonNumber,
  );
  if (previousLessonNumber === undefined) return false;

  const previousLesson = target.lessons.find(
    (lesson) => lesson.number === previousLessonNumber,
  );
  const wasAppliedToPreviousLesson = previousLesson?.replacements.some(
    (appliedReplacement) =>
      appliedReplacement.replacement === replacement &&
      appliedReplacement.lessonNumber === previousLessonNumber,
  );
  if (
    !previousLesson ||
    previousLesson.status === 'cancelled' ||
    !previousLesson.variants.length ||
    !wasAppliedToPreviousLesson
  )
    return false;

  const continuation: ActualLesson = {
    number: lessonNumber,
    variants: previousLesson.variants.map((variant) => ({ ...variant })),
    // У добавленной пары нет строки base XLSX: она существует только в HTML
    // замене, а `sourceRow` вариантов уже указывает на её строку.
    source: null,
    status: 'scheduled',
    replacements: [],
  };
  target.lessons.push(continuation);
  applied(continuation, replacement, lessonNumber, 'ellipsis-continuation');
  return true;
};

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
  originalVariant: LessonVariant | undefined,
  aliases: ReplacementAliases,
): LessonVariant | null => {
  if (!replacement.replacement) return null;
  const rawSubject = replacement.replacement.raw;
  const parsed = parseYgkReplacementLessonText(rawSubject);
  const parsedSubject = parsed.subject;
  const parsedTeacher =
    parsed.teachers.length === 1 ? (parsed.teachers[0] ?? '') : '';
  const subject = parsedSubject
    ? resolveReplacementAlias(aliases, 'subjects', parsedSubject)
    : (originalVariant?.subject ?? rawSubject);
  const teacher = parsedTeacher
    ? resolveReplacementAlias(aliases, 'teachers', parsedTeacher)
    : (originalVariant?.teacher ?? '');
  const room = replacement.replacement.room
    ? resolveReplacementAlias(aliases, 'rooms', replacement.replacement.room)
    : (originalVariant?.room ?? '');

  return {
    subject,
    teacher,
    room,
    weekType: 'both',
    ...(parsed.subgroups.length === 1
      ? { subgroup: parsed.subgroups[0] }
      : originalVariant?.subgroup
        ? { subgroup: originalVariant.subgroup }
        : {}),
    rawSubject,
    ...(parsedTeacher ? { rawTeacher: parsedTeacher } : {}),
    ...(replacement.replacement.room
      ? { rawRoom: replacement.source.rawRoom || replacement.replacement.room }
      : {}),
    sourceRow: replacement.source.row,
  };
};

const sourceForReplacement = (
  sources: readonly ReplacementPageSource[],
  replacement: Replacement,
): ReplacementPageSource | undefined =>
  sources.find((source) => source.shift === replacement.source.shift);

/**
 * Возвращает компактный контекст сопоставления для ручной проверки.
 *
 * Он попадает только в diagnostic unresolved-строки: публичную модель самой
 * замены не раздуваем техническими кандидатами, но Issue и отчёт точно
 * показывают, что было проверено resolver-ом.
 */
const unresolvedMatchContext = (
  replacement: Replacement,
  lesson: ActualLesson,
): Record<string, unknown> => {
  const parsed = replacement.original?.raw
    ? parseYgkReplacementLessonText(replacement.original.raw)
    : null;
  return {
    ...(parsed?.subject ? { requestedSubject: parsed.subject } : {}),
    ...(parsed?.teachers.length === 1
      ? { requestedTeacher: parsed.teachers[0] }
      : {}),
    ...(parsed?.subgroups.length
      ? { requestedSubgroups: parsed.subgroups }
      : {}),
    candidates: lesson.variants.map((variant) => ({
      subject: variant.subject,
      ...(variant.teacher ? { teacher: variant.teacher } : {}),
      ...(variant.room ? { room: variant.room } : {}),
      ...(variant.subgroup ? { subgroup: variant.subgroup } : {}),
      sourceRow: variant.sourceRow,
    })),
  };
};

const resolutionDiagnostic = (
  replacement: Replacement,
  resolvedGroup: string,
  lessonNumber: number,
  reason: UnresolvedReplacementReason,
  source: ReplacementPageSource | undefined,
  details: Record<string, unknown> = {},
): Diagnostic => {
  const reasonMessage: Record<UnresolvedReplacementReason, string> = {
    'group-not-found': 'Группа из замены не найдена в базовом расписании',
    'day-not-found': 'День замены отсутствует в базовом расписании группы',
    'lesson-not-found': 'Пара из замены отсутствует в базовом расписании',
    'lesson-not-scheduled-for-week':
      'Пара из замены есть в базовом расписании, но не проводится в указанную неделю',
    'subgroup-not-matched':
      'Подгруппа из замены не проводится в базовом расписании в эту неделю',
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
      ...details,
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
    ...(resolvedGroup ? { normalizedGroup: resolvedGroup } : {}),
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
  details: Record<string, unknown> = {},
): void => {
  const description = [
    replacement.original?.raw
      ? `По расписанию: «${replacement.original.raw}».`
      : '',
    replacement.replacement?.raw
      ? `По замене: «${replacement.replacement.raw}».`
      : '',
    replacement.replacement?.room
      ? `Аудитория: «${replacement.replacement.room}».`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const unresolvedReplacement: UnresolvedReplacement = {
    replacement,
    lessonNumber,
    reason,
    event: {
      summary: 'Необработанная замена',
      description:
        description || 'Опубликована замена, которую не удалось разобрать.',
      ...(replacement.replacement?.room
        ? { room: replacement.replacement.room }
        : {}),
    },
  };
  target.unresolvedReplacements.push(unresolvedReplacement);
  diagnostics.push(
    resolutionDiagnostic(
      replacement,
      target.group,
      lessonNumber,
      reason,
      sourceForReplacement(sources, replacement),
      details,
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
  aliases: ReplacementAliases,
): { index: number; strategy: AppliedReplacement['strategy'] }[] => {
  const original = replacement.original?.raw;
  if (!original) return [];
  const parsedOriginal = parseYgkReplacementLessonText(original);
  const originalContainsOnlyMarkers =
    !parsedOriginal.subject &&
    (parsedOriginal.teachers.length > 0 ||
      parsedOriginal.subgroups.length > 0 ||
      parsedOriginal.theory);
  if (originalContainsOnlyMarkers) return [];

  const originalSubject = parsedOriginal.subject || original;
  const resolvedOriginal = resolveReplacementAlias(
    aliases,
    'subjects',
    originalSubject,
  );
  const key = subjectKey(resolvedOriginal);
  const requestedTeacher =
    parsedOriginal.teachers.length === 1
      ? resolveReplacementAlias(
          aliases,
          'teachers',
          parsedOriginal.teachers[0] ?? '',
        )
      : '';
  const candidates = lesson.variants
    .map((variant, index) => ({
      index,
      variant,
      key: subjectKey(
        resolveReplacementAlias(aliases, 'subjects', variant.subject),
      ),
      strategy:
        resolvedOriginal === originalSubject
          ? ('exact-subject' as const)
          : ('subject-alias' as const),
    }))
    .filter(
      (candidate) =>
        (!parsedOriginal.subgroups.length ||
          (candidate.variant.subgroup !== undefined &&
            parsedOriginal.subgroups.includes(candidate.variant.subgroup))) &&
        (!requestedTeacher ||
          subjectKey(
            resolveReplacementAlias(
              aliases,
              'teachers',
              candidate.variant.teacher,
            ),
          ) === subjectKey(requestedTeacher)),
    );
  const exactMatches = candidates
    .filter((candidate) => candidate.key === key)
    .map(({ index, strategy }) => ({ index, strategy }));
  if (exactMatches.length) return exactMatches;

  const originalSubjectCodes = subjectCodes(resolvedOriginal);
  if (originalSubjectCodes.length) {
    const moduleMatches = candidates.flatMap(({ variant, index }) =>
      subjectCodes(
        resolveReplacementAlias(aliases, 'subjects', variant.subject),
      ).some((candidateCode) => originalSubjectCodes.includes(candidateCode))
        ? [
            {
              index,
              strategy: 'subject-module-code' as const,
            },
          ]
        : [],
    );
    if (moduleMatches.length) return moduleMatches;
  }

  const abbreviationMatches = candidates.flatMap(({ variant, index }) =>
    isSubjectAbbreviationOf(
      resolvedOriginal,
      resolveReplacementAlias(aliases, 'subjects', variant.subject),
    )
      ? [{ index, strategy: 'subject-abbreviation' as const }]
      : [],
  );
  if (abbreviationMatches.length) return abbreviationMatches;

  const mentioned = findUniqueMentionedSubject(
    resolvedOriginal,
    candidates.map(({ index, variant }) => ({
      index,
      subject: resolveReplacementAlias(aliases, 'subjects', variant.subject),
    })),
  );
  if (mentioned)
    return [{ index: mentioned.index, strategy: 'subject-word-mention' }];

  const similar = findUniqueSimilarSubject(
    resolvedOriginal,
    candidates.map(({ index, variant }) => ({
      index,
      subject: resolveReplacementAlias(aliases, 'subjects', variant.subject),
    })),
  );
  return similar
    ? [{ index: similar.index, strategy: 'subject-similarity' }]
    : [];
};

const applyReplacement = (
  target: ActualGroupSchedule,
  replacement: Replacement,
  lessonNumber: number,
  sources: readonly ReplacementPageSource[],
  diagnostics: Diagnostic[],
  aliases: ReplacementAliases,
  baseContext: Record<string, unknown>,
): void => {
  const lesson = target.lessons.find((item) => item.number === lessonNumber);

  if (replacement.type === 'add') {
    const replacementVariant = createReplacementVariant(
      replacement,
      undefined,
      aliases,
    );
    if (!replacementVariant) {
      unresolved(
        target,
        replacement,
        lessonNumber,
        'unsupported-type',
        sources,
        diagnostics,
        baseContext,
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
      baseContext,
    );
    return;
  }

  if (!lesson) {
    if (applyEllipsisContinuation(target, replacement, lessonNumber)) return;
    unresolved(
      target,
      replacement,
      lessonNumber,
      'lesson-not-found',
      sources,
      diagnostics,
      baseContext,
    );
    return;
  }

  if (isScheduledAsUsualReplacement(replacement)) {
    const room = replacement.replacement?.room
      ? resolveReplacementAlias(aliases, 'rooms', replacement.replacement.room)
      : '';
    // Без новой аудитории строка «по расписанию» не меняет actual-модель.
    // Ее не публикуем как новую пару и не создаем ложную диагностику.
    if (!room) return;
    const rawRoom =
      replacement.source.rawRoom || replacement.replacement?.room || '';
    lesson.variants = lesson.variants.map((variant) => ({
      ...variant,
      room,
      ...(rawRoom ? { rawRoom } : {}),
    }));
    applied(lesson, replacement, lessonNumber, 'scheduled-room');
    return;
  }

  const parsedOriginal = replacement.original?.raw
    ? parseYgkReplacementLessonText(replacement.original.raw)
    : null;
  if (
    parsedOriginal?.subgroups.length &&
    !lesson.variants.some(
      (variant) =>
        variant.subgroup !== undefined &&
        parsedOriginal.subgroups.includes(variant.subgroup),
    )
  ) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'subgroup-not-matched',
      sources,
      diagnostics,
      { ...baseContext, ...unresolvedMatchContext(replacement, lesson) },
    );
    return;
  }

  const matches = findMatchingVariants(lesson, replacement, aliases);
  if (!matches.length) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'original-not-matched',
      sources,
      diagnostics,
      { ...baseContext, ...unresolvedMatchContext(replacement, lesson) },
    );
    return;
  }
  const mayApplyToAllSubgroups =
    parsedOriginal !== null &&
    hasYgkSubgroupMarker(replacement.original?.raw ?? '') &&
    matches.length > 1 &&
    (() => {
      const subgroups = matches.map(
        (match) => lesson.variants[match.index]?.subgroup,
      );
      return (
        subgroups.every((subgroup): subgroup is string => Boolean(subgroup)) &&
        new Set(subgroups).size === subgroups.length
      );
    })();
  if (matches.length > 1 && !mayApplyToAllSubgroups) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'ambiguous-original',
      sources,
      diagnostics,
      { ...baseContext, ...unresolvedMatchContext(replacement, lesson) },
    );
    return;
  }
  if (replacement.type === 'cancel') {
    for (const match of [...matches].sort(
      (left, right) => right.index - left.index,
    )) {
      lesson.variants.splice(match.index, 1);
    }
    lesson.status = lesson.variants.length ? 'scheduled' : 'cancelled';
    applied(
      lesson,
      replacement,
      lessonNumber,
      matches[0]?.strategy ?? 'exact-subject',
    );
    return;
  }

  const replacementVariants = matches.map((match) =>
    createReplacementVariant(
      replacement,
      lesson.variants[match.index],
      aliases,
    ),
  );
  if (replacementVariants.some((variant) => variant === null)) {
    unresolved(
      target,
      replacement,
      lessonNumber,
      'unsupported-type',
      sources,
      diagnostics,
      baseContext,
    );
    return;
  }
  for (const { match, replacementVariant } of matches
    .map((match, index) => ({
      match,
      replacementVariant: replacementVariants[index],
    }))
    .sort((left, right) => right.match.index - left.match.index)) {
    if (!replacementVariant) continue;
    lesson.variants.splice(match.index, 1, replacementVariant);
  }
  lesson.status = 'scheduled';
  applied(
    lesson,
    replacement,
    lessonNumber,
    matches[0]?.strategy ?? 'exact-subject',
  );
};

const cloneActualLesson = (lesson: ActualLesson): ActualLesson => ({
  ...lesson,
  variants: lesson.variants.map((variant) => ({ ...variant })),
  source: lesson.source ? { ...lesson.source } : null,
  replacements: [],
});

/**
 * Возвращает день из базового расписания без отбора по типу недели.
 *
 * Resolver использует его только для объяснения неразрешенной замены:
 * опубликованный actual по-прежнему содержит лишь пары нужной недели.
 */
const baseScheduleDay = (
  schedule: CanonicalSchedule,
  group: string,
  day: ActualScheduleDate['day'],
) => schedule.groups[group]?.days.find((item) => item.day === day);

const baseLessons = (
  schedule: CanonicalSchedule,
  group: string,
  day: ActualScheduleDate['day'],
  weekType: WeekType,
): ActualLesson[] | null => {
  const scheduleDay = baseScheduleDay(schedule, group, day);
  if (!scheduleDay) return null;
  return scheduleDay.lessons
    .map((lesson) => toActualLesson(lesson, weekType))
    .filter((lesson) => lesson.variants.length > 0);
};

/**
 * Строит evidence для случая, когда номер пары существует, но все варианты
 * исключены типом недели из заголовка страницы замен.
 */
const unavailableWeekLessonContext = (
  replacement: Replacement,
  lesson: Lesson,
  weekType: WeekType,
): Record<string, unknown> => ({
  replacementWeekType: weekType,
  availableWeekTypes: [
    ...new Set(lesson.variants.map((variant) => variant.weekType)),
  ].sort((left, right) => left.localeCompare(right)),
  ...unresolvedMatchContext(replacement, toActualLesson(lesson, 'unknown')),
});

/**
 * Добавляет к diagnostics ссылки на базовые данные, которые resolver проверял.
 *
 * Эти поля нужны только для ручной проверки Issue и не влияют на решение о
 * применении замены.
 */
const baseDiagnosticContext = (
  schedule: CanonicalSchedule,
  group: string,
): Record<string, unknown> => {
  const baseGroup = schedule.groups[group];
  if (!baseGroup) return {};
  const sourceNames = new Map(
    schedule.sources.map((source) => [source.id, source.fileName]),
  );
  const baseSourceFiles = [
    ...new Set(
      baseGroup.sourceBlocks
        .map((source) => source.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId))
        .map((sourceId) => sourceNames.get(sourceId) ?? sourceId),
    ),
  ].sort((left, right) => left.localeCompare(right, 'ru-RU'));
  return {
    baseGroup: group,
    ...(baseSourceFiles.length ? { baseSourceFiles } : {}),
  };
};

const frozenBase = (
  schedule: CanonicalSchedule,
  dataRevision: string | undefined,
  lessons: readonly ActualLesson[],
): FrozenActualBase => ({
  scheduleVersion: schedule.version.value,
  ...(dataRevision ? { dataRevision } : {}),
  lessons: lessons.map(cloneActualLesson),
});

const legacySnapshots = (
  replacements: CanonicalReplacements,
  date: CanonicalReplacements['dates'][string],
): ReplacementSnapshot[] => {
  const shifts: readonly ReplacementShift[] = ['first', 'second'];
  return shifts.flatMap((shift) => {
    const shiftReplacements = date.replacements.filter(
      (replacement) => replacement.source.shift === shift,
    );
    if (!shiftReplacements.length) return [];
    const source = replacements.sources.find(
      (item) => item.shift === shift,
    ) ?? {
      id: `legacy-${shift}`,
      fileName: `legacy-${shift}.html`,
      sha256: sha256(`legacy\0${shift}`),
      fetchedAt: replacements.generatedAt,
      shift,
    };
    return [
      {
        date: date.date,
        day: date.day,
        weekType: date.weekType,
        shift,
        status: 'mutable',
        source,
        replacements: shiftReplacements,
        diagnostics: [],
      } satisfies ReplacementSnapshot,
    ];
  });
};

const snapshotsForActual = (
  replacements: CanonicalReplacements,
  date: CanonicalReplacements['dates'][string],
): ReplacementSnapshot[] =>
  date.shifts
    ? compatibleReplacementSnapshots(date)
    : legacySnapshots(replacements, date);

const snapshotStates = (
  snapshots: readonly ReplacementSnapshot[],
): NonNullable<ActualScheduleDate['shifts']> =>
  Object.fromEntries(
    snapshots.map((snapshot) => [
      snapshot.shift,
      {
        date: snapshot.date,
        day: snapshot.day,
        weekType: snapshot.weekType,
        status: snapshot.status,
        source: { ...snapshot.source },
        ...(snapshot.finalizedBy
          ? { finalizedBy: { ...snapshot.finalizedBy } }
          : {}),
      },
    ]),
  );

export interface BuildActualScheduleOptions {
  previousActual?: ActualSchedule | null;
  baseDataRevision?: string;
}

/**
 * Рекурсивно сортирует ключи JSON-совместимого значения для semantic hash.
 *
 * Порядок ключей контекста diagnostics не несёт смысла и не должен менять
 * решение о публикации данных.
 */
const stableSemanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableSemanticValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, 'ru-RU'))
      .map(([key, item]) => [key, stableSemanticValue(item)]),
  );
};

/**
 * Оставляет у строки замен только данные, меняющие опубликованный смысл.
 *
 * URL, время загрузки, ETag и SHA HTML нужны в полном артефакте для
 * проверки источника, но не должны создавать новую semantic-версию.
 */
const replacementSemanticEntry = (replacement: Replacement): unknown => ({
  date: replacement.date,
  group: replacement.group,
  lessonNumbers: replacement.lessonNumbers,
  type: replacement.type,
  original: replacement.original,
  replacement: replacement.replacement,
  source: {
    shift: replacement.source.shift,
    row: replacement.source.row,
    rawGroupName: replacement.source.rawGroupName,
    rawLessonNumbers: replacement.source.rawLessonNumbers,
    rawOriginal: replacement.source.rawOriginal,
    rawReplacement: replacement.source.rawReplacement,
    rawRoom: replacement.source.rawRoom,
  },
});

const semanticDiagnostics = (diagnostics: readonly Diagnostic[]): unknown[] =>
  diagnostics
    .map((diagnostic) => {
      const semanticDiagnostic = { ...diagnostic };
      delete semanticDiagnostic.sourceId;
      delete semanticDiagnostic.sourceUrl;
      return stableSemanticValue(semanticDiagnostic);
    })
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'ru-RU'),
    );

const sortedReplacementSemanticEntries = (
  replacements: readonly Replacement[],
): unknown[] =>
  replacements
    .map(replacementSemanticEntry)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'ru-RU'),
    );

const replacementSemanticValue = (
  replacements: CanonicalReplacements,
): unknown => ({
  dates: Object.fromEntries(
    Object.entries(replacements.dates)
      .sort(([left], [right]) => left.localeCompare(right, 'ru-RU'))
      .map(([date, value]) => [
        date,
        {
          day: value.day,
          weekType: value.weekType,
          shifts: Object.fromEntries(
            Object.entries(value.shifts ?? {})
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([shift, snapshot]) => [
                shift,
                snapshot
                  ? {
                      date: snapshot.date,
                      day: snapshot.day,
                      weekType: snapshot.weekType,
                      shift: snapshot.shift,
                      status: snapshot.status,
                      replacements: sortedReplacementSemanticEntries(
                        snapshot.replacements,
                      ),
                      diagnostics: semanticDiagnostics(snapshot.diagnostics),
                    }
                  : null,
              ]),
          ),
          replacements: sortedReplacementSemanticEntries(value.replacements),
        },
      ]),
  ),
  diagnostics: semanticDiagnostics(replacements.diagnostics),
});

export const semanticReplacementHash = (
  replacements: CanonicalReplacements,
): string => sha256(JSON.stringify(replacementSemanticValue(replacements)));

/**
 * Убирает provenance полей, которые не меняют опубликованный смысл actual.
 *
 * Источник, номер строки и SHA нужны для полного артефакта и диагностики, но
 * не должны создавать новую версию actual при одинаковых занятиях и заменах.
 */
const withoutActualProvenance = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const normalized = value.map(withoutActualProvenance);
    return normalized.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          !['source', 'sourceRow', 'scheduleVersion', 'dataRevision'].includes(
            key,
          ) &&
          ![
            'sourceId',
            'sourceUrl',
            'fetchedAt',
            'sha256',
            'etag',
            'lastModified',
          ].includes(key),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, withoutActualProvenance(item)]),
  );
};

/**
 * Повторяет порядок публичной actual-выгрузки перед semantic hash.
 *
 * Сначала actual строится из истории и может иметь другой порядок групп или
 * пар, чем тот же JSON после повторного чтения. Эти перестановки не являются
 * изменением расписания и не должны создавать новый commit.
 */
const normalizeActualDatesForHash = (
  dates: ActualSchedule['dates'],
): ActualSchedule['dates'] =>
  Object.fromEntries(
    Object.entries(dates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => [
        date,
        {
          ...value,
          groups: Object.fromEntries(
            Object.entries(value.groups)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([group, scheduleGroup]) => [
                group,
                {
                  ...scheduleGroup,
                  lessons: [...scheduleGroup.lessons].sort(
                    (left, right) => left.number - right.number,
                  ),
                },
              ]),
          ),
        },
      ]),
  );

export const semanticActualScheduleHash = (actual: ActualSchedule): string => {
  const dates = normalizeActualDatesForHash(actual.dates);
  return sha256(
    JSON.stringify({
      dates: withoutActualProvenance(dates),
      diagnostics: [...actual.diagnostics].sort((left, right) =>
        left.fingerprint.localeCompare(right.fingerprint),
      ),
    }),
  );
};

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
  aliases: ReplacementAliases = emptyAliases(),
  options: BuildActualScheduleOptions = {},
): ActualSchedule => {
  const diagnostics = [...replacements.diagnostics];
  const dates: Record<string, ActualScheduleDate> = {};
  const baseDataRevision =
    options.previousActual?.baseScheduleVersion === schedule.version.value
      ? (options.previousActual.baseDataRevision ?? options.baseDataRevision)
      : options.baseDataRevision;

  for (const [date, replacementDate] of Object.entries(replacements.dates)) {
    const snapshots = snapshotsForActual(replacements, replacementDate);
    if (!snapshots.length) continue;
    const actualDate: ActualScheduleDate = {
      date,
      day: replacementDate.day,
      weekType: replacementDate.weekType,
      shifts: snapshotStates(snapshots),
      groups: {},
    };
    dates[date] = actualDate;

    const ensureGroup = (
      group: string,
      shouldFreezeBase: boolean,
    ): ActualGroupSchedule => {
      const existing = actualDate.groups[group];
      if (existing) return existing;

      const previousGroup =
        options.previousActual?.dates[date]?.groups[group] ?? null;
      const retainedFrozenBase = previousGroup?.frozenBase;
      const currentBaseLessons = baseLessons(
        schedule,
        group,
        replacementDate.day,
        replacementDate.weekType,
      );
      const initialLessons = retainedFrozenBase
        ? retainedFrozenBase.lessons.map(cloneActualLesson)
        : (currentBaseLessons?.map(cloneActualLesson) ?? []);
      const target: ActualGroupSchedule = {
        group,
        date,
        day: replacementDate.day,
        lessons: initialLessons,
        unresolvedReplacements: [],
        ...(retainedFrozenBase
          ? {
              frozenBase: {
                ...retainedFrozenBase,
                lessons: retainedFrozenBase.lessons.map(cloneActualLesson),
              },
            }
          : shouldFreezeBase && currentBaseLessons
            ? {
                frozenBase: frozenBase(
                  schedule,
                  baseDataRevision,
                  currentBaseLessons,
                ),
              }
            : {}),
      };
      actualDate.groups[group] = target;
      return target;
    };

    for (const snapshot of snapshots) {
      for (const replacement of snapshot.replacements) {
        // Старый артефакт мог быть создан до запрета пустой группы в parser-е.
        // Такую строку уже отражает parser diagnostic; в actual она не должна
        // создавать группу с пустым именем.
        if (!replacement.group.trim()) continue;

        const resolvedGroup = resolveYgkReplacementGroup(
          replacement.group,
          Object.keys(schedule.groups),
          aliases,
        );
        const replacementGroup =
          resolvedGroup.group ??
          resolveReplacementAlias(aliases, 'groups', replacement.group);
        const group = ensureGroup(
          replacementGroup,
          snapshot.status === 'finalized',
        );
        const baseContext = baseDiagnosticContext(schedule, replacementGroup);
        const scheduleDay = baseScheduleDay(
          schedule,
          replacementGroup,
          replacementDate.day,
        );
        const hasBaseDay = Boolean(scheduleDay);
        const hasFrozenBase = Boolean(group.frozenBase);

        if (!hasBaseDay && !hasFrozenBase) {
          const reason = schedule.groups[replacementGroup]
            ? 'day-not-found'
            : 'group-not-found';
          for (const lessonNumber of replacement.lessonNumbers)
            unresolved(
              group,
              replacement,
              lessonNumber,
              reason,
              replacements.sources,
              diagnostics,
              baseContext,
            );
          continue;
        }

        for (const lessonNumber of replacement.lessonNumbers) {
          const baseLesson = scheduleDay?.lessons.find(
            (lesson) => lesson.number === lessonNumber,
          );
          const activeLesson = group.lessons.find(
            (lesson) => lesson.number === lessonNumber,
          );
          if (
            replacement.type !== 'add' &&
            !activeLesson &&
            baseLesson?.variants.length
          ) {
            unresolved(
              group,
              replacement,
              lessonNumber,
              'lesson-not-scheduled-for-week',
              replacements.sources,
              diagnostics,
              {
                ...baseContext,
                ...unavailableWeekLessonContext(
                  replacement,
                  baseLesson,
                  replacementDate.weekType,
                ),
              },
            );
            continue;
          }
          applyReplacement(
            group,
            replacement,
            lessonNumber,
            replacements.sources,
            diagnostics,
            aliases,
            baseContext,
          );
        }
      }
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
    ...(baseDataRevision ? { baseDataRevision } : {}),
    replacementVersion: replacements.version.value,
    dates,
    diagnostics,
    semanticHash: '',
  };
  actual.semanticHash = semanticActualScheduleHash(actual);
  return actual;
};
