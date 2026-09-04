import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';
import { normalizeGroupCode } from '../schedule/group.ts';

export type ReplacementAliasKind = 'groups' | 'subjects' | 'teachers' | 'rooms';

export interface ReplacementAliases {
  groups: ReadonlyMap<string, string>;
  subjects: ReadonlyMap<string, string>;
  teachers: ReadonlyMap<string, string>;
  rooms: ReadonlyMap<string, string>;
}

type MutableReplacementAliases = {
  [Kind in ReplacementAliasKind]: Map<string, string>;
};

const replacementAliasKinds: readonly ReplacementAliasKind[] = [
  'groups',
  'subjects',
  'teachers',
  'rooms',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Приводит текст к ключу, устойчивому к регистру, пробелам и пунктуации.
 */
const textAliasKey = (value: string): string =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const groupAliasKey = (value: string): string =>
  normalizeGroupCode(value)
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const aliasKey = (kind: ReplacementAliasKind, value: string): string =>
  kind === 'groups' ? groupAliasKey(value) : textAliasKey(value);

const emptyAliases = (): MutableReplacementAliases => ({
  groups: new Map(),
  subjects: new Map(),
  teachers: new Map(),
  rooms: new Map(),
});

const parseAliasesFile = (value: unknown, path: string): ReplacementAliases => {
  if (!isRecord(value))
    throw new Error(`Replacement aliases config must be an object: ${path}`);

  for (const key of Object.keys(value)) {
    if (!replacementAliasKinds.includes(key as ReplacementAliasKind))
      throw new Error(
        `Unknown replacement aliases section "${key}" in ${path}`,
      );
  }

  const aliases = emptyAliases();
  for (const kind of replacementAliasKinds) {
    const section = value[kind] ?? {};
    if (!isRecord(section))
      throw new Error(
        `Replacement aliases section "${kind}" must be an object in ${path}`,
      );

    const target = aliases[kind];
    for (const [rawAlias, rawCanonical] of Object.entries(section)) {
      if (typeof rawCanonical !== 'string' || !rawCanonical.trim())
        throw new Error(
          `Replacement alias "${rawAlias}" in "${kind}" must have a non-empty string value in ${path}`,
        );

      const key = aliasKey(kind, rawAlias);
      if (!key)
        throw new Error(
          `Replacement alias "${rawAlias}" in "${kind}" is empty after normalization in ${path}`,
        );

      const previous = target.get(key);
      if (previous && previous !== rawCanonical)
        throw new Error(
          `Replacement aliases "${rawAlias}" and another entry in "${kind}" normalize to the same key in ${path}`,
        );
      target.set(key, rawCanonical);
    }
  }
  return aliases;
};

/**
 * Читает provider-specific aliases для безопасного resolver-а замен.
 *
 * Конфиг отделен от настроек базового XLSX parser-а: его изменение не должно
 * вызывать повторную публикацию `base/`.
 */
export const loadYgkReplacementAliases = async (
  projectRoot = process.cwd(),
): Promise<ReplacementAliases> => {
  const path = resolve(projectRoot, 'config', 'ygk', 'replacements.json');
  try {
    return parseAliasesFile(JSON.parse(await readFile(path, 'utf8')), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return emptyAliases();
    if (error instanceof SyntaxError)
      throw new Error(`Invalid JSON in replacement aliases config: ${path}`, {
        cause: error,
      });
    throw error;
  }
};

/**
 * Возвращает каноническое значение alias-а или исходный текст без изменений.
 */
export const resolveReplacementAlias = (
  aliases: ReplacementAliases,
  kind: ReplacementAliasKind,
  value: string,
): string => aliases[kind].get(aliasKey(kind, value)) ?? value;
