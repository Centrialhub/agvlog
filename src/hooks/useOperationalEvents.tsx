import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables } from '@/integrations/supabase/types';
import { requestWithDeadline } from '@/lib/requestWithDeadline';
import { callOperatorEventRpc, operationalEventError, operationalEventReadError, parseOperationalEventCreateContext, parseOperationalEventResolveContext,
  type OperationalEventBindings, type OperationalEventCommandResult, type OperationalEventCreateResult,
  type OperationalEventCreateCommand, type OperationalEventResolveCommand, type OperationalEventResolveResult } from '@/lib/operationalEvents/operatorEventCommands';
import { createOperationalEventOutbox, OPERATIONAL_EVENT_COMMAND_CHANGED,
  pendingOperationalEventCommand } from '@/lib/operationalEvents/operatorEventOutbox';

export const EVENT_TYPES = [
  'missing_goods', 'missing_goods_fractional', 'wrong_quantity', 'client_refused', 'no_order',
  'expired_goods', 'near_expiration', 'damaged', 'wrong_address',
  'partial_delivery', 'return', 'wrong_product', 'boleto_extension', 'delivery_delay', 'other',
] as const;

export type OperationalEventType = typeof EVENT_TYPES[number];

export const EVENT_TYPE_LABELS: Record<OperationalEventType, string> = {
  missing_goods: 'Falta de Mercadoria (fechada)',
  missing_goods_fractional: 'Falta de Mercadoria (fracionado)',
  wrong_quantity: 'Quantidade Errada',
  client_refused: 'Cliente Fechado / Recusa',
  no_order: 'Cliente Não Fez o Pedido',
  expired_goods: 'Mercadoria Vencida',
  near_expiration: 'Produto Próximo do Vencimento',
  damaged: 'Avaria',
  wrong_address: 'Endereço Errado',
  partial_delivery: 'Entrega Parcial',
  return: 'Devolução',
  wrong_product: 'Mercadoria Invertida',
  boleto_extension: 'Prorrogação de Boleto',
  delivery_delay: 'Atraso na Entrega',
  other: 'Outro',
};

export const SEVERITY_LABELS: Record<string, string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
  critical: 'Crítica',
};

export type OperationalEvent = Omit<Tables<'operational_events'>, 'event_type'> & {
  event_type: OperationalEventType;
  loads?: { load_number: string } | null;
  drivers?: { id?: string; name: string } | null;
  clients?: { company_name: string } | null;
  vehicles?: { plate: string } | null;
};

export type OperationalEventCreate = {
  event_type: string;
  severity: string;
  description: string;
  financial_impact?: number | null;
  visible_to_client?: boolean;
  client_action_required?: boolean;
  load_id?: string | null;
  order_id?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  client_id?: string | null;
  dispatch_trip_id?: string | null;
  dispatch_stop_id?: string | null;
  fiscal_document_id?: string | null;
  proof_of_delivery_id?: string | null;
};
export type OperationalEventUpdate = { id: string; resolution: string };

export function useOperationalEvents() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['operational_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(id, name), clients(company_name), vehicles(plate)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as OperationalEvent[];
    },
    enabled: !!currentTenant,
  });
}

export interface OperationalEventsFilters {
  status?: 'all' | 'open' | 'resolved';
  type?: string;          // 'all' or one of EVENT_TYPES
  severity?: string;      // 'all' | 'low' | 'medium' | 'high' | 'critical'
  vehicleId?: string;     // 'all' or uuid
  dateFrom?: Date | null;
  dateTo?: Date | null;
  driverId?: string;      // 'all' or uuid
  clientId?: string;      // 'all' or uuid
  loadId?: string;        // 'all' or uuid
  impactMin?: number | null;
  impactMax?: number | null;
  hasImpact?: boolean;    // true => only impact > 0
}

/**
 * Versão server-side: empurra filtros (tipo, status, severidade, veículo, datas)
 * para o Supabase. Otimizado para frotas grandes.
 * Busca textual continua no cliente sobre o resultado já reduzido.
 */
export function useOperationalEventsFiltered(filters: OperationalEventsFilters) {
  const { currentTenant } = useTenant();
  const fromKey = filters.dateFrom ? filters.dateFrom.toISOString().slice(0, 10) : null;
  const toKey = filters.dateTo ? filters.dateTo.toISOString().slice(0, 10) : null;
  return useQuery({
    queryKey: [
      'operational_events_filtered',
      currentTenant?.id,
      filters.status ?? 'open',
      filters.type ?? 'all',
      filters.severity ?? 'all',
      filters.vehicleId ?? 'all',
      filters.driverId ?? 'all',
      filters.clientId ?? 'all',
      filters.loadId ?? 'all',
      filters.impactMin ?? null,
      filters.impactMax ?? null,
      filters.hasImpact ? 1 : 0,
      fromKey,
      toKey,
    ],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(id, name), clients(company_name), vehicles(plate)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(2000);

      if (filters.status === 'open') q = q.is('resolved_at', null);
      else if (filters.status === 'resolved') q = q.not('resolved_at', 'is', null);

      if (filters.type && filters.type !== 'all') q = q.eq('event_type', filters.type);
      if (filters.severity && filters.severity !== 'all') q = q.eq('severity', filters.severity);
      if (filters.vehicleId && filters.vehicleId !== 'all') q = q.eq('vehicle_id', filters.vehicleId);
      if (filters.driverId && filters.driverId !== 'all') q = q.eq('driver_id', filters.driverId);
      if (filters.clientId && filters.clientId !== 'all') q = q.eq('client_id', filters.clientId);
      if (filters.loadId && filters.loadId !== 'all') q = q.eq('load_id', filters.loadId);
      if (filters.hasImpact) q = q.gt('financial_impact', 0);
      if (typeof filters.impactMin === 'number' && !isNaN(filters.impactMin)) q = q.gte('financial_impact', filters.impactMin);
      if (typeof filters.impactMax === 'number' && !isNaN(filters.impactMax)) q = q.lte('financial_impact', filters.impactMax);

      if (filters.dateFrom) {
        const d = new Date(filters.dateFrom);
        d.setHours(0, 0, 0, 0);
        q = q.gte('created_at', d.toISOString());
      }
      if (filters.dateTo) {
        const d = new Date(filters.dateTo);
        d.setHours(23, 59, 59, 999);
        q = q.lte('created_at', d.toISOString());
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as OperationalEvent[];
    },
    enabled: !!currentTenant,
    placeholderData: (prev) => prev,
  });
}

export function useCreateOperationalEvent() {
  const commands = useOperationalEventCommandTransport();
  const mutation = useMutation({ mutationFn: commands.create });
  return { ...mutation, pendingCommand: commands.pending, recoveryError: commands.recoveryError, recoverAsync: commands.recover };
}

export function useUpdateOperationalEvent() {
  const commands = useOperationalEventCommandTransport();
  const mutation = useMutation({ mutationFn: commands.resolve });
  return { ...mutation, pendingCommand: commands.pending, recoveryError: commands.recoveryError, recoverAsync: commands.recover };
}

const commandInvalidations = ['operational_events', 'operational_events_filtered', 'traceability', 'pod-history'];
const bindingKeys = ['load_id','order_id','vehicle_id','driver_id','client_id','dispatch_trip_id','dispatch_stop_id','fiscal_document_id','proof_of_delivery_id'] as const;

function useOperationalEventCommandTransport() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  const tenant = currentTenant?.id;
  const actor = user?.id;
  const latest = useRef({ tenant, actor });
  latest.current = { tenant, actor };
  const alive = useRef(true);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    alive.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('storage', changed);
    window.addEventListener(OPERATIONAL_EVENT_COMMAND_CHANGED, changed);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(OPERATIONAL_EVENT_COMMAND_CHANGED, changed);
    };
  }, []);

  const assertContext = useCallback(() => {
    if (!alive.current || latest.current.tenant !== tenant || latest.current.actor !== actor) {
      throw new Error('A sessão ou empresa mudou. Recupere a ocorrência na sessão original.');
    }
  }, [actor, tenant]);

  const outbox = useMemo(() => createOperationalEventOutbox({
    get storage() { return window.localStorage; },
    uuid: () => crypto.randomUUID(),
    assertContext,
    changed: () => window.dispatchEvent(new Event(OPERATIONAL_EVENT_COMMAND_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para alterar ocorrências.');
      return navigator.locks.request(key, work);
    },
    send: (action, payload) => requestWithDeadline(signal => action === 'create'
      ? callOperatorEventRpc('create_operational_event_v1', { _payload: payload as OperationalEventCreateCommand }, signal)
      : callOperatorEventRpc('resolve_operational_event_v1', { _payload: payload as OperationalEventResolveCommand }, signal)),
  }), [assertContext]);

  const recovery = useMemo(() => {
    try { return { revision, pending: tenant && actor ? pendingOperationalEventCommand(window.localStorage, tenant, actor) : null, error: null }; }
    catch (cause) { return { revision, pending: null, error: operationalEventError(cause) }; }
  }, [tenant, actor, revision]);

  const run = useCallback(async <Result extends OperationalEventCommandResult>(work: () => Promise<Result>) => {
    if (!tenant || !actor) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (busy.current) throw new Error('Aguarde a solicitação de ocorrência em andamento.');
    assertContext(); busy.current = true; setPending(true);
    try { const result = await work(); assertContext(); return result; }
    catch (cause) { throw new Error(operationalEventError(cause)); }
    finally {
      try { await Promise.all(commandInvalidations.map(key => qc.invalidateQueries({ queryKey: [key] }))); }
      finally { busy.current = false; if (alive.current) setPending(false); }
    }
  }, [actor, assertContext, qc, tenant]);

  const create = useCallback((values: OperationalEventCreate) => run<OperationalEventCreateResult>(async () => {
    if (pendingOperationalEventCommand(window.localStorage, tenant!, actor!)) throw new Error('Há uma ocorrência sem confirmação. Recupere o pedido existente antes de iniciar outro.');
    const bindings = Object.fromEntries(bindingKeys.flatMap(key => values[key] ? [[key, values[key]]] : [])) as OperationalEventBindings;
    let contextResponse;
    try { contextResponse = await requestWithDeadline(signal => callOperatorEventRpc(
      'get_operational_event_create_context', { _tenant_id: tenant!, _bindings: bindings }, signal,
    )); } catch (cause) { throw new Error(operationalEventReadError(cause, 'Não foi possível obter o contexto atualizado. Tente novamente.')); }
    if (contextResponse.error) throw new Error(operationalEventReadError(contextResponse.error, 'Não foi possível obter o contexto atualizado. Tente novamente.'));
    const context = parseOperationalEventCreateContext(contextResponse.data, tenant!, actor!);
    return outbox.submitCreate(tenant!, actor!, {
      expected_revision: context.revision,
      event_type: values.event_type,
      severity: values.severity as 'low'|'medium'|'high'|'critical',
      description: values.description,
      financial_impact_cents: Math.round(Number(values.financial_impact || 0) * 100),
      visible_to_client: values.visible_to_client ?? false,
      client_action_required: values.client_action_required ?? false,
      bindings: context.bindings,
    });
  }), [actor, outbox, run, tenant]);

  const resolve = useCallback((values: OperationalEventUpdate) => run<OperationalEventResolveResult>(async () => {
    if (pendingOperationalEventCommand(window.localStorage, tenant!, actor!)) throw new Error('Há uma ocorrência sem confirmação. Recupere o pedido existente antes de iniciar outro.');
    let contextResponse;
    try { contextResponse = await requestWithDeadline(signal => callOperatorEventRpc(
      'get_operational_event_context', { _tenant_id: tenant!, _event_id: values.id }, signal,
    )); } catch (cause) { throw new Error(operationalEventReadError(cause, 'Não foi possível obter o contexto atualizado. Tente novamente.')); }
    if (contextResponse.error) throw new Error(operationalEventReadError(contextResponse.error, 'Não foi possível obter o contexto atualizado. Tente novamente.'));
    const context = parseOperationalEventResolveContext(contextResponse.data, tenant!, actor!, values.id);
    if (!context.can_resolve) throw new Error('Esta ocorrência já foi resolvida. Atualize a listagem.');
    return outbox.submitResolve(tenant!, actor!, { event_id: values.id, expected_revision: context.revision, resolution: values.resolution });
  }), [actor, outbox, run, tenant]);

  const recover = useCallback(() => run(() => outbox.recover(tenant!, actor!)), [actor, outbox, run, tenant]);
  return { create, resolve, recover, pending: recovery.pending, recoveryError: recovery.error, isPending };
}
