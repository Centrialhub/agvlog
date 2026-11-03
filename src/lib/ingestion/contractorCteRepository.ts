import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { contractorCteSchema, describeContractorCteFile, type ContractorCte } from './contractorCte';

export const CONTRACTOR_CTE_BUCKET = 'contractor-cte-originals';
export type ContractorCteSource = Omit<Tables<'contractor_cte_sources'>, 'document'> & { document: ContractorCte };
export function readContractorCteSource(row: Tables<'contractor_cte_sources'>): ContractorCteSource {
  const document = contractorCteSchema.parse(row.document);
  if (row.access_key !== document.access_key || row.environment !== document.environment || row.source_format !== document.source_format) {
    throw new Error('Os dados do CT-e de origem estão inconsistentes. Acione o suporte.');
  }
  return { ...row, document };
}
export async function listContractorCteSources(tenantId: string, search = '') {
  let query = supabase.from('contractor_cte_sources').select('*').eq('tenant_id', tenantId);
  const key = search.replace(/\D/g, '');
  if (key) query = query.ilike('access_key', `%${key}%`);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error('Não foi possível consultar os CT-es de origem. Tente novamente.');
  return (data ?? []).map(readContractorCteSource);
}
export async function importContractorCte(tenantId: string, actorId: string, file: File, input: ContractorCte) {
  const document = contractorCteSchema.parse(input);
  const description = await describeContractorCteFile(file);
  if (description.format !== document.source_format) throw new Error('O formato do original não corresponde à revisão.');
  const path = `${tenantId}/${actorId}/${description.sha256}.${description.format}`;
  const bucket = supabase.storage.from(CONTRACTOR_CTE_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: description.format === 'pdf' ? 'application/pdf' : 'application/xml', upsert: false,
  });
  if (uploadError) {
    // A retry may find the original already uploaded. Never overwrite or delete on an ambiguous result.
    const { data, error } = await bucket.download(path);
    if (error || !data) throw new Error('O envio do original não foi confirmado. Tente novamente.');
    const stored = await describeContractorCteFile(new File([data], file.name));
    if (stored.sha256 !== description.sha256 || stored.size !== description.size) throw new Error('O original armazenado não corresponde ao arquivo selecionado.');
  }
  const { data, error } = await supabase.rpc('register_contractor_cte_source_v1', {
    _tenant_id: tenantId, _document: document as Json, _sha256: description.sha256, _size: description.size, _name: file.name,
  });
  if (error || !data) {
    const conflict = error?.code === '23505';
    throw new Error(conflict ? 'Já existe um original diferente para esta chave e formato. Confira o documento cadastrado.'
      : 'O cadastro não foi confirmado. Tente importar novamente o mesmo arquivo.');
  }
  return data;
}
export async function downloadContractorCteOriginal(source: ContractorCteSource): Promise<Blob> {
  const { data, error } = await supabase.storage.from(CONTRACTOR_CTE_BUCKET).download(source.original_path);
  if (error || !data) throw new Error('Não foi possível baixar o original. Tente novamente.');
  const stored = await describeContractorCteFile(new File([data], `original.${source.source_format}`));
  if (stored.sha256 !== source.original_sha256 || stored.size !== source.original_size) throw new Error('O original não passou na conferência de integridade. Acione o suporte.');
  return data;
}
