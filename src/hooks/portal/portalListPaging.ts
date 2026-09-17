export const PORTAL_LIST_PAGE_SIZE = 50;

export interface PortalListPage<T> {
  rows: T[];
  next_cursor: Record<string, string> | null;
  snapshot_at: string;
  revision: string;
}

export interface PortalListPageParam {
  cursor: Record<string, string>;
  snapshotAt: string;
  revision: string;
}

export function nextPortalListPage<T>(page: PortalListPage<T>): PortalListPageParam | undefined {
  return page.next_cursor
    ? { cursor: page.next_cursor, snapshotAt: page.snapshot_at, revision: page.revision }
    : undefined;
}

export function assertPortalListPage<T>(value: unknown): PortalListPage<T> {
  if (!value || typeof value !== 'object') throw new Error('Resposta de paginação inválida');
  const page = value as Partial<PortalListPage<T>>;
  if (!Array.isArray(page.rows) || typeof page.snapshot_at !== 'string' || typeof page.revision !== 'string') {
    throw new Error('Resposta de paginação inválida');
  }
  return page as PortalListPage<T>;
}
