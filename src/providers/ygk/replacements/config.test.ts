import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadYgkReplacementAliases,
  resolveReplacementAlias,
} from './config.ts';

describe('YGK replacement aliases', () => {
  it('loads aliases with normalized lookup keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-replacement-aliases-'));
    const directory = join(root, 'config', 'ygk');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'replacements.json'),
      JSON.stringify({
        groups: { 'СТ специальная': 'СТ1-11' },
        subjects: {
          'Осн. проф. деят.': 'Основы профессиональной деятельности',
        },
        teachers: { 'Иванов И. И.': 'Иванов И.И.' },
        rooms: { 'Сп. зал': 'Спортзал' },
      }),
    );

    const aliases = await loadYgkReplacementAliases(root);
    expect(resolveReplacementAlias(aliases, 'groups', 'ст специальная')).toBe(
      'СТ1-11',
    );
    expect(resolveReplacementAlias(aliases, 'subjects', 'ОСН ПРОФ ДЕЯТ')).toBe(
      'Основы профессиональной деятельности',
    );
    expect(resolveReplacementAlias(aliases, 'teachers', 'иванов и.и.')).toBe(
      'Иванов И.И.',
    );
    expect(resolveReplacementAlias(aliases, 'rooms', 'сп-зал')).toBe(
      'Спортзал',
    );
  });

  it('rejects aliases that collide after normalization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ygk-replacement-aliases-'));
    const directory = join(root, 'config', 'ygk');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'replacements.json'),
      JSON.stringify({
        groups: {},
        subjects: {
          'Осн. проф. деят.': 'Первое значение',
          'Осн проф деят': 'Другое значение',
        },
        teachers: {},
        rooms: {},
      }),
    );

    await expect(loadYgkReplacementAliases(root)).rejects.toThrow(
      /normalize to the same key/,
    );
  });
});
