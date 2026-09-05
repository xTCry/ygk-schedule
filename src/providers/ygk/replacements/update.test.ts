import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { updateSchedule } from '../../../cli/update.ts';
import { fixturePath } from '../schedule/fixture.test-helper.ts';
import { replacementFixturePath } from './fixture.test-helper.ts';
import { updateYgkReplacements } from './update.ts';
import type {
  ActualGroupScheduleArtifact,
  GroupReplacementsArtifact,
} from '../../../types.ts';

describe('YGK replacements update', () => {
  it('writes raw replacements and actual data without replacing the base schedule', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-replacements-'));
    await updateSchedule({
      input: fixturePath,
      outputDir: root,
      projectRoot: process.cwd(),
    });
    const basePath = join(root, 'base', '00-schedule.json');
    const baseBefore = await readFile(basePath, 'utf8');

    const first = await updateYgkReplacements({
      baseSchedule: basePath,
      outputDir: root,
      firstInput: replacementFixturePath('first'),
      secondInput: replacementFixturePath('second'),
      projectRoot: process.cwd(),
    });

    expect(first.written).toBe(true);
    expect(first.replacementsChanged).toBe(true);
    expect(first.actualChanged).toBe(true);
    await expect(readFile(basePath, 'utf8')).resolves.toBe(baseBefore);

    const replacementsJson = JSON.parse(
      await readFile(
        join(root, 'replacements', '00-replacements.json'),
        'utf8',
      ),
    ) as { dates: Record<string, { replacements: unknown[] }> };
    const replacementsYaml = await readFile(
      join(root, 'replacements', '00-replacements.yaml'),
      'utf8',
    );
    const actualJson = JSON.parse(
      await readFile(join(root, 'actual', '00-schedule.json'), 'utf8'),
    ) as { dates: Record<string, unknown> };
    const actualYaml = await readFile(
      join(root, 'actual', '00-schedule.yaml'),
      'utf8',
    );

    expect(replacementsJson.dates['2026-09-04']?.replacements).toHaveLength(
      100,
    );
    expect(replacementsJson).toEqual(parse(replacementsYaml));
    expect(actualJson).toEqual(parse(actualYaml));
    expect(actualJson.dates).toHaveProperty('2026-09-04');
    await expect(
      readFile(join(root, 'replacements', '10-groups', 'ДИ1-13.json'), 'utf8'),
    ).resolves.toContain('"ДИ1-13"');
    await expect(
      readFile(join(root, 'actual', '90-diagnostics.json'), 'utf8'),
    ).resolves.toContain('"issues"');

    const replacementGroup = await readFile(
      join(root, 'replacements', '10-groups', 'ДИ1-13.json'),
      'utf8',
    );
    const actualGroup = await readFile(
      join(root, 'actual', '10-groups', 'ДИ1-13.json'),
      'utf8',
    );
    expect(JSON.parse(replacementGroup) as GroupReplacementsArtifact).toEqual(
      expect.objectContaining({
        group: 'ДИ1-13',
      }),
    );
    expect(JSON.parse(actualGroup) as ActualGroupScheduleArtifact).toEqual(
      expect.objectContaining({
        group: 'ДИ1-13',
      }),
    );
    expect(JSON.parse(replacementGroup)).not.toHaveProperty('generatedAt');
    expect(JSON.parse(actualGroup)).not.toHaveProperty('version');

    await mkdir(join(root, 'config', 'ygk'), { recursive: true });
    await writeFile(
      join(root, 'config', 'ygk', 'replacements.json'),
      JSON.stringify({
        groups: {},
        subjects: {},
        teachers: {},
        rooms: {},
      }),
    );
    await updateSchedule({
      input: fixturePath,
      outputDir: root,
      projectRoot: root,
    });
    const second = await updateYgkReplacements({
      baseSchedule: basePath,
      outputDir: root,
      firstInput: replacementFixturePath('first'),
      secondInput: replacementFixturePath('second'),
      projectRoot: root,
    });
    expect(second.written).toBe(false);
    expect(second.replacementsChanged).toBe(false);
    expect(second.actualChanged).toBe(false);
    await expect(
      readFile(join(root, 'replacements', '10-groups', 'ДИ1-13.json'), 'utf8'),
    ).resolves.toBe(replacementGroup);
    await expect(
      readFile(join(root, 'actual', '10-groups', 'ДИ1-13.json'), 'utf8'),
    ).resolves.toBe(actualGroup);

    const third = await updateYgkReplacements({
      baseSchedule: basePath,
      outputDir: root,
      firstInput: replacementFixturePath('first'),
      secondInput: replacementFixturePath('second'),
      projectRoot: root,
    });
    expect(third.written).toBe(false);
    expect(third.replacementsChanged).toBe(false);
    expect(third.actualChanged).toBe(false);

    await expect(
      readFile(join(root, 'replacements', '00-replacements.yaml'), 'utf8'),
    ).resolves.toMatch(/(^|\s)[&*]a\d+\b/mu);

    const firstForNextDayPath = join(root, 'rasp_first-2026-09-05.html');
    const firstFixtureHtml = await readFile(
      replacementFixturePath('first'),
      'utf8',
    );
    await writeFile(
      firstForNextDayPath,
      firstFixtureHtml
        .replace(
          'на 4 сентября 2026 года / пятница',
          'на 5 сентября 2026 года / суббота',
        )
        .replace('(Числитель) Первая смена', '(Знаменатель) Первая смена'),
    );
    const fourth = await updateYgkReplacements({
      baseSchedule: basePath,
      outputDir: root,
      firstInput: firstForNextDayPath,
      secondInput: replacementFixturePath('second'),
      projectRoot: root,
      baseDataRevision: 'data-base-revision',
    });

    expect(fourth.written).toBe(true);
    expect(fourth.replacementsChanged).toBe(true);
    expect(fourth.actualChanged).toBe(true);
    expect(fourth.replacements.dates['2026-09-04']?.shifts).toMatchObject({
      first: {
        status: 'finalized',
        finalizedBy: { date: '2026-09-05' },
      },
      second: { status: 'mutable' },
    });
    expect(
      fourth.replacements.dates['2026-09-05']?.shifts?.first,
    ).toMatchObject({ status: 'mutable' });
    expect(
      fourth.actual.dates['2026-09-04']?.groups['СТ1-11']?.frozenBase,
    ).toEqual(
      expect.objectContaining({
        dataRevision: 'data-base-revision',
      }),
    );
    expect(
      fourth.actual.dates['2026-09-04']?.groups['СТ1-11']?.frozenBase
        ?.scheduleVersion,
    ).toBeTypeOf('string');
  }, 20_000);
});
