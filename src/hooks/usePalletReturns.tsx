import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { validateUpload } from '@/lib/uploadPolicy';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface PalletType {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  color: string | null;
  description: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PalletItem {
  id: string;
  protocol_id: string;
  pallet_type_id: string | null;
  pallet_type_code: string;
  pallet_type_name: string;
  pallet_color: string | null;
  quantity: number;
  notes: string | null;
  sort_order: number;
}

export interface PalletProtocol {
  id: string;
  tenant_id: string;
  protocol_number: string;
  supplier_id: string | null;
  supplier_name_snapshot: string;
  supplier_document_snapshot: string | null;
  company_snapshot: Record<string, unknown>;
  issue_date: string;
  expected_return_date: string | null;
  returned_at: string | null;
  confirmed_at: string | null;
  status: 'draft' | 'scheduled' | 'returned' | 'partially_returned' | 'awaiting_signature' | 'confirmed' | 'cancelled';
  total_quantity: number;
  driver_id: string | null;
  vehicle_id: string | null;
  load_id: string | null;
  driver_name_snapshot: string | null;
  vehicle_plate_snapshot: string | null;
  notes: string | null;
  receiver_name: string | null;
  receiver_document: string | null;
  receiver_phone: string | null;
  signature_date: string | null;
  signed_proof_url: string | null;
  pdf_url: string | null;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  confirmed_by: string | null;
  items?: PalletItem[];
}

export interface PalletFilters {
  supplierId?: string;
  supplierName?: string;
  status?: string;
  palletTypeCode?: string;
  fromIssue?: string;
  toIssue?: string;
  fromReturn?: string;
  toReturn?: string;
  driverId?: string;
  plate?: string;
  loadId?: string;
  protocolNumber?: string;
  onlyPending?: boolean;
  onlyConfirmed?: boolean;
}

const t = (name: string) => (supabase.from as any)(name);
const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as any)(name, args);

/** Lista tipos de palete do tenant. */
export function usePalletTypes(activeOnly = false) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pallet_types', currentTenant?.id, activeOnly],
    queryFn: async (): Promise<PalletType[]> => {
      if (!currentTenant) return [];
      let q = t('pallet_types').select('*').eq('tenant_id', currentTenant.id).order('code');
      if (activeOnly) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as PalletType[];
    },
    enabled: !!currentTenant,
  });
}

/** Lista protocolos com itens. */
export function usePalletProtocols(filters: PalletFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pallet_return_protocols', currentTenant?.id, filters],
    queryFn: async (): Promise<PalletProtocol[]> => {
      if (!currentTenant) return [];
      let q = t('pallet_return_protocols')
        .select('*, items:pallet_return_items(*)')
        .eq('tenant_id', currentTenant.id)
        .order('issue_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (filters.supplierId) q = q.eq('supplier_id', filters.supplierId);
      if (filters.supplierName) q = q.ilike('supplier_name_snapshot', `%${filters.supplierName}%`);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.driverId) q = q.eq('driver_id', filters.driverId);
      if (filters.plate) q = q.ilike('vehicle_plate_snapshot', `%${filters.plate}%`);
      if (filters.loadId) q = q.eq('load_id', filters.loadId);
      if (filters.protocolNumber) q = q.ilike('protocol_number', `%${filters.protocolNumber}%`);
      if (filters.fromIssue) q = q.gte('issue_date', filters.fromIssue);
      if (filters.toIssue) q = q.lte('issue_date', filters.toIssue);
      if (filters.fromReturn) q = q.gte('returned_at', filters.fromReturn);
      if (filters.toReturn) q = q.lte('returned_at', filters.toReturn);
      if (filters.onlyPending) q = q.not('status', 'in', '(confirmed,cancelled)');
      if (filters.onlyConfirmed) q = q.eq('status', 'confirmed');
      const { data, error } = await q;
      if (error) throw error;
      let rows = ((data || []) as any[]).map((r) => ({ ...r, items: (r.items || []).sort((a: any, b: any) => a.sort_order - b.sort_order) })) as PalletProtocol[];
      if (filters.palletTypeCode) {
        rows = rows.filter((r) => (r.items || []).some((i) => i.pallet_type_code === filters.palletTypeCode));
      }
      return rows;
    },
    enabled: !!currentTenant,
  });
}

export interface CreateProtocolInput {
  supplier_id?: string | null;
  supplier_name_snapshot: string;
  issue_date: string;
  expected_return_date?: string | null;
  returned_at?: string | null;
  status?: PalletProtocol['status'];
  driver_id?: string | null;
  vehicle_id?: string | null;
  load_id?: string | null;
  driver_name_snapshot?: string | null;
  vehicle_plate_snapshot?: string | null;
  notes?: string | null;
  receiver_name?: string | null;
  receiver_document?: string | null;
  items: Array<{ pallet_type_id?: string | null; pallet_type_code: string; pallet_type_name: string; pallet_color?: string | null; quantity: number; notes?: string | null; sort_order?: number }>;
}

export function useCreatePalletProtocol() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProtocolInput) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data, error } = await rpc('create_pallet_return_protocol', {
        _tenant_id: currentTenant.id,
        _payload: input,
      });
      if (error) throw error;
      return data as { protocol_id: string; protocol_number: string; total_quantity: number };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] });
    },
  });
}

export function useUpdatePalletStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { protocolId: string; status: PalletProtocol['status']; payload?: Record<string, unknown> }) => {
      const { error } = await rpc('update_pallet_return_status', {
        _protocol_id: args.protocolId,
        _status: args.status,
        _payload: args.payload || {},
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] }),
  });
}

export function useCancelPalletProtocol() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { protocolId: string; reason: string }) => {
      const { error } = await rpc('cancel_pallet_return_protocol', {
        _protocol_id: args.protocolId,
        _reason: args.reason,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] }),
  });
}

export interface EditProtocolInput {
  protocolId: string;
  patch: Partial<Pick<PalletProtocol,
    'supplier_id' | 'supplier_name_snapshot' | 'issue_date' | 'expected_return_date' |
    'returned_at' | 'driver_name_snapshot' | 'vehicle_plate_snapshot' | 'notes' |
    'receiver_name' | 'receiver_document'>>;
  items?: Array<{ pallet_type_id?: string | null; pallet_type_code: string; pallet_type_name: string; pallet_color?: string | null; quantity: number; notes?: string | null; sort_order?: number }>;
  reason?: string | null;
}

export function useEditPalletProtocol() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: EditProtocolInput) => {
      if (!currentTenant) throw new Error('no_tenant');

      // Fetch existing to guard status
      const { data: existing, error: exErr } = await t('pallet_return_protocols')
        .select('id, status, tenant_id').eq('id', args.protocolId).maybeSingle();
      if (exErr) throw exErr;
      if (!existing) throw new Error('protocol_not_found');
      if (['confirmed', 'cancelled'].includes(existing.status)) {
        throw new Error('Protocolo confirmado ou cancelado não pode ser editado.');
      }

      const updates: Record<string, unknown> = { ...args.patch, updated_at: new Date().toISOString() };

      if (args.items) {
        const total = args.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
        updates.total_quantity = total;
      }

      const { error: upErr } = await t('pallet_return_protocols')
        .update(updates).eq('id', args.protocolId);
      if (upErr) throw upErr;

      if (args.items) {
        const { error: delErr } = await t('pallet_return_items').delete().eq('protocol_id', args.protocolId);
        if (delErr) throw delErr;
        const rows = args.items.map((i, idx) => ({
          tenant_id: currentTenant.id,
          protocol_id: args.protocolId,
          pallet_type_id: i.pallet_type_id || null,
          pallet_type_code: i.pallet_type_code,
          pallet_type_name: i.pallet_type_name,
          pallet_color: i.pallet_color || null,
          quantity: Number(i.quantity),
          notes: i.notes || null,
          sort_order: i.sort_order ?? idx,
        }));
        const { error: insErr } = await t('pallet_return_items').insert(rows);
        if (insErr) throw insErr;
      }

      // Audit trail
      await t('pallet_return_history').insert({
        tenant_id: currentTenant.id,
        protocol_id: args.protocolId,
        action: 'edited',
        reason: args.reason || null,
        metadata: { patch: args.patch, items_replaced: !!args.items } as any,
        created_by: user?.id ?? null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] }),
  });
}

export function useUpsertPalletType() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<PalletType> & { code: string; name: string }) => {
      if (!currentTenant) throw new Error('no_tenant');
      if (input.id) {
        const { error } = await t('pallet_types').update({
          name: input.name, color: input.color, description: input.description, is_active: input.is_active ?? true, updated_by: user?.id,
        }).eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await t('pallet_types').insert({
          tenant_id: currentTenant.id, code: input.code, name: input.name,
          color: input.color, description: input.description, is_active: input.is_active ?? true, created_by: user?.id, updated_by: user?.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_types'] }),
  });
}

export function usePalletHistory(protocolId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pallet_return_history', currentTenant?.id, protocolId],
    queryFn: async () => {
      if (!currentTenant || !protocolId) return [];
      const { data, error } = await t('pallet_return_history')
        .select('*').eq('tenant_id', currentTenant.id).eq('protocol_id', protocolId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!currentTenant && !!protocolId,
  });
}

export function useImportPalletReturns() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fileName: string; parsedList: Array<{ supplier: string; issueDate: string; items: Array<{ code: string; name: string; quantity: number }>; totalDeclared?: number | null }>; asStatus: 'confirmed' | 'returned' }) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data: batch, error: bErr } = await t('pallet_return_import_batches').insert({
        tenant_id: currentTenant.id, file_name: input.fileName, row_count: input.parsedList.length, status: 'processing', created_by: user?.id,
      }).select().single();
      if (bErr) throw bErr;

      // Fetch clients for matching
      const { data: clients } = await supabase.from('clients').select('id, company_name, trade_name').eq('tenant_id', currentTenant.id).limit(2000);
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
      const findClient = (name: string) => {
        const n = norm(name);
        return (clients || []).find((c: any) => norm(c.company_name || '') === n || norm(c.trade_name || '') === n)
          || (clients || []).find((c: any) => norm(c.company_name || '').includes(n) || n.includes(norm(c.company_name || '')));
      };

      let imported = 0, errors: any[] = [], unmatched = 0;
      for (const p of input.parsedList) {
        try {
          const client = findClient(p.supplier);
          if (!client) unmatched += 1;
          // dedupe check
          const { data: existing } = await t('pallet_return_protocols')
            .select('id, total_quantity').eq('tenant_id', currentTenant.id)
            .eq('supplier_name_snapshot', p.supplier).eq('issue_date', p.issueDate).limit(5);
          const sameTotal = (existing || []).some((e: any) => e.total_quantity === (p.totalDeclared || p.items.reduce((s, i) => s + i.quantity, 0)));
          if (sameTotal) { errors.push({ supplier: p.supplier, date: p.issueDate, reason: 'duplicate' }); continue; }

          const { error: rpcErr } = await rpc('create_pallet_return_protocol', {
            _tenant_id: currentTenant.id,
            _payload: {
              supplier_id: client?.id ?? null,
              supplier_name_snapshot: p.supplier,
              issue_date: p.issueDate,
              returned_at: p.issueDate,
              status: input.asStatus,
              items: p.items.map((i) => ({ pallet_type_code: i.code, pallet_type_name: i.name, quantity: i.quantity })),
            },
          });
          if (rpcErr) throw rpcErr;
          imported += 1;
        } catch (e: any) {
          errors.push({ supplier: p.supplier, date: p.issueDate, reason: e?.message || String(e) });
        }
      }

      await t('pallet_return_import_batches').update({
        imported_count: imported,
        unmatched_count: unmatched,
        error_count: errors.length,
        errors,
        status: errors.length ? 'completed_with_errors' : 'completed',
      }).eq('id', batch.id);

      qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] });
      return { imported, errors, unmatched, batchId: batch.id };
    },
  });
}

export function useAttachPalletProof() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { protocolId: string; file: File; receiverName?: string; receiverDocument?: string; signatureDate?: string }) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { contentType, safeName } = validateUpload(args.file, 'proof');
      const path = `${currentTenant.id}/${args.protocolId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from('pallet-return-proofs').upload(path, args.file, { upsert: true, contentType });
      if (upErr) throw upErr;
      const { error } = await rpc('update_pallet_return_status', {
        _protocol_id: args.protocolId,
        _status: 'awaiting_signature',
        _payload: {
          signed_proof_url: path,
          receiver_name: args.receiverName || null,
          receiver_document: args.receiverDocument || null,
          signature_date: args.signatureDate || new Date().toISOString().slice(0, 10),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_return_protocols'] }),
  });
}

/** Gera URL assinada temporária para visualizar o comprovante privado. */
export async function getPalletProofSignedUrl(path: string, expiresIn = 300): Promise<string | null> {
  const { data, error } = await supabase.storage.from('pallet-return-proofs').createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}