import type { DiagnosticsReport } from '../generators/diagnostics.ts';
import type {
  ActualSchedule,
  CanonicalReplacements,
  CanonicalSchedule,
} from '../types.ts';

const diagnosticsSummary = (summary: DiagnosticsReport['summary']): string =>
  `${summary.info} info, ${summary.warning} warnings, ${summary.error} errors, ${summary.fatal} fatal.`;

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
- Источников XLSX: **${schedule.sources.length}**
- Версия данных: \`${schedule.version.value}\`
- Diagnostics: ${diagnosticsSummary(diagnostics.summary)}`;

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
- Diagnostics: ${diagnosticsSummary(diagnostics.summary)}`;
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
