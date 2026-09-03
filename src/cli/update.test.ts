import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalSchedule } from '../types.ts';
import { fixturePath } from '../providers/ygk/schedule/fixture.test-helper.ts';
import { formatUpdateCliOutput, updateSchedule } from './update.ts';
import { parse } from 'yaml';

const createProjectRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'ygk-update-'));
  for (const path of [
    'src/parser',
    'src/xlsx',
    'src/diagnostics',
    'src/providers/ygk',
    'config',
  ])
    await mkdir(join(root, path), { recursive: true });
  await writeFile(join(root, 'src/types.ts'), 'export type A = string;');
  await writeFile(
    join(root, 'src/parser/parser.ts'),
    'export const version = 1;',
  );
  await writeFile(join(root, 'config/config.json'), '{}');
  return root;
};

describe('schedule update', () => {
  it('hides detailed lesson changes in compact CLI output', () => {
    const result = {
      written: true,
      versionChanged: true,
      semanticChanged: true,
      schedule: { groups: {}, diagnostics: [] },
      diff: {
        changed: true,
        addedGroups: [],
        removedGroups: [],
        changedGroups: ['СТ1-11'],
        lessonChanges: [
          {
            group: 'СТ1-11',
            day: 'Понедельник' as const,
            lessonNumber: 1,
            before: null,
            after: { variants: [] },
          },
        ],
      },
    };

    const compact = JSON.parse(formatUpdateCliOutput(result, false)) as {
      diff: Record<string, unknown>;
    };
    const verbose = JSON.parse(formatUpdateCliOutput(result, true)) as {
      diff: Record<string, unknown>;
    };
    expect(compact.diff).not.toHaveProperty('lessonChanges');
    expect(verbose.diff.lessonChanges).toHaveLength(1);
  });

  it('writes once and skips an unchanged source, parser and config version', async () => {
    const root = await createProjectRoot();
    const output = join(root, 'data/schedule.json');
    const first = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    expect(first.written).toBe(true);
    expect(first.versionChanged).toBe(true);
    expect(first.semanticChanged).toBe(true);
    expect(Object.keys(first.schedule.groups)).toHaveLength(38);

    const firstFile = await readFile(output, 'utf8');
    const second = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    expect(second.written).toBe(false);
    expect(second.versionChanged).toBe(false);
    expect(second.semanticChanged).toBe(false);
    await expect(readFile(output, 'utf8')).resolves.toBe(firstFile);
  });

  it('skips an unchanged export when CI does not have config/.gitkeep', async () => {
    const root = await createProjectRoot();
    await rm(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config/.gitkeep'), '');
    const outputDir = join(root, 'data');

    const first = await updateSchedule({
      input: fixturePath,
      outputDir,
      projectRoot: root,
    });
    const firstSchedule = await readFile(
      join(outputDir, 'base/00-schedule.json'),
      'utf8',
    );

    await rm(join(root, 'config'), { recursive: true });
    const second = await updateSchedule({
      input: fixturePath,
      outputDir,
      projectRoot: root,
    });

    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
    expect(second.versionChanged).toBe(false);
    await expect(
      readFile(join(outputDir, 'base/00-schedule.json'), 'utf8'),
    ).resolves.toBe(firstSchedule);
  });

  it('reparses the same XLSX when parser code changes', async () => {
    const root = await createProjectRoot();
    const output = join(root, 'data/schedule.json');
    const first = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    await writeFile(
      join(root, 'src/parser/parser.ts'),
      'export const version = 2;',
    );
    const second = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    expect(second.written).toBe(true);
    expect(second.versionChanged).toBe(true);
    expect(second.semanticChanged).toBe(false);
    expect(second.schedule.version.parserHash).not.toBe(
      first.schedule.version.parserHash,
    );
    expect(second.schedule.sources[0]?.sha256).toBe(
      first.schedule.sources[0]?.sha256,
    );
  });

  it('reparses the same XLSX when configuration changes', async () => {
    const root = await createProjectRoot();
    const output = join(root, 'data/schedule.json');
    const first = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    await writeFile(
      join(root, 'config/config.json'),
      '{"academicYear":"auto"}',
    );
    const second = await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    expect(second.written).toBe(true);
    expect(second.versionChanged).toBe(true);
    expect(second.semanticChanged).toBe(false);
    expect(second.schedule.version.configHash).not.toBe(
      first.schedule.version.configHash,
    );
  });

  it('discovers and aggregates XLSX files from a schedule page', async () => {
    const root = await createProjectRoot();
    const output = join(root, 'data/schedule.json');
    const pageUrl = 'https://ygk.example/raspisanie.html';
    const sourceUrl = 'https://ygk.example/files/so.xlsx';
    const fixture = await readFile(fixturePath);

    vi.stubGlobal('fetch', (input: string | URL) => {
      const url = String(input);
      if (url === pageUrl) {
        return Promise.resolve(
          new Response(
            '<article><p>Расписание</p><table><tr><td><a href="/files/so.xlsx">СО</a></td></tr></table></article>',
          ),
        );
      }
      if (url === sourceUrl) return Promise.resolve(new Response(fixture));
      throw new Error(`Unexpected request: ${url}`);
    });

    try {
      const result = await updateSchedule({
        pageUrl,
        output,
        projectRoot: root,
      });
      expect(result.written).toBe(true);
      expect(Object.keys(result.schedule.groups)).toHaveLength(38);
      expect(result.schedule.sources).toEqual([
        expect.objectContaining({
          id: sourceUrl,
          fileName: 'so.xlsx',
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not replace a valid export when the schedule page is unavailable', async () => {
    const root = await createProjectRoot();
    const output = join(root, 'data/schedule.json');
    await updateSchedule({
      input: fixturePath,
      output,
      projectRoot: root,
    });
    const previous = await readFile(output, 'utf8');
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        updateSchedule({
          pageUrl: 'https://ygk.example/raspisanie.html',
          output,
          projectRoot: root,
        }),
      ).rejects.toThrow(/HTTP 503/);
      await expect(readFile(output, 'utf8')).resolves.toBe(previous);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('writes matching JSON and YAML artifacts to an output directory', async () => {
    const root = await createProjectRoot();
    const outputDir = join(root, 'data');
    const result = await updateSchedule({
      input: fixturePath,
      outputDir,
      projectRoot: root,
    });

    const json = await readFile(
      join(outputDir, 'base/00-schedule.json'),
      'utf8',
    );
    const yaml = await readFile(
      join(outputDir, 'base/00-schedule.yaml'),
      'utf8',
    );
    const groupJson = await readFile(
      join(outputDir, 'base/10-groups/СТ1-11.json'),
      'utf8',
    );
    const groupYaml = await readFile(
      join(outputDir, 'base/10-groups/СТ1-11.yaml'),
      'utf8',
    );
    const diagnostics = JSON.parse(
      await readFile(join(outputDir, 'base/90-diagnostics.json'), 'utf8'),
    ) as { summary: Record<string, number> };
    const diagnosticsYaml = await readFile(
      join(outputDir, 'base/90-diagnostics.yaml'),
      'utf8',
    );
    const parsedGroupJson = JSON.parse(groupJson) as CanonicalSchedule;
    expect(JSON.parse(json)).toEqual(parse(yaml));
    expect(parsedGroupJson).toEqual(parse(groupYaml));
    expect(Object.keys(parsedGroupJson.groups)).toEqual(['СТ1-11']);
    expect(diagnostics).toEqual(parse(diagnosticsYaml));
    expect(diagnostics.summary.warning).toBe(2);
    expect(result.written).toBe(true);
  });
});
