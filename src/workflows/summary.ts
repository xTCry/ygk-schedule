import type { DiagnosticsReport } from '../generators/diagnostics.ts';
import type {
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
  ReplacementPageSource,
  ScheduleSource,
} from '../types.ts';

const diagnosticsSummary = (summary: DiagnosticsReport['summary']): string =>
  `${summary.info} info, ${summary.warning} warnings, ${summary.error} errors, ${summary.fatal} fatal.`;

const scheduleLessonCount = (schedule: CanonicalSchedule): number =>
  Object.values(schedule.groups).reduce(
    (count, group) =>
      count + group.days.reduce((total, day) => total + day.lessons.length, 0),
    0,
  );

const actualLessonCount = (actual: ActualSchedule): number =>
  Object.values(actual.dates).reduce(
    (count, date) =>
      count +
      Object.values(date.groups).reduce(
        (total, group) => total + group.lessons.length,
        0,
      ),
    0,
  );

const sourceLink = (
  source: Pick<ScheduleSource, 'fileName' | 'url'>,
): string =>
  source.url ? `[${source.fileName}](${source.url})` : `\`${source.fileName}\``;

const sourceTimestamp = (
  source: Pick<ScheduleSource, 'fetchedAt' | 'lastModified'>,
): string =>
  source.lastModified
    ? `сайт: \`${source.lastModified}\``
    : `получен: \`${source.fetchedAt}\``;

/**
 * Проверка не блокирует выгрузку: количество XLSX может поменяться при
 * реорганизации сайта. Но 0–1 файла почти наверняка означает смену вёрстки
 * или неполное обнаружение ссылки.
 */
const formatScheduleSourcesHealth = (
  sources: readonly ScheduleSource[],
): string => {
  const suspicious = sources.length < 2;
  return `### Источники XLSX

- ${suspicious ? '⚠️' : '✅'} Обнаружено файлов: **${sources.length}**
- Файлы: ${sources.length ? sources.map(sourceLink).join(', ') : '—'}
${sources.length ? sources.map((source) => `- ${sourceLink(source)} — ${sourceTimestamp(source)}`).join('\n') : ''}
${suspicious ? '\n- ⚠️ Необычно мало XLSX: проверьте разметку страницы и ссылки на источники.' : ''}`;
};

const shiftLabel = (shift: ReplacementPageSource['shift']): string =>
  shift === 'first' ? 'первая смена' : 'вторая смена';

/**
 * Обе страницы замен должны быть доступны даже при отсутствии самих замен:
 * пустая таблица — допустимый ответ, отсутствие страницы — нет.
 */
const formatReplacementSourcesHealth = (
  replacements: CanonicalReplacements,
): string => {
  const sourceByShift = new Map(
    replacements.sources.map((source) => [source.shift, source]),
  );
  const shifts: ReplacementPageSource['shift'][] = ['first', 'second'];
  const missing = shifts.filter((shift) => !sourceByShift.has(shift));
  const latestDate = Object.keys(replacements.dates).sort().at(-1);

  return `### Источники замен

- ${missing.length ? '⚠️' : '✅'} Страницы: ${shifts
    .map((shift) =>
      sourceByShift.has(shift)
        ? shiftLabel(shift)
        : `${shiftLabel(shift)} — отсутствует`,
    )
    .join(', ')}
- Новейшая дата в сохранённой истории: ${latestDate ? `\`${latestDate}\`` : '—'}
${shifts
  .flatMap((shift) => {
    const source = sourceByShift.get(shift);
    return source
      ? [
          `- ${shiftLabel(shift)}: ${sourceLink(source)} — ${sourceTimestamp(source)}`,
        ]
      : [];
  })
  .join('\n')}
${missing.length ? '\n- ⚠️ Отсутствует одна из обязательных страниц замен: проверьте источник до публикации.' : ''}`;
};

/** Формирует Job Summary для успешной проверки кода parser-а. */
export const formatParserCheckSummary = (): string => `## Проверка parser

✅ TypeScript, ESLint, Vitest и Prettier прошли успешно.`;

/** Формирует Job Summary после обновления базового расписания. */
export const formatScheduleUpdateSummary = (
  schedule: CanonicalSchedule,
  diagnostics: DiagnosticsReport,
  changed: boolean,
): string => `## Базовое расписание

- Изменения перед публикацией: **${changed ? 'да' : 'нет'}**
- Групп: **${Object.keys(schedule.groups).length}**
- Пар в шаблоне: **${scheduleLessonCount(schedule)}**
- Источников XLSX: **${schedule.sources.length}**
- Версия данных: \`${schedule.version.value}\`
- Diagnostics: ${diagnosticsSummary(diagnostics.summary)}

${formatScheduleSourcesHealth(schedule.sources)}`;

/** Формирует Job Summary после обновления замен и actual-расписания. */
export const formatReplacementsUpdateSummary = (
  replacements: CanonicalReplacements,
  actual: ActualSchedule,
  diagnostics: DiagnosticsReport,
  changed: boolean,
): string => {
  const snapshots = Object.values(replacements.dates).flatMap((date) =>
    Object.values(date.shifts ?? {}).filter(
      (snapshot): snapshot is NonNullable<typeof snapshot> => Boolean(snapshot),
    ),
  );
  const replacementCount = Object.values(replacements.dates).reduce(
    (count, date) => count + date.replacements.length,
    0,
  );
  return `## Замены и actual-расписание

- Изменения перед публикацией: **${changed ? 'да' : 'нет'}**
- Дат с заменами: **${Object.keys(replacements.dates).length}**
- Строк замен: **${replacementCount}**
- Снимков: **${snapshots.filter((snapshot) => snapshot.status === 'mutable').length} mutable**, **${snapshots.filter((snapshot) => snapshot.status === 'finalized').length} finalized**
- Дат actual-расписания: **${Object.keys(actual.dates).length}**
- Пар в actual-расписании: **${actualLessonCount(actual)}**
- Diagnostics: ${diagnosticsSummary(diagnostics.summary)}

${formatReplacementSourcesHealth(replacements)}`;
};

/** Формирует Job Summary состояния публикации data-ветки. */
export const formatPublishSummary = (
  directories: readonly string[],
  changed: boolean,
  files = 0,
  revision?: string,
): string =>
  changed
    ? `### Публикация

- Обновлено файлов в ${directories.map((directory) => `\`${directory}/\``).join(', ')}: **${files}**
- Commit: \`${revision?.slice(0, 12) ?? 'unknown'}\``
    : `### Публикация

Изменений в ${directories.map((directory) => `\`${directory}/\``).join(', ')} нет — commit не создан.`;

/** Формирует Job Summary синхронизации диагностических Issue. */
export const formatIssueSyncSummary = (
  issueCount: number,
  result: {
    created: number;
    updated: number;
    reopened: number;
    commented: number;
    closed: number;
    unchanged: number;
    deferred?: { reason: string; retryAfterSeconds?: number };
  },
): string => {
  const details = result.deferred
    ? `Синхронизация отложена: **${result.deferred.reason}**. Следующий запуск продолжит работу без ожидания в этом workflow.`
    : `Синхронизация завершена. Черновиков Issue в текущих выгрузках: **${issueCount}**.`;
  return `### Диагностические Issue

${details}

- Создано: **${result.created}**
- Обновлено: **${result.updated}**
- Переоткрыто: **${result.reopened}**
- Комментариев lifecycle: **${result.commented}**
- Закрыто: **${result.closed}**
- Без изменений: **${result.unchanged}**`;
};

/** Формирует единый итог workflow по результатам его шагов. */
export const formatWorkflowStatusSummary = (options: {
  event: string;
  parserRevision: string;
  check: string;
  update: string;
  ical: string;
  publish: string;
  issues: string;
}): string => `## Итог workflow

- Событие: \`${options.event}\`
- Ревизия parser: \`${options.parserRevision}\`
- Проверка parser: \`${options.check}\`
- Выгрузка данных: \`${options.update}\`
- Генерация ICS: \`${options.ical}\`
- Публикация: \`${options.publish}\`
- Синхронизация Issue: \`${options.issues}\``;
