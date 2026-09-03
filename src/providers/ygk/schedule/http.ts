const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

export interface YgkRequestOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

const isPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500;

const waitForRetry = async (milliseconds: number): Promise<void> => {
  if (milliseconds === 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const getRequestSignal = (
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
};

/**
 * Загружает ресурс ЯГК с ограничением времени и повторными попытками.
 *
 * Повторяются временные HTTP-ошибки и ошибки сети. Остальные ошибки клиента
 * возвращаются сразу, чтобы не создавать лишнюю нагрузку на сайт.
 */
export const fetchYgkResource = async (
  url: string,
  init: RequestInit,
  options: YgkRequestOptions = {},
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  if (
    !isPositiveInteger(timeoutMs) ||
    !isPositiveInteger(maxAttempts) ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0
  )
    throw new Error('Invalid YGK request retry options');

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: getRequestSignal(init.signal, timeoutMs),
      });
      if (!isRetryableStatus(response.status) || attempt === maxAttempts)
        return response;
    } catch (error) {
      if (attempt === maxAttempts || init.signal?.aborted) throw error;
    }

    await waitForRetry(retryDelayMs * 2 ** (attempt - 1));
  }

  throw new Error('YGK request retry loop unexpectedly completed');
};
