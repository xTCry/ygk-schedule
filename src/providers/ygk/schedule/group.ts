import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';

const confusables: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

const canonicalGroupPattern = /[А-ЯЁA-Z]{1,5}\s*\d{0,2}-\d{1,3}(?![-\d])/giu;
const numberedSpecialtyGroupPattern =
  /\d{1,3}\s+[А-ЯЁA-Z]{2,5}(?![\p{L}\p{N}])/giu;
const fullCanonicalGroupPattern = /^([А-ЯЁ]{1,5})\d{0,2}-\d{1,3}$/u;
const compactGroupPattern = /^\d{1,2}-\d{1,3}$/u;

const groupPrefix = (group: string): string | null =>
  /^([А-ЯЁ]{1,5})\d{0,2}-\d{1,3}$/u.exec(group)?.[1] ?? null;

const groupsInPart = (value: string): string[] =>
  [
    ...[...value.matchAll(canonicalGroupPattern)].map((match) => ({
      group: match[0],
      index: match.index ?? 0,
    })),
    ...[...value.matchAll(numberedSpecialtyGroupPattern)].map((match) => ({
      group: match[0],
      index: match.index ?? 0,
    })),
  ]
    .sort((left, right) => left.index - right.index)
    .map((match) => {
      const compact = match.group.replace(/\s+/gu, '');
      return fullCanonicalGroupPattern.test(compact) ? compact : match.group;
    });

/**
 * Раскрывает распространенное в документах сокращение группы:
 * `СД2-21/2-22` → `СД2-21`, `СД2-22`.
 *
 * Для фрагмента без букв нужен предшествующий полный код. Без такого
 * контекста фрагмент не считается группой: нельзя угадывать отделение.
 */
const groupsFromCandidate = (normalizedSource: string): string[] => {
  const groups: string[] = [];
  let currentPrefix: string | null = null;

  for (const part of normalizedSource.split('/')) {
    const value = part.trim();
    if (!value) continue;
    const foundGroups = groupsInPart(value);
    if (foundGroups.length) {
      groups.push(...foundGroups);
      const lastCanonicalGroup = [...foundGroups]
        .reverse()
        .find((group) => fullCanonicalGroupPattern.test(group));
      currentPrefix = lastCanonicalGroup
        ? groupPrefix(lastCanonicalGroup)
        : null;
      continue;
    }
    if (currentPrefix && compactGroupPattern.test(value)) {
      const expanded = `${currentPrefix}${value}`;
      if (fullCanonicalGroupPattern.test(expanded)) groups.push(expanded);
    }
  }

  return groups;
};

export const normalizeGroupCode = (value: string): string => {
  const prepared = normalizeDashes(normalizeSingleLine(value)).toUpperCase();
  return [...prepared].map((char) => confusables[char] ?? char).join('');
};

export interface GroupCandidate {
  raw: string;
  normalizedSource: string;
  groups: string[];
}

export const parseGroupCandidate = (value: unknown): GroupCandidate | null => {
  const raw = normalizeSingleLine(value);
  if (!raw || raw.startsWith('*')) return null;
  const normalizedSource = normalizeGroupCode(raw);
  const groups = groupsFromCandidate(normalizedSource);
  if (!groups.length) return null;
  const unique = [...new Set(groups)];
  return { raw, normalizedSource, groups: unique };
};
