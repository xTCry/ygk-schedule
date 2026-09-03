import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturePath } from '../providers/ygk/schedule/fixture.test-helper.ts';
import { updateSchedule } from './update.ts';

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
    expect(second.schedule.source.sha256).toBe(first.schedule.source.sha256);
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
});
