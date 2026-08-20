import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { computeFinancialStatus, type FinancialStatus } from '@/lib/loadImports/loadImportNormalizer';
import type { ParsedSpreadsheet } from '@/lib/loadImports/spreadsheetLoadImport';
import type { ParsedNfe, ParsedCte } from '@/lib/loadImports/xmlLoadImport';

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
  metadata?: any;
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
      let q = (supabase
      .from('loads') as any)
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
      return (data || []).map((r: any) => ({
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
      const { data, error } = await (supabase.from('load_documents') as any)
        .select('*')
        .eq('tenant_id', currentTenant!.id)
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
      let q = (supabase.from('load_unloading_charges') as any)
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
      const { data, error } = await (supabase.from('load_import_batches') as any)
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
  return useMutation({
    mutationFn: async (p: {
      loadId: string;
      amount: number;
      paymentDate: string;
      method?: string | null;
      notes?: string | null;
    }) => {
      const tenantId = currentTenant!.id;
      const { data: load, error: le } = await (supabase
      .from('loads') as any)
        .select('freight_amount, received_amount, operational_status, expected_payment_date, payment_status')
        .eq('id', p.loadId).single();
      if (le) throw le;
      if ((load.operational_status || '').toLowerCase() === 'cancelled')
        throw new Error('Carga cancelada não pode receber pagamento.');
      const newReceived = Number(load.received_amount || 0) + Number(p.amount || 0);
      if (newReceived > Number(load.freight_amount || 0) * 1.001 && !confirmOverpay())
        throw new Error('Pagamento maior que o valor de frete — cancelado.');

      const { error: pe } = await (supabase.from('load_payments') as any).insert({
        tenant_id: tenantId, load_id: p.loadId,
        amount: p.amount, payment_date: p.paymentDate,
        payment_method: p.method || null, notes: p.notes || null,
      });
      if (pe) throw pe;

      const newStatus = computeFinancialStatus({
        freight_amount: Number(load.freight_amount || 0),
        received_amount: newReceived,
        expected_payment_date: load.expected_payment_date,
        operational_status: load.operational_status,
      });

      const { error: ue } = await (supabase
        // linter:allow-direct-write loads manual-payment-update 2026-12-31
      .from('loads') as any).update({
        received_amount: newReceived,
        payment_status: newStatus,
        payment_date: newStatus === 'paid' ? p.paymentDate : null,
      }).eq('id', p.loadId);
      if (ue) throw ue;

      await (supabase.from('load_status_history') as any).insert({
        tenant_id: tenantId, load_id: p.loadId,
        field_name: 'payment_status', old_value: load.payment_status,
        new_value: newStatus, reason: `Pagamento ${p.amount}`,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['load-control'] }); },
  });
}

function confirmOverpay() {
  if (typeof window === 'undefined') return false;
  return window.confirm('Pagamento maior que o valor de frete. Confirmar?');
}

export function useMarkUnpaid() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (loadId: string) => {
      const tenantId = currentTenant!.id;
      const { data: pays } = await (supabase.from('load_payments') as any)
        .select('id').eq('tenant_id', tenantId).eq('load_id', loadId).limit(1);
      if ((pays || []).length > 0) {
        throw new Error('Existem pagamentos registrados. Lance um estorno via ajuste para reabrir a carga.');
      }
      const { error } = await (supabase
        // linter:allow-direct-write loads manual-unpaid-reset 2026-12-31
      .from('loads') as any)
        .update({ payment_status: 'unpaid', payment_date: null, received_amount: 0 })
        .eq('id', loadId);
      if (error) throw error;
      await (supabase.from('load_status_history') as any).insert({
        tenant_id: tenantId, load_id: loadId, field_name: 'payment_status',
        old_value: 'paid', new_value: 'unpaid', reason: 'Reabertura manual',
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['load-control'] }); },
  });
}

// ---- Import runners ----------------------------------------------

export interface ImportPreview {
  newLoads: number;
  updatedLoads: number;
  newDocuments: number;
  duplicated: number;
  pending: number;
  errors: Array<{ row?: number; message: string }>;
}

export async function commitSpreadsheetImport(
  tenantId: string,
  fileName: string,
  parsed: ParsedSpreadsheet[],
): Promise<{ batchId: string; preview: ImportPreview }> {
  const preview: ImportPreview = { newLoads: 0, updatedLoads: 0, newDocuments: 0, duplicated: 0, pending: 0, errors: [] };

  const { data: batch, error: be } = await (supabase.from('load_import_batches') as any).insert({
    tenant_id: tenantId, source_type: 'spreadsheet', file_name: fileName,
    file_count: 1, parsed_count: parsed.reduce((s, p) => s + p.summary.length + p.detail.length + p.unloading.length, 0),
    status: 'processing',
  }).select('id').single();
  if (be) throw be;
  const batchId = batch.id as string;

  for (const sheet of parsed) {
    // summary rows -> loads
    for (const s of sheet.summary) {
      try {
        const { data: existing } = await (supabase
          // linter:allow-direct-write loads legacy-import-check 2026-12-31
      .from('loads') as any)
          .select('id, load_number').eq('tenant_id', tenantId).eq('external_load_number', s.external_load_number).maybeSingle();
        if (existing) {
          preview.updatedLoads++;
          await (supabase
            // linter:allow-direct-write loads legacy-import-update 2026-12-31
      .from('loads') as any).update({
            load_date: s.load_date, arrival_date: s.arrival_date,
            gross_cargo_value: s.gross_cargo_value, freight_amount: s.freight_amount,
            cte_count: s.cte_numbers.length, legacy_status_text: s.legacy_status_text,
            expected_payment_date: s.expected_payment_date,
            closed_at: s.closed_at ? new Date(s.closed_at).toISOString() : null,
            source_origin: 'spreadsheet_import', last_import_batch_id: batchId,
            payment_status: computeFinancialStatus({
              freight_amount: s.freight_amount, received_amount: 0,
              expected_payment_date: s.expected_payment_date,
            }),
          }).eq('id', existing.id);
        } else {
          preview.newLoads++;
          await (supabase
            // linter:allow-direct-write loads legacy-import-insert 2026-12-31
      .from('loads') as any).insert({
            tenant_id: tenantId, external_load_number: s.external_load_number,
            load_number: s.external_load_number, // reuse legacy number if we don't have a natural key yet
            status: 'imported', load_date: s.load_date, arrival_date: s.arrival_date,
            gross_cargo_value: s.gross_cargo_value, freight_amount: s.freight_amount,
            cte_count: s.cte_numbers.length, legacy_status_text: s.legacy_status_text,
            expected_payment_date: s.expected_payment_date,
            closed_at: s.closed_at ? new Date(s.closed_at).toISOString() : null,
            source_origin: 'spreadsheet_import', last_import_batch_id: batchId,
            payment_status: computeFinancialStatus({
              freight_amount: s.freight_amount, received_amount: 0,
              expected_payment_date: s.expected_payment_date,
            }),
          });
        }
      } catch (e: any) {
        preview.errors.push({ message: `Carga ${s.external_load_number}: ${e.message || e}` });
      }
    }

    // detail rows -> load_documents (grouped)
    const grouped = new Map<string, typeof sheet.detail>();
    for (const d of sheet.detail) {
      if (!grouped.has(d.external_load_number)) grouped.set(d.external_load_number, [] as any);
      grouped.get(d.external_load_number)!.push(d);
    }
    for (const [loadNum, rows] of grouped) {
      try {
        let { data: load } = await (supabase
      .from('loads') as any)
          .select('id').eq('tenant_id', tenantId).eq('external_load_number', loadNum).maybeSingle();
        if (!load) {
          const { data: created } = await (supabase
            // linter:allow-direct-write loads legacy-import-insert 2026-12-31
      .from('loads') as any).insert({
            tenant_id: tenantId, external_load_number: loadNum, load_number: loadNum,
            status: 'imported', source_origin: 'spreadsheet_import', last_import_batch_id: batchId,
          }).select('id').single();
          load = created; preview.newLoads++;
        }

        let totWeight = 0, totCargo = 0, totFreight = 0, nfCount = 0;
        for (const d of rows) {
          for (const nf of d.invoice_numbers) {
            const { data: dup } = await (supabase.from('load_documents') as any)
              .select('id').eq('tenant_id', tenantId).eq('load_id', load.id)
              .eq('document_number', nf).eq('document_type', 'nfe').maybeSingle();
            if (dup) { preview.duplicated++; continue; }
            await (supabase.from('load_documents') as any).insert({
              tenant_id: tenantId, load_id: load.id, document_type: 'nfe',
              document_number: nf, issuer_name: d.issuer_name, issue_date: d.issue_date,
              recipient_name: d.recipient_name, destination_city: d.destination_city,
              cargo_value: d.cargo_value / Math.max(d.invoice_numbers.length, 1),
              freight_value: d.freight_value / Math.max(d.invoice_numbers.length, 1),
              weight_kg: d.weight_kg / Math.max(d.invoice_numbers.length, 1),
              metadata: { batch_id: batchId, freight_percent: d.freight_percent },
            });
            preview.newDocuments++;
            nfCount++;
          }
          totWeight += d.weight_kg; totCargo += d.cargo_value; totFreight += d.freight_value;
        }
        await (supabase
          // linter:allow-direct-write loads legacy-import-totals 2026-12-31
      .from('loads') as any).update({
          total_weight_kg: totWeight, gross_cargo_value: totCargo,
          freight_amount: totFreight, invoice_count: nfCount,
        }).eq('id', load.id);
      } catch (e: any) {
        preview.errors.push({ message: `Carga ${loadNum}: ${e.message || e}` });
      }
    }

    // unloading rows
    for (const u of sheet.unloading) {
      try {
        if (!u.invoice_numbers.length) {
          await (supabase.from('load_unloading_charges') as any).insert({
            tenant_id: tenantId, import_batch_id: batchId, invoice_number: null,
            client_name: u.client_name, supplier_name: (u.supplier_names[0] || null),
            city: u.city, service_date: u.service_date, amount: u.amount, status: 'pending',
            metadata: { suppliers: u.supplier_names },
          });
          preview.pending++; continue;
        }
        for (const nf of u.invoice_numbers) {
          const { data: ld } = await (supabase.from('load_documents') as any)
            .select('load_id').eq('tenant_id', tenantId).eq('document_number', nf).limit(1).maybeSingle();
          await (supabase.from('load_unloading_charges') as any).insert({
            tenant_id: tenantId, import_batch_id: batchId, invoice_number: nf,
            client_name: u.client_name, supplier_name: (u.supplier_names[0] || null),
            city: u.city, service_date: u.service_date,
            amount: u.amount / Math.max(u.invoice_numbers.length, 1),
            status: ld ? 'matched' : 'pending',
            load_id: ld?.load_id || null,
            metadata: { suppliers: u.supplier_names },
          });
          if (ld) preview.newDocuments++; else preview.pending++;
        }
      } catch (e: any) {
        preview.errors.push({ message: `Descarga NF ${u.invoice_numbers.join('/')}: ${e.message || e}` });
      }
    }
  }

  await (supabase.from('load_import_batches') as any).update({
    imported_count: preview.newLoads + preview.newDocuments,
    duplicated_count: preview.duplicated,
    error_count: preview.errors.length,
    status: preview.errors.length ? 'completed_with_errors' : 'completed',
    metadata: { preview },
    errors: preview.errors,
  }).eq('id', batchId);

  return { batchId, preview };
}

export async function commitXmlImport(
  tenantId: string,
  fileName: string,
  docs: Array<ParsedNfe | ParsedCte>,
): Promise<{ batchId: string; preview: ImportPreview }> {
  const preview: ImportPreview = { newLoads: 0, updatedLoads: 0, newDocuments: 0, duplicated: 0, pending: 0, errors: [] };

  const { data: batch, error: be } = await (supabase.from('load_import_batches') as any).insert({
    tenant_id: tenantId, source_type: 'xml', file_name: fileName,
    file_count: 1, parsed_count: docs.length, status: 'processing',
  }).select('id').single();
  if (be) throw be;
  const batchId = batch.id as string;

  for (const d of docs) {
    try {
      if (!d.access_key) { preview.errors.push({ message: `XML sem chave (${d.kind})` }); continue; }
      const { data: dup } = await (supabase.from('load_documents') as any)
        .select('id').eq('tenant_id', tenantId).eq('access_key', d.access_key).maybeSingle();
      if (dup) { preview.duplicated++; continue; }
      // Attach to a "pending" holder load (per batch) since XML lacks explicit load id
      const holderNumber = `XML-${batchId.slice(0, 8)}`;
      let { data: load } = await (supabase// linter:allow-direct-write loads legacy-code 2026-12-31
      .from('loads') as any)
        .select('id').eq('tenant_id', tenantId).eq('external_load_number', holderNumber).maybeSingle();
      if (!load) {
        const { data: created } = await (supabase// linter:allow-direct-write loads legacy-code 2026-12-31
      .from('loads') as any).insert({
          tenant_id: tenantId, external_load_number: holderNumber, load_number: holderNumber,
          status: 'draft', source_origin: 'xml_import', last_import_batch_id: batchId,
        }).select('id').single();
        load = created; preview.newLoads++;
      }
      await (supabase.from('load_documents') as any).insert({
        tenant_id: tenantId, load_id: load.id, access_key: d.access_key,
        document_type: d.kind, document_number: d.number,
        issue_date: d.issue_date,
        issuer_name: d.kind === 'nfe' ? d.issuer_name : d.remitter_name,
        issuer_cnpj: d.kind === 'nfe' ? d.issuer_cnpj : null,
        recipient_name: d.recipient_name,
        recipient_cnpj: d.kind === 'nfe' ? d.recipient_cnpj : null,
        origin_city: d.origin_city, origin_state: d.origin_state,
        destination_city: d.destination_city, destination_state: d.destination_state,
        cargo_value: d.kind === 'nfe' ? d.total_value : d.cargo_value,
        freight_value: d.kind === 'cte' ? d.freight_value : 0,
        weight_kg: d.kind === 'nfe' ? d.weight_kg : 0,
        volume_count: d.kind === 'nfe' ? d.volume_count : 0,
        metadata: { source: 'xml', batch_id: batchId, referenced_nfe_keys: d.kind === 'cte' ? d.referenced_nfe_keys : undefined },
      });
      preview.newDocuments++;
    } catch (e: any) {
      preview.errors.push({ message: `${d.kind}: ${e.message || e}` });
    }
  }

  await (supabase.from('load_import_batches') as any).update({
    imported_count: preview.newDocuments,
    duplicated_count: preview.duplicated,
    error_count: preview.errors.length,
    status: preview.errors.length ? 'completed_with_errors' : 'completed',
    metadata: { preview }, errors: preview.errors,
  }).eq('id', batchId);

  return { batchId, preview };
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