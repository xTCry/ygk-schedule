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
  it('extracts only base schedule XLSX links from the HTML section', async () => {
    const html = `
      <article>
        <p>Расписание звонков</p>
        <table>
          <tr><td><a href="/pages/rasp/26-27/bells.xlsx">Звонки</a></td></tr>
        </table>

        <p><img src="../icons/rasp/rasp.png"><a href="#">Расписание</a></p>
        <table>
          <tr><td><a href="/pages/rasp/26-27/oar_0.xlsx">ОАР 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/oit_1sem.xlsx">ОИТ 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/ort.xlsx">ОРТ 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/out.xlsx">ОУТ 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/oeis.xlsx">ОЭИС 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/so.xlsx">СО 1 сем</a></td></tr>
          <tr><td><a href="/pages/rasp/26-27/so.xlsx#old">СО обновлённое</a></td></tr>
          <tr><td><a href="https://other.example/foreign.xlsx">Чужой файл</a></td></tr>
        </table>

        <p><a href="#">Расписание учебных практик</a></p>
        <table>
          <tr><td><a href="/pages/rasp/26-27/practice.xlsx">Практика</a></td></tr>
        </table>

        <!-- <a href="/pages/rasp/16-17/old.xlsx">Старый файл</a> -->
      </article>
    `;
    await withFetch(
      () => Promise.resolve(new Response(html, { status: 200 })),
      async () => {
        await expect(
          discoverScheduleFiles('https://ygk.example/raspisanie.html'),
        ).resolves.toEqual([
          {
            url: 'https://ygk.example/pages/rasp/26-27/oar_0.xlsx',
            fileName: 'oar_0.xlsx',
            label: 'ОАР 1 сем',
          },
          {
            url: 'https://ygk.example/pages/rasp/26-27/oit_1sem.xlsx',
            fileName: 'oit_1sem.xlsx',
            label: 'ОИТ 1 сем',
          },
          {
            url: 'https://ygk.example/pages/rasp/26-27/ort.xlsx',
            fileName: 'ort.xlsx',
            label: 'ОРТ 1 сем',
          },
          {
            url: 'https://ygk.example/pages/rasp/26-27/out.xlsx',
            fileName: 'out.xlsx',
            label: 'ОУТ 1 сем',
          },
          {
            url: 'https://ygk.example/pages/rasp/26-27/oeis.xlsx',
            fileName: 'oeis.xlsx',
            label: 'ОЭИС 1 сем',
          },
          {
            url: 'https://ygk.example/pages/rasp/26-27/so.xlsx',
            fileName: 'so.xlsx',
            label: 'СО обновлённое',
          },
        ]);
      },
    );
  });

  it('rejects an unexpected base schedule layout', async () => {
    await withFetch(
      () =>
        Promise.resolve(new Response('<article></article>', { status: 200 })),
      async () => {
        await expect(
          discoverScheduleFiles('https://ygk.example/raspisanie.html'),
        ).rejects.toThrow(/base schedule section/);
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
