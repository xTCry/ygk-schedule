import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../../../utils/hash.ts';
import { discoverScheduleFiles } from './discover.ts';
import { downloadScheduleFile } from './download.ts';

const withFetch = async (
  handler: unknown,
  run: () => Promise<void>,
): Promise<void> => {
  vi.stubGlobal('fetch', handler);
  try {
    await run();
  } finally {
    vi.unstubAllGlobals();
  }
};

describe('YGK source discovery and download', () => {
  it('extracts and deduplicates XLSX links', async () => {
    const html = `
      <a href="/pages/rasp/26-27/so.xlsx">СО 1 сем</a>
      <a href="/pages/rasp/26-27/so.xlsx#x">Дубль</a>
      <a href="files/oit.xlsx?download=1">ОИТ &amp; тест</a>
      <a href="file.pdf">PDF</a>
    `;
    await withFetch(
      () => Promise.resolve(new Response(html, { status: 200 })),
      async () => {
        await expect(
          discoverScheduleFiles('https://ygk.example/raspisanie.html'),
        ).resolves.toEqual([
          {
            url: 'https://ygk.example/pages/rasp/26-27/so.xlsx',
            fileName: 'so.xlsx',
            label: 'Дубль',
          },
          {
            url: 'https://ygk.example/files/oit.xlsx?download=1',
            fileName: 'oit.xlsx',
            label: 'ОИТ & тест',
          },
        ]);
      },
    );
  });

  it('rejects failed discovery requests', async () => {
    await withFetch(
      () => Promise.resolve(new Response('fail', { status: 503 })),
      async () => {
        await expect(
          discoverScheduleFiles('https://ygk.example/raspisanie.html'),
        ).rejects.toThrow(/HTTP 503/);
      },
    );
  });

  it('validates the ZIP signature and returns metadata', async () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
    const headers = new Headers({
      etag: 'abc',
      'last-modified': 'Wed, 02 Sep 2026 10:00:00 GMT',
    });
    await withFetch(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          url: 'https://ygk.example/files/so.xlsx',
          headers,
          arrayBuffer: () =>
            Promise.resolve(
              buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
              ),
            ),
        }),
      async () => {
        await expect(
          downloadScheduleFile('https://ygk.example/source.xlsx'),
        ).resolves.toMatchObject({
          fileName: 'so.xlsx',
          sha256: sha256(buffer),
          url: 'https://ygk.example/files/so.xlsx',
          etag: 'abc',
          lastModified: 'Wed, 02 Sep 2026 10:00:00 GMT',
          buffer,
        });
      },
    );
  });

  it('rejects non-XLSX responses', async () => {
    await withFetch(
      () =>
        Promise.resolve({
          ok: true,
          status: 200,
          url: 'https://ygk.example/file.xlsx',
          headers: new Headers(),
          arrayBuffer: () =>
            Promise.resolve(Uint8Array.from([1, 2, 3, 4]).buffer),
        }),
      async () => {
        await expect(
          downloadScheduleFile('https://ygk.example/file.xlsx'),
        ).rejects.toThrow(/not a ZIP\/XLSX/);
      },
    );
  });
});
