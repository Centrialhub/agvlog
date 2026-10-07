import { expect, type APIRequestContext } from "@playwright/test";
import type { passwordToken } from "./session";

type Session = Awaited<ReturnType<typeof passwordToken>>;
type Load = { id: string; tenant_id: string; load_number: string; version: number };
type Item = {
  id: string; tenant_id: string; load_id: string; fiscal_document_id: string | null;
  order_id: string | null; item_description: string; quantity: number;
  pallet_count: number | null; weight_kg: number | null; volume_m3: number | null;
  status: string; notes: string | null; updated_at: string;
};

// Only for a new, synthetic load owned by the current test. Never use this for
// shared seed loads or imported documents, which require a separate lifecycle.
export async function cleanupSyntheticManualLoad(
  request: APIRequestContext,
  session: Session,
  fixture: { tenantId: string; loadId: string; loadNumber: string; itemId: string | null },
) {
  const headers = {
    apikey: session.publishableKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
  const read = async <T>(table: string, filter: string): Promise<T[]> => {
    const response = await request.get(`${session.backendUrl}/rest/v1/${table}?${filter}`, { headers });
    expect(response.ok(), `Cleanup read ${table}: HTTP ${response.status()}`).toBeTruthy();
    const rows: unknown = await response.json();
    expect(Array.isArray(rows), `Cleanup ${table} must return rows`).toBe(true);
    return rows as T[];
  };
  const loadFilter = `id=eq.${fixture.loadId}&tenant_id=eq.${fixture.tenantId}&select=id,tenant_id,load_number,version`;
  const itemsFilter = `load_id=eq.${fixture.loadId}&tenant_id=eq.${fixture.tenantId}&select=id,tenant_id,load_id,fiscal_document_id,order_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status,notes,updated_at`;
  const assertOwnedLoad = (load: Load) => {
    expect(load).toMatchObject({
      id: fixture.loadId, tenant_id: fixture.tenantId, load_number: fixture.loadNumber,
    });
  };
  const loads = await read<Load>("loads", loadFilter);
  expect(loads.length).toBeLessThanOrEqual(1);
  const items = await read<Item>("load_items", itemsFilter);
  if (loads.length === 0) {
    expect(items, "Removed synthetic load must not leave cargo items").toEqual([]);
    return;
  }
  assertOwnedLoad(loads[0]);
  // This journey creates exactly one manual item. Refuse unexpected composition
  // rather than detaching documents or deleting another test's cargo.
  expect(items.length, "Unexpected synthetic load composition").toBeLessThanOrEqual(1);
  for (const item of items) {
    // A failed create response can leave an item without returning its ID.
    // Refuse to delete an item whose identity this test did not confirm.
    expect(fixture.itemId, "Cannot clean an item without its creation ID").toBeTruthy();
    expect(item).toMatchObject({
      id: fixture.itemId, tenant_id: fixture.tenantId,
      load_id: fixture.loadId, fiscal_document_id: null,
    });
    // v4 compares this complete item snapshot, including updated_at. Audited
    // reallocation updates that timestamp, so a stale snapshot fails closed.
    const expected = {
      order_id: item.order_id, item_description: item.item_description,
      quantity: item.quantity, pallet_count: item.pallet_count,
      weight_kg: item.weight_kg, volume_m3: item.volume_m3,
      status: item.status, notes: item.notes, updated_at: item.updated_at,
    };
    const removed = await request.post(`${session.backendUrl}/rest/v1/rpc/delete_load_item_v4`, {
      headers, data: { p_tenant_id: fixture.tenantId, p_item_id: item.id, p_expected: expected },
    });
    expect(removed.ok(), `Cleanup item: HTTP ${removed.status()}`).toBeTruthy();
    expect(await removed.json(), "Item deletion must be confirmed").toBe(true);
  }

  // delete_load_if_empty is best effort inside the item RPC. If it kept the
  // empty load, use the same revision-checked aggregate command as the UI.
  const remaining = await read<Load>("loads", loadFilter);
  expect(remaining.length).toBeLessThanOrEqual(1);
  if (remaining[0]) {
    assertOwnedLoad(remaining[0]);
    const removed = await request.post(`${session.backendUrl}/rest/v1/rpc/apply_load_aggregate_command`, {
      headers,
      data: { _payload: {
        schema_version: 1, tenant_id: fixture.tenantId, request_id: crypto.randomUUID(),
        action: "delete", load_id: fixture.loadId, expected_version: remaining[0].version,
        reason: "Limpeza da carga sintética exclusiva desta execução E2E",
      } },
    });
    expect(removed.ok(), `Cleanup load: HTTP ${removed.status()}`).toBeTruthy();
    expect(await removed.json()).toMatchObject({
      ok: true, action: "delete", deleted_load_ids: [fixture.loadId],
    });
  }
  expect(await read<Load>("loads", loadFilter), "Synthetic load cleanup must persist").toEqual([]);
  expect(await read<Item>("load_items", itemsFilter), "Synthetic cargo cleanup must persist").toEqual([]);
}
