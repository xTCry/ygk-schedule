import { basename } from 'node:path';
import { sha256 } from '../../../utils/hash.ts';

export interface DownloadedScheduleFile {
  buffer: Buffer;
  fileName: string;
  sha256: string;
  url: string;
  etag?: string;
  lastModified?: string;
}

export const downloadScheduleFile = async (
  url: string,
): Promise<DownloadedScheduleFile> => {
  const response = await fetch(url, {
    headers: { 'user-agent': 'ygk-schedule-parser/1.0' },
    redirect: 'follow',
  });
  if (!response.ok)
    throw new Error(`Failed to download schedule: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 4 || buffer.readUInt32LE(0) !== 0x04034b50)
    throw new Error('Downloaded file is not a ZIP/XLSX document');
  const finalUrl = response.url || url;
  const fileName =
    decodeURIComponent(basename(new URL(finalUrl).pathname)) || 'schedule.xlsx';
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');

  return {
    buffer,
    fileName,
    sha256: sha256(buffer),
    url: finalUrl,
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
};
