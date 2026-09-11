import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import type { useLoadReplanning } from '@/hooks/useLoadReplanning';
import { isRecord, parseReplanningContext, type ReplanningResult, type ReplanningTarget } from '@/lib/loads/replanning';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/errors';
import { LocationPicker } from '@/components/maps/LocationPicker';
import type { ResolvedLocation } from '@/lib/geocoding';

interface Props {
  api: ReturnType<typeof useLoadReplanning>; sourceId: string; targetId: string; itemIds: string[];
  disabled?: boolean; onConfirmed: (result: ReplanningResult) => void;
}
export function LoadReplanningPanel({ api, sourceId, targetId, itemIds, disabled, onConfirmed }: Props) {
  const { currentTenant } = useTenant(); const { user } = useAuth();
  const [open, setOpen] = useState(false); const [choice, setChoice] = useState(''); const [reason, setReason] = useState('');
  const [destination, setDestination] = useState(''); const [location, setLocation] = useState<ResolvedLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false); setChoice(''); setReason(''); setError(null);
    setDestination(''); setLocation(null);
  }, [sourceId, targetId, currentTenant?.id, user?.id]);
  const query = useQuery({
    queryKey: ['load_replanning_context', currentTenant?.id, user?.id, sourceId, targetId],
    enabled: open && !!currentTenant?.id && !!sourceId && !!targetId,
    staleTime: 0, retry: false,
    queryFn: async ({ signal }) => {
      const { data, error: failure } = await supabase.rpc('get_load_replanning_context', {
        _tenant_id: currentTenant!.id, _source_load_id: sourceId, _target_load_id: targetId,
      }).abortSignal(signal);
      if (failure) throw failure;
      return parseReplanningContext(data, sourceId, targetId);
    },
  });
  const context = query.data; const targetTrip = context?.loads.find(load => load.id === targetId)?.trip_id;
  const targetStops = context?.stops.filter(stop => stop.dispatch_trip_id === targetTrip && stop.status === 'pending') ?? [];
  const unresolved = api.pending.length > 0 || !!api.recoveryError;
  async function submit() {
    setError(null);
    let submitted = false;
    try {
      if (!context || !reason.trim() || !choice) throw new Error('Escolha explicitamente o destino e informe o motivo.');
      const items = itemIds.map(id => context.items.find(item => item.id === id && item.load_id === sourceId));
      if (!items.length || items.some(item => !item)) throw new Error('A seleção mudou. Atualize as cargas e selecione novamente.');
      let target: ReplanningTarget;
      if (choice === 'unassigned') target = { mode: 'unassigned' };
      else if (choice === 'new') {
        if (!destination.trim() || !location) throw new Error('Informe o endereço e confirme o ponto no mapa.');
        target = { mode: 'new', destination: destination.trim(), latitude: location.latitude, longitude: location.longitude, client_id: null,
          location_source: location.source, location_address: location.address || destination.trim(),
          location_provider: location.provider, location_accuracy_m: location.accuracy_m,
          location_confidence: location.confidence, location_audit: location.audit, geofence_radius_m: 500 };
      } else target = { mode: 'existing', stop_id: choice };
      submitted = true;
      const result = await api.submit({ source_load_id: sourceId, target_load_id: targetId, item_ids: itemIds,
        expected_document_ids: [...new Set(items.flatMap(item => item?.fiscal_document_id ? [item.fiscal_document_id] : []))],
        revision: context.revision, reason: reason.trim(), target_stop: target });
      setOpen(false); onConfirmed(result);
    } catch (failure) {
      setError(getErrorMessage(failure, 'Não foi possível confirmar o replanejamento.'));
      if (submitted && !(isRecord(failure) && failure.outcome === 'rejected')) setOpen(false);
    }
  }
  return <section className="space-y-3" aria-label="Replanejamento de cargas">
    {api.recoveryError && <p role="alert">{api.recoveryError}</p>}
    {api.pending.map(item => <div key={item.requestId} className="rounded border border-warning/40 p-3 space-y-2">
      <p role="status" className="text-sm">Há um replanejamento sem confirmação. Recupere a solicitação original antes de enviar outra movimentação.</p>
      <p className="text-xs text-muted-foreground">{item.payload.reason}</p>
      <Button variant="outline" disabled={api.isPending} onClick={async () => {
        setError(null);
        try { const result = await api.recover(item.scope); setOpen(false); onConfirmed(result); }
        catch (failure) { setError(getErrorMessage(failure, 'Falha ao recuperar replanejamento.')); }
      }}>Recuperar replanejamento</Button>
    </div>)}
    {!open && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {sourceId && targetId && itemIds.length > 0 && <Button variant="outline" disabled={disabled || api.isPending || unresolved}
      onClick={() => { setChoice(''); setError(null); setOpen(true); }}>Replanejar itens e paradas</Button>}
    <Dialog open={open} onOpenChange={value => { if (!api.isPending) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replanejar realocação</DialogTitle>
          <DialogDescription>Confirme o destino dos itens. Paradas esvaziadas ficam canceladas no histórico; nenhuma entrega, emissão fiscal ou partida será criada.</DialogDescription>
        </DialogHeader>
        {query.isPending ? <p role="status">Carregando plano atual…</p> : query.error ? <div className="space-y-2">
          <p role="alert">{getErrorMessage(query.error, 'Falha ao consultar o plano.')}</p>
          <Button variant="outline" onClick={() => { setChoice(''); void query.refetch(); }}>Atualizar plano</Button>
        </div> : <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="replanning-target">Destino dos itens</Label>
            <Select value={choice} onValueChange={setChoice} disabled={api.isPending}>
              <SelectTrigger id="replanning-target"><SelectValue placeholder="Escolha o destino explicitamente" /></SelectTrigger>
              <SelectContent>{targetTrip ? <>
                {targetStops.map(stop => <SelectItem key={stop.id} value={stop.id}>Parada {stop.stop_order}: {stop.destination}</SelectItem>)}
                <SelectItem value="new">Nova parada com localização</SelectItem>
              </> : <SelectItem value="unassigned">Carga sem viagem: aguardar novo planejamento</SelectItem>}</SelectContent>
            </Select>
          </div>
          {choice === 'new' && <>
            <div><Label htmlFor="replanning-destination">Endereço/destino da nova parada</Label>
              <Input id="replanning-destination" value={destination} onChange={event => setDestination(event.target.value)} disabled={api.isPending} /></div>
            {currentTenant ? <LocationPicker tenantId={currentTenant.id} address={destination} value={location}
              onAddressChange={setDestination} onChange={setLocation} disabled={api.isPending} /> : null}
          </>}
          <div><Label htmlFor="replanning-reason">Motivo do replanejamento</Label>
            <Textarea id="replanning-reason" value={reason} maxLength={2000} onChange={event => setReason(event.target.value)} disabled={api.isPending} /></div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button disabled={api.isPending || unresolved || query.isFetching} onClick={() => void submit()}>
            {api.isPending ? 'Confirmando…' : 'Confirmar replanejamento'}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  </section>;
}
