import {
  getDiagnosticIssueFamilyKeyFromBody,
  getDiagnosticIssueKeyFromBody,
  getDiagnosticIssueLifecycleFromBody,
  getDiagnosticIssueObservationKeysFromBody,
  SCHEDULE_DIAGNOSTIC_LABEL,
  type DiagnosticIssueDraft,
  type DiagnosticsScope,
} from '../diagnostics/issues.ts';

const API_VERSION = '2022-11-28';
const ISSUES_PER_PAGE = 100;

const scheduleDiagnosticLabel = {
  name: SCHEDULE_DIAGNOSTIC_LABEL,
  color: '0969da',
  description: 'Автоматически создано парсером расписания',
};

export interface ManagedDiagnosticIssue {
  number: number;
  key: string;
  familyKey: string | null;
  scope: DiagnosticsScope | null;
  lifecycle: 'persistent' | 'dated';
  observedDate?: string;
  observationKeys: string[];
  title: string;
  body: string;
  labels: string[];
}

export interface DiagnosticIssuesClient {
  listOpenManagedIssues(): Promise<ManagedDiagnosticIssue[]>;
  listClosedManagedIssues(): Promise<ManagedDiagnosticIssue[]>;
  createIssue(issue: DiagnosticIssueDraft): Promise<void>;
  updateIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body' | 'labels'>,
  ): Promise<void>;
  reopenIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body' | 'labels'>,
  ): Promise<void>;
  addComment(number: number, body: string): Promise<void>;
  closeIssue(number: number): Promise<void>;
}

export interface DiagnosticIssuesSyncResult {
  created: number;
  updated: number;
  reopened: number;
  commented: number;
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
  /**
   * Позволяет дополнить черновик контекстом существующей Issue до сравнения.
   * Например, сохранить ссылку на уже опубликованный immutable data commit,
   * если сама диагностика не изменилась.
   */
  prepareDraft?: (
    draft: DiagnosticIssueDraft,
    existing: ManagedDiagnosticIssue | undefined,
  ) => DiagnosticIssueDraft;
  /**
   * Ограничивает автоматическое закрытие scopes, отчёты которых действительно
   * были загружены этим запуском. Пустой report scope всё равно считается
   * обработанным.
   */
  scopes?: readonly DiagnosticsScope[];
  /**
   * Дата запуска по Москве. Нужна, чтобы исторические Issue замен закрывались
   * с архивной формулировкой, а не как будто источник был исправлен.
   */
  currentDate?: string;
}

interface RepositoryIssueResponse {
  number: number;
  title: string;
  body: string | null;
  labels: unknown[];
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
    (typeof issue.body === 'string' || issue.body === null) &&
    Array.isArray(issue.labels)
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

/**
 * Возвращает последнюю закрытую Issue для каждого ключа. Ранние версии
 * workflow успели создать закрытые дубли до появления family key, поэтому
 * такая история не должна блокировать новую выгрузку. Больший номер GitHub
 * Issue однозначно означает более позднее создание.
 */
const buildLatestClosedIssueMap = (
  issues: readonly ManagedDiagnosticIssue[],
): Map<string, ManagedDiagnosticIssue> => {
  const result = new Map<string, ManagedDiagnosticIssue>();
  for (const issue of issues) {
    const current = result.get(issue.key);
    if (!current || issue.number > current.number) result.set(issue.key, issue);
  }
  return result;
};

const buildIssueFamilyMap = (
  issues: readonly ManagedDiagnosticIssue[],
): Map<string, ManagedDiagnosticIssue> => {
  const duplicates = new Set<string>();
  const result = new Map<string, ManagedDiagnosticIssue>();
  for (const issue of issues) {
    if (!issue.familyKey || duplicates.has(issue.familyKey)) continue;
    if (result.has(issue.familyKey)) {
      result.delete(issue.familyKey);
      duplicates.add(issue.familyKey);
    } else result.set(issue.familyKey, issue);
  }
  return result;
};

const isSameIssue = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): boolean =>
  existing.title === next.title &&
  existing.body === next.body &&
  existing.labels.length === next.labels.length &&
  existing.labels.every((label, index) => label === next.labels[index]);

const labelNames = (labels: readonly unknown[]): string[] =>
  labels
    .flatMap((label) =>
      label &&
      typeof label === 'object' &&
      typeof (label as Record<string, unknown>).name === 'string'
        ? [(label as { name: string }).name]
        : [],
    )
    .sort((left, right) => left.localeCompare(right));

const issueScope = (labels: readonly string[]): DiagnosticsScope | null => {
  const scope = labels.find((label) => label.startsWith('scope:'))?.slice(6);
  return scope === 'base' || scope === 'replacements' || scope === 'actual'
    ? scope
    : null;
};

const isManagedDiagnosticLabel = (label: string): boolean =>
  label === SCHEDULE_DIAGNOSTIC_LABEL ||
  ['diagnostic:', 'reason:', 'shift:', 'scope:', 'area:'].some((prefix) =>
    label.startsWith(prefix),
  );

/**
 * Сохраняет labels, добавленные вручную, и пересобирает только служебные
 * labels diagnostics. Автоматический workflow не должен стирать ручную
 * классификацию Issue.
 */
const mergedIssueLabels = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): string[] =>
  [
    ...new Set([
      ...next.labels,
      ...existing.labels.filter((label) => !isManagedDiagnosticLabel(label)),
    ]),
  ].sort((left, right) => left.localeCompare(right));

const tableValue = (body: string, field: string): string =>
  body.match(new RegExp(`^\\| ${field} \\| (.+) \\|$`, 'mu'))?.[1] ?? '—';

const observationDelta = (
  previous: readonly string[],
  next: readonly string[],
): { added: number; removed: number; unchanged: number } => {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((key) => !previousSet.has(key)).length,
    removed: [...previousSet].filter((key) => !nextSet.has(key)).length,
    unchanged: [...nextSet].filter((key) => previousSet.has(key)).length,
  };
};

const hasObservationChanges = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): boolean =>
  existing.observationKeys.length > 0 &&
  JSON.stringify(existing.observationKeys) !==
    JSON.stringify(
      [...next.observationKeys].sort((left, right) =>
        left.localeCompare(right),
      ),
    );

const issueDataReferences = (
  body: string,
): {
  dataRevision: string;
  diagnostics: string;
  evidence: string;
} => ({
  dataRevision: tableValue(body, 'Ревизия data'),
  diagnostics: tableValue(body, 'Diagnostics YAML'),
  evidence: tableValue(body, 'Evidence YAML'),
});

const formatDataReferences = (prefix: string, body: string): string[] => {
  const references = issueDataReferences(body);
  return [
    `| ${prefix} data | ${references.dataRevision} |`,
    `| ${prefix} diagnostics | ${references.diagnostics} |`,
    `| ${prefix} evidence | ${references.evidence} |`,
  ];
};

const sourceSha256 = (body: string): string | undefined => {
  const value = tableValue(body, 'SHA-256');
  const sha256 = value.match(/[a-f0-9]{64}/iu)?.[0];
  return sha256?.toLocaleLowerCase('en-US');
};

const hasSourceChange = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): boolean => {
  const previousSha256 = sourceSha256(existing.body);
  const nextSha256 = sourceSha256(next.body);
  return Boolean(previousSha256 && nextSha256 && previousSha256 !== nextSha256);
};

const sourceChangeRows = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): string[] => [
  `| SHA-256 было | ${tableValue(existing.body, 'SHA-256')} |`,
  `| SHA-256 стало | ${tableValue(next.body, 'SHA-256')} |`,
  `| Изменён на сайте было | ${tableValue(existing.body, 'Изменён на сайте')} |`,
  `| Изменён на сайте стало | ${tableValue(next.body, 'Изменён на сайте')} |`,
];

/**
 * История не перезаписывается в теле Issue: при изменении набора строк
 * отдельный комментарий фиксирует дельту и обе immutable ревизии data.
 */
const formatUpdateComment = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): string => {
  const delta = observationDelta(
    existing.observationKeys,
    next.observationKeys,
  );
  const observationsChanged = hasObservationChanges(existing, next);
  const sourceChanged = hasSourceChange(existing, next);
  return `## Автоматическое обновление

${observationsChanged ? 'Изменился состав наблюдаемых diagnostics.' : ''}
${sourceChanged ? 'Изменилось содержимое исходного файла, связанное с этой диагностикой.' : ''}

${
  observationsChanged
    ? `| Показатель | Строк |
| --- | ---: |
| Добавлено | ${delta.added} |
| Перестало наблюдаться | ${delta.removed} |
| Осталось | ${delta.unchanged} |`
    : ''
}

${
  sourceChanged
    ? `## Источник

| Показатель | Значение |
| --- | --- |
${sourceChangeRows(existing, next).join('\n')}`
    : ''
}

## Ссылки на снимки

| Поле | Значение |
| --- | --- |
${formatDataReferences('Предыдущие', existing.body).join('\n')}
${formatDataReferences('Актуальные', next.body).join('\n')}
`;
};

const formatCloseComment = (
  issue: ManagedDiagnosticIssue,
  currentDate: string | undefined,
): string => {
  const archive =
    issue.lifecycle === 'dated' &&
    issue.observedDate &&
    currentDate &&
    issue.observedDate < currentDate;
  const message = archive
    ? `Дата замен ${issue.observedDate} уже завершилась, поэтому Issue закрыта как архивная. Она больше не влияет на актуальное расписание.`
    : 'Проблема больше не наблюдается в актуальной выгрузке.';
  return `## Автоматическое закрытие

${message}

Это не подтверждает исправление первоисточника: исчезновение может быть
вызвано обновлением файла, замен или parser-а.

## Последний зафиксированный снимок

| Поле | Значение |
| --- | --- |
${formatDataReferences('Последние', issue.body).join('\n')}
`;
};

const formatReopenComment = (
  existing: ManagedDiagnosticIssue,
  next: DiagnosticIssueDraft,
): string => `## Автоматическое переоткрытие

Проблема снова наблюдается в актуальной выгрузке.

## Ссылки на снимки

| Поле | Значение |
| --- | --- |
${formatDataReferences('Предыдущие', existing.body).join('\n')}
${formatDataReferences('Актуальные', next.body).join('\n')}
`;

const canCloseIssue = (
  issue: ManagedDiagnosticIssue,
  scopes: ReadonlySet<DiagnosticsScope> | undefined,
): boolean => !scopes || (issue.scope !== null && scopes.has(issue.scope));

const diagnosticLabelDefinition = (
  label: string,
): { name: string; color: string; description: string } => {
  if (label === SCHEDULE_DIAGNOSTIC_LABEL) return scheduleDiagnosticLabel;
  if (label.startsWith('diagnostic:'))
    return {
      name: label,
      color: '0969da',
      description: 'Код или уровень диагностического сообщения расписания',
    };
  if (label.startsWith('reason:'))
    return {
      name: label,
      color: 'd4a72c',
      description: 'Причина, по которой изменение расписания не применено',
    };
  if (label.startsWith('shift:'))
    return {
      name: label,
      color: '8250df',
      description: 'Смена страницы замен',
    };
  if (label.startsWith('scope:'))
    return {
      name: label,
      color: '0969da',
      description: 'Поток generated data, в котором обнаружена проблема',
    };
  if (label.startsWith('area:'))
    return {
      name: label,
      color: '1f883d',
      description: 'Подсистема parser-а, сформировавшая diagnostics',
    };
  return {
    name: label,
    color: '6e7781',
    description: 'Автоматически создано парсером расписания',
  };
};

/**
 * Синхронизирует с GitHub только Issue с маркером parser.
 *
 * Открытая Issue обновляется сначала по точному ключу, затем по ключу семьи.
 * Закрытая Issue при повторном появлении переоткрывается. Вручную созданные
 * Issue без служебного маркера остаются без изменений.
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
    reopened: 0,
    commented: 0,
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
  const canWrite = (count = 1): boolean =>
    options.maxWriteOperations === undefined ||
    writeOperations + count <= options.maxWriteOperations;

  let openIssues: ManagedDiagnosticIssue[];
  try {
    openIssues = await client.listOpenManagedIssues();
  } catch (error) {
    if (error instanceof GitHubRateLimitError) return deferForRateLimit(error);
    throw error;
  }
  const openByKey = buildIssueMap(openIssues, 'open managed Issue');
  const openByFamily = buildIssueFamilyMap(openIssues);
  const draftWithoutOpenIssue = drafts.some(
    (draft) => !openByKey.has(draft.key) && !openByFamily.has(draft.familyKey),
  );
  let closedByKey = new Map<string, ManagedDiagnosticIssue>();
  let closedByFamily = new Map<string, ManagedDiagnosticIssue>();
  if (draftWithoutOpenIssue) {
    try {
      const closedIssues = await client.listClosedManagedIssues();
      closedByKey = buildLatestClosedIssueMap(closedIssues);
      closedByFamily = buildIssueFamilyMap(closedIssues);
    } catch (error) {
      if (error instanceof GitHubRateLimitError)
        return deferForRateLimit(error);
      throw error;
    }
  }
  const handledOpenIssueNumbers = new Set<number>();

  for (const draft of drafts) {
    const existing =
      openByKey.get(draft.key) ?? openByFamily.get(draft.familyKey);
    const prepared = options.prepareDraft?.(draft, existing) ?? draft;
    const next = existing
      ? { ...prepared, labels: mergedIssueLabels(existing, prepared) }
      : prepared;

    try {
      if (existing) {
        handledOpenIssueNumbers.add(existing.number);
        if (isSameIssue(existing, next)) {
          result.unchanged += 1;
          continue;
        }
        const comment =
          hasObservationChanges(existing, next) ||
          hasSourceChange(existing, next)
            ? formatUpdateComment(existing, next)
            : undefined;
        if (!canWrite(comment ? 2 : 1)) return deferForWriteLimit();
        await client.updateIssue(existing.number, next);
        writeOperations += 1;
        result.updated += 1;
        if (comment) {
          await client.addComment(existing.number, comment);
          writeOperations += 1;
          result.commented += 1;
        }
      } else {
        const closed =
          closedByKey.get(draft.key) ?? closedByFamily.get(draft.familyKey);
        if (closed) {
          const reopened = {
            ...prepared,
            labels: mergedIssueLabels(closed, prepared),
          };
          if (!canWrite(2)) return deferForWriteLimit();
          await client.reopenIssue(closed.number, reopened);
          writeOperations += 1;
          result.reopened += 1;
          await client.addComment(
            closed.number,
            formatReopenComment(closed, reopened),
          );
          writeOperations += 1;
          result.commented += 1;
        } else {
          if (!canWrite()) return deferForWriteLimit();
          await client.createIssue(next);
          writeOperations += 1;
          result.created += 1;
        }
      }
    } catch (error) {
      if (error instanceof GitHubRateLimitError)
        return deferForRateLimit(error);
      throw error;
    }
  }

  // Закрываем только после успешного создания и обновления актуальных Issue.
  // Scope без загруженного report намеренно не трогаем.
  const scopes = options.scopes ? new Set(options.scopes) : undefined;
  for (const issue of openIssues) {
    if (
      handledOpenIssueNumbers.has(issue.number) ||
      desiredByKey.has(issue.key) ||
      !canCloseIssue(issue, scopes)
    )
      continue;
    if (!canWrite(2)) return deferForWriteLimit();
    try {
      await client.addComment(
        issue.number,
        formatCloseComment(issue, options.currentDate),
      );
      writeOperations += 1;
      result.commented += 1;
      await client.closeIssue(issue.number);
      writeOperations += 1;
      result.closed += 1;
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
  private readonly ensuredLabels = new Set<string>();

  public constructor(options: GitHubDiagnosticIssuesClientOptions) {
    const { owner, name } = parseRepository(options.repository);
    this.baseUrl = `https://api.github.com/repos/${owner}/${name}/issues`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.token = options.token;
  }

  private readonly token: string;

  private async listManagedIssues(
    state: 'open' | 'closed',
  ): Promise<ManagedDiagnosticIssue[]> {
    const issues: ManagedDiagnosticIssue[] = [];

    for (let page = 1; ; page += 1) {
      const response = await this.request(
        `${this.baseUrl}?state=${state}&per_page=${ISSUES_PER_PAGE}&page=${page}`,
      );
      const payload: unknown = await response.json();
      if (!Array.isArray(payload) || !payload.every(isRepositoryIssueResponse))
        throw new Error('GitHub returned an invalid issue list');

      for (const issue of payload) {
        if (issue.pull_request) continue;
        const key = getDiagnosticIssueKeyFromBody(issue.body);
        if (!key) continue;
        const body = issue.body ?? '';
        const lifecycle = getDiagnosticIssueLifecycleFromBody(body);
        const labels = labelNames(issue.labels);
        issues.push({
          number: issue.number,
          key,
          familyKey: getDiagnosticIssueFamilyKeyFromBody(body),
          scope: issueScope(labels),
          lifecycle: lifecycle.lifecycle,
          ...(lifecycle.observedDate
            ? { observedDate: lifecycle.observedDate }
            : {}),
          observationKeys: getDiagnosticIssueObservationKeysFromBody(body),
          title: issue.title,
          body,
          labels,
        });
      }

      if (payload.length < ISSUES_PER_PAGE) return issues;
    }
  }

  public async listOpenManagedIssues(): Promise<ManagedDiagnosticIssue[]> {
    return this.listManagedIssues('open');
  }

  public async listClosedManagedIssues(): Promise<ManagedDiagnosticIssue[]> {
    return this.listManagedIssues('closed');
  }

  public async createIssue(issue: DiagnosticIssueDraft): Promise<void> {
    await this.ensureDiagnosticLabels(issue.labels);
    await this.request(this.baseUrl, {
      method: 'POST',
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
    });
  }

  public async updateIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body' | 'labels'>,
  ): Promise<void> {
    await this.ensureDiagnosticLabels(issue.labels);
    await this.request(`${this.baseUrl}/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
    });
  }

  public async reopenIssue(
    number: number,
    issue: Pick<DiagnosticIssueDraft, 'title' | 'body' | 'labels'>,
  ): Promise<void> {
    await this.ensureDiagnosticLabels(issue.labels);
    await this.request(`${this.baseUrl}/${number}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        state: 'open',
      }),
    });
  }

  public async addComment(number: number, body: string): Promise<void> {
    await this.request(`${this.baseUrl}/${number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
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
  private async ensureDiagnosticLabel(label: string): Promise<void> {
    if (this.ensuredLabels.has(label)) return;
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/issues$/, '')}/labels/${label}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': API_VERSION,
        },
      },
    );
    if (response.ok) {
      this.ensuredLabels.add(label);
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
        `GitHub API GET label ${label} failed: HTTP ${response.status}${body ? ` ${body}` : ''}`,
      );
    }

    await this.request(`${this.baseUrl.replace(/\/issues$/, '')}/labels`, {
      method: 'POST',
      body: JSON.stringify(diagnosticLabelDefinition(label)),
    });
    this.ensuredLabels.add(label);
  }

  private async ensureDiagnosticLabels(
    labels: readonly string[],
  ): Promise<void> {
    for (const label of labels) await this.ensureDiagnosticLabel(label);
  }
}
