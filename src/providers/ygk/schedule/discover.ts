import { YGK_SCHEDULE_PAGE_URL } from '../constants.ts';

export interface DiscoveredScheduleFile {
  url: string;
  fileName: string;
  label: string;
}

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');

const stripTags = (value: string): string =>
  decodeHtml(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

export const discoverScheduleFiles = async (
  pageUrl = YGK_SCHEDULE_PAGE_URL,
): Promise<DiscoveredScheduleFile[]> => {
  const response = await fetch(pageUrl, {
    headers: { 'user-agent': 'ygk-schedule-parser/1.0' },
  });
  if (!response.ok)
    throw new Error(`Failed to load schedule page: HTTP ${response.status}`);
  const html = await response.text();
  const result = new Map<string, DiscoveredScheduleFile>();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(html))) {
    const hrefMatch = /href\s*=\s*("([^"]+)"|'([^']+)')/i.exec(match[1] ?? '');
    const href = decodeHtml(hrefMatch?.[2] ?? hrefMatch?.[3] ?? '');
    if (!href || !/\.xlsx(?:[?#]|$)/i.test(href)) continue;
    const url = new URL(href, pageUrl);
    url.hash = '';
    const fileName = decodeURIComponent(
      url.pathname.split('/').pop() ?? 'schedule.xlsx',
    );
    result.set(url.toString(), {
      url: url.toString(),
      fileName,
      label: stripTags(match[2] ?? ''),
    });
  }

  return [...result.values()];
};
