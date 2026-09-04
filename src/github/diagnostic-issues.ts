import {
  getDiagnosticIssueKeyFromBody,
  type DiagnosticIssueDraft,
} from '../diagnostics/issues.ts';

const API_VERSION = '2022-11-28';
const ISSUES_PER_PAGE = 100;
export const SCHEDULE_DIAGNOSTIC_LABEL = 'schedule-diagnostic';

const scheduleDiagnosticLabel = {
  name: SCHEDULE_DIAGNOSTIC_LABEL,
  color: '0969da',
  description: 'Автоматически создано парсером расписания',
};

export interface ManagedDiagnosticIssue {
  number: number;
  key: string;
  title: string;
  body: string;
}

export interface DiagnosticIssuesClient {
  listOpenManagedIssues(): Promise<ManagedDiagnosticIssue[]>;
  createIssue(issue: DiagnosticIssueDraft): Promise<void>;
  updateIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body'>,
  ): Promise<void>;
  closeIssue(number: number): Promise<void>;
}

export interface DiagnosticIssuesSyncResult {
  created: number;
  updated: number;
  closed: number;
  unchanged: number;
  deferred?: {
    reason: 'rate-limit' | 'write-limit';
    retryAfterSeconds?: number;
  };
}

export interface SyncDiagnosticIssuesOptions {
  /**
   * Ограничивает число изменяющих запросов за один запуск. Это позволяет
   * постепенно создать большой набор Issue без ожиданий внутри workflow.
   */
  maxWriteOperations?: number;
}

interface RepositoryIssueResponse {
  number: number;
  title: string;
  body: string | null;
  pull_request?: unknown;
}

export interface GitHubDiagnosticIssuesClientOptions {
  repository: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class GitHubRateLimitError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`GitHub API rate limit: HTTP ${status}`);
    this.name = 'GitHubRateLimitError';
  }
}

const isRepositoryIssueResponse = (
  value: unknown,
): value is RepositoryIssueResponse => {
  if (!value || typeof value !== 'object') return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue.number === 'number' &&
    typeof issue.title === 'string' &&
    (typeof issue.body === 'string' || issue.body === null)
  );
};

const parseRepository = (
  repository: string,
): { owner: string; name: string } => {
  const [owner, name, ...rest] = repository.split('/');
  if (!owner || !name || rest.length > 0)
    throw new Error('Repository must have the form owner/name');
  return { owner, name };
};

const buildIssueMap = <T extends { key: string }>(
  issues: readonly T[],
  description: string,
): Map<string, T> => {
  const result = new Map<string, T>();
  for (const issue of issues) {
    if (result.has(issue.key))
      throw new Error(`Duplicate ${description} for key ${issue.key}`);
    result.set(issue.key, issue);
  }
  return result;
};

const isSameIssue = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): boolean => existing.title === next.title && existing.body === next.body;

/**
 * Синхронизирует с GitHub только открытые Issue с маркером parser.
 *
 * Отсутствующая в актуальном отчете диагностическая Issue закрывается, а
 * вручную созданные Issue без служебного маркера остаются без изменений.
 */
export const syncDiagnosticIssues = async (
  drafts: readonly DiagnosticIssueDraft[],
  client: DiagnosticIssuesClient,
  options: SyncDiagnosticIssuesOptions = {},
): Promise<DiagnosticIssuesSyncResult> => {
  const desiredByKey = buildIssueMap(drafts, 'diagnostic Issue draft');
  const result: DiagnosticIssuesSyncResult = {
    created: 0,
    updated: 0,
    closed: 0,
    unchanged: 0,
  };
  let writeOperations = 0;
  const deferForWriteLimit = (): DiagnosticIssuesSyncResult => ({
    ...result,
    deferred: { reason: 'write-limit' },
  });
  const deferForRateLimit = (
    error: GitHubRateLimitError,
  ): DiagnosticIssuesSyncResult => ({
    ...result,
    deferred: {
      reason: 'rate-limit',
      ...(error.retryAfterSeconds
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    },
  });
  const canWrite = (): boolean =>
    options.maxWriteOperations === undefined ||
    writeOperations < options.maxWriteOperations;

  let existingByKey: Map<string, ManagedDiagnosticIssue>;
  try {
    existingByKey = buildIssueMap(
      await client.listOpenManagedIssues(),
      'open managed Issue',
    );
  } catch (error) {
    if (error instanceof GitHubRateLimitError) return deferForRateLimit(error);
    throw error;
  }

  for (const draft of drafts) {
    const existing = existingByKey.get(draft.key);
    if (existing && isSameIssue(existing, draft)) {
      result.unchanged += 1;
      continue;
    }
    if (!canWrite()) return deferForWriteLimit();

    try {
      if (existing) {
        await client.updateIssue(existing.number, draft);
        result.updated += 1;
      } else {
        await client.createIssue(draft);
        result.created += 1;
      }
      writeOperations += 1;
    } catch (error) {
      if (error instanceof GitHubRateLimitError)
        return deferForRateLimit(error);
      throw error;
    }
  }

  // Закрываем только после успешного создания и обновления актуальных Issue.
  for (const issue of existingByKey.values()) {
    if (desiredByKey.has(issue.key)) continue;
    if (!canWrite()) return deferForWriteLimit();
    try {
      await client.closeIssue(issue.number);
      result.closed += 1;
      writeOperations += 1;
    } catch (error) {
      if (error instanceof GitHubRateLimitError)
        return deferForRateLimit(error);
      throw error;
    }
  }

  return result;
};

/**
 * Клиент GitHub REST API для Issue, созданных parser-ом расписания.
 */
export class GitHubDiagnosticIssuesClient implements DiagnosticIssuesClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private diagnosticLabelReady = false;

  public constructor(options: GitHubDiagnosticIssuesClientOptions) {
    const { owner, name } = parseRepository(options.repository);
    this.baseUrl = `https://api.github.com/repos/${owner}/${name}/issues`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
  }

  private readonly token: string;

  public async listOpenManagedIssues(): Promise<ManagedDiagnosticIssue[]> {
    const issues: ManagedDiagnosticIssue[] = [];

    for (let page = 1; ; page += 1) {
      const response = await this.request(
        `${this.baseUrl}?state=open&per_page=${ISSUES_PER_PAGE}&page=${page}`,
      );
      const payload: unknown = await response.json();
      if (!Array.isArray(payload) || !payload.every(isRepositoryIssueResponse))
        throw new Error('GitHub returned an invalid issue list');

      for (const issue of payload) {
        if (issue.pull_request) continue;
        const key = getDiagnosticIssueKeyFromBody(issue.body);
        if (!key) continue;
        issues.push({
          number: issue.number,
          key,
          title: issue.title,
          body: issue.body ?? '',
        });
      }

      if (payload.length < ISSUES_PER_PAGE) return issues;
    }
  }

  public async createIssue(issue: DiagnosticIssueDraft): Promise<void> {
    await this.ensureDiagnosticLabel();
    await this.request(this.baseUrl, {
      method: 'POST',
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: [SCHEDULE_DIAGNOSTIC_LABEL],
      }),
    });
  }

  public async updateIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body'>,
  ): Promise<void> {
    await this.request(`${this.baseUrl}/${number}`, {
      method: 'PATCH',
      body: JSON.stringify(issue),
    });
  }

  public async closeIssue(number: number): Promise<void> {
    await this.request(`${this.baseUrl}/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
  }

  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const response = await this.fetchImpl(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': API_VERSION,
        ...options.headers,
      },
    });
    if (response.ok) return response;

    const body = await response.text();
    if (
      response.status === 429 ||
      (response.status === 403 && /rate limit/iu.test(body))
    ) {
      const retryAfter = Number.parseInt(
        response.headers.get('retry-after') ?? '',
        10,
      );
      throw new GitHubRateLimitError(
        response.status,
        Number.isSafeInteger(retryAfter) && retryAfter > 0
          ? retryAfter
          : undefined,
      );
    }
    throw new Error(
      `GitHub API ${options.method ?? 'GET'} ${url} failed: HTTP ${response.status}${body ? ` ${body}` : ''}`,
    );
  }

  /**
   * Создает label один раз, чтобы новая диагностическая Issue была заметна в
   * общем списке. Уже существующий label не изменяется.
   */
  private async ensureDiagnosticLabel(): Promise<void> {
    if (this.diagnosticLabelReady) return;

    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/issues$/, '')}/labels/${SCHEDULE_DIAGNOSTIC_LABEL}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
        },
      },
    );
    if (response.ok) {
      this.diagnosticLabelReady = true;
      return;
    }
    if (response.status !== 404) {
      const body = await response.text();
      if (
        response.status === 429 ||
        (response.status === 403 && /rate limit/iu.test(body))
      ) {
        const retryAfter = Number.parseInt(
          response.headers.get('retry-after') ?? '',
          10,
        );
        throw new GitHubRateLimitError(
          response.status,
          Number.isSafeInteger(retryAfter) && retryAfter > 0
            ? retryAfter
            : undefined,
        );
      }
      throw new Error(
        `GitHub API GET label ${SCHEDULE_DIAGNOSTIC_LABEL} failed: HTTP ${response.status}${body ? ` ${body}` : ''}`,
      );
    }

    await this.request(`${this.baseUrl.replace(/\/issues$/, '')}/labels`, {
      method: 'POST',
      body: JSON.stringify(scheduleDiagnosticLabel),
    });
    this.diagnosticLabelReady = true;
  }
}
