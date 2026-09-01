import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import type { FinancialStatus } from '@/lib/loadImports/loadImportNormalizer';
import type { Json } from '@/integrations/supabase/types';
import { loadPaymentError, type LoadPaymentCommandInput, type LoadPaymentResult } from '@/lib/loadPayments/loadPaymentCommands';
import { createLoadPaymentOutbox, LOAD_PAYMENT_COMMAND_CHANGED, pendingLoadPaymentCommand } from '@/lib/loadPayments/loadPaymentOutbox';

export interface LoadControlRow {
  id: string;
  tenant_id: string;
  load_number: string;
  external_load_number: string | null;
  load_date: string | null;
  arrival_date: string | null;
  gross_cargo_value: number;
  freight_amount: number;
  freight_percent: number | null;
  total_weight_kg: number | null;
  invoice_count: number;
  cte_count: number;
  operational_status: string | null;
  billing_status: string | null;
  payment_status: FinancialStatus | string;
  expected_payment_date: string | null;
  payment_date: string | null;
  received_amount: number;
  legacy_status_text: string | null;
  client_name?: string | null;
  driver_name?: string | null;
  plate?: string | null;
  cte_numbers?: string[];
  receivable_id?: string | null;
  client_invoice_id?: string | null;
  doccob_export_id?: string | null;
  origin?: string | null;
  destination?: string | null;
  status?: string;
}

export interface UnloadingChargeRow {
  id: string;
  invoice_number: string | null;
  client_name: string | null;
  supplier_name: string | null;
  city: string | null;
  service_date: string | null;
  amount: number;
  status: string;
  load?: { id: string; external_load_number: string | null; load_number: string } | null;
  metadata?: Json;
}

export interface LoadControlFilters {
  loadNumber?: string | null;
  clientId?: string | null;
  paymentStatus?: string | null;
  operationalStatus?: string | null;
  billingStatus?: string | null;
  loadDateFrom?: string | null;
  loadDateTo?: string | null;
  expectedPayFrom?: string | null;
  expectedPayTo?: string | null;
  batchId?: string | null;
}

export function useLoadControlList(filters: LoadControlFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load-control', currentTenant?.id, filters],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      let q = supabase.from('loads')
        .select(`id, tenant_id, load_number, external_load_number, load_date, arrival_date,
                 gross_cargo_value, freight_amount, freight_percent, total_weight_kg,
                 invoice_count, cte_count, operational_status, billing_status, payment_status,
                 expected_payment_date, payment_date, received_amount, legacy_status_text,
                 receivable_id, client_invoice_id, doccob_export_id,
                 origin, destination, status,
                 trailer_plate,
                 drivers:driver_id(name),
                 vehicles:vehicle_id(plate)`)
        .eq('tenant_id', currentTenant!.id)
        .order('load_date', { ascending: false, nullsFirst: false })
        .limit(500);

      if (filters.loadNumber) q = q.or(`external_load_number.ilike.%${filters.loadNumber}%,load_number.ilike.%${filters.loadNumber}%`);
      if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus);
      if (filters.operationalStatus) q = q.eq('operational_status', filters.operationalStatus);
      if (filters.billingStatus) q = q.eq('billing_status', filters.billingStatus);
      if (filters.loadDateFrom) q = q.gte('load_date', filters.loadDateFrom);
      if (filters.loadDateTo) q = q.lte('load_date', filters.loadDateTo);
      if (filters.expectedPayFrom) q = q.gte('expected_payment_date', filters.expectedPayFrom);
      if (filters.expectedPayTo) q = q.lte('expected_payment_date', filters.expectedPayTo);
      if (filters.batchId) q = q.eq('last_import_batch_id', filters.batchId);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r) => ({
        ...r,
        client_name: r.origin || r.destination || null,
        driver_name: r.drivers?.name || null,
        plate: r.vehicles?.plate || r.trailer_plate || null,
      })) as LoadControlRow[];
    },
  });
}

export function useLoadDocuments(loadId: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load-documents', currentTenant?.id, loadId],
    enabled: !!currentTenant?.id && !!loadId,
    queryFn: async () => {
      if (!currentTenant?.id || !loadId) throw new Error('Carga ou tenant não informado');
      const { data, error } = await supabase.from('load_documents')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('load_id', loadId)
        .order('document_type');
      if (error) throw error;
      return data || [];
    },
  });
}

export function useUnloadingCharges(filters: { loadId?: string | null; status?: string | null } = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load-unloading', currentTenant?.id, filters],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      let q = supabase.from('load_unloading_charges')
        .select('*, load:load_id(id, load_number, external_load_number)')
        .eq('tenant_id', currentTenant!.id)
        .order('service_date', { ascending: false })
        .limit(1000);
      if (filters.loadId) q = q.eq('load_id', filters.loadId);
      if (filters.status) q = q.eq('status', filters.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as UnloadingChargeRow[];
    },
  });
}

export function useImportBatches() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load-import-batches', currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('load_import_batches')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
  });
}

// ---- Mutations ----------------------------------------------------

export function useRegisterPayment() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const actor = user?.id;
  const tenant = currentTenant?.id;
  const latest = useRef({ actor, tenant });
  latest.current = { actor, tenant };
  const alive = useRef(true);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    alive.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('storage', changed);
    window.addEventListener(LOAD_PAYMENT_COMMAND_CHANGED, changed);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(LOAD_PAYMENT_COMMAND_CHANGED, changed);
    };
  }, []);

  const assertContext = useCallback(() => {
    if (!alive.current || latest.current.actor !== actor || latest.current.tenant !== tenant) {
      throw new Error('A sessão ou empresa mudou. Recupere o pagamento na sessão original.');
    }
  }, [actor, tenant]);

  const outbox = useMemo(() => createLoadPaymentOutbox({
    get storage() { return window.localStorage; },
    uuid: () => crypto.randomUUID(),
    assertContext,
    changed: () => window.dispatchEvent(new Event(LOAD_PAYMENT_COMMAND_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) throw new Error('Use um navegador atualizado em conexão segura para confirmar o pagamento.');
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        return await supabase.rpc('apply_load_payment_command', {
          _payload: JSON.parse(JSON.stringify(payload)),
        }).abortSignal(controller.signal);
      } finally { clearTimeout(timeout); }
    },
  }), [assertContext]);

  const recovery = useMemo(() => {
    try {
      return { revision, pending: tenant && actor ? pendingLoadPaymentCommand(window.localStorage, tenant, actor) : null, error: null };
    } catch (cause) {
      return { revision, pending: null, error: loadPaymentError(cause) };
    }
  }, [tenant, actor, revision]);

  const run = async (work: () => Promise<LoadPaymentResult>) => {
    if (!tenant || !actor) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (busy.current) throw new Error('Aguarde o pagamento em andamento.');
    assertContext();
    busy.current = true;
    setPending(true);
    try {
      const result = await work();
      assertContext();
      return result;
    } catch (cause) {
      throw new Error(loadPaymentError(cause));
    } finally {
      try {
        await Promise.all([
          'load-control', 'load_payments', 'load-status-history', 'receivables',
          'receivables_payments', 'bank_transactions', 'closing-reports', 'client_invoices',
        ].map(key => qc.invalidateQueries({ queryKey: [key] })));
      } finally {
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };

  return {
    isPending,
    pending: recovery.pending,
    recoveryError: recovery.error,
    submit: (input: LoadPaymentCommandInput) => run(() => outbox.submit(tenant!, actor!, input)),
    recover: () => run(() => outbox.recover(tenant!, actor!)),
  };
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Não pago', partially_paid: 'Parcial', paid: 'Pago',
  overdue: 'Vencido', disputed: 'Em disputa', cancelled: 'Cancelado',
};
export const OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho', imported: 'Importada', received: 'Recebida', planned: 'Planejada',
  in_transit: 'Em trânsito', delivered: 'Entregue', closed: 'Fechada', cancelled: 'Cancelada',
};
export const BILLING_STATUS_LABELS: Record<string, string> = {
  not_invoiced: 'Sem fatura', invoice_pending: 'Pendente', invoiced: 'Faturada',
  doccob_generated: 'DOCCOB gerado', sent_to_client: 'Enviada', cancelled: 'Cancelada',
};
