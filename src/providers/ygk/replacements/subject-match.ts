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

const subjectWords = (value: string): string[] =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Раскрывает несколько устойчивых учебных сокращений, не зависящих от группы
 * или года. Это не пользовательский alias: варианты «физкультура» и
 * «физическая культура» обозначают одну и ту же дисциплину во всех таблицах.
 */
const expandedManualWords = (value: string): string[] =>
  subjectWords(value).flatMap((word) =>
    word.startsWith('физкул') ? ['физическая', 'культура'] : [word],
  );

const subjectKey = (value: string): string =>
  normalizeDashes(normalizeSingleLine(value))
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const significantWords = (value: string): string[] =>
  subjectWords(value).filter((word) => word.length > 2);

const wordMatches = (source: string, candidate: string): boolean =>
  source === candidate ||
  (source.length >= 2 &&
    candidate.length >= 3 &&
    (source.startsWith(candidate) || candidate.startsWith(source)));

const hasLongPrefixMatch = (source: string, candidate: string): boolean => {
  if (source.length < 5 || candidate.length < 5) return false;
  let length = 0;
  const limit = Math.min(source.length, candidate.length);
  while (length < limit && source[length] === candidate[length]) length += 1;
  return length >= 5;
};

/**
 * Проверяет, есть ли в ручной строке самостоятельное упоминание предмета.
 *
 * В одной ячейке ЯГК иногда перечисляют исходные названия для нескольких
 * номеров пары: «Теор.вер. Физкул.». Для каждого номера resolver уже знает
 * свой короткий список вариантов и может безопасно найти в такой строке
 * последовательность сокращённых первых слов конкретного предмета.
 */
const mentionsSubject = (value: string, subject: string): boolean => {
  const rawSourceWords = expandedManualWords(value);
  const initialism = subjectWords(subject)
    .map((word) => word[0])
    .join('');
  if (
    initialism.length >= 2 &&
    rawSourceWords.some((word) => word === initialism)
  ) {
    return true;
  }

  const sourceWords = rawSourceWords.filter((word) => word.length >= 2);
  const candidateWords = significantWords(subject);
  if (!sourceWords.length || !candidateWords.length) return false;

  for (
    let sourceStart = 0;
    sourceStart < sourceWords.length;
    sourceStart += 1
  ) {
    let matchedWords = 0;
    while (
      sourceStart + matchedWords < sourceWords.length &&
      matchedWords < candidateWords.length &&
      wordMatches(
        sourceWords[sourceStart + matchedWords] ?? '',
        candidateWords[matchedWords] ?? '',
      )
    ) {
      matchedWords += 1;
    }

    if (matchedWords >= 2) return true;

    const sourceWord = sourceWords[sourceStart] ?? '';
    const firstSubjectWord = candidateWords[0] ?? '';
    if (
      matchedWords === 1 &&
      (sourceWord === firstSubjectWord
        ? sourceWord.length >= 6
        : hasLongPrefixMatch(sourceWord, firstSubjectWord))
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Выбирает единственный вариант пары, явно упомянутый в составной строке.
 *
 * Дополнительные слова не считаются свободным нечётким совпадением: они
 * допускаются только потому, что другая часть строки может относиться к
 * соседнему номеру пары. Два подходящих варианта оставляют строку unresolved.
 */
export const findUniqueMentionedSubject = (
  value: string,
  candidates: readonly SubjectSimilarityCandidate[],
): Pick<SubjectSimilarityCandidate, 'index'> | null => {
  const matches = candidates.filter((candidate) =>
    mentionsSubject(value, candidate.subject),
  );
  return matches.length === 1 && matches[0]
    ? { index: matches[0].index }
    : null;
};

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
