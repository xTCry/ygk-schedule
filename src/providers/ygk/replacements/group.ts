import { normalizeGroupCode } from '../schedule/group.ts';
import { resolveReplacementAlias, type ReplacementAliases } from './config.ts';

export type ReplacementGroupResolutionStrategy =
  'alias' | 'exact' | 'unresolved';

export interface ReplacementGroupResolution {
  group: string | null;
  strategy: ReplacementGroupResolutionStrategy;
  candidates: string[];
}

/**
 * Сопоставляет обозначение группы из HTML-замен с ключом базового расписания.
 *
 * Новый формат «36 ЭМЕХ» — такой же полноценный код, как «СТ1-11»:
 * parser базового XLSX сохраняет его в `schedule.groups`, а здесь достаточно
 * нормализованного точного совпадения. Aliases остаются только исключением.
 */
export const resolveYgkReplacementGroup = (
  value: string,
  knownGroups: Iterable<string>,
  aliases: ReplacementAliases,
): ReplacementGroupResolution => {
  const groups = [...new Set(knownGroups)].sort((left, right) =>
    left.localeCompare(right, 'ru-RU'),
  );
  const byNormalizedGroup = new Map(
    groups.map((group) => [normalizeGroupCode(group), group] as const),
  );
  const aliased = resolveReplacementAlias(aliases, 'groups', value);
  const normalizedAliased = normalizeGroupCode(aliased);
  const exact = byNormalizedGroup.get(normalizedAliased);
  if (exact) {
    return {
      group: exact,
      strategy: aliased === value ? 'exact' : 'alias',
      candidates: [exact],
    };
  }

  return {
    group: null,
    strategy: 'unresolved',
    candidates: [],
  };
};
