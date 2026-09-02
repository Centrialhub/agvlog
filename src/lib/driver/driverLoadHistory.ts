import { z } from 'zod';
import { LOAD_STATUSES } from '@/lib/status/loadStatus';

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const status = z.enum(LOAD_STATUSES);

export const driverLoadCursorSchema = z.object({
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot_at: timestamp,
  created_at: timestamp,
  id: uuid,
}).strict();

const tripLinkSchema = z.object({
  dispatch_trip_id: uuid,
  dispatch_trips: z.object({
    status: z.string().min(1).max(80),
    actual_start_at: timestamp.nullable(),
  }).strict(),
}).strict();

const loadSchema = z.object({
  id: uuid,
  tenant_id: uuid,
  load_number: z.string().min(1).max(120),
  origin: z.string().max(500).nullable(),
  destination: z.string().max(500).nullable(),
  status,
  scheduled_load_at: timestamp.nullable(),
  total_pallet_count: z.number().finite().nonnegative().nullable(),
  total_weight_kg: z.number().finite().nonnegative().nullable(),
  created_at: timestamp,
  vehicles: z.object({
    plate: z.string().min(1).max(40),
    nickname: z.string().max(160).nullable(),
  }).strict().nullable(),
  dispatch_trip_loads: z.array(tripLinkSchema).max(100),
}).strict();

const pageSchema = z.object({
  version: z.literal(1),
  tenant_id: uuid,
  actor_id: uuid,
  driver_id: uuid,
  search: z.string().max(300).nullable(),
  status: status.nullable(),
  items: z.array(loadSchema).max(50),
  next_cursor: driverLoadCursorSchema.nullable(),
}).strict();

export type DriverLoadCursor = z.infer<typeof driverLoadCursorSchema>;
export type DriverLoadHistoryItem = z.infer<typeof loadSchema>;
export type DriverLoadHistoryPage = z.infer<typeof pageSchema>;

export function parseDriverLoadHistoryPage(
  value: unknown,
  expected: {
    tenantId: string;
    actorId: string;
    driverId: string;
    search: string | null;
    status: z.infer<typeof status> | null;
  },
): DriverLoadHistoryPage {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== expected.tenantId
    || parsed.data.actor_id !== expected.actorId
    || parsed.data.driver_id !== expected.driverId
    || parsed.data.search !== expected.search
    || parsed.data.status !== expected.status) {
    throw new Error('O histórico de cargas não corresponde à sessão e aos filtros atuais.');
  }
  if (parsed.data.items.some(item => item.tenant_id !== expected.tenantId)) {
    throw new Error('O histórico de cargas contém dados de outra empresa. A consulta foi bloqueada.');
  }
  if (parsed.data.next_cursor) {
    const last = parsed.data.items.at(-1);
    if (!last
      || last.id !== parsed.data.next_cursor.id
      || last.created_at !== parsed.data.next_cursor.created_at) {
      throw new Error('O cursor do histórico de cargas não corresponde à página recebida.');
    }
  }
  return parsed.data;
}

export function mergeDriverLoadHistoryPages(pages: DriverLoadHistoryPage[]) {
  const ids = new Set<string>();
  return pages.flatMap(page => page.items.map(item => {
    if (ids.has(item.id)) {
      throw new Error('O histórico de cargas retornou registros duplicados. Atualize a consulta.');
    }
    ids.add(item.id);
    return item;
  }));
}
