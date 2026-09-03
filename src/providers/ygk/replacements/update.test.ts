import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { updateSchedule } from '../../../cli/update.ts';
import { fixturePath } from '../schedule/fixture.test-helper.ts';
import { replacementFixturePath } from './fixture.test-helper.ts';
import { updateYgkReplacements } from './update.ts';

describe('YGK replacements update', () => {
  it('writes raw replacements and actual data without replacing the base schedule', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-replacements-'));
    await updateSchedule({
      input: fixturePath,
      outputDir: root,
      projectRoot: process.cwd(),
    });
    const basePath = join(root, 'json', '00-schedule.json');
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
        join(root, 'replacements', 'json', '00-replacements.json'),
        'utf8',
      ),
    ) as { dates: Record<string, { replacements: unknown[] }> };
    const replacementsYaml = await readFile(
      join(root, 'replacements', 'yaml', '00-replacements.yaml'),
      'utf8',
    );
    const actualJson = JSON.parse(
      await readFile(join(root, 'actual', 'json', '00-schedule.json'), 'utf8'),
    ) as { dates: Record<string, unknown> };
    const actualYaml = await readFile(
      join(root, 'actual', 'yaml', '00-schedule.yaml'),
      'utf8',
    );

    expect(replacementsJson.dates['2026-09-04']?.replacements).toHaveLength(
      100,
    );
    expect(replacementsJson).toEqual(parse(replacementsYaml));
    expect(actualJson).toEqual(parse(actualYaml));
    expect(actualJson.dates).toHaveProperty('2026-09-04');
    await expect(
      readFile(
        join(root, 'replacements', 'json', '10-groups', 'ДИ1-13.json'),
        'utf8',
      ),
    ).resolves.toContain('"ДИ1-13"');
    await expect(
      readFile(join(root, 'actual', 'meta', '90-diagnostics.json'), 'utf8'),
    ).resolves.toContain('"issues"');

    const second = await updateYgkReplacements({
      baseSchedule: basePath,
      outputDir: root,
      firstInput: replacementFixturePath('first'),
      secondInput: replacementFixturePath('second'),
      projectRoot: process.cwd(),
    });
    expect(second.written).toBe(false);
    expect(second.replacementsChanged).toBe(false);
    expect(second.actualChanged).toBe(false);
  });
});
