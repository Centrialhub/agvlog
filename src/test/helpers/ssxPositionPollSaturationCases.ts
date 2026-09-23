import { expect, it } from 'vitest';
import type { RpcArgs } from './ssxPositionPollRuntimeFixture';

type SaturationState = {
  items: Record<string, unknown>[];
  itemBatches: Record<string, unknown>[][];
  rpcCalls: Array<{ name: string; args: RpcArgs }>;
};

export function registerSaturationCases(
  state: SaturationState,
  request: (body: Record<string, unknown>) => Promise<Response>,
  accountId: string,
) {
  it('blocks a saturated 500-item response instead of acknowledging it as complete', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = Array.from({ length: 500 }, (_, index) => ({
      IdPosition: String(index + 1), IdTrackedUnit: '123', IdTrackedUnitType: 1,
      Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, ValidGPS: true,
    }));
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result).toMatchObject({
      success: false,
      batch_aborted: true,
      abort_reason: 'saturated_response',
      saturation_blocked: true,
      total_inserted: 0,
    });
    expect(result.requests).toBeGreaterThan(1);
    expect(result.requests).toBeLessThanOrEqual(32);
    expect(state.rpcCalls.map((call) => call.name)).toEqual(['record_ssx_poll_error_v1']);
  });

  it('subdivides a saturated window and commits only after both halves prove complete', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    const positions = Array.from({ length: 500 }, (_, index) => ({
      IdPosition: String(index + 1), IdTrackedUnit: '123', IdTrackedUnitType: 1,
      Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, ValidGPS: true,
    }));
    state.itemBatches = [positions, positions.slice(0, 200), positions.slice(200)];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      total_positions_received: 500,
      total_inserted: 500,
      touched_vehicles: 1,
    });
    const commits = state.rpcCalls.filter((call) => call.name === 'commit_ssx_position_batch_v1');
    expect(commits).toHaveLength(1);
    expect(commits[0].args._positions).toHaveLength(500);
  });
}
