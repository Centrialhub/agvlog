import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markDriverArrival } from '@/lib/driver/driverArrival';

const mocks = vi.hoisted(() => ({ location: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/driverLocation', () => ({ getCurrentDriverLocation: mocks.location }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
beforeEach(() => {
  mocks.location.mockReset().mockResolvedValue({ latitude: -15.802, longitude: -43.313, accuracyM: 10 });
  mocks.rpc.mockReset().mockResolvedValue({ data: 'arrival', error: null });
});
describe('shared driver arrival frontend request', () => {
  it('sends captured GPS evidence to the backend and returns its event ID', async () => {
    expect(await markDriverArrival('stop')).toBe('arrival');
    expect(mocks.rpc).toHaveBeenCalledWith('driver_mark_arrival', { _stop_id:'stop', _latitude:-15.802, _longitude:-43.313, _accuracy_m:10 });
  });
  it('does not call the backend if location is unavailable', async () => {
    mocks.location.mockRejectedValue(new Error('GPS denied'));
    await expect(markDriverArrival('stop')).rejects.toThrow('GPS denied');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not report success when the backend rejects the geofence', async () => {
    mocks.rpc.mockResolvedValue({ data:null, error:new Error('Outside geofence') });
    await expect(markDriverArrival('stop')).rejects.toThrow('Outside geofence');
  });
});
