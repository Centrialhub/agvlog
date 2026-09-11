import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('driver observability shell contract',()=>{
  it('publishes opt-in heartbeats from the normal app shell on a periodic cadence',()=>{
    const layout=readFileSync('src/components/layout/DriverLayout.tsx','utf8');
    const agent=readFileSync('src/components/driver/DriverAppObservabilityAgent.tsx','utf8');
    expect(layout).toContain('<DriverAppObservabilityAgent />');
    expect(agent).toContain('HEARTBEAT_INTERVAL_MS');
    expect(agent).toContain('window.setInterval');
    expect(agent).toContain('DRIVER_OFFLINE_OUTBOX_CHANGED');
    expect(agent).toContain('isDriverDiagnosticsSharingEnabled');
    expect(agent).toContain('publish_driver_app_observability_v1');
  });
});
