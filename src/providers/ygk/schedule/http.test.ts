import { describe, expect, it, vi } from 'vitest';
import { fetchYgkResource } from './http.ts';

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

describe('YGK HTTP requests', () => {
  it('retries a temporary HTTP failure and returns the next successful response', async () => {
    let calls = 0;
    await withFetch(
      () => {
        calls += 1;
        return Promise.resolve(
          new Response(calls === 1 ? 'temporary' : 'ok', {
            status: calls === 1 ? 503 : 200,
          }),
        );
      },
      async () => {
        const response = await fetchYgkResource(
          'https://ygk.example/schedule.xlsx',
          {},
          { retryDelayMs: 0 },
        );
        expect(response.status).toBe(200);
      },
    );
    expect(calls).toBe(2);
  });

  it('does not retry a permanent client error', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    await withFetch(fetchMock, async () => {
      const response = await fetchYgkResource(
        'https://ygk.example/missing.xlsx',
        {},
        { retryDelayMs: 0 },
      );
      expect(response.status).toBe(404);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network error', async () => {
    let calls = 0;
    await withFetch(
      () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new TypeError('Network error'));
        return Promise.resolve(new Response('ok', { status: 200 }));
      },
      async () => {
        await expect(
          fetchYgkResource(
            'https://ygk.example/schedule.xlsx',
            {},
            { retryDelayMs: 0 },
          ),
        ).resolves.toMatchObject({ status: 200 });
      },
    );
    expect(calls).toBe(2);
  });

  it('aborts a request that exceeds its timeout', async () => {
    await withFetch(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          signal?.addEventListener(
            'abort',
            () => reject(new Error('Request aborted')),
            {
              once: true,
            },
          );
        }),
      async () => {
        await expect(
          fetchYgkResource(
            'https://ygk.example/schedule.xlsx',
            {},
            { timeoutMs: 1, maxAttempts: 1 },
          ),
        ).rejects.toBeDefined();
      },
    );
  });
});
