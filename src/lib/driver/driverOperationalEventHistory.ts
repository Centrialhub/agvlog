import { z } from 'zod';
import type { Json } from '@/integrations/supabase/types';

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const nullableUuid = uuid.nullable();

const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonSchema),
  z.record(z.string(), jsonSchema),
]));

export const driverOperationalEventCursorSchema = z.object({
  scope: z.string().regex(/^[0-9a-f]{64}$/),
  snapshot_at: timestamp,
  created_at: timestamp,
  id: uuid,
}).strict();

const eventSchema = z.object({
  id: uuid,
  tenant_id: uuid,
  driver_id: nullableUuid,
  dispatch_trip_id: nullableUuid,
  dispatch_stop_id: nullableUuid,
  event_type: z.string().min(1).max(100),
  severity: z.string().min(1).max(40),
  description: z.string().max(20_000).nullable(),
  report_details: jsonSchema.nullable(),
  payload: jsonSchema.nullable(),
  created_at: timestamp,
}).strict();

const pageSchema = z.object({
  version: z.literal(1),
  tenant_id: uuid,
  actor_id: uuid,
  driver_id: uuid,
  trip_id: nullableUuid,
  items: z.array(eventSchema).max(50),
  next_cursor: driverOperationalEventCursorSchema.nullable(),
}).strict();

export type DriverOperationalEventCursor = z.infer<typeof driverOperationalEventCursorSchema>;
export type DriverOperationalEventItem = z.infer<typeof eventSchema>;
export type DriverOperationalEventPage = z.infer<typeof pageSchema>;

export function parseDriverOperationalEventPage(
  value: unknown,
  expected: {
    tenantId: string;
    actorId: string;
    driverId: string;
    tripId: string | null;
  },
): DriverOperationalEventPage {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.tenant_id !== expected.tenantId
    || parsed.data.actor_id !== expected.actorId
    || parsed.data.driver_id !== expected.driverId
    || parsed.data.trip_id !== expected.tripId) {
    throw new Error('O histórico de ocorrências não corresponde à sessão e à viagem atuais.');
  }
  if (parsed.data.items.some(item => item.tenant_id !== expected.tenantId)) {
    throw new Error('O histórico de ocorrências contém dados de outra empresa. A consulta foi bloqueada.');
  }
  if (parsed.data.next_cursor) {
    const last = parsed.data.items.at(-1);
    if (!last
      || last.id !== parsed.data.next_cursor.id
      || last.created_at !== parsed.data.next_cursor.created_at) {
      throw new Error('O cursor do histórico de ocorrências não corresponde à página recebida.');
    }
  }
  return parsed.data;
}

export function mergeDriverOperationalEventPages(pages: DriverOperationalEventPage[]) {
  const ids = new Set<string>();
  return pages.flatMap(page => page.items.map(item => {
    if (ids.has(item.id)) {
      throw new Error('O histórico de ocorrências retornou registros duplicados. Atualize a consulta.');
    }
    ids.add(item.id);
    return item;
  }));
}
