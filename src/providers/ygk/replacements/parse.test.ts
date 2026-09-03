import { describe, expect, it } from 'vitest';
import { readReplacementFixture } from './fixture.test-helper.ts';
import { parseYgkReplacements } from './parse.ts';

describe('YGK replacements HTML parser', () => {
  it('parses the first-shift regression fixture', async () => {
    const parsed = parseYgkReplacements(
      await readReplacementFixture('first'),
      'first',
    );

    expect(parsed).toMatchObject({
      hasChanges: true,
      date: '2026-09-04',
      day: 'Пятница',
      shift: 'first',
      weekType: 'numerator',
      diagnostics: [],
    });
    expect(parsed.replacements).toHaveLength(71);
  });

  it('preserves zero lesson numbers and classifies cancel, replace and add', async () => {
    const parsed = parseYgkReplacements(
      await readReplacementFixture('first'),
      'first',
    );
    const cancelled = parsed.replacements.find(
      (replacement) =>
        replacement.source.rawGroupName === 'ДИ1-13' &&
        replacement.source.rawLessonNumbers === '0',
    );
    const replaced = parsed.replacements.find(
      (replacement) =>
        replacement.source.rawGroupName === 'ДИ1-13' &&
        replacement.source.rawLessonNumbers === '2',
    );
    const added = parsed.replacements.find(
      (replacement) =>
        replacement.source.rawGroupName === 'ИТ1-11' &&
        replacement.source.rawLessonNumbers === '4',
    );

    expect(cancelled).toMatchObject({
      group: 'ДИ1-13',
      lessonNumbers: [0],
      type: 'cancel',
      original: { raw: 'Разг. о важном' },
      replacement: { raw: 'Снято' },
    });
    expect(replaced).toMatchObject({
      lessonNumbers: [2],
      type: 'replace',
      original: { raw: 'Математика' },
      replacement: { raw: 'История Смирнов Б.Е.', room: 'А201' },
    });
    expect(added).toMatchObject({
      lessonNumbers: [4],
      type: 'add',
      original: null,
      replacement: { raw: 'История Свободина Н.В.', room: 'Б101' },
    });
  });

  it('expands lesson ranges that include the zero lesson', async () => {
    const parsed = parseYgkReplacements(
      await readReplacementFixture('first'),
      'first',
    );
    const replacement = parsed.replacements.find(
      (item) => item.source.rawLessonNumbers === '0-3',
    );

    expect(replacement).toMatchObject({
      lessonNumbers: [0, 1, 2, 3],
      type: 'cancel',
    });
  });

  it('parses the second-shift regression fixture and comma-separated numbers', async () => {
    const parsed = parseYgkReplacements(
      await readReplacementFixture('second'),
      'second',
    );
    const replacement = parsed.replacements.find(
      (item) => item.source.rawLessonNumbers === '4,5',
    );

    expect(parsed).toMatchObject({
      hasChanges: true,
      date: '2026-09-04',
      day: 'Пятница',
      shift: 'second',
      weekType: 'numerator',
      diagnostics: [],
    });
    expect(parsed.replacements).toHaveLength(29);
    expect(replacement).toMatchObject({
      lessonNumbers: [4, 5],
      type: 'replace',
    });
  });

  it('returns diagnostics for an incomplete row instead of silently guessing', () => {
    const parsed = parseYgkReplacements(
      `
        <div><b>ИЗМЕНЕНИЯ</b></div>
        <div>в расписании на 4 сентября 2026 года / пятница</div>
        <div>(Числитель) Первая смена</div>
        <table>
          <tr>
            <th>№</th>
            <th>Группа</th>
            <th>Номер</th>
            <th>Дисциплина по расписанию</th>
            <th>Дисциплина по замене</th>
            <th>Аудитория</th>
          </tr>
          <tr>
            <td>1</td>
            <td>СТ1-11</td>
            <td></td>
            <td>Математика</td>
            <td>История</td>
            <td>А201</td>
          </tr>
        </table>
      `,
      'first',
    );

    expect(parsed.replacements).toEqual([
      expect.objectContaining({
        group: 'СТ1-11',
        lessonNumbers: [],
        type: 'unknown',
      }),
    ]);
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'INVALID_REPLACEMENT_LESSON_NUMBER',
      'UNKNOWN_REPLACEMENT_TYPE',
    ]);
  });

  it('distinguishes an unpublished page from an empty table of changes', () => {
    const parsed = parseYgkReplacements(
      '<div>Обновление ожидается</div>',
      'second',
    );

    expect(parsed).toMatchObject({
      hasChanges: false,
      date: null,
      day: null,
      shift: 'second',
      weekType: 'unknown',
      replacements: [],
    });
    expect(parsed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'REPLACEMENT_CHANGES_NOT_PUBLISHED',
    ]);
  });
});
