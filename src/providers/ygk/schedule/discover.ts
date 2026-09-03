import * as cheerio from 'cheerio';
import { YGK_SCHEDULE_PAGE_URL } from '../constants.ts';

export interface DiscoveredScheduleFile {
  url: string;
  fileName: string;
  label: string;
}

const normalizeLabel = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

export const discoverScheduleFiles = async (
  pageUrl = YGK_SCHEDULE_PAGE_URL,
): Promise<DiscoveredScheduleFile[]> => {
  const response = await fetch(pageUrl, {
    headers: { 'user-agent': 'ygk-schedule-parser/1.0' },
  });
  if (!response.ok)
    throw new Error(`Failed to load schedule page: HTTP ${response.status}`);

  const html = await response.text();
  const page = new URL(pageUrl);
  const $ = cheerio.load(html);
  const baseScheduleHeading = $('article p')
    .filter(
      (_index, element) =>
        normalizeLabel($(element).text()).toLocaleLowerCase('ru-RU') ===
        'расписание',
    )
    .first();

  if (!baseScheduleHeading.length)
    throw new Error('Failed to find the base schedule section');

  /**
   * На странице ЯГК таблица базового расписания следует сразу за заголовком
   * «Расписание». Поиск только в этой таблице исключает ссылки на практики,
   * экзамены и устаревшие фрагменты HTML.
   */
  const baseScheduleTable = baseScheduleHeading.next('table');
  if (!baseScheduleTable.length)
    throw new Error('Failed to find the base schedule table');

  const result = new Map<string, DiscoveredScheduleFile>();

  baseScheduleTable.find('a[href]').each((_index, anchor) => {
    const href = $(anchor).attr('href');
    if (!href) return;

    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return;
    }

    if (
      url.origin !== page.origin ||
      !url.pathname.toLowerCase().endsWith('.xlsx')
    )
      return;

    url.hash = '';
    const fileName = decodeURIComponent(
      url.pathname.split('/').pop() ?? 'schedule.xlsx',
    );
    result.set(url.toString(), {
      url: url.toString(),
      fileName,
      label: normalizeLabel($(anchor).text()),
    });
  });

  if (!result.size)
    throw new Error('The base schedule table contains no XLSX links');

  return [...result.values()];
};
