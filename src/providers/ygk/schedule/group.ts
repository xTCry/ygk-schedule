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

const groupPattern = /[А-ЯЁA-Z]{1,5}\d{0,2}-\d{1,3}/giu;

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
  const groups = [...normalizedSource.matchAll(groupPattern)].map(
    (match) => match[0],
  );
  if (!groups.length) return null;
  const unique = [...new Set(groups)];
  return { raw, normalizedSource, groups: unique };
};
