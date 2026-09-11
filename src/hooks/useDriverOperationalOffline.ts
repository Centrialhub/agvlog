import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import {
  DRIVER_OFFLINE_OUTBOX_CHANGED,
  driverOfflineOutbox,
  type DriverOfflineEnvelope,
} from '@/lib/driver/driverOfflineOutbox';
import {
  createDriverOperationalCommandService,
  type DriverOperationalCommand,
} from '@/lib/driver/driverOperationalOffline';

type RpcError = Error & { code?: string; retryable?: boolean };
type RpcResult = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
const rpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => RpcResult;
let operationalSessionRefresh:Promise<boolean>|null=null;

function isAuthorizationError(error:{code?:string;message?:string}|null):boolean{
  if(!error)return false;
  return error.code==='401'||error.code==='42501'||/\b(jwt|token|sess[aã]o)\b.*\b(expir|invalid|ausente)|unauthorized/i.test(error.message??'');
}

async function refreshOperationalSession():Promise<boolean>{
  if(!operationalSessionRefresh)operationalSessionRefresh=(async()=>{
    try{const response=await supabase.auth.refreshSession();return !response.error&&!!response.data.session;}
    catch{return false;}
  })().finally(()=>{operationalSessionRefresh=null;});
  return operationalSessionRefresh;
}

async function send(record: DriverOfflineEnvelope<Json>) {
  const args={
    _tenant_id: record.tenantId,
    _request_id: record.id,
    _command: record.kind === 'journey' ? 'journey_event' : record.kind,
    _payload: record.payload,
  };
  const invoke=()=>rpc('driver_apply_offline_command_v1',args);
  let {data,error}=await invoke();
  if(isAuthorizationError(error)&&await refreshOperationalSession())({data,error}=await invoke());
  if (error) {
    const failure = new Error(error.message || 'Não foi possível sincronizar o comando.') as RpcError;
    failure.code = error.code;
    failure.retryable = !error.code || ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(error.code);
    throw failure;
  }
  return data;
}

export function useDriverOperationalOffline(options: { autoRecover?: boolean } = {}) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const online = useOnlineStatus();
  const [pending, setPending] = useState(0);
  const [commands, setCommands] = useState<DriverOfflineEnvelope<Json>[]>([]);
  const [syncing, setSyncing] = useState(false);
  const service = useMemo(() => createDriverOperationalCommandService({
    outbox: driverOfflineOutbox,
    send,
    uuid: () => crypto.randomUUID(),
    now: () => new Date(),
    isOnline: () => navigator.onLine,
  }), []);

  const refreshPending = useCallback(async () => {
    if (!currentTenant?.id || !user?.id) { setPending(0); setCommands([]); return; }
    try {
      const rows = await driverOfflineOutbox.list(currentTenant.id, user.id);
      const operational = rows.filter(row => ['arrival', 'departure', 'journey', 'checklist', 'occurrence'].includes(row.kind));
      setCommands(operational);
      setPending(operational.length);
    } catch {
      setCommands([]);
      setPending(0);
    }
  }, [currentTenant?.id, user?.id]);

  const recover = useCallback(async (includeNeedsAttention = false) => {
    if (!currentTenant?.id || !user?.id || !navigator.onLine) return { confirmed: 0, pending: 0 };
    setSyncing(true);
    try {
      const result = await service.recover(currentTenant.id, user.id, includeNeedsAttention);
      setPending(result.pending);
      return result;
    } finally {
      setSyncing(false);
    }
  }, [currentTenant?.id, service, user?.id]);

  useEffect(() => {
    const refresh = () => { void refreshPending(); };
    window.addEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED, refresh);
    void refreshPending();
    return () => window.removeEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED, refresh);
  }, [refreshPending]);

  useEffect(() => {
    if (online && options.autoRecover) void recover();
  }, [online, options.autoRecover, recover]);

  const submit = useCallback(async (command: DriverOperationalCommand) => {
    if (!currentTenant?.id || !user?.id) throw new Error('Sessão do motorista indisponível.');
    const result = await service.submit(currentTenant.id, user.id, command);
    await refreshPending();
    return result;
  }, [currentTenant?.id, refreshPending, service, user?.id]);

  return { submit, recover, pending, commands, syncing, online };
}
