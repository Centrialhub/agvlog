import { describe, expect, it } from 'vitest';

import { buildDriverOccurrenceRpcArgs } from '@/lib/driver/driverOccurrence';

const baseInput = {
  tripId: 'trip-1',
  eventType: 'other',
  description: 'Pneu furado durante a viagem',
  severity: 'medium',
};

describe('driver occurrence RPC contract', () => {
  it('omits stop and client for a trip-level occurrence', () => {
    expect(buildDriverOccurrenceRpcArgs({
      ...baseInput,
      stopId: null,
      clientId: 'stale-client-from-a-previous-selection',
    })).toEqual({
      _trip_id: 'trip-1',
      _event_type: 'other',
      _description: 'Pneu furado durante a viagem',
      _severity: 'medium',
    });
  });

  it('sends a client only with its explicitly selected stop', () => {
    expect(buildDriverOccurrenceRpcArgs({
      ...baseInput,
      stopId: 'stop-1',
      clientId: 'client-1',
    })).toMatchObject({
      _stop_id: 'stop-1',
      _client_id: 'client-1',
    });
  });
});
