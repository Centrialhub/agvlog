import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Json} from '@/integrations/supabase/types';
import type {DriverOfflineEnvelope} from '@/lib/driver/driverOfflineOutbox';
import {
  categorizeDriverGeofenceError,
  createDriverAppHeartbeatPayload,
  getDriverInstallationId,
  isDriverDiagnosticsSharingEnabled,
  parseDriverAppObservability,
  recordDriverSuccessfulSync,
  setDriverDiagnosticsSharing,
  summarizeDriverOutbox,
} from '@/lib/driver/driverAppObservability';

const envelope=(overrides:Partial<DriverOfflineEnvelope<Json>>={}):DriverOfflineEnvelope<Json>=>({
  version:1,id:crypto.randomUUID(),scopeKey:'tenant:actor',tenantId:'tenant',actorId:'actor',kind:'delivery',
  aggregateId:'trip',state:'queued',payload:{},files:[],attempts:0,lastError:null,
  createdAt:'2026-09-10T10:00:00.000Z',updatedAt:'2026-09-10T10:00:00.000Z',...overrides,
});

describe('driver app observability',()=>{
  beforeEach(()=>localStorage.clear());

  it('summarizes every outbox kind/state without leaking payload content',()=>{
    const rows=[
      envelope({payload:{attention:{kind:'remote_conflict',message:'sensitive'}} as Json,state:'needs_attention'}),
      envelope({kind:'arrival',state:'needs_attention',lastError:'Precisão do GPS insuficiente',uploadFailures:2}),
      envelope({kind:'expense',uploadFailures:1}),
    ];
    const summary=summarizeDriverOutbox(rows);
    expect(summary).toMatchObject({total:3,documentConflicts:1,byState:{queued:1,syncing:0,needs_attention:2},
      byKind:{delivery:1,expense:1,arrival:1}});
    expect(summary.geofenceErrors.low_accuracy).toBe(1);
    expect(summary.uploadFailures).toMatchObject({total:3,affectedItems:2,byKind:{arrival:2,expense:1}});
    const payload=createDriverAppHeartbeatPayload({tenantId:'tenant',installationId:crypto.randomUUID(),
      build:{version:'1.2.3',buildHash:'a'.repeat(16),builtAt:'2026-09-10T10:00:00Z'},lastSuccessfulSyncAt:null,summary});
    expect(JSON.stringify(payload)).not.toContain('sensitive');
    expect(payload.outbox.by_kind.delivery).toBe(1);
    expect(payload.upload_failures).toMatchObject({total:3,affected_items:2,by_kind:{arrival:2,expense:1}});
  });

  it('categorizes local arrival failures deterministically',()=>{
    expect(categorizeDriverGeofenceError('Permissão de localização negada')).toBe('permission_denied');
    expect(categorizeDriverGeofenceError('Motorista está fora da geofence')).toBe('outside_geofence');
    expect(categorizeDriverGeofenceError('GPS indisponível')).toBe('location_unavailable');
    expect(categorizeDriverGeofenceError('rejected by server')).toBe('server_rejection');
  });

  it('keeps sharing opt-in and sync timestamp scoped by tenant and actor',()=>{
    expect(isDriverDiagnosticsSharingEnabled('tenant','actor')).toBe(false);
    setDriverDiagnosticsSharing('tenant','actor',true);
    expect(isDriverDiagnosticsSharingEnabled('tenant','actor')).toBe(true);
    expect(isDriverDiagnosticsSharingEnabled('tenant','other')).toBe(false);
    expect(recordDriverSuccessfulSync('tenant','actor',new Date('2026-09-10T12:00:00Z'))).toBe('2026-09-10T12:00:00.000Z');
    const uuid=vi.fn(()=> '123e4567-e89b-42d3-a456-426614174000');
    expect(getDriverInstallationId(localStorage,uuid)).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(getDriverInstallationId(localStorage,uuid)).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(uuid).toHaveBeenCalledOnce();
  });

  it('parses the admin report defensively and preserves categorized metrics',()=>{
    const report=parseDriverAppObservability({generated_at:'2026-09-10T12:00:00Z',total_devices:2,active_24h:1,
      geofence_errors:{invalid_position:3,tracker_identity:2,temporal_binding:1,address_resolution:4,processing:5},devices:[{
        installation_code:'abc12345',actor_code:'def67890',app_version:'1.0.0',build_hash:'a'.repeat(16),
        last_successful_sync_at:null,outbox:{total:1,by_state:{queued:1},by_kind:{delivery:1}},document_conflicts:0,
        upload_failures:{total:2,affected_items:1,by_kind:{delivery:2}},
        geofence_errors:{outside_geofence:1},seen_at:'2026-09-10T11:00:00Z',
      }]});
    expect(report.geofenceErrors).toEqual({invalidPosition:3,trackerIdentity:2,temporalBinding:1,addressResolution:4,processing:5});
    expect(report.devices[0].outbox.by_state.needs_attention).toBe(0);
    expect(report.devices[0].geofenceErrors.outside_geofence).toBe(1);
    expect(report.devices[0].uploadFailures).toMatchObject({total:2,affected_items:1,by_kind:{delivery:2}});
    expect(parseDriverAppObservability({devices:[{seen_at:'invalid'}]}).devices).toEqual([]);
  });
});
