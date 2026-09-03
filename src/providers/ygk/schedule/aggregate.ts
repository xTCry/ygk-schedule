import { createDiagnostic } from '../../../diagnostics/index.ts';
import type {
  Diagnostic,
  GroupSchedule,
  ParsedSchedule,
  ScheduleSource,
} from '../../../types.ts';

export interface ParsedYgkScheduleSource {
  source: ScheduleSource;
  parsed: ParsedSchedule;
}

const compareSources = (
  left: ParsedYgkScheduleSource,
  right: ParsedYgkScheduleSource,
): number => left.source.id.localeCompare(right.source.id);

const withSourceReferences = (
  group: GroupSchedule,
  sourceId: string,
): GroupSchedule => ({
  ...group,
  sourceBlocks: group.sourceBlocks.map((sourceBlock) => ({
    ...sourceBlock,
    sourceId,
  })),
  days: group.days.map((day) => ({
    ...day,
    lessons: day.lessons.map((lesson) => ({
      ...lesson,
      source: {
        ...lesson.source,
        sourceId,
      },
    })),
  })),
});

const withSourceMetadata = (
  diagnostic: Diagnostic,
  source: ScheduleSource,
): Diagnostic => ({
  ...diagnostic,
  sourceId: source.id,
  ...(source.url ? { sourceUrl: source.url } : {}),
  context: {
    ...(diagnostic.context ?? {}),
    sourceFileName: source.fileName,
  },
});

/**
 * Собирает разобранные файлы отделений в единое расписание ЯГК.
 *
 * Повтор группы между файлами считается критической неоднозначностью: первая
 * группа сохраняется для диагностики, но новый результат не публикуется.
 */
export const aggregateYgkSchedules = (
  parsedSources: ParsedYgkScheduleSource[],
): ParsedSchedule => {
  const groups: Record<string, GroupSchedule> = {};
  const diagnostics: Diagnostic[] = [];
  const sourceFileNames = new Map<string, string>();

  for (const { source, parsed } of [...parsedSources].sort(compareSources)) {
    sourceFileNames.set(source.id, source.fileName);
    diagnostics.push(
      ...parsed.diagnostics.map((diagnostic) =>
        withSourceMetadata(diagnostic, source),
      ),
    );

    for (const [groupCode, group] of Object.entries(parsed.groups).sort(
      ([left], [right]) => left.localeCompare(right, 'ru-RU'),
    )) {
      const existing = groups[groupCode];
      if (!existing) {
        groups[groupCode] = withSourceReferences(group, source.id);
        continue;
      }

      const sourceIds = [
        ...new Set([
          ...existing.sourceBlocks
            .map((sourceBlock) => sourceBlock.sourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId)),
          source.id,
        ]),
      ].sort();
      const fileNames = sourceIds
        .map((sourceId) => sourceFileNames.get(sourceId) ?? sourceId)
        .sort();
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_GROUP_ACROSS_SOURCES',
          severity: 'fatal',
          message: `Группа ${groupCode} обнаружена в нескольких XLSX-файлах`,
          normalizedGroup: groupCode,
          context: { sourceIds, fileNames },
          fingerprintContext: sourceIds,
        }),
      );
    }
  }

  return {
    groups: Object.fromEntries(
      Object.entries(groups).sort(([left], [right]) =>
        left.localeCompare(right, 'ru-RU'),
      ),
    ),
    diagnostics,
  };
};
