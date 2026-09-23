import { supabase } from '@/integrations/supabase/client';

export interface LoadFreightDocument {
  id: string;
  issue_date: string | null;
  value: number | null;
  client_id: string | null;
  recipient_state: string | null;
  recipient_city: string | null;
  recipient_neighborhood: string | null;
  recipient: string | null;
  recipient_cnpj: string | null;
}

export interface LoadFreightContext {
  documents: LoadFreightDocument[];
  item_descriptions: string[];
  order_names: string[];
  total_pallets: number;
  total_weight: number;
}

export async function readLoadFreightContext(tenantId: string, loadId: string): Promise<LoadFreightContext> {
  const { data, error } = await supabase.rpc('get_load_freight_context_v1' as never, {
    _tenant_id: tenantId,
    _load_id: loadId,
  } as never);
  if (error) throw error;
  const value = data as unknown as Partial<LoadFreightContext> | null;
  if (!value || !Array.isArray(value.documents) || !Array.isArray(value.item_descriptions)
    || !Array.isArray(value.order_names)) {
    throw new Error('A base vigente da carga retornou uma resposta inválida.');
  }
  return {
    documents: value.documents,
    item_descriptions: value.item_descriptions,
    order_names: value.order_names,
    total_pallets: Number(value.total_pallets) || 0,
    total_weight: Number(value.total_weight) || 0,
  };
}
