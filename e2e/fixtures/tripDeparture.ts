import { expect, type APIRequestContext } from '@playwright/test';
import { fixtureIds } from './accounts';
import { preTripChecklistPayload } from './driverChecklist';
import { passwordToken } from './session';

type Session = Awaited<ReturnType<typeof passwordToken>>;
type LoadCheck = { load_id: string; expected_volume_count: number | null; expected_pallet_count: number | null; expected_weight_kg: number | null };

// Prepare the disposable trip through the same guarded commands as the driver.
// Linked evidence is retained with its audit trail until the local project is discarded.
export async function confirmFixtureDeparture(request: APIRequestContext, session: Session) {
  const origin = new URL(session.backendUrl);
  expect(origin.origin).toBe('http://127.0.0.1:55321');
  const headers = { apikey: session.publishableKey, Authorization: `Bearer ${session.accessToken}` };
  const scope = { _tenant_id: fixtureIds.tenantA, _trip_id: fixtureIds.tripA };
  const rpc = async (name: string, data: Record<string, unknown>) => {
    const response = await request.post(`${origin.origin}/rest/v1/rpc/${name}`, { headers, data });
    expect(response.ok(), `${name}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const command = (action: string, payload: Record<string, unknown> = {}) => rpc('driver_update_trip_cargo_v1', {
    ...scope, _request_id: crypto.randomUUID(), _action: action, _payload: payload,
  });
  let snapshot = await rpc('get_trip_cargo_control_v2', scope);
  if (!snapshot.available || snapshot.control.status === 'pending_acceptance') {
    expect(await command('accept', { vehicle_id: fixtureIds.vehicleA })).toMatchObject({ confirmed: true, status: 'accepted' });
    snapshot = await rpc('get_trip_cargo_control_v2', scope);
  }
  if (snapshot.control.status !== 'departed') {
    expect(['accepted', 'loading', 'ready_to_depart']).toContain(snapshot.control.status);
    const collection = async <T>(name: string): Promise<T[]> => {
      const items: T[] = [];
      const total = snapshot.collection_counts[name];
      for (let page = 1; page === 1 || items.length < total; page++) {
        const result = await rpc('get_trip_cargo_collection_page_v1', { ...scope, _collection: name, _page: page, _page_size: 50 });
        expect(result).toMatchObject({ total_count: total, page, page_size: 50 });
        expect(result.items.length > 0 || total === 0).toBe(true);
        items.push(...result.items);
      }
      expect(items).toHaveLength(total);
      return items;
    };
    const loads = await collection<LoadCheck>('loads');
    const documents = await collection<{ id: string }>('documents');
    const key = process.env.E2E_LOCAL_STORAGE_SERVICE_KEY;
    if (!key) throw new Error('Guarded local Storage fixture key is required.');
    const storageHeaders = { apikey: session.publishableKey, Authorization: `Bearer ${key}` };
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7yQAAAAASUVORK5CYII=', 'base64');
    const evidence = [];
    for (const kind of ['loading', 'tie_down']) {
      const path = `${fixtureIds.tenantA}/trip-cargo/${fixtureIds.tripA}/qa-${crypto.randomUUID()}/${kind}.png`;
      const upload = await request.post(`${origin.origin}/storage/v1/object/receipts/${path}`, {
        headers: { ...storageHeaders, 'Content-Type': 'image/png', 'x-upsert': 'false' }, data: bytes,
      });
      expect(upload.ok(), await upload.text()).toBeTruthy();
      const download = await request.get(`${origin.origin}/storage/v1/object/authenticated/receipts/${path}`, { headers: storageHeaders });
      expect(download.ok(), await download.text()).toBeTruthy();
      expect(await download.body()).toEqual(bytes);
      evidence.push({ kind, path });
    }
    expect(await command('confirm_cargo', {
      vehicle_checked: true, tie_down_confirmed: true,
      seal_not_applicable_reason: 'Veículo sintético sem ponto de lacre',
      documents: documents.map(document => document.id),
      loads: loads.map(load => ({ load_id: load.load_id, volume_count: load.expected_volume_count ?? 0,
        pallet_count: load.expected_pallet_count ?? 0, weight_kg: load.expected_weight_kg ?? 0 })), evidence,
    })).toMatchObject({ confirmed: true, status: 'ready_to_depart' });
  }
  await rpc('driver_save_checklist', { _trip_id: fixtureIds.tripA, _kind: 'pre', _payload: preTripChecklistPayload() });
  expect(await command('mark_departed')).toMatchObject({ confirmed: true, status: 'departed' });
  const final = await rpc('get_trip_cargo_control_v2', scope);
  expect(final.control).toMatchObject({ status: 'departed', vehicle_checked: true, tie_down_confirmed: true });
  expect(final.collection_counts.evidence).toBeGreaterThanOrEqual(2);
}
