import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';

export interface ParsedYgkReplacementLessonText {
  subject: string;
  teachers: string[];
  subgroups: string[];
  theory: boolean;
}

const subgroupMarkerPattern =
  /(?:(?<![\p{L}\p{N}.])(?<before>\d+(?:\s*[,;]\s*\d+)*)\s*)?п\s*\/?\s*гр\.?\s*(?<after>\d+(?:\s*[,;]\s*\d+)*)?/giu;
const theoryMarkerPattern = /(?:^|[\s/;,-])теория(?=$|[\s/;,-])/giu;
const teacherPattern =
  /(?<surname>[А-ЯЁ][а-яё-]+)\s+(?<first>[А-ЯЁ])\.\s*(?<second>[А-ЯЁ])\.?/gu;

const cleanupSubject = (value: string): string =>
  normalizeSingleLine(value)
    .replace(/(?:\s*[,;:-]\s*){2,}/gu, ' ')
    .replace(/^[,;: -]+|[,;: -]+$/gu, '')
    .trim();

const subgroupNumbers = (value: string | undefined): string[] =>
  (value?.match(/\d+/gu) ?? []).filter(
    (number, index, values) => values.indexOf(number) === index,
  );

/**
 * Извлекает структурные признаки из ручного текста замены ЯГК.
 *
 * Функция не пытается выбрать вариант пары: она только отделяет предмет,
 * преподавателей, подгруппы и отметку «теория». Это позволяет resolver-у
 * применять замену лишь после однозначного сопоставления с base-расписанием.
 */
export const parseYgkReplacementLessonText = (
  value: string,
): ParsedYgkReplacementLessonText => {
  const normalized = normalizeDashes(normalizeSingleLine(value));
  const subgroups: string[] = [];
  let withoutMarkers = normalized.replace(
    subgroupMarkerPattern,
    (match, before: string | undefined, after: string | undefined) => {
      for (const subgroup of [
        ...subgroupNumbers(before),
        ...subgroupNumbers(after),
      ]) {
        if (!subgroups.includes(subgroup)) subgroups.push(subgroup);
      }
      return ' ';
    },
  );
  const theory = theoryMarkerPattern.test(withoutMarkers);
  theoryMarkerPattern.lastIndex = 0;
  withoutMarkers = withoutMarkers.replace(theoryMarkerPattern, ' ');

  const teachers: string[] = [];
  const subject = cleanupSubject(
    withoutMarkers.replace(
      teacherPattern,
      (
        match,
        surname: string | undefined,
        first: string | undefined,
        second: string | undefined,
      ) => {
        if (surname && first && second)
          teachers.push(normalizeSingleLine(match));
        return ' ';
      },
    ),
  );

  return {
    subject,
    teachers,
    subgroups,
    theory,
  };
};
