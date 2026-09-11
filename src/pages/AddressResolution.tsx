import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, MapPin, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AddressResolutionPicker, type AddressResolutionSelection } from '@/components/maps/AddressResolutionPicker';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useAuth } from '@/hooks/useAuth';
import { useIsAdmin, useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import { geocodeAddress, type GeocodingCandidate } from '@/lib/geocoding';
import { acknowledgeDurableOperatorCommand, prepareDurableOperatorCommand } from '@/lib/operator/durableOperatorCommand';

type QueueItem = {
  id: string;
  entity_type: 'client' | 'dispatch_stop';
  entity_id: string;
  address_snapshot: string;
  status: 'pending' | 'ambiguous' | 'error';
  candidates: GeocodingCandidate[];
  attempts: number;
  last_error: string | null;
  invalidated_at: string | null;
  company_name: string;
  trade_name: string | null;
};

const isCandidate = (value: unknown): value is GeocodingCandidate => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.label === 'string' && typeof item.latitude === 'number'
    && typeof item.longitude === 'number' && typeof item.provider === 'string'
    && typeof item.accuracy_m === 'number' && typeof item.confidence === 'number';
};

const parseQueue = (value: unknown): QueueItem[] => Array.isArray(value) ? value.flatMap((raw) => {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.entity_id !== 'string' || typeof row.address_snapshot !== 'string') return [];
  const status = row.status;
  if (status !== 'pending' && status !== 'ambiguous' && status !== 'error') return [];
  const entityType = row.entity_type;
  if (entityType !== 'client' && entityType !== 'dispatch_stop') return [];
  return [{
    id: row.id,
    entity_type: entityType,
    entity_id: row.entity_id,
    address_snapshot: row.address_snapshot,
    status,
    candidates: Array.isArray(row.candidates) ? row.candidates.filter(isCandidate) : [],
    attempts: Number(row.attempts) || 0,
    last_error: typeof row.last_error === 'string' ? row.last_error : null,
    invalidated_at: typeof row.invalidated_at === 'string' ? row.invalidated_at : null,
    company_name: typeof row.company_name === 'string' ? row.company_name : 'Cliente',
    trade_name: typeof row.trade_name === 'string' ? row.trade_name : null,
  }];
}) : [];

export default function AddressResolution() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const tenantId = currentTenant?.id;
  const queryKey = ['address-resolution-queue', tenantId];

  const queue = useQuery({
    queryKey,
    enabled: Boolean(tenantId && isAdmin),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_address_resolution_queue_v1' as never, {
        _tenant_id: tenantId,
        _status: null,
        _limit: 200,
      } as never);
      if (error) throw error;
      return parseQueue(data);
    },
  });

  const searchMutation = useMutation({
    mutationFn: async (item: QueueItem) => {
      if (!tenantId) throw new Error('Empresa não selecionada.');
      return geocodeAddress(tenantId, item.address_snapshot, { type: item.entity_type, id: item.entity_id });
    },
    onSuccess: async (candidates) => {
      await queryClient.invalidateQueries({ queryKey });
      if (candidates.length === 0) toast.error('Nenhum endereço correspondente foi encontrado.');
      else toast.success(`${candidates.length} opção(ões) encontrada(s).`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Falha ao pesquisar endereço.'),
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ item, selection }: {
      item: QueueItem; selection: AddressResolutionSelection;
    }) => {
      if (!tenantId || !user?.id) throw new Error('Empresa ou usuário não selecionado.');
      const payload = {
        tenant_id: tenantId,
        queue_id: item.id,
        latitude: selection.latitude,
        longitude: selection.longitude,
        provider: selection.provider,
        accuracy_m: selection.accuracy_m,
        confidence: selection.confidence,
        label: selection.label,
        selection_kind: selection.selection_kind,
        previous_lat: selection.previous_lat,
        previous_lng: selection.previous_lng,
      };
      const pending = await prepareDurableOperatorCommand({
        tenantId,
        actorId: user.id,
        action: 'resolve_address',
        entityId: item.id,
        payload,
      });
      const { data, error } = await supabase.rpc('resolve_address_queue_item_v2' as never, { _payload: {
        ...payload,
        request_id: pending.requestId,
      } } as never);
      if (error) throw error;
      if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true
        || (data as Record<string, unknown>).request_id !== pending.requestId) {
        throw new Error('A confirmação do endereço não pôde ser validada. A solicitação foi preservada para reenvio.');
      }
      return pending;
    },
    onSuccess: async (pending) => {
      acknowledgeDurableOperatorCommand(pending);
      toast.success('Endereço verificado e vinculado ao destino.');
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Falha ao confirmar endereço.'),
  });

  if (!isAdmin) return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;
  const items = queue.data || [];

  return <div className="space-y-6 animate-fade-in">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><MapPin className="h-6 w-6 text-primary" />Endereços para validar</h1>
        <p className="mt-1 text-sm text-muted-foreground">Backfill assistido para endereços novos, alterados ou ambíguos.</p>
      </div>
      <Button type="button" variant="outline" onClick={() => void queue.refetch()} disabled={queue.isFetching}>
        <RefreshCw className={`mr-2 h-4 w-4 ${queue.isFetching ? 'animate-spin' : ''}`} />Atualizar
      </Button>
    </div>

    <div className="grid grid-cols-3 gap-3">
      {(['pending', 'ambiguous', 'error'] as const).map((status) => <Card key={status}>
        <CardContent className="py-4 text-center">
          <p className="text-2xl font-bold">{items.filter((item) => item.status === status).length}</p>
          <p className="text-xs text-muted-foreground">{status === 'pending' ? 'Pendentes' : status === 'ambiguous' ? 'Ambíguos' : 'Com erro'}</p>
        </CardContent>
      </Card>)}
    </div>

    {queue.error ? <Card role="alert" className="border-destructive/40"><CardContent className="py-4 text-sm text-destructive">
      Não foi possível carregar a fila de endereços.
    </CardContent></Card> : null}
    {!queue.isLoading && items.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
      <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" />Todos os endereços estão resolvidos.
    </CardContent></Card> : null}

    <div className="space-y-3">
      {items.map((item) => <Card key={item.id}>
        <CardHeader className="pb-2"><CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {item.company_name}<Badge variant={item.status === 'error' ? 'destructive' : 'secondary'}>{item.status}</Badge>
        </CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{item.address_snapshot}</p>
          {item.invalidated_at ? <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Endereço alterado; localização anterior invalidada.</p> : null}
          {item.last_error ? <p className="text-xs text-destructive">{item.last_error}</p> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => searchMutation.mutate(item)}
            disabled={searchMutation.isPending || resolveMutation.isPending}>
            {searchMutation.isPending && searchMutation.variables?.id === item.id
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Buscar opções
          </Button>
          {item.candidates.length > 0 ? <AddressResolutionPicker address={item.address_snapshot}
            candidates={item.candidates} disabled={resolveMutation.isPending}
            onConfirm={(selection) => resolveMutation.mutate({ item, selection })} /> : null}
        </CardContent>
      </Card>)}
    </div>
  </div>;
}
