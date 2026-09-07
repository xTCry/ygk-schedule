/**
 * Возвращает читаемое имя файла для кода или названия группы.
 *
 * Пробелы и кириллица остаются без кодирования: они поддерживаются файловыми
 * системами и совпадают с именами групп в опубликованных данных. Управляющие
 * символы и разделители путей кодируются, чтобы значение не могло выйти за
 * пределы целевой директории.
 */
export const getGroupFileName = (group: string): string => {
  const normalized = group.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!normalized || normalized === '.' || normalized === '..')
    throw new Error(`Group name cannot be used as a file name: ${group}`);
  return [...normalized]
    .map((character) =>
      (character.codePointAt(0) ?? 0) < 32 || /[\\/:*?"<>|]/u.test(character)
        ? encodeURIComponent(character)
        : character,
    )
    .join('');
};
