import ExcelJS from 'exceljs';
import { resolveColor } from './colors.ts';
import type {
  XlsxCell,
  XlsxColor,
  XlsxFill,
  XlsxMerge,
  XlsxWorkbook,
  XlsxWorksheet,
} from './types.ts';

const columnToNumber = (letters: string): number => {
  let result = 0;
  for (const char of letters.toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result;
};

export const numberToColumn = (column: number): string => {
  let value = column;
  let result = '';
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
};

export const parseAddress = (
  address: string,
): { row: number; column: number } => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) throw new Error(`Invalid cell address: ${address}`);
  return {
    column: columnToNumber(match[1] ?? ''),
    row: Number.parseInt(match[2] ?? '', 10),
  };
};

const parseRange = (ref: string): XlsxMerge => {
  const [startRef, endRef = startRef] = ref.split(':');
  if (!startRef || !endRef) throw new Error(`Invalid range: ${ref}`);
  const start = parseAddress(startRef);
  const end = parseAddress(endRef);
  return {
    ref,
    startRow: start.row,
    endRow: end.row,
    startColumn: start.column,
    endColumn: end.column,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asFiniteInteger = (value: unknown): number | undefined => {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
};

const toXlsxColor = (value: unknown): XlsxColor => {
  const color = asRecord(value);
  if (!color) return { type: 'none' };

  if (typeof color.argb === 'string') return { type: 'rgb', rgb: color.argb };

  const theme = asFiniteInteger(color.theme);
  if (theme !== undefined) {
    const tint = asFiniteNumber(color.tint);
    return {
      type: 'theme',
      theme,
      ...(tint !== undefined ? { tint } : {}),
    };
  }

  const indexed = asFiniteInteger(color.indexed);
  if (indexed !== undefined) return { type: 'indexed', indexed };
  if (color.auto === true) return { type: 'auto' };
  return { type: 'none' };
};

/**
 * ExcelJS сохраняет XML темы в модели, но не раскрывает готовую палитру.
 * Извлекаем только стандартную схему цветов, чтобы сохранить theme+tint
 * семантику, не разбирая ZIP или XML-структуру всего XLSX.
 */
const extractThemeColors = (themes: unknown): string[] => {
  const themeXml = asRecord(themes)?.theme1;
  if (typeof themeXml !== 'string') return [];

  const scheme =
    /<(?:a:)?clrScheme\b[^>]*>([\s\S]*?)<\/(?:a:)?clrScheme>/i.exec(
      themeXml,
    )?.[1] ?? '';
  const colors: string[] = [];
  const schemeColor =
    /<(?:a:)?(?:dk1|lt1|dk2|lt2|accent1|accent2|accent3|accent4|accent5|accent6|hlink|folHlink)\b[^>]*>([\s\S]*?)<\/(?:a:)?(?:dk1|lt1|dk2|lt2|accent1|accent2|accent3|accent4|accent5|accent6|hlink|folHlink)>/gi;
  let match: RegExpExecArray | null;

  while ((match = schemeColor.exec(scheme))) {
    const block = match[1] ?? '';
    const value =
      /lastClr\s*=\s*["']([^"']+)["']/i.exec(block)?.[1] ??
      /val\s*=\s*["']([^"']+)["']/i.exec(block)?.[1];
    colors.push((value ?? '000000').toUpperCase());
  }

  return colors;
};

const toXlsxFill = (value: unknown, themeColors: string[]): XlsxFill => {
  const fill = asRecord(value);
  if (fill?.type !== 'pattern') return { foreground: { type: 'none' } };

  return {
    ...(typeof fill.pattern === 'string' ? { patternType: fill.pattern } : {}),
    foreground: resolveColor(toXlsxColor(fill.fgColor), themeColors),
  };
};

const toCellValue = (cell: ExcelJS.Cell): XlsxCell['value'] => {
  const { value } = cell;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  const structuredValue = asRecord(value);
  const result = structuredValue?.result;
  return typeof result === 'string' ||
    typeof result === 'number' ||
    typeof result === 'boolean'
    ? result
    : Array.isArray(structuredValue?.richText)
      ? cell.text
      : null;
};

const toXlsxWorksheet = (
  sheet: ExcelJS.Worksheet,
  themeColors: string[],
): XlsxWorksheet => {
  const rows = new Map<number, { index: number; hidden: boolean }>();
  const cells = new Map<string, XlsxCell>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    rows.set(rowNumber, { index: rowNumber, hidden: row.hidden });
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      if (cell.isMerged && cell.master.address !== cell.address) return;

      const address = cell.address.toUpperCase();
      cells.set(address, {
        address,
        row: rowNumber,
        column: columnNumber,
        value: toCellValue(cell),
        fill: toXlsxFill(cell.fill, themeColors),
      });
    });
  });

  return {
    name: sheet.name,
    rows,
    cells,
    merges: (sheet.model.merges ?? []).map(parseRange),
  };
};

export const loadXlsx = async (buffer: Buffer): Promise<XlsxWorkbook> => {
  const workbook = new ExcelJS.Workbook();
  // ExcelJS 4 объявляет параметр как ArrayBuffer под глобальным именем Buffer.
  await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  const themeColors = extractThemeColors(workbook.model.themes);

  return {
    sheets: workbook.worksheets.map((sheet) =>
      toXlsxWorksheet(sheet, themeColors),
    ),
  };
};

export const cellAddress = (row: number, column: number): string =>
  `${numberToColumn(column)}${row}`;

export const findMerge = (
  sheet: XlsxWorksheet,
  row: number,
  column: number,
): XlsxMerge | undefined =>
  sheet.merges.find(
    (merge) =>
      row >= merge.startRow &&
      row <= merge.endRow &&
      column >= merge.startColumn &&
      column <= merge.endColumn,
  );

export const getCell = (
  sheet: XlsxWorksheet,
  row: number,
  column: number,
): XlsxCell | undefined => sheet.cells.get(cellAddress(row, column));

export const getLogicalDirectCell = (
  sheet: XlsxWorksheet,
  row: number,
  column: number,
): XlsxCell | undefined => {
  const direct = getCell(sheet, row, column);
  const merge = findMerge(sheet, row, column);
  if (!merge) return direct;
  if (merge.startRow === row && merge.startColumn === column) return direct;
  return undefined;
};

export const getEffectiveCell = (
  sheet: XlsxWorksheet,
  row: number,
  column: number,
): XlsxCell | undefined => {
  const merge = findMerge(sheet, row, column);
  if (merge) return getCell(sheet, merge.startRow, merge.startColumn);
  return getCell(sheet, row, column);
};

export const getCellFill = (cell: XlsxCell | undefined): XlsxFill | undefined =>
  cell?.fill;
