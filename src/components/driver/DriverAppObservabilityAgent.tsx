import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import { DRIVER_OFFLINE_OUTBOX_CHANGED, driverOfflineOutbox } from '@/lib/driver/driverOfflineOutbox';
import {
  createDriverAppHeartbeatPayload,
  getDriverInstallationId,
  isDriverDiagnosticsSharingEnabled,
  readDriverBuildInfo,
  readDriverLastSuccessfulSync,
  summarizeDriverOutbox,
} from '@/lib/driver/driverAppObservability';

const HEARTBEAT_INTERVAL_MS=5*60*1_000;

/** Publishes opt-in, private diagnostics during normal driver-app use, not only on the sync page. */
export function DriverAppObservabilityAgent(){
  const {currentTenant}=useTenant();
  const {user}=useAuth();
  const online=useOnlineStatus();
  const tenantId=currentTenant?.id,actorId=user?.id;

  useEffect(()=>{
    if(!tenantId||!actorId||!online)return;
    let active=true,running=false;
    const installationId=getDriverInstallationId();
    const publish=async()=>{
      if(running||!active||!navigator.onLine||!isDriverDiagnosticsSharingEnabled(tenantId,actorId))return;
      running=true;
      try{
        const [build,rows]=await Promise.all([readDriverBuildInfo(),driverOfflineOutbox.list(tenantId,actorId)]);
        if(!active||!build)return;
        const payload=createDriverAppHeartbeatPayload({tenantId,installationId,build,
          lastSuccessfulSyncAt:readDriverLastSuccessfulSync(tenantId,actorId),summary:summarizeDriverOutbox(rows)});
        await supabase.rpc('publish_driver_app_observability_v1' as never,{_payload:payload} as never);
      }catch{/* Diagnostics are best-effort and never block the trip. */}
      finally{running=false;}
    };
    const onOutboxChanged=()=>{void publish();};
    void publish();
    const interval=window.setInterval(()=>void publish(),HEARTBEAT_INTERVAL_MS);
    window.addEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,onOutboxChanged);
    return()=>{active=false;window.clearInterval(interval);window.removeEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,onOutboxChanged);};
  },[actorId,online,tenantId]);
  return null;
}
