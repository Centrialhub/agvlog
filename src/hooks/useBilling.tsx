import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';
import { getGroupingMode } from '@/lib/cteGroupingModes';

export interface CteBatch {
  id: string;
  tenant_id: string;
  client_id: string | null;
  grouping_mode: number;
  grouping_mode_label: string | null;
  source_type: 'period' | 'loads';
  period_start: string | null;
  period_end: string | null;
  load_ids: string[];
  fiscal_document_ids: string[];
  total_documents: number;
  total_value: number;
  total_freight: number;
  status: 'draft' | 'generated' | 'cancelled';
  notes: string | null;
  created_at: string;
  clients?: { company_name: string } | null;
}

export interface CteDocument {
  id: string;
  batch_id: string;
  cte_number: string | null;
  cte_series: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  load_ids: string[];
  fiscal_document_ids: string[];
  invoice_count: number;
  pallet_count: number;
  weight_kg: number;
  cargo_value: number;
  freight_value: number;
  ibs_value: number | null;
  cbs_value: number | null;
  net_value: number | null;
  status: 'draft' | 'issued' | 'cancelled';
  issued_at: string | null;
  created_at: string;
}

export function useCteBatches() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['cte_batches', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('cte_batches')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as CteBatch[];
    },
    enabled: !!currentTenant,
  });
}

export function useCteDocuments(batchId: string | null) {
  return useQuery({
    queryKey: ['cte_documents', batchId],
    queryFn: async () => {
      if (!batchId) return [];
      const { data, error } = await supabase
        .from('cte_documents')
        .select('*')
        .eq('batch_id', batchId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as CteDocument[];
    },
    enabled: !!batchId,
  });
}

export interface IssuedCte {
  id: string;
  invoice_number: string | null;
  status: string | null;
  sefaz_status: string | null;
  sefaz_message: string | null;
  access_key: string | null;
  hub_document_id: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  freight_value: number;
  created_at: string;
  /** NFs de entrada agrupadas nesse CT-e. */
  notes: { id: string; invoice_number: string | null; recipient: string | null; value: number }[];
}

/**
 * CT-es realmente transmitidos (fiscal_documents outbound) com as NFs de entrada
 * vinculadas — usado no histórico do CT-e Hub, onde antes as notas não apareciam.
 */
export function useIssuedCtes() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['issued_ctes', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async (): Promise<IssuedCte[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select(
          'id, invoice_number, status, sefaz_status, sefaz_message, access_key, hub_document_id, remitter, recipient, recipient_city, recipient_state, freight_value, created_at',
        )
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'outbound')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      const ctes = (data || []) as any[];
      if (ctes.length === 0) return [];

      const { data: notes } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, recipient, value, cte_emitted_outbound_id')
        .eq('tenant_id', currentTenant.id)
        .in('cte_emitted_outbound_id', ctes.map((c) => c.id));

      const byCte = new Map<string, IssuedCte['notes']>();
      for (const n of (notes || []) as any[]) {
        const arr = byCte.get(n.cte_emitted_outbound_id) || [];
        arr.push({ id: n.id, invoice_number: n.invoice_number, recipient: n.recipient, value: Number(n.value || 0) });
        byCte.set(n.cte_emitted_outbound_id, arr);
      }

      return ctes.map((c) => ({
        ...c,
        freight_value: Number(c.freight_value || 0),
        notes: byCte.get(c.id) || [],
      })) as IssuedCte[];
    },
  });
}

/**
 * Exclui o registro local de um CT-e (outbound) e libera as NFs vinculadas.
 * Não permitido para CT-e autorizado que ainda não foi cancelado na SEFAZ.
 */
export function useDeleteIssuedCte() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não encontrado');
      const { data: doc, error: readErr } = await supabase
        .from('fiscal_documents')
        .select('id, status, sefaz_status')
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!doc) throw new Error('CT-e não encontrado');
      const status = (doc as any).status as string;
      const sefaz = (doc as any).sefaz_status as string | null;
      const isAuthorizedLive = status === 'authorized' && sefaz !== 'cancelled';
      if (isAuthorizedLive && sefaz !== 'cancel_rejected') {
        throw new Error('CT-e autorizado não pode ser excluído — cancele na SEFAZ primeiro');
      }

      // Libera as NFs vinculadas para novo faturamento
      // guardrail:allow-direct-write
      const { error: relErr } = await supabase
        .from('fiscal_documents')
        .update({ cte_emitted_at: null, cte_emitted_outbound_id: null } as any)
        .eq('tenant_id', currentTenant.id)
        .eq('cte_emitted_outbound_id', id);
      if (relErr) throw relErr;

      const { error } = await supabase
        .from('fiscal_documents')
        .delete()
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issued_ctes'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
    },
  });
}

interface CreateBatchInput {
  client_id: string | null;
  emitter_id?: string | null;
  grouping_mode: number;
  source_type: 'period' | 'loads';
  period_start?: string | null;
  period_end?: string | null;
  load_ids?: string[];
  fiscal_document_ids: string[];
  groups: CteGroupPreview[];
  notes?: string;
}

/**
 * Cria um lote de faturamento e materializa os CT-es a partir da prévia de grupos.
 * Calcula impostos pela reforma tributária: IBS 0,10% + CBS 0,90%; net = freight - taxes.
 */
export function useCreateCteBatch() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateBatchInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const mode = getGroupingMode(input.grouping_mode);
      const totalValue = input.groups.reduce((s, g) => s + g.cargo_value, 0);
      const totalFreight = input.groups.reduce((s, g) => s + g.freight_value, 0);

      // Resolve emitente (override → default ativo) para vincular remetente/CNPJ nos CT-es do lote.
      let emitter: any = null;
      if (input.emitter_id) {
        const { data } = await (supabase as any)
          .from('tenant_emitters').select('*').eq('id', input.emitter_id).maybeSingle();
        emitter = data || null;
      }
      if (!emitter) {
        const { data } = await (supabase as any)
          .from('tenant_emitters').select('*')
          .eq('tenant_id', currentTenant.id).eq('active', true)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1);
        emitter = data?.[0] || null;
      }

      const { data: batch, error: e1 } = await supabase
        .from('cte_batches')
        .insert({
          tenant_id: currentTenant.id,
          client_id: input.client_id,
          emitter_id: emitter?.id || input.emitter_id || null,
          grouping_mode: input.grouping_mode,
          grouping_mode_label: mode.label,
          source_type: input.source_type,
          period_start: input.period_start || null,
          period_end: input.period_end || null,
          load_ids: input.load_ids || [],
          fiscal_document_ids: input.fiscal_document_ids,
          total_documents: input.groups.length,
          total_value: totalValue,
          total_freight: totalFreight,
          status: 'generated',
          notes: input.notes || null,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (e1) throw e1;

      // Generate sequential CT-e numbers per batch (placeholder; real numbering integra com SEFAZ).
      const docsPayload = input.groups.map((g, idx) => {
        const ibs_rate = 0.001; // 0,10%
        const cbs_rate = 0.009; // 0,90%
        const ibs_value = +(g.freight_value * ibs_rate).toFixed(2);
        const cbs_value = +(g.freight_value * cbs_rate).toFixed(2);
        const net_value = +(g.freight_value - ibs_value - cbs_value).toFixed(2);
        return {
          tenant_id: currentTenant.id,
          batch_id: batch.id,
          emitter_id: emitter?.id || input.emitter_id || null,
          client_id: g.client_id,
          cte_number: `RASCUNHO-${String(idx + 1).padStart(4, '0')}`,
          cte_series: '1',
          remitter: emitter?.razao_social || emitter?.nome_fantasia || g.remitter,
          remitter_cnpj: emitter?.cnpj || null,
          recipient: g.recipient,
          recipient_city: g.recipient_city,
          recipient_state: g.recipient_state,
          load_ids: g.load_ids,
          fiscal_document_ids: g.fiscal_document_ids,
          invoice_count: g.invoice_count,
          pallet_count: g.pallet_count,
          weight_kg: g.weight_kg,
          cargo_value: g.cargo_value,
          freight_value: g.freight_value,
          ibs_base: g.freight_value,
          ibs_rate,
          ibs_value,
          cbs_base: g.freight_value,
          cbs_rate,
          cbs_value,
          net_value,
          status: 'draft',
          grouping_keys: { mode: input.grouping_mode, key: g.key },
          created_by: user?.id,
        };
      });

      if (docsPayload.length > 0) {
        const { error: e2 } = await supabase.from('cte_documents').insert(docsPayload as any);
        if (e2) throw e2;
      }

      // Sincronização com Financeiro: cria contas a receber por CT-e (se a tabela existir).
      try {
        const { data: createdDocs } = await supabase
          .from('cte_documents')
          .select('id, client_id, freight_value, net_value, recipient')
          .eq('batch_id', batch.id);

        if (createdDocs && createdDocs.length > 0 && input.client_id) {
          const receivables = createdDocs.map((d: any) => ({
            tenant_id: currentTenant.id,
            client_id: d.client_id,
            cte_document_id: d.id,
            description: `CT-e ${d.id.slice(0, 8)} • ${d.recipient || '-'}`,
            amount: d.freight_value,
            net_amount: d.net_value,
            status: 'pending',
            issue_date: new Date().toISOString().slice(0, 10),
            created_by: user?.id,
          }));
          // Tenta inserir; se a tabela não existir ou colunas divergirem, ignora silenciosamente.
          await supabase.from('receivables').insert(receivables as any);
        }
      } catch {
        /* sincronização opcional */
      }

      return batch;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
      qc.invalidateQueries({ queryKey: ['receivables'] });
      // Documentos já emitidos devem sumir da listagem de Faturamento
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_documents'] });
    },
  });
}

export function useCancelCteBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      const { error } = await supabase
        .from('cte_batches')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() } as any)
        .eq('id', batchId);
      if (error) throw error;
      // Descobre as NFs consumidas pelo lote antes de cancelar, para devolvê-las ao pool.
      const { data: rows } = await supabase
        .from('cte_documents')
        .select('fiscal_document_ids')
        .eq('batch_id', batchId);
      await supabase
        .from('cte_documents')
        .update({ status: 'cancelled' } as any)
        .eq('batch_id', batchId);

      const nfIds = Array.from(
        new Set(((rows || []) as any[]).flatMap((r) => r.fiscal_document_ids || []).filter(Boolean)),
      );
      if (nfIds.length > 0) {
        // Espelha useDeleteIssuedCte: cancelar o lote libera a NF para novo faturamento.
        await supabase
          .from('fiscal_documents')
          .update({ cte_emitted_at: null, cte_emitted_outbound_id: null } as any)
          .in('id', nfIds);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cte_batches'] });
      qc.invalidateQueries({ queryKey: ['cte_documents'] });
      // Cancelamento devolve os documentos ao pool disponível
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['pending_invoices_summary'] });
    },
  });
}