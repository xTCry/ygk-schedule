import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseYgkSchedule } from './parse.ts';

const createZeroLessonWorkbook = async (): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Расписание');
  sheet.getCell('A1').value = 'ТЕСТ1-11';
  sheet.getCell('A2').value = 'Понедельник';
  sheet.getCell('A3').value = 0;
  sheet.getCell('B3').value = 'Нулевая пара';

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('YGK zero lesson number', () => {
  it('keeps the valid zero lesson number', async () => {
    const parsed = await parseYgkSchedule(await createZeroLessonWorkbook());
    const group = parsed.groups['ТЕСТ1-11'];

    expect(group?.days[0]?.lessons).toEqual([
      expect.objectContaining({
        number: 0,
        variants: [
          expect.objectContaining({
            subject: 'Нулевая пара',
          }),
        ],
      }),
    ]);
    expect(
      parsed.diagnostics.some(
        (diagnostic) => diagnostic.code === 'INVALID_LESSON_NUMBER',
      ),
    ).toBe(false);
  });
});
