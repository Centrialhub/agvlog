import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useDriverCargoTripIdentity } from '@/hooks/useDriverCargoTripIdentity';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getCompleteTripCargoControl, updateDriverTripCargo } from '@/lib/driver/tripCargoCustody';
import { completeQuickCargoConference } from '@/lib/driver/quickCargoConference';
import { supabase } from '@/integrations/supabase/client';
import { invalidateTripLoadQueries, isConfirmedTripStart } from '@/lib/tripMutation';
import LegacyCargo from './DriverCargoCustodyLegacy';

export default function DriverCargoCustody() {
  const [params] = useSearchParams();
  const { currentTenant } = useTenant(); const { user } = useAuth();
  const driver = useCurrentDriver(); const activeTrip = useActiveTrip(driver.data?.id);
  const tripId = params.get('trip') || activeTrip.data?.id;
  if (driver.isError || (driver.isSuccess && (!driver.data || !driver.data.active))) return <div className="space-y-4"><h1 className="text-lg font-bold">Conferência rápida</h1><p role="alert">Não foi possível validar o motorista ativo. Atualize o app ou confira seu vínculo com a operação.</p></div>;
  if (params.get('details') === '1') return <LegacyCargo />;
  return <QuickConference key={`${currentTenant?.id}:${user?.id}:${driver.data?.id}:${tripId}`}
    tripId={tripId} driverId={driver.data?.active ? driver.data.id : undefined} />;
}

function QuickConference({ tripId, driverId }: { tripId?: string; driverId?: string }) {
  const { currentTenant } = useTenant(); const { user } = useAuth();
  const online = useOnlineStatus(); const navigate = useNavigate(); const qc = useQueryClient();
  const identity = useDriverCargoTripIdentity(driverId, tripId ?? null);
  const active = useRef(true); const requests = useRef(new Map<string, string>());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const read = () => getCompleteTripCargoControl(currentTenant!.id, tripId!);
  const cargo = useQuery({ queryKey: ['trip-cargo-control', currentTenant?.id, user?.id, driverId, tripId],
    enabled: !!currentTenant && !!user && !!driverId && !!tripId, retry: false, queryFn: read });
  const validIdentity = !identity.isError && !identity.isFetching && !!identity.data?.plate
    && !!identity.data.loads.length && identity.data.loads.every(item => !!item.loadNumber);
  const execute = useMutation({ mutationFn: async () => {
    const assertActive = () => {
      if (!active.current || !online || !user || !currentTenant || !tripId || !driverId)
        throw new Error('A sessão ou a conexão mudou. Atualize antes de continuar.');
    };
    assertActive();
    if (!validIdentity || cargo.isError) throw new Error('Atualize a identificação da carga antes de confirmar.');
    await completeQuickCargoConference({ read, assertActive,
      command: async (action, payload) => {
        assertActive(); const key = `${action}:${JSON.stringify(payload ?? {})}`;
        const requestId = requests.current.get(key) ?? crypto.randomUUID(); requests.current.set(key, requestId);
        const result = await updateDriverTripCargo({ tenantId: currentTenant!.id, tripId: tripId!, requestId, action, payload });
        requests.current.delete(key); return result;
      }, start: async () => {
        assertActive(); const { data, error } = await supabase.rpc('driver_start_trip', { _trip_id: tripId! });
        if (error) throw new Error(error.message);
        if (!isConfirmedTripStart(data, tripId!)) throw new Error('O início da viagem não foi confirmado. Tente novamente.');
      },
    });
  }, onSuccess: async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['trip-cargo-control'] }), invalidateTripLoadQueries(qc)]);
    if (active.current) navigate(`/driver/stops?trip=${encodeURIComponent(tripId!)}`);
  }, onError: () => { if (active.current) void cargo.refetch(); } });
  const started = cargo.data?.available && ['returned', 'closed'].includes(cargo.data.control.status);
  return <div className="space-y-4">
    <h1 className="text-lg font-bold">Conferência rápida</h1>
    <Card><CardContent className="space-y-4 p-4">
      {identity.data && <p className="text-sm">Carga {identity.data.loads.map(item => item.loadNumber).join(', ')} · placa {identity.data.plate}</p>}
      {!tripId ? <p>Nenhuma viagem disponível para conferência.</p> : <>
        <p>Um toque seleciona todas as notas, confirma a carga, inicia a viagem e abre suas entregas.</p>
        {cargo.data?.available && <p className="font-medium">{cargo.data.documents.length} nota(s) da carga</p>}
        {cargo.data?.available && <details><summary>Ver notas</summary><ul className="mt-2 space-y-1 text-sm">
          {cargo.data.documents.map(item => <li key={item.id}>{item.reference_number}</li>)}
        </ul></details>}
        {!online && <p role="status">Conecte-se à internet para confirmar a conferência.</p>}
        {(cargo.isPending || identity.isFetching) && <p role="status">Carregando conferência…</p>}
        {(cargo.isError || identity.isError) && <div role="alert"><p>Não foi possível carregar a carga.</p>
          <Button variant="outline" onClick={() => { void cargo.refetch(); void identity.refetch(); }}>Atualizar carga</Button></div>}
        {!identity.isFetching && !identity.isError && !validIdentity && <div role="status"><p>A carga ou a placa ainda não está identificada. Atualize; se continuar, peça à operação para conferir o vínculo.</p>
          <Button variant="outline" onClick={() => void identity.refetch()}>Atualizar identificação</Button></div>}
        {execute.isError && <p role="alert">{execute.error instanceof Error ? execute.error.message : 'Não foi possível confirmar. Atualize e tente novamente.'}</p>}
        {started ? <>
          <Button className="h-12 w-full" onClick={() => navigate(`/driver/stops?trip=${encodeURIComponent(tripId)}`)}>Ir para entregas</Button>
          <Button variant="link" onClick={() => navigate(`/driver/cargo?trip=${encodeURIComponent(tripId)}&details=1`)}>Ver registro e retorno da viagem</Button>
        </> : <Button className="h-12 w-full" disabled={!online || !driverId || !validIdentity || cargo.isPending || cargo.isError || execute.isPending}
          onClick={() => execute.mutate()}>{execute.isPending ? 'Confirmando e abrindo entregas…' : 'Confirmar carga e iniciar entregas'}</Button>}
      </>}
    </CardContent></Card>
  </div>;
}
