import { distance } from 'fastest-levenshtein';
import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';

export interface SubjectSimilarityCandidate {
  index: number;
  subject: string;
}

export interface SubjectSimilarityMatch {
  index: number;
  similarity: number;
}

const subjectKey = (value: string): string =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Возвращает процент символьной близости двух очищенных названий предметов.
 *
 * Метрика нужна только для ранжирования вариантов одной пары. Она не ищет
 * предмет среди всего расписания и потому не может сама сопоставить группу,
 * дату или номер пары.
 */
export const subjectSimilarityPercent = (
  left: string,
  right: string,
): number => {
  const normalizedLeft = subjectKey(left);
  const normalizedRight = subjectKey(right);
  const longestLength = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!longestLength) return 0;

  return Math.round(
    ((longestLength - distance(normalizedLeft, normalizedRight)) /
      longestLength) *
      100,
  );
};

/**
 * Находит единственный достаточно близкий вариант предмета.
 *
 * Порог и отрыв от следующего кандидата не дают применить замену, если
 * короткое ручное название одинаково похоже на несколько вариантов пары.
 */
export const findUniqueSimilarSubject = (
  subject: string,
  candidates: readonly SubjectSimilarityCandidate[],
  minimumPercent = 86,
  minimumLeadPercent = 8,
): SubjectSimilarityMatch | null => {
  const ranked = candidates
    .map((candidate) => ({
      index: candidate.index,
      similarity: subjectSimilarityPercent(subject, candidate.subject),
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.index - right.index,
    );
  const best = ranked[0];
  if (!best || best.similarity < minimumPercent) return null;

  const next = ranked[1];
  if (next && best.similarity - next.similarity < minimumLeadPercent)
    return null;

  return best;
};
