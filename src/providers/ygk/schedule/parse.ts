import { createDiagnostic } from '../../../diagnostics/index.ts';
import { normalizeSingleLine, normalizeText } from '../../../parser/text.ts';
import type {
  DayOfWeek,
  Diagnostic,
  GroupSchedule,
  Lesson,
  LessonVariant,
  ParsedSchedule,
  ScheduleDay,
  SourceReference,
  WeekType,
} from '../../../types.ts';
import {
  findMerge,
  getCellFill,
  getEffectiveCell,
  getLogicalDirectCell,
  loadXlsx,
} from '../../../xlsx/workbook.ts';
import type { XlsxCell, XlsxWorksheet } from '../../../xlsx/types.ts';
import { YGK_DAY_INDEX, YGK_DAYS, YGK_EXPECTED_COLUMNS } from '../constants.ts';
import { normalizeGroupCode, parseGroupCandidate } from './group.ts';
import {
  cellAppliesToWholeLesson,
  classifyWeekFill,
  resolveVariantWeekType,
} from './week.ts';

interface Block {
  sourceGroup: string;
  groups: string[];
  sheet: string;
  rowStart: number;
  rowEnd: number;
  days: Map<DayOfWeek, Lesson[]>;
}

interface VariantRow {
  row: number;
  subject: string;
  teacher: string;
  room: string;
  rawSubject: string;
  rawTeacher: string;
  rawRoom: string;
  numerator: boolean;
  unknownColor: boolean;
  allRelevantFieldsSpanLesson: boolean;
}

const dayByValue = (value: unknown): DayOfWeek | null => {
  const normalized = normalizeSingleLine(value).toLocaleLowerCase('ru-RU');
  const index = YGK_DAY_INDEX.get(normalized);
  return index === undefined ? null : (YGK_DAYS[index] ?? null);
};

const hasMeaningfulValue = (cell: XlsxCell | undefined): boolean =>
  normalizeText(cell?.value).length > 0;

const rowHasDirectData = (
  sheet: XlsxWorksheet,
  row: number,
  maxColumn = YGK_EXPECTED_COLUMNS,
): boolean => {
  for (let column = 1; column <= maxColumn; column += 1) {
    if (hasMeaningfulValue(getLogicalDirectCell(sheet, row, column)))
      return true;
  }
  return false;
};

const onlyFirstColumnHasData = (sheet: XlsxWorksheet, row: number): boolean => {
  if (!hasMeaningfulValue(getLogicalDirectCell(sheet, row, 1))) return false;
  for (let column = 2; column <= YGK_EXPECTED_COLUMNS; column += 1) {
    if (hasMeaningfulValue(getLogicalDirectCell(sheet, row, column)))
      return false;
  }
  return true;
};

const parseLessonNumber = (value: unknown): number | null => {
  // У дочерних ячеек merge нет собственного значения: это не номер пары.
  if (value === null || value === undefined) return null;
  const normalized = normalizeSingleLine(value);
  if (!/^\d+$/.test(normalized)) return null;
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) ? number : null;
};

const rawValue = (cell: XlsxCell | undefined): string => {
  if (cell?.value === null || cell?.value === undefined) return '';
  return typeof cell.value === 'string' ||
    typeof cell.value === 'number' ||
    typeof cell.value === 'boolean'
    ? String(cell.value)
    : '';
};

const extractSubgroup = (subject: string): string | undefined => {
  const matches = [...subject.matchAll(/п\s*\/\s*гр\.?\s*([12])/giu)].map(
    (match) => match[1],
  );
  const unique = [
    ...new Set(matches.filter((value): value is string => Boolean(value))),
  ];
  return unique.length === 1 ? unique[0] : undefined;
};

const mergeSpansLesson = (
  sheet: XlsxWorksheet,
  row: number,
  column: number,
  startRow: number,
  endRow: number,
): boolean =>
  cellAppliesToWholeLesson(findMerge(sheet, row, column), startRow, endRow);

const parseVariantRow = (
  sheet: XlsxWorksheet,
  row: number,
  startRow: number,
  endRow: number,
): VariantRow | null => {
  const subjectCell = getEffectiveCell(sheet, row, 2);
  const teacherCell = getEffectiveCell(sheet, row, 6);
  const roomCell = getEffectiveCell(sheet, row, 9);
  const subject = normalizeText(subjectCell?.value);
  const teacher = normalizeText(teacherCell?.value);
  const room = normalizeText(roomCell?.value);
  if (!subject) return null;

  const relevant = [
    { column: 2, cell: subjectCell, value: subject },
    { column: 6, cell: teacherCell, value: teacher },
    { column: 9, cell: roomCell, value: room },
  ].filter((item) => item.value.length > 0);

  const fillClasses = relevant.map((item) =>
    classifyWeekFill(getCellFill(item.cell)),
  );
  const numerator = fillClasses.includes('numerator');
  const unknownColor = !numerator && fillClasses.includes('unknown');
  const allRelevantFieldsSpanLesson =
    relevant.length > 0 &&
    relevant.every((item) =>
      mergeSpansLesson(sheet, row, item.column, startRow, endRow),
    );

  return {
    row,
    subject,
    teacher,
    room,
    rawSubject: rawValue(subjectCell),
    rawTeacher: rawValue(teacherCell),
    rawRoom: rawValue(roomCell),
    numerator,
    unknownColor,
    allRelevantFieldsSpanLesson,
  };
};

const variantKey = (variant: VariantRow): string =>
  [variant.subject, variant.teacher, variant.room].join('\0');

const buildLessonVariants = (
  rows: VariantRow[],
  diagnostics: Diagnostic[],
  sheet: XlsxWorksheet,
  group: string,
): LessonVariant[] => {
  const unique = new Map<string, VariantRow>();
  for (const row of rows) {
    const key = variantKey(row);
    const existing = unique.get(key);
    if (!existing || row.numerator) unique.set(key, row);
  }

  const distinctRows = [...unique.values()];
  const hasDistinctSibling = distinctRows.length > 1;
  const variants = distinctRows.map((row) => {
    const weekType = resolveVariantWeekType(
      row.numerator,
      row.unknownColor,
      row.allRelevantFieldsSpanLesson,
      hasDistinctSibling,
    );
    const subgroup = extractSubgroup(row.subject);
    if (weekType === 'unknown') {
      diagnostics.push(
        createDiagnostic({
          code: 'UNKNOWN_WEEK_COLOR',
          severity: 'error',
          message:
            'Цвет варианта пары не удалось надежно сопоставить с учебной неделей',
          sheet: sheet.name,
          row: row.row,
          normalizedGroup: group,
          rawValue: row.subject,
          fingerprintContext: [group, row.subject],
        }),
      );
    }
    return {
      subject: row.subject,
      teacher: row.teacher,
      room: row.room,
      weekType,
      ...(subgroup ? { subgroup } : {}),
      ...(row.rawSubject && row.rawSubject !== row.subject
        ? { rawSubject: row.rawSubject }
        : {}),
      ...(row.rawTeacher && row.rawTeacher !== row.teacher
        ? { rawTeacher: row.rawTeacher }
        : {}),
      ...(row.rawRoom && row.rawRoom !== row.room
        ? { rawRoom: row.rawRoom }
        : {}),
      sourceRow: row.row,
    } satisfies LessonVariant;
  });

  const weekCounts = new Map<WeekType, number>();
  for (const variant of variants)
    weekCounts.set(
      variant.weekType,
      (weekCounts.get(variant.weekType) ?? 0) + 1,
    );
  if (
    (weekCounts.get('numerator') ?? 0) > 1 ||
    (weekCounts.get('denominator') ?? 0) > 1
  ) {
    diagnostics.push(
      createDiagnostic({
        code: 'CONFLICTING_WEEK_COLOR',
        severity: 'warning',
        message:
          'Для одной пары обнаружено несколько разных вариантов одной учебной недели',
        sheet: sheet.name,
        ...(rows[0] ? { row: rows[0].row } : {}),
        normalizedGroup: group,
        fingerprintContext: variants.map(
          (variant) => `${variant.weekType}:${variant.subject}`,
        ),
      }),
    );
  }

  return variants;
};

const detectBlocks = (
  sheet: XlsxWorksheet,
  diagnostics: Diagnostic[],
): Block[] => {
  const candidates: Array<{
    row: number;
    sourceGroup: string;
    groups: string[];
  }> = [];
  const maxRow = Math.max(0, ...sheet.rows.keys());

  for (let row = 1; row <= maxRow; row += 1) {
    if (!onlyFirstColumnHasData(sheet, row)) continue;
    const value = getEffectiveCell(sheet, row, 1)?.value;
    if (dayByValue(value)) continue;
    const candidate = parseGroupCandidate(value);
    if (!candidate) continue;
    candidates.push({
      row,
      sourceGroup: candidate.raw,
      groups: candidate.groups,
    });
    if (candidate.raw !== candidate.normalizedSource) {
      diagnostics.push(
        createDiagnostic({
          code: 'GROUP_NAME_NORMALIZED',
          severity: 'info',
          message: `Название группы нормализовано: ${candidate.raw} -> ${candidate.normalizedSource}`,
          sheet: sheet.name,
          row,
          rawValue: candidate.raw,
          normalizedGroup: candidate.groups.join('/'),
          fingerprintContext: [candidate.raw, candidate.normalizedSource],
        }),
      );
    }
  }

  return candidates.map((candidate, index) => ({
    sourceGroup: candidate.sourceGroup,
    groups: candidate.groups,
    sheet: sheet.name,
    rowStart: candidate.row,
    rowEnd: (candidates[index + 1]?.row ?? maxRow + 1) - 1,
    days: new Map(),
  }));
};

const parseBlock = (
  sheet: XlsxWorksheet,
  block: Block,
  diagnostics: Diagnostic[],
): void => {
  let currentDay: DayOfWeek | null = null;

  for (let row = block.rowStart + 1; row <= block.rowEnd; row += 1) {
    const rowInfo = sheet.rows.get(row);
    if (rowInfo?.hidden && rowHasDirectData(sheet, row)) {
      diagnostics.push(
        createDiagnostic({
          code: 'HIDDEN_ROW_WITH_DATA',
          severity: 'warning',
          message:
            'Скрытая строка содержит данные и исключена из опубликованного расписания',
          sheet: sheet.name,
          row,
          normalizedGroup: block.groups.join('/'),
          rawValue: normalizeSingleLine(getEffectiveCell(sheet, row, 1)?.value),
          fingerprintContext: [
            block.sourceGroup,
            normalizeSingleLine(getEffectiveCell(sheet, row, 1)?.value),
          ],
        }),
      );
      continue;
    }

    const firstCell = getEffectiveCell(sheet, row, 1);
    const day = dayByValue(firstCell?.value);
    if (day) {
      currentDay = day;
      if (!block.days.has(day)) block.days.set(day, []);
      continue;
    }

    const directFirst = getLogicalDirectCell(sheet, row, 1);
    const number = parseLessonNumber(directFirst?.value);
    if (number === null) continue;
    if (!currentDay) {
      diagnostics.push(
        createDiagnostic({
          code: 'LESSON_OUTSIDE_DAY',
          severity: 'error',
          message: `Пара ${number} обнаружена до определения дня недели`,
          sheet: sheet.name,
          row,
          normalizedGroup: block.groups.join('/'),
          fingerprintContext: [block.sourceGroup, String(number)],
        }),
      );
      continue;
    }

    const numberMerge = findMerge(sheet, row, 1);
    const endRow = numberMerge?.endRow ?? row;
    if (
      !numberMerge ||
      numberMerge.startColumn !== 1 ||
      numberMerge.endColumn !== 1
    ) {
      diagnostics.push(
        createDiagnostic({
          code: 'UNEXPECTED_MERGE',
          severity: 'warning',
          message: `Неожиданная структура ячейки номера пары ${number}`,
          sheet: sheet.name,
          row,
          column: 1,
          normalizedGroup: block.groups.join('/'),
          fingerprintContext: [
            block.sourceGroup,
            String(number),
            numberMerge?.ref ?? 'no-merge',
          ],
        }),
      );
    }

    const variantRows: VariantRow[] = [];
    for (
      let variantRow = row;
      variantRow <= Math.min(endRow, block.rowEnd);
      variantRow += 1
    ) {
      const variantRowInfo = sheet.rows.get(variantRow);
      if (variantRowInfo?.hidden) {
        if (rowHasDirectData(sheet, variantRow)) {
          diagnostics.push(
            createDiagnostic({
              code: 'HIDDEN_ROW_WITH_DATA',
              severity: 'warning',
              message:
                'Скрытая строка варианта пары содержит данные и исключена',
              sheet: sheet.name,
              row: variantRow,
              normalizedGroup: block.groups.join('/'),
              fingerprintContext: [
                block.sourceGroup,
                currentDay,
                String(number),
              ],
            }),
          );
        }
        continue;
      }
      const parsed = parseVariantRow(sheet, variantRow, row, endRow);
      if (parsed) variantRows.push(parsed);
    }

    if (variantRows.length) {
      const source: SourceReference = {
        sheet: sheet.name,
        rowStart: row,
        rowEnd: endRow,
        rawGroupName: block.sourceGroup,
      };
      const lesson: Lesson = {
        number,
        variants: buildLessonVariants(
          variantRows,
          diagnostics,
          sheet,
          block.groups.join('/'),
        ),
        source,
      };
      block.days.get(currentDay)?.push(lesson);
    }

    row = Math.max(row, endRow);
  }
};

const mergeBlockIntoGroups = (
  block: Block,
  groups: Record<string, GroupSchedule>,
  diagnostics: Diagnostic[],
): void => {
  const sourceReference: SourceReference = {
    sheet: block.sheet,
    rowStart: block.rowStart,
    rowEnd: block.rowEnd,
    rawGroupName: block.sourceGroup,
  };
  const blockHasLessons = [...block.days.values()].some(
    (lessons) => lessons.length > 0,
  );
  if (!blockHasLessons) {
    diagnostics.push(
      createDiagnostic({
        code: 'EMPTY_SCHEDULE_BLOCK',
        severity: 'warning',
        message: 'Блок группы не содержит занятий',
        sheet: block.sheet,
        row: block.rowStart,
        normalizedGroup: block.groups.join('/'),
        fingerprintContext: [block.sourceGroup],
      }),
    );
  }

  for (const group of block.groups) {
    const normalized = normalizeGroupCode(group);
    const existing = groups[normalized];
    const days: ScheduleDay[] = YGK_DAYS.filter((day) =>
      block.days.has(day),
    ).map((day) => ({
      day,
      lessons: [...(block.days.get(day) ?? [])].sort(
        (a, b) => a.number - b.number,
      ),
    }));

    if (!existing) {
      groups[normalized] = {
        group: normalized,
        sourceGroups: [block.sourceGroup],
        sourceBlocks: [sourceReference],
        days,
      };
      continue;
    }

    if (blockHasLessons) {
      diagnostics.push(
        createDiagnostic({
          code: 'DUPLICATE_GROUP',
          severity: 'warning',
          message: `Группа ${normalized} встречается более чем в одном блоке`,
          sheet: block.sheet,
          row: block.rowStart,
          normalizedGroup: normalized,
          fingerprintContext: [
            normalized,
            ...existing.sourceGroups,
            block.sourceGroup,
          ],
        }),
      );
    }
    existing.sourceGroups.push(block.sourceGroup);
    existing.sourceBlocks.push(sourceReference);
    for (const day of days) {
      const existingDay = existing.days.find((item) => item.day === day.day);
      if (existingDay) existingDay.lessons.push(...day.lessons);
      else existing.days.push(day);
    }
    existing.days.sort(
      (a, b) => YGK_DAYS.indexOf(a.day) - YGK_DAYS.indexOf(b.day),
    );
  }
};

const checkOutsideExpectedColumns = (
  sheet: XlsxWorksheet,
  diagnostics: Diagnostic[],
): void => {
  for (const cell of sheet.cells.values()) {
    if (cell.column <= YGK_EXPECTED_COLUMNS || !normalizeText(cell.value))
      continue;
    diagnostics.push(
      createDiagnostic({
        code: 'DATA_OUTSIDE_EXPECTED_COLUMNS',
        severity: 'info',
        message: `Найдены данные за пределами ожидаемых колонок A:I`,
        sheet: sheet.name,
        row: cell.row,
        column: cell.column,
        rawValue: normalizeSingleLine(cell.value),
        fingerprintContext: [
          sheet.name,
          String(cell.column),
          normalizeSingleLine(cell.value),
        ],
      }),
    );
  }
};

export const parseYgkSchedule = async (
  buffer: Buffer,
): Promise<ParsedSchedule> => {
  const workbook = await loadXlsx(buffer);
  const diagnostics: Diagnostic[] = [];
  const groups: Record<string, GroupSchedule> = {};

  for (const sheet of workbook.sheets) {
    checkOutsideExpectedColumns(sheet, diagnostics);
    const blocks = detectBlocks(sheet, diagnostics);
    for (const block of blocks) {
      parseBlock(sheet, block, diagnostics);
      mergeBlockIntoGroups(block, groups, diagnostics);
    }
  }

  for (const group of Object.values(groups)) {
    for (const day of group.days)
      day.lessons.sort(
        (a, b) => a.number - b.number || a.source.rowStart - b.source.rowStart,
      );
  }

  return {
    groups: Object.fromEntries(
      Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, 'ru-RU')),
    ),
    diagnostics,
  };
};
