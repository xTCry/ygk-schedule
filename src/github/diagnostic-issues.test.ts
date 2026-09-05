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
  fingerprint: `fingerprint-${key}`,
  scope: 'base',
  title: `Проблема ${key}${suffix}`,
  body: `<!-- parser-issue-key: ${key} -->\nbody${suffix}`,
  labels: ['schedule-diagnostic'],
  occurrenceCount: 1,
});

const managedIssue = (
  key: string,
  number: number,
  suffix = '',
): ManagedDiagnosticIssue => ({
  number,
  key,
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
    const closeIssue = vi.fn(() => Promise.resolve());
    const client: DiagnosticIssuesClient = {
      listOpenManagedIssues,
      createIssue,
      updateIssue,
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
      closed: 1,
      unchanged: 0,
    });
    expect(createIssue).toHaveBeenCalledWith(draft('new'));
    expect(updateIssue).toHaveBeenCalledWith(
      2,
      draft('changed', ' (обновлено)'),
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
      createIssue,
      updateIssue,
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([draft('known')], client),
    ).resolves.toEqual({
      created: 0,
      updated: 0,
      closed: 0,
      unchanged: 1,
    });
    expect(createIssue).not.toHaveBeenCalled();
    expect(updateIssue).not.toHaveBeenCalled();
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
        closed: 0,
        unchanged: 0,
      },
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/labels/schedule-diagnostic',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.github.com/repos/owner/repository/labels',
    );
    const issueRequest = fetchMock.mock.calls[3]?.[1];
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
      createIssue: () => Promise.resolve(),
      updateIssue,
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
      createIssue,
      updateIssue: () => Promise.resolve(),
      closeIssue,
    };

    await expect(
      syncDiagnosticIssues([draft('new')], client, { maxWriteOperations: 1 }),
    ).resolves.toEqual({
      created: 1,
      updated: 0,
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
      createIssue: () => Promise.reject(new GitHubRateLimitError(403, 60)),
      updateIssue: () => Promise.resolve(),
      closeIssue,
    };

    await expect(syncDiagnosticIssues([draft('new')], client)).resolves.toEqual(
      {
        created: 0,
        updated: 0,
        closed: 0,
        unchanged: 0,
        deferred: { reason: 'rate-limit', retryAfterSeconds: 60 },
      },
    );
    expect(closeIssue).not.toHaveBeenCalled();
  });
});
