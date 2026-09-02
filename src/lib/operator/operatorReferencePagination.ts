import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const resourceSchema = z.enum(['loads', 'clients', 'drivers', 'vehicles', 'operational_routes']);
const cursorSchema = z.object({
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot_at: timestamp,
  created_at: timestamp,
  id,
}).strict();
const itemSchema = z.object({ id, tenant_id: id, created_at: timestamp }).passthrough();
const pageSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  resource: resourceSchema,
  items: z.array(itemSchema).max(500),
  next_cursor: cursorSchema.nullable(),
}).strict();

export type OperatorReferenceResource = z.infer<typeof resourceSchema>;
export type OperatorReferenceCursor = z.infer<typeof cursorSchema>;
export type OperatorReferenceItem = z.infer<typeof itemSchema>;

export function parseOperatorReferencePage(
  value: unknown,
  tenantId: string,
  actorId: string,
  resource: OperatorReferenceResource,
) {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== tenantId
    || parsed.data.actor_id !== actorId
    || parsed.data.resource !== resource) {
    throw new Error('O catálogo operacional não corresponde à sessão atual. Atualize a consulta.');
  }
  if (parsed.data.items.some(item => item.tenant_id !== tenantId)) {
    throw new Error('O catálogo operacional contém dados de outra empresa. A consulta foi bloqueada.');
  }
  if (parsed.data.next_cursor) {
    const last = parsed.data.items.at(-1);
    if (!last
      || last.id !== parsed.data.next_cursor.id
      || last.created_at !== parsed.data.next_cursor.created_at) {
      throw new Error('O cursor do catálogo operacional não corresponde à página recebida.');
    }
  }
  return parsed.data;
}

type ReadPage = (cursor: OperatorReferenceCursor | null) => Promise<unknown>;

export async function readAllOperatorReferencePages(
  read: ReadPage,
  tenantId: string,
  actorId: string,
  resource: OperatorReferenceResource,
): Promise<OperatorReferenceItem[]> {
  const rows: OperatorReferenceItem[] = [];
  const rowIds = new Set<string>();
  const cursors = new Set<string>();
  let cursor: OperatorReferenceCursor | null = null;

  for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
    const page = parseOperatorReferencePage(await read(cursor), tenantId, actorId, resource);
    for (const item of page.items) {
      if (rowIds.has(item.id)) {
        throw new Error('O catálogo operacional retornou registros duplicados. Atualize a consulta.');
      }
      rowIds.add(item.id);
      rows.push(item);
    }
    if (!page.next_cursor) return rows;

    const signature = `${page.next_cursor.scope}:${page.next_cursor.snapshot_at}:${page.next_cursor.created_at}:${page.next_cursor.id}`;
    if (cursors.has(signature)) {
      throw new Error('A paginação do catálogo operacional não avançou. Atualize a consulta.');
    }
    cursors.add(signature);
    cursor = page.next_cursor;
  }

  throw new Error('O catálogo operacional excedeu o limite seguro de páginas.');
}

type ReferencePageArgs = {
  _tenant_id: string;
  _resource: OperatorReferenceResource;
  _include_inactive: boolean;
  _limit: number;
  _cursor: OperatorReferenceCursor | null;
};

interface RpcResponse {
  data: unknown;
  error: unknown;
}

const rpc = supabase.rpc as unknown as (
  name: 'list_operator_reference_page_v1',
  args: ReferencePageArgs,
) => PromiseLike<RpcResponse>;

export async function callOperatorReferencePage(args: ReferencePageArgs): Promise<unknown> {
  const { data, error } = await rpc('list_operator_reference_page_v1', args);
  if (error) throw error;
  return data;
}

export function readOperatorReferenceCatalog(input: {
  tenantId: string;
  actorId: string;
  resource: OperatorReferenceResource;
  includeInactive?: boolean;
}) {
  return readAllOperatorReferencePages(
    cursor => callOperatorReferencePage({
      _tenant_id: input.tenantId,
      _resource: input.resource,
      _include_inactive: input.includeInactive ?? false,
      _limit: 500,
      _cursor: cursor,
    }),
    input.tenantId,
    input.actorId,
    input.resource,
  );
}
