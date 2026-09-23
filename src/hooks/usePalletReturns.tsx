import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { uploadSecureFile } from '@/lib/secureUpload';
import type { Json, Tables } from '@/integrations/supabase/types';
import { localDateInputValue } from '@/lib/utils/formatDate';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import { palletImportRequestId, protocolDedupeKey } from '@/lib/palletReturns/palletReturnImporter';

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

/** Lista tipos de palete do tenant. */
export function usePalletTypes(activeOnly = false) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pallet_types', currentTenant?.id, activeOnly],
    queryFn: async (): Promise<PalletType[]> => {
      if (!currentTenant) return [];
      let q = supabase.from('pallet_types').select('*').eq('tenant_id', currentTenant.id).order('code');
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
      const data = await fetchAllPostgrestPages((from, to) => {
        let q = supabase.from('pallet_return_protocols').select('*, items:pallet_return_items(*)')
          .eq('tenant_id', currentTenant.id).order('issue_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to);
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
        return q;
      });
      let rows = data.map((row) => ({
        ...row,
        items: [...(row.items || [])].sort((a, b) => a.sort_order - b.sort_order),
      })) as unknown as PalletProtocol[];
      if (filters.palletTypeCode) {
        rows = rows.filter((r) => (r.items || []).some((i) => i.pallet_type_code === filters.palletTypeCode));
      }
      return rows;
    },
    enabled: !!currentTenant,
  });
}

export interface CreateProtocolInput {
  request_id: string;
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
      const { data, error } = await supabase.rpc('create_pallet_return_protocol', {
        _tenant_id: currentTenant.id,
        _payload: input as unknown as Json,
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
      const { error } = await supabase.rpc('update_pallet_return_status', {
        _protocol_id: args.protocolId,
        _status: args.status,
        _payload: (args.payload || {}) as Json,
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
      const { error } = await supabase.rpc('cancel_pallet_return_protocol', {
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: EditProtocolInput) => {
      if (!currentTenant) throw new Error('no_tenant');

      const { error } = await supabase.rpc('edit_pallet_return_protocol_v1', {
        _payload: {
          tenant_id: currentTenant.id,
          protocol_id: args.protocolId,
          patch: args.patch,
          items: args.items,
          reason: args.reason || null,
        } as unknown as Json,
      });
      if (error) throw error;
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
      const code = normalizePalletTypeCode(input.code);
      const name = input.name.trim();
      if (!code || !name) throw new Error('Código e nome do tipo de palete são obrigatórios.');
      const existingTypes = await fetchAllPostgrestPages((from, to) => supabase.from('pallet_types')
        .select('id, code').eq('tenant_id', currentTenant.id).order('id').range(from, to));
      if (existingTypes.some((row) => row.id !== input.id && normalizePalletTypeCode(row.code) === code)) {
        throw new Error(`Já existe um tipo de palete com o código ${code}.`);
      }
      if (input.id) {
        const { error } = await supabase.from('pallet_types').update({
          code, name, color: input.color, description: input.description, is_active: input.is_active ?? true, updated_by: user?.id,
        }).eq('id', input.id).eq('tenant_id', currentTenant.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('pallet_types').insert({
          tenant_id: currentTenant.id, code, name,
          color: input.color, description: input.description, is_active: input.is_active ?? true, created_by: user?.id, updated_by: user?.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pallet_types'] }),
  });
}

export const normalizePalletTypeCode = (code: string): string => code.trim().toUpperCase();

export function usePalletHistory(protocolId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pallet_return_history', currentTenant?.id, protocolId],
    queryFn: async () => {
      if (!currentTenant || !protocolId) return [];
      const { data, error } = await supabase.from('pallet_return_history')
        .select('*').eq('tenant_id', currentTenant.id).eq('protocol_id', protocolId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Tables<'pallet_return_history'>[];
    },
    enabled: !!currentTenant && !!protocolId,
  });
}

export function useImportPalletReturns() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fileName: string; parsedList: Array<{ supplier: string; issueDate: string; items: Array<{ code: string; name: string; quantity: number }>; totalDeclared?: number | null }>; localErrors: Array<{ supplier: string; date: string; reason: string }>; asStatus: 'confirmed' | 'returned' }) => {
      if (!currentTenant) throw new Error('no_tenant');
      const { data: batch, error: bErr } = await supabase.from('pallet_return_import_batches').insert({
        tenant_id: currentTenant.id, file_name: input.fileName,
        row_count: input.parsedList.length + input.localErrors.length,
        status: 'processing', created_by: user?.id,
      }).select().single();
      if (bErr) throw bErr;

      // Fetch clients for matching
      const clients = await fetchAllPostgrestPages((from, to) => supabase.from('clients').select('id, company_name, trade_name')
        .eq('tenant_id', currentTenant.id).order('id').range(from, to));
      const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
      const findClient = (name: string) => {
        const n = norm(name);
        const exact = clients.filter(c => norm(c.company_name || '') === n || norm(c.trade_name || '') === n);
        return exact.length === 1 ? exact[0] : undefined;
      };

      let imported = 0, unmatched = 0;
      const errors: Array<{ supplier: string; date: string; reason: string }> = [...input.localErrors];
      for (const p of input.parsedList) {
        try {
          const client = findClient(p.supplier);
          if (!client) unmatched += 1;
          // dedupe check
          const { data: existing, error: existingError } = await supabase.from('pallet_return_protocols')
            .select('id, supplier_id, supplier_name_snapshot, pallet_return_items(pallet_type_code, pallet_type_name, quantity)')
            .eq('tenant_id', currentTenant.id).eq('issue_date', p.issueDate);
          if (existingError) throw existingError;
          const importedKey = protocolDedupeKey(client?.id ?? p.supplier, p.issueDate, p.items);
          const duplicate = (existing || []).some(entry => protocolDedupeKey(
            entry.supplier_id ?? entry.supplier_name_snapshot,
            p.issueDate,
            (entry.pallet_return_items || []).map(item => ({ code: item.pallet_type_code, name: item.pallet_type_name, quantity: item.quantity })),
          ) === importedKey);
          if (duplicate) { errors.push({ supplier: p.supplier, date: p.issueDate, reason: 'duplicate' }); continue; }

          const requestId = await palletImportRequestId(currentTenant.id, importedKey);

          const { error: rpcErr } = await supabase.rpc('create_pallet_return_protocol', {
            _tenant_id: currentTenant.id,
            _payload: {
              request_id: requestId,
              supplier_id: client?.id ?? null,
              supplier_name_snapshot: p.supplier,
              issue_date: p.issueDate,
              returned_at: p.issueDate,
              status: input.asStatus,
              items: p.items.map((i) => ({ pallet_type_code: i.code, pallet_type_name: i.name, quantity: i.quantity })),
            } as Json,
          });
          if (rpcErr) throw rpcErr;
          imported += 1;
        } catch (error: unknown) {
          errors.push({ supplier: p.supplier, date: p.issueDate, reason: error instanceof Error ? error.message : String(error) });
        }
      }

      const { error: completionError } = await supabase.from('pallet_return_import_batches').update({
        imported_count: imported,
        unmatched_count: unmatched,
        error_count: errors.length,
        errors: errors as Json,
        status: errors.length ? 'completed_with_errors' : 'completed',
      }).eq('id', batch.id).eq('tenant_id', currentTenant.id);
      if (completionError) throw completionError;

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
      const { data: protocol, error: readError } = await supabase.from('pallet_return_protocols').select('status')
        .eq('tenant_id', currentTenant.id).eq('id', args.protocolId).single();
      if (readError) throw readError;
      if (!['returned', 'partially_returned', 'awaiting_signature'].includes(protocol.status)) throw new Error('Marque o protocolo como devolvido antes de anexar o comprovante.');
      const path = await uploadSecureFile({
        tenantId: currentTenant.id,
        bucket: 'pallet-return-proofs',
        folder: `protocols/${args.protocolId}`,
        file: args.file,
        kind: 'proof',
      });
      const { error } = await supabase.rpc('update_pallet_return_status', {
        _protocol_id: args.protocolId,
        _status: 'confirmed',
        _payload: {
          signed_proof_url: path,
          receiver_name: args.receiverName || null,
          receiver_document: args.receiverDocument || null,
          signature_date: args.signatureDate || localDateInputValue(),
        },
      });
      if (error) { await supabase.storage.from('pallet-return-proofs').remove([path]); throw error; }
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
