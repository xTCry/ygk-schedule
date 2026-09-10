/**
 * Добавляет Text Fragment к живой странице замен.
 *
 * Современные браузеры прокручивают страницу к указанному коду группы и
 * подсвечивают его. Если URL источника оказался некорректным, сохраняем
 * исходную ссылку: просмотр замен не должен ломаться из-за удобной подсветки.
 */
export const replacementSourceUrlForGroup = (
  sourceUrl: string,
  group: string,
): string => {
  try {
    const url = new URL(sourceUrl);
    // В Text Fragments дефис задает prefix/suffix, поэтому кодируем его
    // дополнительно даже после encodeURIComponent.
    const text = encodeURIComponent(group).replace(/-/g, '%2D');
    url.hash = `:~:text=${text}`;
    return url.toString();
  } catch {
    return sourceUrl;
  }
};
