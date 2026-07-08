import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import {
  parseRuralSpreadsheet,
  dedupeRuralRows,
  type ParsedRuralRow,
} from '@/lib/ruralClients/ruralClientsSpreadsheetImport';
import { normalizeText, ruralProfileDedupeKey } from '@/lib/ruralClients/ruralDeliveryMatcher';

export interface RuralProfile {
  id: string;
  tenant_id: string;
  client_id: string;
  client_name?: string | null;
  related_remitter_id: string | null;
  related_remitter_name?: string | null;
  supplier_name_snapshot: string | null;
  recipient_name_snapshot: string | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  locality: string | null;
  origin_city: string | null;
  origin_state: string | null;
  round_trip_km: number | null;
  access_type: string | null;
  delivery_mode: string;
  requires_contact_before_delivery: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  taxi_required: boolean;
  taxi_contact_name: string | null;
  taxi_contact_phone: string | null;
  taxi_estimated_cost: number | null;
  can_deliver_in_city: boolean;
  city_delivery_instructions: string | null;
  driver_instructions: string | null;
  internal_notes: string | null;
  source_type: string;
  source_reference: string | null;
  active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuralClientsFilters {
  search?: string;
  city?: string;
  accessType?: string;
  requiresContact?: boolean;
  taxiRequired?: boolean;
  canDeliverInCity?: boolean;
  active?: boolean;
  remitterId?: string;
}

/** Lista perfis rurais com dados de cliente e remetente relacionado. */
export function useRuralProfiles(filters: RuralClientsFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['rural_profiles', currentTenant?.id, filters],
    queryFn: async (): Promise<RuralProfile[]> => {
      if (!currentTenant) return [];
      let q = (supabase.from as any)('client_rural_delivery_profiles')
        .select('*, client:clients!client_rural_delivery_profiles_client_id_fkey(id, company_name), remitter:clients!client_rural_delivery_profiles_related_remitter_id_fkey(id, company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('updated_at', { ascending: false })
        .limit(1000);

      if (filters.active !== undefined) q = q.eq('active', filters.active);
      if (filters.city) q = q.ilike('city', `%${filters.city}%`);
      if (filters.accessType) q = q.eq('access_type', filters.accessType);
      if (filters.requiresContact !== undefined) q = q.eq('requires_contact_before_delivery', filters.requiresContact);
      if (filters.taxiRequired !== undefined) q = q.eq('taxi_required', filters.taxiRequired);
      if (filters.canDeliverInCity !== undefined) q = q.eq('can_deliver_in_city', filters.canDeliverInCity);
      if (filters.remitterId) q = q.eq('related_remitter_id', filters.remitterId);

      const { data, error } = await q;
      if (error) throw error;
      let rows: RuralProfile[] = ((data ?? []) as any[]).map((r) => ({
        ...r,
        client_name: r.client?.company_name || r.recipient_name_snapshot,
        related_remitter_name: r.remitter?.company_name || r.supplier_name_snapshot,
      }));
      const q2 = (filters.search || '').trim().toLowerCase();
      if (q2) {
        rows = rows.filter(r =>
          (r.client_name || '').toLowerCase().includes(q2) ||
          (r.city || '').toLowerCase().includes(q2) ||
          (r.neighborhood || '').toLowerCase().includes(q2) ||
          (r.related_remitter_name || '').toLowerCase().includes(q2)
        );
      }
      return rows;
    },
    enabled: !!currentTenant,
  });
}

/** Todos os clientes com is_rural=true, para cards e relatórios rápidos. */
export function useRuralClientsSummary() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['rural_clients_summary', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data, error } = await supabase
        .from('clients')
        .select('id, company_name, is_rural, rural_driver_instructions, rural_requires_contact, rural_contact_phone, rural_access_type, address_city, address_state')
        .eq('tenant_id', currentTenant.id)
        .eq('is_rural', true)
        .limit(2000);
      if (error) throw error;
      const list = data || [];
      return {
        total: list.length,
        withInstructions: list.filter((c: any) => (c.rural_driver_instructions || '').trim().length > 0).length,
        requireContact: list.filter((c: any) => c.rural_requires_contact).length,
        withoutPhone: list.filter((c: any) => !(c.rural_contact_phone || '').trim()).length,
        dirtRoad: list.filter((c: any) => c.rural_access_type === 'dirt_road').length,
        withoutInstructions: list.filter((c: any) => !(c.rural_driver_instructions || '').trim()).length,
        clients: list as any[],
      };
    },
    enabled: !!currentTenant,
  });
}

export function useCreateRuralProfile() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<RuralProfile>) => {
      const { data, error } = await (supabase.from as any)('client_rural_delivery_profiles').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
        updated_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rural_profiles'] }),
  });
}

export function useUpdateRuralProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<RuralProfile> & { id: string }) => {
      const { data, error } = await (supabase.from as any)('client_rural_delivery_profiles')
        .update({ ...values, updated_by: user?.id })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rural_profiles'] }),
  });
}

// ============== Importação da planilha ==============

export interface RuralImportPreviewRow extends ParsedRuralRow {
  matched_client_id?: string | null;
  matched_remitter_id?: string | null;
  existing_profile_id?: string | null;
  action: 'create' | 'update' | 'skip' | 'unmatched';
}

export interface RuralImportPreview {
  fileName: string;
  rows: RuralImportPreviewRow[];
  toCreate: number;
  toUpdate: number;
  unmatched: number;
}

export async function buildRuralImportPreview(
  buffer: ArrayBuffer,
  fileName: string,
  tenantId: string,
): Promise<RuralImportPreview> {
  const parsed = parseRuralSpreadsheet(buffer, fileName);
  const deduped = dedupeRuralRows(parsed.rows);

  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, address_city')
    .eq('tenant_id', tenantId)
    .limit(5000);

  const clientIndex = new Map<string, any>();
  for (const c of clients || []) {
    clientIndex.set(normalizeText(c.company_name), c);
  }

  const { data: existing } = await (supabase.from as any)('client_rural_delivery_profiles')
    .select('id, client_id, city, neighborhood, related_remitter_id')
    .eq('tenant_id', tenantId)
    .limit(5000);
  const existingIndex = new Map<string, string>();
  for (const e of existing || []) {
    existingIndex.set(ruralProfileDedupeKey(e), e.id);
  }

  const rows: RuralImportPreviewRow[] = deduped.map((r) => {
    const matchedClient = clientIndex.get(normalizeText(r.recipient_name_snapshot));
    const matchedRemitter = r.supplier_name_snapshot
      ? clientIndex.get(normalizeText(r.supplier_name_snapshot))
      : null;
    let action: RuralImportPreviewRow['action'] = 'unmatched';
    let existingProfileId: string | null = null;
    if (matchedClient) {
      const key = ruralProfileDedupeKey({
        client_id: matchedClient.id,
        city: r.city,
        neighborhood: r.neighborhood,
        related_remitter_id: matchedRemitter?.id || null,
      });
      existingProfileId = existingIndex.get(key) || null;
      action = existingProfileId ? 'update' : 'create';
    }
    return {
      ...r,
      matched_client_id: matchedClient?.id || null,
      matched_remitter_id: matchedRemitter?.id || null,
      existing_profile_id: existingProfileId,
      action,
    };
  });

  return {
    fileName,
    rows,
    toCreate: rows.filter(r => r.action === 'create').length,
    toUpdate: rows.filter(r => r.action === 'update').length,
    unmatched: rows.filter(r => r.action === 'unmatched').length,
  };
}

export function useCommitRuralImport() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preview: RuralImportPreview) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const tenantId = currentTenant.id;

      const { data: batchData, error: batchError } = await (supabase.from as any)('rural_delivery_import_batches')
        .insert({
          tenant_id: tenantId,
          file_name: preview.fileName,
          row_count: preview.rows.length,
          created_by: user?.id,
          metadata: { sheetsProcessed: [...new Set(preview.rows.map(r => r.sheet))] },
        }).select().single();
      if (batchError) throw batchError;

      const errors: any[] = [];
      let imported = 0, updated = 0, unmatched = 0;

      for (const r of preview.rows) {
        if (!r.matched_client_id) {
          unmatched++;
          errors.push({ recipient: r.recipient_name_snapshot, reason: 'Cliente não encontrado' });
          continue;
        }
        const payload = {
          tenant_id: tenantId,
          client_id: r.matched_client_id,
          related_remitter_id: r.matched_remitter_id,
          supplier_name_snapshot: r.supplier_name_snapshot,
          recipient_name_snapshot: r.recipient_name_snapshot,
          city: r.city,
          neighborhood: r.neighborhood,
          origin_city: r.origin_city,
          round_trip_km: r.round_trip_km,
          access_type: r.inferred.access_type,
          delivery_mode: r.inferred.delivery_mode,
          requires_contact_before_delivery: r.inferred.requires_contact_before_delivery,
          taxi_required: r.inferred.taxi_required,
          can_deliver_in_city: r.inferred.can_deliver_in_city,
          city_delivery_instructions: r.inferred.city_delivery_instructions,
          driver_instructions: r.resolution_text,
          internal_notes: r.taxi_text,
          source_type: 'spreadsheet_import',
          source_reference: `${preview.fileName} | ${r.sheet}${r.invoice_number ? ' | NF ' + r.invoice_number : ''}`,
          active: true,
          updated_by: user?.id,
        };
        try {
          if (r.existing_profile_id) {
            const { error } = await (supabase.from as any)('client_rural_delivery_profiles')
              .update(payload).eq('id', r.existing_profile_id);
            if (error) throw error;
            updated++;
          } else {
            const { error } = await (supabase.from as any)('client_rural_delivery_profiles')
              .insert({ ...payload, created_by: user?.id });
            if (error) throw error;
            imported++;
          }
          // marca cliente como rural
          await supabase.from('clients')
            .update({ is_rural: true, rural_updated_at: new Date().toISOString() } as any)
            .eq('id', r.matched_client_id);
        } catch (e: any) {
          errors.push({ recipient: r.recipient_name_snapshot, reason: e.message });
        }
      }

      await (supabase.from as any)('rural_delivery_import_batches').update({
        imported_count: imported,
        updated_count: updated,
        unmatched_count: unmatched,
        error_count: errors.length - unmatched,
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        errors,
      }).eq('id', batchData.id);

      qc.invalidateQueries({ queryKey: ['rural_profiles'] });
      qc.invalidateQueries({ queryKey: ['rural_clients_summary'] });
      qc.invalidateQueries({ queryKey: ['rural_import_batches'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      return { imported, updated, unmatched, errors };
    },
  });
}

export function useRuralImportBatches() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['rural_import_batches', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase.from as any)('rural_delivery_import_batches')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });
}