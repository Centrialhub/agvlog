import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const cursorSchema = z.object({
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: timestamp,
  id,
}).strict();

const itemSchema = z.object({
  id,
  tenant_id: id,
  created_at: timestamp,
  event_type: z.string(),
  severity: z.string(),
}).passthrough();

const pageSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  items: z.array(itemSchema).max(500),
  next_cursor: cursorSchema.nullable(),
}).strict();

export type OperationalEventCursor = z.infer<typeof cursorSchema>;
export type OperationalEventPageItem = z.infer<typeof itemSchema>;
export type OperationalEventPage = z.infer<typeof pageSchema>;

export function parseOperationalEventPage(value: unknown, tenantId: string, actorId: string): OperationalEventPage {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success || parsed.data.tenant_id !== tenantId || parsed.data.actor_id !== actorId) {
    throw new Error('Página de ocorrências incompatível com a sessão. Atualize a consulta.');
  }
  if (parsed.data.items.some(item => item.tenant_id !== tenantId)) {
    throw new Error('Página de ocorrências contém dados de outra empresa. A consulta foi bloqueada.');
  }
  if (parsed.data.next_cursor) {
    const last = parsed.data.items.at(-1);
    if (!last || last.id !== parsed.data.next_cursor.id || last.created_at !== parsed.data.next_cursor.created_at) {
      throw new Error('Cursor de ocorrências incompatível com a página recebida. Atualize a consulta.');
    }
  }
  return parsed.data;
}

export async function readAllOperationalEventPages(
  read: (cursor: OperationalEventCursor | null) => Promise<unknown>,
  tenantId: string,
  actorId: string,
): Promise<OperationalEventPageItem[]> {
  const rows: OperationalEventPageItem[] = [];
  const itemIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: OperationalEventCursor | null = null;

  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = parseOperationalEventPage(await read(cursor), tenantId, actorId);
    for (const item of page.items) {
      if (itemIds.has(item.id)) {
        throw new Error('A paginação de ocorrências retornou itens duplicados. Atualize a consulta.');
      }
      itemIds.add(item.id);
      rows.push(item);
    }
    if (!page.next_cursor) return rows;

    const signature = `${page.next_cursor.scope}:${page.next_cursor.created_at}:${page.next_cursor.id}`;
    if (cursors.has(signature)) {
      throw new Error('A paginação de ocorrências não avançou. Atualize a consulta.');
    }
    cursors.add(signature);
    cursor = page.next_cursor;
  }
  throw new Error('A consulta de ocorrências excedeu o limite seguro de páginas. Restrinja os filtros.');
}

type OperationalEventPageRpcArgs = {
  _tenant_id: string;
  _filters: Record<string, unknown>;
  _limit: number;
  _cursor: OperationalEventCursor | null;
};

interface RpcResponse {
  data: unknown;
  error: unknown;
}

const rpc = supabase.rpc as unknown as (
  name: 'list_operational_events_page_v1',
  args: OperationalEventPageRpcArgs,
) => PromiseLike<RpcResponse>;

export async function callOperationalEventPage(args: OperationalEventPageRpcArgs): Promise<unknown> {
  const { data, error } = await rpc('list_operational_events_page_v1', args);
  if (error) throw error;
  return data;
}
