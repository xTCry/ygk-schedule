import type {
  ActualGroupArtifact,
  BaseGroupArtifact,
  PagesApiIndex,
} from './types.ts';

const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);

export const apiUrl = (path: string): URL => new URL(`api/${path}`, baseUrl);

export const siteUrl = (path: string): string =>
  decodeURI(new URL(path, baseUrl).toString());

export const fetchJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(apiUrl(path));
  if (!response.ok)
    throw new Error(`Не удалось загрузить ${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
};

export const loadIndex = (): Promise<PagesApiIndex> =>
  fetchJson<PagesApiIndex>('index.json');

export const loadGroupSchedule = (group: string): Promise<BaseGroupArtifact> =>
  fetchJson<BaseGroupArtifact>(`base/groups/${encodeURIComponent(group)}.json`);

export const loadActualSchedule = (
  group: string,
): Promise<ActualGroupArtifact> =>
  fetchJson<ActualGroupArtifact>(
    `actual/groups/${encodeURIComponent(group)}.json`,
  );
