import { normalizeDashes, normalizeSingleLine } from '../../parser/text.ts';

export interface ParsedYgkSubgroupMarkers {
  text: string;
  subgroups: string[];
  hasMarker: boolean;
}

/**
 * В таблицах ЯГК существуют только две подгруппы: 1 и 2.
 *
 * Маркер пишут вручную с разными сокращениями: «пгр1», «п/гр 1», «пг 1».
 * Пустой маркер «пгр» относится ко всем подгруппам, поэтому сохраняем факт
 * его наличия отдельно от перечисленных номеров.
 */
const subgroupMarkerPattern =
  /(?:(?<![\p{L}\p{N}.])(?<before>[12](?:\s*[,;]\s*[12])*)\s*)?п\s*\/?\s*гр?\.?\s*(?<after>[12](?:\s*[,;]\s*[12])*)?/giu;

const subgroupNumbers = (value: string | undefined): string[] => [
  ...new Set(value?.match(/[12]/gu) ?? []),
];

/**
 * Удаляет маркеры подгрупп из ручного текста и возвращает их номера.
 *
 * Числа вне строго ограниченного маркера не интерпретируются как подгруппа:
 * например, «УП 04» и «МДК 01.05» остаются кодами дисциплин.
 */
export const stripYgkSubgroupMarkers = (
  value: string,
): ParsedYgkSubgroupMarkers => {
  const subgroups: string[] = [];
  let hasMarker = false;
  const text = normalizeSingleLine(
    normalizeDashes(normalizeSingleLine(value)).replace(
      subgroupMarkerPattern,
      (_match, before: string | undefined, after: string | undefined) => {
        hasMarker = true;
        for (const subgroup of [
          ...subgroupNumbers(before),
          ...subgroupNumbers(after),
        ]) {
          if (!subgroups.includes(subgroup)) subgroups.push(subgroup);
        }
        return ' ';
      },
    ),
  );

  return { text, subgroups, hasMarker };
};

export const hasYgkSubgroupMarker = (value: string): boolean =>
  stripYgkSubgroupMarkers(value).hasMarker;
