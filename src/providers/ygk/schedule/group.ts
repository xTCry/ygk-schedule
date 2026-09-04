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

const groupPattern = /[А-ЯЁA-Z]{1,5}\d{0,2}-\d{1,3}(?![-\d])/giu;
const fullGroupPattern = /^([А-ЯЁ]{1,5})\d{0,2}-\d{1,3}$/u;
const compactGroupPattern = /^\d{1,2}-\d{1,3}$/u;

const groupPrefix = (group: string): string | null =>
  /^([А-ЯЁ]{1,5})\d{0,2}-\d{1,3}$/u.exec(group)?.[1] ?? null;

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
    const fullGroups = [...value.matchAll(groupPattern)].map(
      (match) => match[0],
    );
    if (fullGroups.length) {
      groups.push(...fullGroups);
      currentPrefix = groupPrefix(fullGroups.at(-1)!);
      continue;
    }
    if (currentPrefix && compactGroupPattern.test(value)) {
      const expanded = `${currentPrefix}${value}`;
      if (fullGroupPattern.test(expanded)) groups.push(expanded);
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
