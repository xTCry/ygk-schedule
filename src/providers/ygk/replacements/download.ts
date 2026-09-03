import { basename } from 'node:path';
import type {
  ReplacementPageSource,
  ReplacementShift,
} from '../../../types.ts';
import { sha256 } from '../../../utils/hash.ts';
import { fetchYgkResource } from '../schedule/http.ts';

export interface DownloadedReplacementPage {
  html: string;
  source: ReplacementPageSource;
}

/**
 * Скачивает одну HTML-страницу замен с общими ограничениями времени и retry.
 */
export const downloadReplacementPage = async (
  url: string,
  shift: ReplacementShift,
): Promise<DownloadedReplacementPage> => {
  let response: Response;
  try {
    response = await fetchYgkResource(url, {
      headers: { 'user-agent': 'ygk-schedule-parser/1.0' },
      redirect: 'follow',
    });
  } catch (error) {
    throw new Error(
      `Failed to download replacement page: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok)
    throw new Error(
      `Failed to download replacement page: HTTP ${response.status}`,
    );

  const html = await response.text();
  const finalUrl = response.url || url;
  const fileName =
    decodeURIComponent(basename(new URL(finalUrl).pathname)) ||
    `rasp_${shift}.html`;
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  return {
    html,
    source: {
      id: finalUrl,
      fileName,
      sha256: sha256(html),
      fetchedAt: new Date().toISOString(),
      url: finalUrl,
      shift,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
    },
  };
};
