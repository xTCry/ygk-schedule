import { describe, expect, it } from 'vitest';
import { readFixture } from '../providers/ygk/schedule/fixture.test-helper.ts';
import { isRedLike } from './colors.ts';
import {
  findMerge,
  getCell,
  getCellFill,
  getEffectiveCell,
  loadXlsx,
  numberToColumn,
  parseAddress,
} from './workbook.ts';

describe('XLSX workbook reader', () => {
  it('supports multi-letter cell addresses', () => {
    expect(parseAddress('A1')).toEqual({ row: 1, column: 1 });
    expect(parseAddress('AA42')).toEqual({ row: 42, column: 27 });
    expect(numberToColumn(1)).toBe('A');
    expect(numberToColumn(27)).toBe('AA');
    expect(numberToColumn(1024)).toBe('AMJ');
  });

  it('reads all worksheets from the current YGK fixture', async () => {
    const workbook = await loadXlsx(await readFixture());
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual([
      'CТ1-11СТ1-13СТ1-15СТ-17',
      'СТ 2 курс',
      'CТ 3 курс',
      'СТ 4 курс',
      'СД2-11 СД2-13 СД2-21 СД2-31',
      'МО2-11',
    ]);
  });

  it('resolves merged cells through their top-left cell', async () => {
    const workbook = await loadXlsx(await readFixture());
    const sheet = workbook.sheets[0];
    expect(sheet).toBeDefined();
    expect(findMerge(sheet!, 5, 1)).toEqual({
      ref: 'A4:A5',
      startRow: 4,
      endRow: 5,
      startColumn: 1,
      endColumn: 1,
    });
    expect(getEffectiveCell(sheet!, 5, 1)?.value).toBe(1);
    expect(getEffectiveCell(sheet!, 5, 2)?.value).toBe('Физическая культура');
  });

  it('keeps hidden rows with meaningful data in the workbook model', async () => {
    const workbook = await loadXlsx(await readFixture());
    const sheet = workbook.sheets.find((item) => item.name === 'СТ 2 курс');
    expect(sheet).toBeDefined();
    expect(sheet!.rows.get(35)?.hidden).toBe(true);
    expect(getCell(sheet!, 35, 1)?.value).toBe(3);
    expect(sheet!.rows.get(36)?.hidden).toBe(true);
  });

  it('converts rich-text cells to plain text', async () => {
    const workbook = await loadXlsx(await readFixture());
    const sheet = workbook.sheets.find((item) => item.name === 'СТ 2 курс');
    expect(sheet).toBeDefined();
    expect(getCell(sheet!, 95, 1)?.value).toBe('Суббота ');
  });

  it('resolves a theme and tint numerator fill to red', async () => {
    const workbook = await loadXlsx(await readFixture());
    const sheet = workbook.sheets[0];
    expect(sheet).toBeDefined();
    const denominator = getCellFill(getCell(sheet!, 13, 2));
    const numerator = getCellFill(getCell(sheet!, 14, 2));
    expect(isRedLike(denominator?.foreground.resolvedRgb)).toBe(false);
    expect(numerator?.foreground.type).toBe('theme');
    expect(numerator?.foreground.theme).toBe(5);
    expect(isRedLike(numerator?.foreground.resolvedRgb)).toBe(true);
  });
});
