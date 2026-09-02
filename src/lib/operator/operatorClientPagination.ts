import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

export type OperatorClientKind = 'all' | 'client' | 'supplier' | 'both';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const cursorSchema = z.object({
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot_at: timestamp,
  company_name: z.string(),
  id,
}).strict();
const itemSchema = z.object({
  id,
  tenant_id: id,
  company_name: z.string(),
  created_at: timestamp,
}).passthrough();
const pageSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  resource: z.literal('clients'),
  snapshot_at: timestamp,
  items: z.array(itemSchema).max(200),
  total_count: z.number().int().nonnegative(),
  previous_cursor: cursorSchema.nullable(),
  next_cursor: cursorSchema.nullable(),
}).strict();

export type OperatorClientCursor = z.infer<typeof cursorSchema>;
export type OperatorClientPage = z.infer<typeof pageSchema>;

type PageRequest = {
  cursor: OperatorClientCursor | null;
  direction: 'next' | 'previous';
  snapshotAt: string | null;
};

type ScopeCache = {
  pages: Map<number, { page: OperatorClientPage; request: PageRequest }>;
  totalPages: number;
};

const pageAnchors = new Map<string, ScopeCache>();
const MAX_SCOPES = 50;

function scopeKey(input: {
  tenantId: string;
  actorId: string;
  search: string;
  kind: OperatorClientKind;
  pageSize: number;
}) {
  return JSON.stringify({
    tenantId: input.tenantId,
    actorId: input.actorId,
    search: input.search,
    kind: input.kind,
    pageSize: input.pageSize,
  });
}

function rememberScope(key: string, cache: ScopeCache) {
  pageAnchors.delete(key);
  pageAnchors.set(key, cache);
  if (pageAnchors.size > MAX_SCOPES) {
    pageAnchors.delete(pageAnchors.keys().next().value as string);
  }
}

export function clearOperatorClientPageAnchors(tenantId?: string) {
  if (!tenantId) {
    pageAnchors.clear();
    return;
  }
  for (const key of pageAnchors.keys()) {
    if (key.includes(`"tenantId":"${tenantId}"`)) pageAnchors.delete(key);
  }
}

export function parseOperatorClientPage(value: unknown, tenantId: string, actorId: string) {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== tenantId
    || parsed.data.actor_id !== actorId
    || parsed.data.items.some(item => item.tenant_id !== tenantId)) {
    throw new Error('A página de clientes não corresponde à sessão atual. Atualize a consulta.');
  }
  return parsed.data;
}

type ClientPageArgs = {
  _tenant_id: string;
  _search: string;
  _kind: OperatorClientKind;
  _limit: number;
  _cursor: OperatorClientCursor | null;
  _direction: 'next' | 'previous';
  _snapshot_at: string | null;
};

interface RpcResponse {
  data: unknown;
  error: unknown;
}

const rpc = supabase.rpc as unknown as (
  name: 'list_operator_clients_page_v1',
  args: ClientPageArgs,
) => PromiseLike<RpcResponse>;

async function callPage(input: {
  tenantId: string;
  actorId: string;
  search: string;
  kind: OperatorClientKind;
  pageSize: number;
}, request: PageRequest) {
  const { data, error } = await rpc('list_operator_clients_page_v1', {
    _tenant_id: input.tenantId,
    _search: input.search,
    _kind: input.kind,
    _limit: input.pageSize,
    _cursor: request.cursor,
    _direction: request.direction,
    _snapshot_at: request.snapshotAt,
  });
  if (error) throw error;
  return parseOperatorClientPage(data, input.tenantId, input.actorId);
}

export async function readOperatorClientPageNumber(input: {
  tenantId: string;
  actorId: string;
  page: number;
  pageSize: number;
  search: string;
  kind: OperatorClientKind;
}) {
  const requestedPage = Math.max(1, Math.trunc(input.page));
  const key = scopeKey(input);
  let cache = pageAnchors.get(key);
  let createdCache = false;

  if (!cache) {
    const request: PageRequest = { cursor: null, direction: 'next', snapshotAt: null };
    const first = await callPage(input, request);
    cache = {
      pages: new Map([[1, { page: first, request }]]),
      totalPages: Math.max(1, Math.ceil(first.total_count / input.pageSize)),
    };
    createdCache = true;
    rememberScope(key, cache);
  }

  const targetPage = Math.min(requestedPage, cache.totalPages);
  const exact = cache.pages.get(targetPage);
  if (createdCache && exact) return exact.page;
  if (exact) {
    const refreshed = await callPage(input, exact.request);
    exact.page = refreshed;
    const nextTotalPages = Math.max(1, Math.ceil(refreshed.total_count / input.pageSize));
    if (exact.request.cursor === null && exact.request.direction === 'next') {
      cache.pages.clear();
      cache.pages.set(1, exact);
      cache.totalPages = nextTotalPages;
    } else if (nextTotalPages !== cache.totalPages) {
      cache.pages.clear();
      cache.pages.set(targetPage, exact);
      cache.totalPages = nextTotalPages;
    }
    rememberScope(key, cache);
    return refreshed;
  }

  if (targetPage === cache.totalPages) {
    const first = cache.pages.get(1)?.page;
    const request: PageRequest = {
      cursor: null,
      direction: 'previous',
      snapshotAt: first?.snapshot_at ?? null,
    };
    const last = await callPage(input, request);
    cache.pages.set(targetPage, { page: last, request });
    rememberScope(key, cache);
    return last;
  }

  let anchorNumber = 1;
  let anchor = cache.pages.get(1)!;
  for (const [pageNumber, candidate] of cache.pages) {
    if (Math.abs(pageNumber - targetPage) < Math.abs(anchorNumber - targetPage)) {
      anchorNumber = pageNumber;
      anchor = candidate;
    }
  }

  while (anchorNumber !== targetPage) {
    const movingForward = anchorNumber < targetPage;
    const cursor = movingForward ? anchor.page.next_cursor : anchor.page.previous_cursor;
    if (!cursor) throw new Error('A paginação de clientes terminou antes da página solicitada.');
    const request: PageRequest = {
      cursor,
      direction: movingForward ? 'next' : 'previous',
      snapshotAt: anchor.page.snapshot_at,
    };
    const next = await callPage(input, request);
    anchorNumber += movingForward ? 1 : -1;
    anchor = { page: next, request };
    cache.pages.set(anchorNumber, anchor);
  }

  rememberScope(key, cache);
  return anchor.page;
}
