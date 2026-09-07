import { normalizeDashes, normalizeSingleLine } from '../../../parser/text.ts';
import { stripYgkSubgroupMarkers } from '../subgroup.ts';

export interface ParsedYgkReplacementLessonText {
  subject: string;
  teachers: string[];
  subgroups: string[];
  theory: boolean;
}

const theoryMarkerPattern = /(?:^|[\s/;,-])теория(?=$|[\s/;,-])/giu;
const teacherPattern =
  /(?<surname>[А-ЯЁ][а-яё-]+)\s+(?<first>[А-ЯЁ])\.\s*(?<second>[А-ЯЁ])\.?/gu;

const cleanupSubject = (value: string): string =>
  normalizeSingleLine(value)
    .replace(/(?:\s*[,;:-]\s*){2,}/gu, ' ')
    .replace(/^[,;: -]+|[,;: -]+$/gu, '')
    .trim();

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
  const subgroupMarkers = stripYgkSubgroupMarkers(normalized);
  let withoutMarkers = subgroupMarkers.text;
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
    subgroups: subgroupMarkers.subgroups,
    theory,
  };
};
