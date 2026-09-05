import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ActualSchedule,
  ActualGroupScheduleArtifact,
  CanonicalReplacements,
  GroupReplacementsArtifact,
  ReplacementDate,
  ReplacementSnapshot,
} from '../types.ts';
import { writeFileAtomic } from '../utils/fs.ts';
import { sha256 } from '../utils/hash.ts';
import {
  serializeDiagnosticsReport,
  serializeDiagnosticsReportYaml,
} from './diagnostics.ts';
import { serializeYaml } from './yaml.ts';

export interface ReplacementArtifactPaths {
  replacementsJson: string;
  replacementsYaml: string;
  replacementGroupJsonDirectory: string;
  replacementGroupYamlDirectory: string;
  replacementDiagnosticsJson: string;
  replacementDiagnosticsYaml: string;
  actualJson: string;
  actualYaml: string;
  actualGroupJsonDirectory: string;
  actualGroupYamlDirectory: string;
  actualDiagnosticsJson: string;
  actualDiagnosticsYaml: string;
}

const compareText = (left: string, right: string): number =>
  left.localeCompare(right, 'ru-RU');

/**
 * Возвращает стабильные пути raw-замен и расписания после их наложения.
 */
export const getReplacementArtifactPaths = (
  outputDirectory: string,
): ReplacementArtifactPaths => {
  const directory = resolve(outputDirectory);
  return {
    replacementsJson: join(directory, 'replacements', '00-replacements.json'),
    replacementsYaml: join(directory, 'replacements', '00-replacements.yaml'),
    replacementGroupJsonDirectory: join(directory, 'replacements', '10-groups'),
    replacementGroupYamlDirectory: join(directory, 'replacements', '10-groups'),
    replacementDiagnosticsJson: join(
      directory,
      'replacements',
      '90-diagnostics.json',
    ),
    replacementDiagnosticsYaml: join(
      directory,
      'replacements',
      '90-diagnostics.yaml',
    ),
    actualJson: join(directory, 'actual', '00-schedule.json'),
    actualYaml: join(directory, 'actual', '00-schedule.yaml'),
    actualGroupJsonDirectory: join(directory, 'actual', '10-groups'),
    actualGroupYamlDirectory: join(directory, 'actual', '10-groups'),
    actualDiagnosticsJson: join(directory, 'actual', '90-diagnostics.json'),
    actualDiagnosticsYaml: join(directory, 'actual', '90-diagnostics.yaml'),
  };
};

const replacementSortKey = (
  replacement: ReplacementDate['replacements'][number],
): string =>
  [
    replacement.group,
    replacement.lessonNumbers.join(','),
    replacement.type,
    replacement.original?.raw ?? '',
    replacement.replacement?.raw ?? '',
  ].join('\0');

/**
 * Устойчиво связывает строку агрегированной даты с той же строкой снимка
 * смены после чтения JSON, где ссылочная идентичность уже потеряна.
 */
const replacementIdentity = (
  replacement: ReplacementDate['replacements'][number],
): string =>
  [
    replacementSortKey(replacement),
    replacement.source.shift,
    String(replacement.source.row),
    replacement.source.rawGroupName,
    replacement.source.rawLessonNumbers,
    replacement.source.rawOriginal,
    replacement.source.rawReplacement,
    replacement.source.rawRoom,
  ].join('\0');

const normalizeReplacementDates = (
  dates: CanonicalReplacements['dates'],
): CanonicalReplacements['dates'] =>
  Object.fromEntries(
    Object.entries(dates)
      .sort(([left], [right]) => compareText(left, right))
      .map(([date, value]) => {
        const replacements = [...value.replacements].sort((left, right) =>
          compareText(replacementSortKey(left), replacementSortKey(right)),
        );
        const replacementReferences = new Map(
          replacements.map((replacement) => [
            replacementIdentity(replacement),
            replacement,
          ]),
        );
        const shifts = Object.fromEntries(
          Object.entries(value.shifts ?? {})
            .sort(([left], [right]) => compareText(left, right))
            .flatMap(([shift, snapshot]) =>
              snapshot
                ? [
                    [
                      shift,
                      {
                        ...snapshot,
                        replacements: snapshot.replacements
                          .map(
                            (replacement) =>
                              replacementReferences.get(
                                replacementIdentity(replacement),
                              ) ?? replacement,
                          )
                          .sort((left, right) =>
                            compareText(
                              replacementSortKey(left),
                              replacementSortKey(right),
                            ),
                          ),
                        diagnostics: [...snapshot.diagnostics].sort(
                          (left, right) =>
                            compareText(left.fingerprint, right.fingerprint),
                        ),
                      } satisfies ReplacementSnapshot,
                    ],
                  ]
                : [],
            ),
        );
        return [
          date,
          {
            ...value,
            ...(Object.keys(shifts).length ? { shifts } : {}),
            replacements,
          },
        ];
      }),
  );

const normalizeActualDates = (
  dates: ActualSchedule['dates'],
): ActualSchedule['dates'] =>
  Object.fromEntries(
    Object.entries(dates)
      .sort(([left], [right]) => compareText(left, right))
      .map(([date, value]) => [
        date,
        {
          ...value,
          groups: Object.fromEntries(
            Object.entries(value.groups)
              .sort(([left], [right]) => compareText(left, right))
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

const normalizeReplacements = (
  replacements: CanonicalReplacements,
): CanonicalReplacements => ({
  ...replacements,
  sources: [...replacements.sources].sort((left, right) =>
    compareText(left.id, right.id),
  ),
  dates: normalizeReplacementDates(replacements.dates),
  diagnostics: [...replacements.diagnostics].sort((left, right) =>
    compareText(left.fingerprint, right.fingerprint),
  ),
});

const normalizeActualSchedule = (schedule: ActualSchedule): ActualSchedule => ({
  ...schedule,
  sources: [...schedule.sources].sort((left, right) =>
    compareText(left.id, right.id),
  ),
  dates: normalizeActualDates(schedule.dates),
  diagnostics: [...schedule.diagnostics].sort((left, right) =>
    compareText(left.fingerprint, right.fingerprint),
  ),
});

export const serializeReplacements = (
  replacements: CanonicalReplacements,
): string =>
  `${JSON.stringify(normalizeReplacements(replacements), null, 2)}\n`;

export const serializeReplacementsYaml = (
  replacements: CanonicalReplacements,
): string => serializeYaml(normalizeReplacements(replacements));

export const serializeActualSchedule = (schedule: ActualSchedule): string =>
  `${JSON.stringify(normalizeActualSchedule(schedule), null, 2)}\n`;

export const serializeActualScheduleYaml = (schedule: ActualSchedule): string =>
  serializeYaml(normalizeActualSchedule(schedule));

/**
 * Возвращает безопасное и читаемое имя файла для названия группы из HTML.
 *
 * Пробелы и кириллица допустимы в именах файлов и остаются без URL-кодирования.
 * Кодирование применяется только к символам, которые небезопасны для пути или
 * несовместимы с распространенными файловыми системами.
 */
export const getReplacementGroupFileName = (group: string): string => {
  const normalized = group.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized === '.' || normalized === '..')
    throw new Error(`Group name cannot be used as a file name: ${group}`);
  return [...normalized]
    .map((character) =>
      (character.codePointAt(0) ?? 0) < 32 || /[\\/:*?"<>|]/u.test(character)
        ? encodeURIComponent(character)
        : character,
    )
    .join('');
};

const getGroupArtifactPaths = (
  jsonDirectory: string,
  yamlDirectory: string,
  group: string,
): { json: string; yaml: string } => {
  const fileName = getReplacementGroupFileName(group);
  return {
    json: join(jsonDirectory, `${fileName}.json`),
    yaml: join(yamlDirectory, `${fileName}.yaml`),
  };
};

const replacementGroups = (replacements: CanonicalReplacements): string[] =>
  [
    ...new Set(
      Object.values(replacements.dates).flatMap((date) =>
        date.replacements.map((replacement) => replacement.group),
      ),
    ),
  ].sort(compareText);

/**
 * Оставляет в снимке смены только строки и диагностику одной группы.
 *
 * Массив `replacements` намеренно содержит те же объекты, что и агрегированная
 * проекция даты. YAML представит их aliases, а JSON останется полностью
 * развернутым и не потеряет совместимость.
 */
const replacementSnapshotForGroup = (
  snapshot: ReplacementSnapshot,
  group: string,
): ReplacementSnapshot | null => {
  const groupReplacements = snapshot.replacements.filter(
    (replacement) => replacement.group === group,
  );
  const diagnostics = snapshot.diagnostics.filter(
    (diagnostic) => diagnostic.normalizedGroup === group,
  );
  if (!groupReplacements.length && !diagnostics.length) return null;
  return {
    ...snapshot,
    replacements: groupReplacements,
    diagnostics,
  };
};

/**
 * Проецирует независимые снимки первой и второй смены на одну группу.
 */
const replacementShiftsForGroup = (
  date: ReplacementDate,
  group: string,
): ReplacementDate['shifts'] => {
  const shifts = Object.entries(date.shifts ?? {})
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([shift, snapshot]) => {
      if (!snapshot) return [];
      const groupSnapshot = replacementSnapshotForGroup(snapshot, group);
      return groupSnapshot
        ? ([[shift, groupSnapshot]] as const)
        : ([] as const);
    });
  return shifts.length ? Object.fromEntries(shifts) : undefined;
};

const actualGroups = (schedule: ActualSchedule): string[] =>
  [
    ...new Set(
      Object.values(schedule.dates).flatMap((date) => Object.keys(date.groups)),
    ),
  ].sort(compareText);

/**
 * Возвращает компактную выгрузку замен одной группы без общих metadata.
 */
const replacementGroupArtifact = (
  replacements: CanonicalReplacements,
  group: string,
): GroupReplacementsArtifact => {
  const dates: CanonicalReplacements['dates'] = {};
  for (const [date, value] of Object.entries(replacements.dates)) {
    const groupReplacements = value.replacements.filter(
      (replacement) => replacement.group === group,
    );
    if (!groupReplacements.length) continue;
    const shifts = replacementShiftsForGroup(value, group);
    dates[date] = {
      date: value.date,
      day: value.day,
      weekType: value.weekType,
      ...(shifts ? { shifts } : {}),
      replacements: groupReplacements,
    };
  }
  return {
    schemaVersion: replacements.schemaVersion,
    provider: replacements.provider,
    group,
    dates: normalizeReplacementDates(dates),
    diagnostics: replacements.diagnostics.filter(
      (diagnostic) => diagnostic.normalizedGroup === group,
    ),
    semanticHash: sha256(
      JSON.stringify({ group, dates: normalizeReplacementDates(dates) }),
    ),
  };
};

/**
 * Возвращает компактную выгрузку actual-расписания одной группы.
 */
const actualGroupArtifact = (
  schedule: ActualSchedule,
  group: string,
): ActualGroupScheduleArtifact => {
  const dates: ActualSchedule['dates'] = {};
  for (const [date, value] of Object.entries(schedule.dates)) {
    const scheduleGroup = value.groups[group];
    if (!scheduleGroup) continue;
    dates[date] = { ...value, groups: { [group]: scheduleGroup } };
  }
  return {
    schemaVersion: schedule.schemaVersion,
    provider: schedule.provider,
    group,
    dates: normalizeActualDates(dates),
    diagnostics: schedule.diagnostics.filter(
      (diagnostic) => diagnostic.normalizedGroup === group,
    ),
    semanticHash: sha256(
      JSON.stringify({ group, dates: normalizeActualDates(dates) }),
    ),
  };
};

const serializeReplacementGroupArtifact = (
  artifact: GroupReplacementsArtifact,
): string => `${JSON.stringify(artifact, null, 2)}\n`;

const serializeReplacementGroupArtifactYaml = (
  artifact: GroupReplacementsArtifact,
): string => serializeYaml(artifact);

const serializeActualGroupArtifact = (
  artifact: ActualGroupScheduleArtifact,
): string => `${JSON.stringify(artifact, null, 2)}\n`;

const serializeActualGroupArtifactYaml = (
  artifact: ActualGroupScheduleArtifact,
): string => serializeYaml(artifact);

const syncDirectory = async (
  directory: string,
  expectedPaths: readonly string[],
): Promise<void> => {
  const expected = new Set(expectedPaths.map((path) => resolve(path)));
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
        .map((entry) => join(directory, entry.name))
        .filter((path) => !expected.has(resolve(path)))
        .map((path) => unlink(path)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

/**
 * Список всех файлов, которые считаются полной выгрузкой замен и actual data.
 */
export const getReplacementArtifactFiles = (
  paths: ReplacementArtifactPaths,
  replacements: CanonicalReplacements,
  actual: ActualSchedule,
): string[] => [
  paths.replacementsJson,
  paths.replacementsYaml,
  paths.replacementDiagnosticsJson,
  paths.replacementDiagnosticsYaml,
  paths.actualJson,
  paths.actualYaml,
  paths.actualDiagnosticsJson,
  paths.actualDiagnosticsYaml,
  ...replacementGroups(replacements).flatMap((group) => {
    const groupPaths = getGroupArtifactPaths(
      paths.replacementGroupJsonDirectory,
      paths.replacementGroupYamlDirectory,
      group,
    );
    return [groupPaths.json, groupPaths.yaml];
  }),
  ...actualGroups(actual).flatMap((group) => {
    const groupPaths = getGroupArtifactPaths(
      paths.actualGroupJsonDirectory,
      paths.actualGroupYamlDirectory,
      group,
    );
    return [groupPaths.json, groupPaths.yaml];
  }),
];

/**
 * Записывает raw-замены и actual-расписание, очищая только устаревшие файлы
 * в предназначенных для автоматически созданных групповых каталогах.
 */
export const writeReplacementArtifacts = async (
  paths: ReplacementArtifactPaths,
  replacements: CanonicalReplacements,
  actual: ActualSchedule,
): Promise<void> => {
  // JSON не сохраняет shared references. Перед каждым выводом восстанавливаем
  // их по стабильному ключу, чтобы YAML aliases не зависели от того, был ли
  // источник только что распарсен или прочитан из предыдущего JSON-артефакта.
  const normalizedReplacements = normalizeReplacements(replacements);
  const normalizedActual = normalizeActualSchedule(actual);
  const replacementGroupWrites = replacementGroups(
    normalizedReplacements,
  ).flatMap((group) => {
    const groupPaths = getGroupArtifactPaths(
      paths.replacementGroupJsonDirectory,
      paths.replacementGroupYamlDirectory,
      group,
    );
    const artifact = replacementGroupArtifact(normalizedReplacements, group);
    return [
      writeFileAtomic(
        groupPaths.json,
        serializeReplacementGroupArtifact(artifact),
      ),
      writeFileAtomic(
        groupPaths.yaml,
        serializeReplacementGroupArtifactYaml(artifact),
      ),
    ];
  });
  const actualGroupWrites = actualGroups(normalizedActual).flatMap((group) => {
    const groupPaths = getGroupArtifactPaths(
      paths.actualGroupJsonDirectory,
      paths.actualGroupYamlDirectory,
      group,
    );
    const artifact = actualGroupArtifact(normalizedActual, group);
    return [
      writeFileAtomic(groupPaths.json, serializeActualGroupArtifact(artifact)),
      writeFileAtomic(
        groupPaths.yaml,
        serializeActualGroupArtifactYaml(artifact),
      ),
    ];
  });

  await Promise.all([
    writeFileAtomic(
      paths.replacementsJson,
      serializeReplacements(normalizedReplacements),
    ),
    writeFileAtomic(
      paths.replacementsYaml,
      serializeReplacementsYaml(normalizedReplacements),
    ),
    writeFileAtomic(
      paths.replacementDiagnosticsJson,
      serializeDiagnosticsReport(normalizedReplacements),
    ),
    writeFileAtomic(
      paths.replacementDiagnosticsYaml,
      serializeDiagnosticsReportYaml(normalizedReplacements),
    ),
    writeFileAtomic(
      paths.actualJson,
      serializeActualSchedule(normalizedActual),
    ),
    writeFileAtomic(
      paths.actualYaml,
      serializeActualScheduleYaml(normalizedActual),
    ),
    writeFileAtomic(
      paths.actualDiagnosticsJson,
      serializeDiagnosticsReport(normalizedActual),
    ),
    writeFileAtomic(
      paths.actualDiagnosticsYaml,
      serializeDiagnosticsReportYaml(normalizedActual),
    ),
    ...replacementGroupWrites,
    ...actualGroupWrites,
  ]);

  const expectedReplacementJson = replacementGroups(normalizedReplacements).map(
    (group) =>
      getGroupArtifactPaths(
        paths.replacementGroupJsonDirectory,
        paths.replacementGroupYamlDirectory,
        group,
      ).json,
  );
  const expectedReplacementYaml = replacementGroups(normalizedReplacements).map(
    (group) =>
      getGroupArtifactPaths(
        paths.replacementGroupJsonDirectory,
        paths.replacementGroupYamlDirectory,
        group,
      ).yaml,
  );
  const expectedActualJson = actualGroups(normalizedActual).map(
    (group) =>
      getGroupArtifactPaths(
        paths.actualGroupJsonDirectory,
        paths.actualGroupYamlDirectory,
        group,
      ).json,
  );
  const expectedActualYaml = actualGroups(normalizedActual).map(
    (group) =>
      getGroupArtifactPaths(
        paths.actualGroupJsonDirectory,
        paths.actualGroupYamlDirectory,
        group,
      ).yaml,
  );
  await Promise.all([
    // JSON и YAML одной группы лежат рядом: очищаем каталог одним проходом,
    // иначе две параллельные очистки могут удалить файлы друг друга.
    syncDirectory(paths.replacementGroupJsonDirectory, [
      ...expectedReplacementJson,
      ...expectedReplacementYaml,
    ]),
    syncDirectory(paths.actualGroupJsonDirectory, [
      ...expectedActualJson,
      ...expectedActualYaml,
    ]),
  ]);
};
