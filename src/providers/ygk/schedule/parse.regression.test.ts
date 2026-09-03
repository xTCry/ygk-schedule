import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { semanticScheduleHash } from '../../../compare/schedule.ts';
import { readFixture } from './fixture.test-helper.ts';
import { parseYgkSchedule } from './parse.ts';

const expectedGroups = [
  'МО2-11',
  'СД2-11',
  'СД2-12',
  'СД2-13',
  'СД2-21',
  'СД2-22',
  'СД2-31',
  'СД2-32',
  'СТ1-11',
  'СТ1-12',
  'СТ1-13',
  'СТ1-14',
  'СТ1-15',
  'СТ1-16',
  'СТ1-17',
  'СТ1-18',
  'СТ1-19',
  'СТ1-21',
  'СТ1-22',
  'СТ1-23',
  'СТ1-24',
  'СТ1-25',
  'СТ1-26',
  'СТ1-27',
  'СТ1-28',
  'СТ1-31',
  'СТ1-32',
  'СТ1-33',
  'СТ1-34',
  'СТ1-35',
  'СТ1-36',
  'СТ1-37',
  'СТ1-41',
  'СТ1-42',
  'СТ1-43',
  'СТ1-44',
  'СТ1-45',
  'СТ1-46',
];

describe('YGK schedule regression fixture', () => {
  it('has expected source and semantic hashes', async () => {
    const buffer = await readFixture();
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(
      'e96247ff41f124834fde64987e3fdca3e307b2299b872761b02f65dbd6b12806',
    );
    const parsed = await parseYgkSchedule(buffer);
    expect(semanticScheduleHash(parsed.groups)).toBe(
      '06383632b0d0eb5d8873c530b527635ddf1475110ea79d132f9e1f4b79c5845a',
    );
  });

  it('yields all 38 normalized groups', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    expect(Object.keys(parsed.groups)).toEqual(expectedGroups);
  });

  it('keeps lesson and variant counts stable', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    let lessons = 0;
    let variants = 0;
    for (const group of Object.values(parsed.groups)) {
      for (const day of group.days) {
        lessons += day.lessons.length;
        for (const lesson of day.lessons) variants += lesson.variants.length;
      }
    }
    expect(lessons).toBe(788);
    expect(variants).toBe(1089);
  });

  it('exposes only known diagnostics', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    expect(
      parsed.diagnostics.map((item) => ({
        code: item.code,
        severity: item.severity,
        sheet: item.sheet,
        row: item.row,
        group: item.normalizedGroup,
      })),
    ).toEqual([
      {
        code: 'HIDDEN_ROW_WITH_DATA',
        severity: 'warning',
        sheet: 'СТ 2 курс',
        row: 35,
        group: 'СТ1-21/СТ1-22',
      },
      {
        code: 'DUPLICATE_GROUP',
        severity: 'warning',
        sheet: 'CТ 3 курс',
        row: 103,
        group: 'СТ1-37',
      },
    ]);
  });

  it('keeps both source blocks for duplicate СТ1-37', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    const group = parsed.groups['СТ1-37'];
    expect(group).toBeDefined();
    expect(group!.sourceGroups).toEqual([
      'СТ1-33/СТ1-34/СТ1-37',
      'СТ1-35/СТ1-36/СТ1-37',
    ]);
    expect(group!.sourceBlocks).toHaveLength(2);
  });

  it('excludes a hidden lesson row from published СТ1-21 lessons', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    const group = parsed.groups['СТ1-21'];
    expect(group).toBeDefined();
    expect(
      group!.days
        .flatMap((day) => day.lessons)
        .some((lesson) => lesson.source.rowStart === 35),
    ).toBe(false);
  });

  it('maps numerator and denominator colours to Tuesday variants', async () => {
    const parsed = await parseYgkSchedule(await readFixture());
    const group = parsed.groups['СТ1-11'];
    expect(group).toBeDefined();
    const tuesday = group!.days.find((day) => day.day === 'Вторник');
    const lesson = tuesday?.lessons.find((item) => item.number === 1);
    expect(lesson).toBeDefined();
    expect(
      lesson!.variants.map((variant) => ({
        subject: variant.subject,
        weekType: variant.weekType,
        subgroup: variant.subgroup,
      })),
    ).toEqual([
      {
        subject: 'Иностранный язык п/гр.1',
        weekType: 'denominator',
        subgroup: '1',
      },
      {
        subject: 'Иностранный язык п/гр.2',
        weekType: 'numerator',
        subgroup: '2',
      },
    ]);
  });
});
