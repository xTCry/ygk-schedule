import { describe, expect, it, vi } from 'vitest';
import type { DiagnosticIssueDraft } from '../diagnostics/issues.ts';
import {
  GitHubDiagnosticIssuesClient,
  GitHubRateLimitError,
  syncDiagnosticIssues,
  type DiagnosticIssuesClient,
  type ManagedDiagnosticIssue,
} from './diagnostic-issues.ts';

const draft = (key: string, suffix = ''): DiagnosticIssueDraft => ({
  key,
  familyKey: `family-${key}`,
  fingerprint: `fingerprint-${key}`,
  scope: 'base',
  lifecycle: 'persistent',
  title: `Проблема ${key}${suffix}`,
  body: `<!-- parser-issue-key: ${key} -->\nbody${suffix}`,
  labels: ['schedule-diagnostic'],
  occurrenceCount: 1,
  observationKeys: [`observation-${key}`],
});

const managedIssue = (
  key: string,
  number: number,
  suffix = '',
): ManagedDiagnosticIssue => ({
  number,
  key,
  familyKey: `family-${key}`,
  scope: 'base',
  lifecycle: 'persistent',
  observationKeys: [`observation-${key}`],
  title: `Проблема ${key}${suffix}`,
  body: `<!-- parser-issue-key: ${key} -->\nbody${suffix}`,
  labels: ['schedule-diagnostic'],
});

describe('diagnostic Issue synchronization', () => {
  it('creates new issues, updates changed ones and closes resolved ones', async () => {
    const listOpenManagedIssues = vi.fn(() =>
      Promise.resolve([
        managedIssue('changed', 2),
        managedIssue('resolved', 3),
      ]),
    );
    const createIssue = vi.fn(() => Promise.resolve());
    const updateIssue = vi.fn(() => Promise.resolve());
    const addComment = vi.fn(() => Promise.resolve());
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues,
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue,
      updateIssue,
      reopenIssue: () => Promise.resolve(),
      addComment,
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues(
        [draft('new'), draft('changed', ' (обновлено)')],
        client,
      ),
    ).resolves.toEqual({
      created: 1,
      updated: 1,
      reopened: 0,
      commented: 1,
      closed: 1,
      unchanged: 0,
    });
    expect(createIssue).toHaveBeenCalledWith(draft('new'));
    expect(updateIssue).toHaveBeenCalledWith(
      2,
      draft('changed', ' (обновлено)'),
    );
    expect(addComment).toHaveBeenCalledWith(
      3,
      expect.stringContaining('Автоматическое закрытие'),
    );
    expect(closeIssue).toHaveBeenCalledWith(3);
  });

  it('does not update a managed issue when its body is unchanged', async () => {
    const listOpenManagedIssues = vi.fn(() =>
      Promise.resolve([managedIssue('known', 4)]),
    );
    const createIssue = vi.fn(() => Promise.resolve());
    const updateIssue = vi.fn(() => Promise.resolve());
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues,
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue,
      updateIssue,
      reopenIssue: () => Promise.resolve(),
      addComment: () => Promise.resolve(),
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([draft('known')], client),
    ).resolves.toEqual({
      created: 0,
      updated: 0,
      reopened: 0,
      commented: 0,
      closed: 0,
      unchanged: 1,
    });
    expect(createIssue).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
    expect(closeIssue).not.toHaveBeenCalled();
  });

  it('updates an open issue by family key and comments the observation delta', async () => {
    const updateIssue = vi.fn(() => Promise.resolve());
    const addComment = vi.fn(() => Promise.resolve());
    const existing: ManagedDiagnosticIssue = {
      ...managedIssue('old-key', 5),
      familyKey: 'family-shared',
      observationKeys: ['old-observation'],
      body: `<!-- parser-issue-key: old-key -->
<!-- diagnostics-links: old-data -->

## Ревизии и данные

| Поле | Значение |
| --- | --- |
| Ревизия data | [\`old\`](https://example.test/old) |
| Diagnostics JSON | [\`old.json\`](https://example.test/old.json) |
| Evidence JSON | [\`old-evidence.json\`](https://example.test/old-evidence.json) |
`,
    };
    const next: DiagnosticIssueDraft = {
      ...draft('new-key'),
      familyKey: 'family-shared',
      observationKeys: ['new-observation'],
      body: `<!-- parser-issue-key: new-key -->
<!-- diagnostics-links: new-data -->

## Ревизии и данные

| Поле | Значение |
| --- | --- |
| Ревизия data | [\`new\`](https://example.test/new) |
| Diagnostics JSON | [\`new.json\`](https://example.test/new.json) |
| Evidence JSON | [\`new-evidence.json\`](https://example.test/new-evidence.json) |
`,
    };
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () => Promise.resolve([existing]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue: () => Promise.resolve(),
      updateIssue,
      reopenIssue: () => Promise.resolve(),
      addComment,
      closeIssue: () => Promise.resolve(),
    };

    await expect(syncDiagnosticIssues([next], client)).resolves.toEqual({
      created: 0,
      updated: 1,
      reopened: 0,
      commented: 1,
      closed: 0,
      unchanged: 0,
    });
    expect(updateIssue).toHaveBeenCalledWith(5, next);
    expect(addComment).toHaveBeenCalledWith(
      5,
      expect.stringMatching(/Добавлено \| 1/),
    );
    expect(addComment).toHaveBeenCalledWith(
      5,
      expect.stringMatching(/Перестало наблюдаться \| 1/),
    );
  });

  it('reopens a matching closed issue instead of creating another one', async () => {
    const createIssue = vi.fn(() => Promise.resolve());
    const reopenIssue = vi.fn(() => Promise.resolve());
    const addComment = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () => Promise.resolve([]),
      listClosedManagedIssues: () =>
        Promise.resolve([managedIssue('known', 7)]),
      createIssue,
      updateIssue: () => Promise.resolve(),
      reopenIssue,
      addComment,
      closeIssue: () => Promise.resolve(),
    };

    await expect(
      syncDiagnosticIssues([draft('known')], client),
    ).resolves.toEqual({
      created: 0,
      updated: 0,
      reopened: 1,
      commented: 1,
      closed: 0,
      unchanged: 0,
    });
    expect(createIssue).not.toHaveBeenCalled();
    expect(reopenIssue).toHaveBeenCalledWith(7, draft('known'));
    expect(addComment).toHaveBeenCalledWith(
      7,
      expect.stringContaining('Автоматическое переоткрытие'),
    );
  });

  it('archives a past replacement issue without claiming that the source was fixed', async () => {
    const addComment = vi.fn(() => Promise.resolve());
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () =>
        Promise.resolve([
          {
            ...managedIssue('past', 8),
            scope: 'actual',
            lifecycle: 'dated',
            observedDate: '2026-09-05',
          },
        ]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue: () => Promise.resolve(),
      updateIssue: () => Promise.resolve(),
      reopenIssue: () => Promise.resolve(),
      addComment,
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([], client, {
        scopes: ['actual'],
        currentDate: '2026-09-07',
      }),
    ).resolves.toEqual({
      created: 0,
      updated: 0,
      reopened: 0,
      commented: 1,
      closed: 1,
      unchanged: 0,
    });
    expect(addComment).toHaveBeenCalledWith(
      8,
      expect.stringContaining('закрыта как архивная'),
    );
    expect(addComment).toHaveBeenCalledWith(
      8,
      expect.stringContaining('не подтверждает исправление'),
    );
    expect(closeIssue).toHaveBeenCalledWith(8);
  });

  it('does not close issues outside the scopes of loaded diagnostics reports', async () => {
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () =>
        Promise.resolve([{ ...managedIssue('actual', 9), scope: 'actual' }]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue: () => Promise.resolve(),
      updateIssue: () => Promise.resolve(),
      reopenIssue: () => Promise.resolve(),
      addComment: () => Promise.resolve(),
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([], client, { scopes: ['base'] }),
    ).resolves.toEqual({
      created: 0,
      updated: 0,
      reopened: 0,
      commented: 0,
      closed: 0,
      unchanged: 0,
    });
    expect(closeIssue).not.toHaveBeenCalled();
  });

  it('uses the GitHub REST API only for marked issues', async () => {
    const key = 'a'.repeat(64);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              number: 1,
              title: 'manual',
              body: '<!-- parser-fingerprint: fingerprint -->',
              labels: [],
            },
            {
              number: 2,
              title: 'managed',
              body: `<!-- parser-issue-key: ${key} -->`,
              labels: [{ name: 'schedule-diagnostic' }],
            },
          ]),
        ),
      )
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));
    const client = new GitHubDiagnosticIssuesClient({
      repository: 'owner/repository',
      token: 'token',
      fetchImpl: fetchMock,
    });

    await expect(
      syncDiagnosticIssues([draft(key, ' new')], client),
    ).resolves.toEqual({
      created: 0,
      updated: 1,
      reopened: 0,
      commented: 0,
      closed: 0,
      unchanged: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      '/repos/owner/repository/issues?state=open',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/labels/schedule-diagnostic',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/issues/2',
    );
  });

  it('creates and assigns the diagnostic label for a new issue', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response(JSON.stringify([])))
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{}'));
    const client = new GitHubDiagnosticIssuesClient({
      repository: 'owner/repository',
      token: 'token',
      fetchImpl: fetchMock,
    });

    await expect(syncDiagnosticIssues([draft('new')], client)).resolves.toEqual(
      {
        created: 1,
        updated: 0,
        reopened: 0,
        commented: 0,
        closed: 0,
        unchanged: 0,
      },
    );
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      '/repos/owner/repository/issues?state=closed',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/labels/schedule-diagnostic',
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/labels',
    );
    const issueRequest = fetchMock.mock.calls[4]?.[1];
    expect(issueRequest?.method).toBe('POST');
    expect(issueRequest?.body).toBe(
      JSON.stringify({
        title: 'Проблема new',
        body: '<!-- parser-issue-key: new -->\nbody',
        labels: ['schedule-diagnostic'],
      }),
    );
  });

  it('adds diagnostic labels when an existing Issue is updated', async () => {
    const issue = draft('b'.repeat(64));
    issue.labels = [
      'diagnostic:error',
      'diagnostic:unresolved-replacement',
      'reason:original-not-matched',
      'schedule-diagnostic',
      'shift:first',
    ];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              number: 2,
              title: issue.title,
              body: issue.body,
              labels: [{ name: 'schedule-diagnostic' }],
            },
          ]),
        ),
      )
      .mockResolvedValue(new Response('{}'));
    const client = new GitHubDiagnosticIssuesClient({
      repository: 'owner/repository',
      token: 'token',
      fetchImpl: fetchMock,
    });

    await syncDiagnosticIssues([issue], client);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === 'https://api.github.com/repos/owner/repository/issues/2' &&
        options?.method === 'PATCH',
    );
    expect(updateCall?.[1]?.body).toBe(
      JSON.stringify({
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
      }),
    );
  });

  it('preserves manually added labels when synchronizing diagnostics', async () => {
    const issue = draft('c'.repeat(64));
    const updateIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () =>
        Promise.resolve([
          {
            ...managedIssue(issue.key, 3),
            labels: ['schedule-diagnostic', 'needs-review'],
          },
        ]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue: () => Promise.resolve(),
      updateIssue,
      reopenIssue: () => Promise.resolve(),
      addComment: () => Promise.resolve(),
      closeIssue: () => Promise.resolve(),
    };

    await syncDiagnosticIssues([issue], client);

    expect(updateIssue).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        labels: ['needs-review', 'schedule-diagnostic'],
      }),
    );
  });

  it('defers remaining writes when the per-run limit is reached', async () => {
    const createIssue = vi.fn(() => Promise.resolve());
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () =>
        Promise.resolve([managedIssue('resolved', 3)]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue,
      updateIssue: () => Promise.resolve(),
      reopenIssue: () => Promise.resolve(),
      addComment: () => Promise.resolve(),
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([draft('new')], client, { maxWriteOperations: 1 }),
    ).resolves.toEqual({
      created: 1,
      updated: 0,
      reopened: 0,
      commented: 0,
      closed: 0,
      unchanged: 0,
      deferred: { reason: 'write-limit' },
    });
    expect(closeIssue).not.toHaveBeenCalled();
  });

  it('defers Issue synchronization after a GitHub rate limit without closing issues', async () => {
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues: () =>
        Promise.resolve([managedIssue('resolved', 3)]),
      listClosedManagedIssues: () => Promise.resolve([]),
      createIssue: () => Promise.reject(new GitHubRateLimitError(403, 60)),
      updateIssue: () => Promise.resolve(),
      reopenIssue: () => Promise.resolve(),
      addComment: () => Promise.resolve(),
      closeIssue,
    };

    await expect(syncDiagnosticIssues([draft('new')], client)).resolves.toEqual(
      {
        created: 0,
        updated: 0,
        reopened: 0,
        commented: 0,
        closed: 0,
        unchanged: 0,
        deferred: { reason: 'rate-limit', retryAfterSeconds: 60 },
      },
    );
    expect(closeIssue).not.toHaveBeenCalled();
  });
});
