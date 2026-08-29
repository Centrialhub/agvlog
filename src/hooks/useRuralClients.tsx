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
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export interface RuralProfile extends Tables<'client_rural_delivery_profiles'> {
  client_name?: string | null;
  related_remitter_name?: string | null;
}

type RuralProfileJoined = Tables<'client_rural_delivery_profiles'> & {
  client: { company_name: string } | null;
  remitter: { company_name: string } | null;
};
type RuralProfileCreate = Omit<
  TablesInsert<'client_rural_delivery_profiles'>,
  'tenant_id' | 'created_by' | 'updated_by'
>;
type RuralProfileUpdate = Omit<
  TablesUpdate<'client_rural_delivery_profiles'>,
  'id' | 'tenant_id' | 'created_by' | 'updated_by'
>;

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
      let q = supabase.from('client_rural_delivery_profiles')
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
      let rows: RuralProfile[] = ((data ?? []) as RuralProfileJoined[]).map((r) => ({
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
        withInstructions: list.filter((c) => (c.rural_driver_instructions || '').trim().length > 0).length,
        requireContact: list.filter((c) => c.rural_requires_contact).length,
        withoutPhone: list.filter((c) => !(c.rural_contact_phone || '').trim()).length,
        dirtRoad: list.filter((c) => c.rural_access_type === 'dirt_road').length,
        withoutInstructions: list.filter((c) => !(c.rural_driver_instructions || '').trim()).length,
        clients: list,
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
    mutationFn: async (values: RuralProfileCreate) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('client_rural_delivery_profiles').insert({
        ...values,
        tenant_id: currentTenant.id,
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
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: RuralProfileUpdate & { id: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('client_rural_delivery_profiles')
        .update({ ...values, updated_by: user?.id })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .select()
        .single();
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

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, address_city')
    .eq('tenant_id', tenantId)
    .limit(5000);
  if (clientsError) throw clientsError;

  const clientIndex = new Map<string, Pick<Tables<'clients'>, 'id' | 'company_name' | 'address_city'>>();
  for (const c of clients || []) {
    clientIndex.set(normalizeText(c.company_name), c);
  }

  const { data: existing, error: existingError } = await supabase.from('client_rural_delivery_profiles')
    .select('id, client_id, city, neighborhood, related_remitter_id')
    .eq('tenant_id', tenantId)
    .limit(5000);
  if (existingError) throw existingError;
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

      const { data: batchData, error: batchError } = await supabase.from('rural_delivery_import_batches')
        .insert({
          tenant_id: tenantId,
          file_name: preview.fileName,
          row_count: preview.rows.length,
          created_by: user?.id,
          metadata: { sheetsProcessed: [...new Set(preview.rows.map(r => r.sheet))] },
        }).select().single();
      if (batchError) throw batchError;

      const errors: Array<{ recipient: string | null; reason: string }> = [];
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
            const { error } = await supabase.from('client_rural_delivery_profiles')
              .update(payload)
              .eq('id', r.existing_profile_id)
              .eq('tenant_id', tenantId);
            if (error) throw error;
            updated++;
          } else {
            const { error } = await supabase.from('client_rural_delivery_profiles')
              .insert({ ...payload, created_by: user?.id });
            if (error) throw error;
            imported++;
          }
          // marca cliente como rural
          const { error: clientError } = await supabase.from('clients')
            .update({ is_rural: true, rural_updated_at: new Date().toISOString() })
            .eq('id', r.matched_client_id)
            .eq('tenant_id', tenantId);
          if (clientError) throw clientError;
        } catch (error: unknown) {
          errors.push({
            recipient: r.recipient_name_snapshot,
            reason: error instanceof Error ? error.message : 'Falha desconhecida ao importar perfil rural',
          });
        }
      }

      const { error: completionError } = await supabase.from('rural_delivery_import_batches').update({
        imported_count: imported,
        updated_count: updated,
        unmatched_count: unmatched,
        error_count: errors.length - unmatched,
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        errors: errors as Json,
      }).eq('id', batchData.id).eq('tenant_id', tenantId);
      if (completionError) throw completionError;

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
      const { data, error } = await supabase.from('rural_delivery_import_batches')
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
