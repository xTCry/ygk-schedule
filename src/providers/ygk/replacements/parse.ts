import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import { createDiagnostic } from '../../../diagnostics/index.ts';
import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';
import type {
  DayOfWeek,
  Diagnostic,
  ParsedReplacements,
  Replacement,
  ReplacementShift,
  ReplacementSource,
  ReplacementType,
  WeekType,
} from '../../../types.ts';
import { normalizeGroupCode, parseGroupCandidate } from '../schedule/group.ts';

const dayByName = new Map<string, DayOfWeek>([
  ['понедельник', 'Понедельник'],
  ['вторник', 'Вторник'],
  ['среда', 'Среда'],
  ['четверг', 'Четверг'],
  ['пятница', 'Пятница'],
  ['суббота', 'Суббота'],
]);

const monthByName = new Map<string, number>([
  ['января', 1],
  ['февраля', 2],
  ['марта', 3],
  ['апреля', 4],
  ['мая', 5],
  ['июня', 6],
  ['июля', 7],
  ['августа', 8],
  ['сентября', 9],
  ['октября', 10],
  ['ноября', 11],
  ['декабря', 12],
]);

interface ReplacementColumns {
  group: number;
  lessonNumbers: number;
  original: number;
  replacement: number;
  room: number;
}

interface ParsedLessonNumbers {
  numbers: number[];
  invalidParts: string[];
}

const maxLessonRangeSize = 50;

const shiftLabel = (shift: ReplacementShift): string =>
  shift === 'first' ? 'Первая смена' : 'Вторая смена';

const sheetName = (shift: ReplacementShift): string =>
  `Замены: ${shiftLabel(shift)}`;

const cellText = (
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<Element>,
  column: number,
): string => normalizeSingleLine(row.children('td, th').eq(column).text());

const normalizeHeading = (value: string): string =>
  normalizeSingleLine(value).toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');

const findReplacementColumns = (
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<Element>,
): ReplacementColumns | null => {
  const headers = table
    .find('tr')
    .first()
    .children('td, th')
    .map((_index, cell) => normalizeHeading($(cell).text()))
    .toArray();

  const findColumn = (predicate: (header: string) => boolean): number =>
    headers.findIndex(predicate);

  const group = findColumn((header) => header === 'группа');
  const lessonNumbers = findColumn(
    (header) => header === 'номер' || header.includes('номер пары'),
  );
  const original = findColumn((header) => header.includes('по расписанию'));
  const replacement = findColumn((header) => header.includes('по замене'));
  const room = findColumn((header) => header.includes('аудитори'));

  return [group, lessonNumbers, original, replacement, room].every(
    (column) => column >= 0,
  )
    ? { group, lessonNumbers, original, replacement, room }
    : null;
};

const parsePageDate = (
  value: string,
): { date: string; day: DayOfWeek | null } | null => {
  const match = value.match(
    /в\s+расписании\s+на\s+(\d{1,2})\s+([а-яё]+)\s+(\d{4})\s+года?\s*\/\s*([а-яё]+)/iu,
  );
  if (!match) return null;

  const [, rawDay, rawMonth, rawYear, rawWeekday] = match;
  const day = Number.parseInt(rawDay ?? '', 10);
  const month = monthByName.get((rawMonth ?? '').toLocaleLowerCase('ru-RU'));
  const year = Number.parseInt(rawYear ?? '', 10);
  if (!month || !Number.isSafeInteger(day) || !Number.isSafeInteger(year))
    return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    day: dayByName.get((rawWeekday ?? '').toLocaleLowerCase('ru-RU')) ?? null,
  };
};

const parseWeekType = (value: string): WeekType => {
  const normalized = value.toLocaleLowerCase('ru-RU');
  if (normalized.includes('числитель')) return 'numerator';
  if (normalized.includes('знаменатель')) return 'denominator';
  return 'unknown';
};

const parsePublishedShift = (value: string): ReplacementShift | null => {
  const normalized = value.toLocaleLowerCase('ru-RU');
  if (normalized.includes('первая смена')) return 'first';
  if (normalized.includes('вторая смена')) return 'second';
  return null;
};

/**
 * Разбирает список номеров пар, включая нулевую пару и диапазоны.
 * Неопределенные фрагменты сохраняются для отдельной диагностики строки.
 */
const parseLessonNumbers = (value: string): ParsedLessonNumbers => {
  const parts = normalizeDashes(value).split(/[;,]/u);
  const numbers = new Set<number>();
  const invalidParts: string[] = [];

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) {
      invalidParts.push(rawPart);
      continue;
    }

    if (/^\d+$/u.test(part)) {
      const number = Number.parseInt(part, 10);
      if (Number.isSafeInteger(number)) {
        numbers.add(number);
      } else {
        invalidParts.push(part);
      }
      continue;
    }

    const range = part.match(/^(\d+)\s*-\s*(\d+)$/u);
    if (!range) {
      invalidParts.push(part);
      continue;
    }

    const start = Number.parseInt(range[1] ?? '', 10);
    const end = Number.parseInt(range[2] ?? '', 10);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      end - start + 1 > maxLessonRangeSize
    ) {
      invalidParts.push(part);
      continue;
    }

    for (let number = start; number <= end; number += 1) numbers.add(number);
  }

  return {
    numbers: [...numbers].sort((left, right) => left - right),
    invalidParts,
  };
};

const normalizeReplacementGroup = (rawGroupName: string): string => {
  const candidate = parseGroupCandidate(rawGroupName);
  if (candidate?.groups.length === 1) return candidate.groups[0] ?? '';
  return normalizeGroupCode(rawGroupName);
};

const classifyReplacementType = (
  original: string,
  replacement: string,
): ReplacementType => {
  if (replacement.toLocaleLowerCase('ru-RU') === 'снято') return 'cancel';
  if (!replacement) return 'unknown';
  return original ? 'replace' : 'add';
};

const diagnosticForRow = (
  diagnostics: Diagnostic[],
  shift: ReplacementShift,
  row: number,
  group: string,
  code: Extract<
    Diagnostic['code'],
    'INVALID_REPLACEMENT_LESSON_NUMBER' | 'UNKNOWN_REPLACEMENT_TYPE'
  >,
  message: string,
  rawValue: string,
  fingerprintContext: string[],
): void => {
  diagnostics.push(
    createDiagnostic({
      code,
      severity: 'warning',
      message,
      sheet: sheetName(shift),
      row,
      rawValue,
      fingerprintContext: ['replacements', shift, ...fingerprintContext],
      ...(group ? { normalizedGroup: group } : {}),
    }),
  );
};

const parseReplacementRow = (
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<Element>,
  tableRow: number,
  columns: ReplacementColumns,
  date: string,
  shift: ReplacementShift,
  diagnostics: Diagnostic[],
): Replacement | null => {
  const rawGroupName = cellText($, row, columns.group);
  const rawLessonNumbers = cellText($, row, columns.lessonNumbers);
  const rawOriginal = cellText($, row, columns.original);
  const rawReplacement = cellText($, row, columns.replacement);
  const rawRoom = cellText($, row, columns.room);

  // В исходной таблице встречаются строки с порядковым номером без данных.
  // Это не замена и не ошибка структуры страницы.
  if (
    !rawGroupName &&
    !rawLessonNumbers &&
    !rawOriginal &&
    !rawReplacement &&
    !rawRoom
  ) {
    return null;
  }

  const group = normalizeReplacementGroup(rawGroupName);
  const parsedNumbers = parseLessonNumbers(rawLessonNumbers);
  for (const invalidPart of parsedNumbers.invalidParts) {
    diagnosticForRow(
      diagnostics,
      shift,
      tableRow,
      group,
      'INVALID_REPLACEMENT_LESSON_NUMBER',
      'Не удалось разобрать номер пары или диапазон из таблицы замен',
      invalidPart || rawLessonNumbers,
      [date, rawLessonNumbers],
    );
  }

  let type = classifyReplacementType(rawOriginal, rawReplacement);
  if (!group || !parsedNumbers.numbers.length || type === 'unknown') {
    type = 'unknown';
    diagnosticForRow(
      diagnostics,
      shift,
      tableRow,
      group,
      'UNKNOWN_REPLACEMENT_TYPE',
      'Строка замен не содержит данных, достаточных для определения действия',
      [rawGroupName, rawLessonNumbers, rawOriginal, rawReplacement].join(' | '),
      [date, rawGroupName, rawLessonNumbers, rawOriginal, rawReplacement],
    );
  }

  const source: ReplacementSource = {
    shift,
    row: tableRow,
    rawGroupName,
    rawLessonNumbers,
    rawOriginal,
    rawReplacement,
    rawRoom,
  };

  return {
    date,
    group,
    lessonNumbers: parsedNumbers.numbers,
    type,
    original: rawOriginal ? { raw: rawOriginal } : null,
    replacement: rawReplacement
      ? { raw: rawReplacement, ...(rawRoom ? { room: rawRoom } : {}) }
      : null,
    source,
  };
};

/**
 * Разбирает HTML-страницу замен одной смены ЯГК в промежуточную каноническую
 * модель. Функция не загружает страницу из сети и не сопоставляет строки с
 * базовым расписанием: это будет задачей отдельного resolver-слоя.
 */
export const parseYgkReplacements = (
  html: string,
  shift: ReplacementShift,
): ParsedReplacements => {
  const diagnostics: Diagnostic[] = [];
  const $ = cheerio.load(html);
  const hasChanges = $('b')
    .toArray()
    .some(
      (element) =>
        normalizeSingleLine($(element).text()).toLocaleUpperCase('ru-RU') ===
        'ИЗМЕНЕНИЯ',
    );

  if (!hasChanges) {
    diagnostics.push(
      createDiagnostic({
        code: 'REPLACEMENT_CHANGES_NOT_PUBLISHED',
        severity: 'info',
        message: 'На странице нет опубликованного блока «ИЗМЕНЕНИЯ»',
        sheet: sheetName(shift),
        fingerprintContext: ['replacements', shift],
      }),
    );
    return {
      hasChanges: false,
      date: null,
      day: null,
      shift,
      weekType: 'unknown',
      replacements: [],
      diagnostics,
    };
  }

  const dateLine = $('div')
    .toArray()
    .map((element) => normalizeSingleLine($(element).text()))
    .find((value) =>
      value.toLocaleLowerCase('ru-RU').includes('в расписании на'),
    );
  if (!dateLine) {
    diagnostics.push(
      createDiagnostic({
        code: 'MISSING_REPLACEMENT_DATE',
        severity: 'error',
        message: 'В опубликованных заменах не найдена строка с датой',
        sheet: sheetName(shift),
        fingerprintContext: ['replacements', shift],
      }),
    );
  }
  const parsedDate = dateLine ? parsePageDate(dateLine) : null;
  if (dateLine && !parsedDate) {
    diagnostics.push(
      createDiagnostic({
        code: 'INVALID_REPLACEMENT_DATE',
        severity: 'error',
        message: 'Не удалось разобрать дату или день недели в таблице замен',
        sheet: sheetName(shift),
        rawValue: dateLine,
        fingerprintContext: ['replacements', shift, dateLine],
      }),
    );
  }
  if (parsedDate && !parsedDate.day) {
    diagnostics.push(
      createDiagnostic({
        code: 'UNKNOWN_DAY',
        severity: 'error',
        message: 'Не удалось сопоставить день недели из таблицы замен',
        sheet: sheetName(shift),
        rawValue: dateLine ?? '',
        fingerprintContext: ['replacements', shift, dateLine ?? ''],
      }),
    );
  }

  const weekLine = $('div')
    .toArray()
    .map((element) => normalizeSingleLine($(element).text()))
    .find((value) => value.toLocaleLowerCase('ru-RU').includes('смена'));
  const weekType = weekLine ? parseWeekType(weekLine) : 'unknown';
  const publishedShift = weekLine ? parsePublishedShift(weekLine) : null;
  if (publishedShift && publishedShift !== shift) {
    diagnostics.push(
      createDiagnostic({
        code: 'REPLACEMENT_SHIFT_MISMATCH',
        severity: 'error',
        message: `Страница ${shiftLabel(shift).toLocaleLowerCase('ru-RU')} содержит заголовок «${shiftLabel(publishedShift)}»`,
        sheet: sheetName(shift),
        rawValue: weekLine ?? '',
        fingerprintContext: ['replacements', shift, publishedShift],
      }),
    );
  }

  const tableWithColumns = $('table')
    .toArray()
    .map((element) => {
      const table = $(element);
      return { table, columns: findReplacementColumns($, table) };
    })
    .find(
      (
        item,
      ): item is {
        table: cheerio.Cheerio<Element>;
        columns: ReplacementColumns;
      } => item.columns !== null,
    );

  if (!tableWithColumns) {
    diagnostics.push(
      createDiagnostic({
        code: 'UNKNOWN_REPLACEMENT_LAYOUT',
        severity: 'error',
        message: 'Не найдена таблица замен с ожидаемыми названиями столбцов',
        sheet: sheetName(shift),
        fingerprintContext: ['replacements', shift],
      }),
    );
  }

  const replacements =
    parsedDate && tableWithColumns
      ? tableWithColumns.table
          .find('tr')
          .slice(1)
          .toArray()
          .flatMap((element, index) => {
            const replacement = parseReplacementRow(
              $,
              $(element),
              index + 2,
              tableWithColumns.columns,
              parsedDate.date,
              shift,
              diagnostics,
            );
            return replacement ? [replacement] : [];
          })
      : [];

  return {
    hasChanges: true,
    date: parsedDate?.date ?? null,
    day: parsedDate?.day ?? null,
    shift,
    weekType,
    replacements,
    diagnostics,
  };
};
