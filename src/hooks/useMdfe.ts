import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useTenant } from '@/hooks/useTenant';
import { hubFiscal, type EmitParams, type HubEnvironment } from '@/lib/fiscal/hubFiscalClient';

export interface MdfeManifest {
  id: string;
  tenant_id: string;
  load_id: string;
  manifest_number: string;
  cte_document_ids: string[];
  fiscal_document_ids: string[];
  status: string;
  emitter_id: string | null;
  environment: HubEnvironment | null;
  external_id: string | null;
  request_payload: Json | null;
  hub_emission_id: string | null;
  hub_document_id: string | null;
  access_key: string | null;
  authorization_protocol: string | null;
  document_number: string | null;
  document_series: string | null;
  status_message: string | null;
  pdf_url: string | null;
  xml_url: string | null;
  issued_at: string | null;
  closure_requested_at: string | null;
  closure_dispatch_state: string | null;
  closure_protocol: string | null;
  closed_at: string | null;
  attempt_count: number;
  origin: string | null;
  destination: string | null;
  created_at: string;
  updated_at: string;
  loads?: {
    load_number: string;
    status: string;
    arrival_at: string | null;
    drivers: { name: string } | null;
    vehicles: { plate: string } | null;
  } | null;
  tenant_emitters?: { razao_social: string } | null;
}

const preparedSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  load_id: z.string().uuid(),
  emitter_id: z.string().uuid(),
  environment: z.enum(['sandbox', 'homologation', 'production']),
  request_payload: z.record(z.unknown()),
  status: z.string(),
}).passthrough();

function invalidateMdfe(qc: ReturnType<typeof useQueryClient>, loadId?: string) {
  qc.invalidateQueries({ queryKey: ['mdfe'] });
  qc.invalidateQueries({ queryKey: ['load_manifest'] });
  if (loadId) qc.invalidateQueries({ queryKey: ['load', loadId] });
}

export function useLoadMdfe(loadId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['mdfe', 'load', currentTenant?.id, loadId],
    enabled: !!currentTenant?.id && !!loadId,
    queryFn: async (): Promise<MdfeManifest | null> => {
      const { data, error } = await supabase
        .from('load_manifests')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .eq('load_id', loadId!)
        .not('external_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as MdfeManifest | null;
    },
  });
}

export function useMdfeHistory() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['mdfe', 'history', currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async (): Promise<MdfeManifest[]> => {
      const { data, error } = await supabase
        .from('load_manifests')
        .select(`
          *,
          loads!load_manifests_load_id_fkey(
            load_number,status,arrival_at,
            drivers(name),vehicles(plate)
          ),
          tenant_emitters(razao_social)
        `)
        .eq('tenant_id', currentTenant!.id)
        .not('external_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as unknown as MdfeManifest[];
    },
  });
}

export function useIssueMdfe() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: {
      loadId: string;
      emitterId: string;
      environment: HubEnvironment;
      cteIds: string[];
      snapshot: EmitParams['body'];
    }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('prepare_mdfe_issue', {
        _tenant_id: currentTenant.id,
        _load_id: input.loadId,
        _emitter_id: input.emitterId,
        _environment: input.environment,
        _cte_ids: input.cteIds,
        _snapshot: input.snapshot as Json,
      });
      if (error) throw error;
      const prepared = preparedSchema.parse(data);
      const response = await hubFiscal.emit({
        type: 'mdfe',
        emitterId: prepared.emitter_id,
        loadManifestId: prepared.id,
        body: prepared.request_payload as EmitParams['body'],
      });
      return { prepared: prepared as unknown as MdfeManifest, response };
    },
    onSettled: (_data, _error, input) => invalidateMdfe(qc, input.loadId),
  });
}

export function useSyncMdfe() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (manifest: MdfeManifest) => {
      if (!manifest.hub_document_id || !manifest.hub_emission_id) {
        throw new Error('MDF-e ainda não possui documento confirmado no Hub Fiscal.');
      }
      return hubFiscal.sync(manifest.hub_document_id, manifest.hub_emission_id, undefined, {
        type: 'mdfe',
        emitterId: manifest.emitter_id,
      });
    },
    onSettled: (_data, _error, manifest) => invalidateMdfe(qc, manifest.load_id),
  });
}

export function useCloseMdfe() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (manifest: MdfeManifest) => {
      if (!manifest.hub_document_id || !manifest.hub_emission_id) {
        throw new Error('MDF-e sem vínculo confirmado com o Hub Fiscal.');
      }
      return hubFiscal.closeMdfe(
        manifest.hub_document_id,
        manifest.id,
        manifest.hub_emission_id,
        manifest.emitter_id,
      );
    },
    onSettled: (_data, _error, manifest) => invalidateMdfe(qc, manifest.load_id),
  });
}

export async function downloadMdfeFile(manifest: MdfeManifest, format: 'pdf' | 'xml') {
  if (!manifest.hub_document_id) throw new Error('MDF-e sem documento confirmado no Hub Fiscal.');
  const blob = await hubFiscal.file(manifest.hub_document_id, format, {
    type: 'mdfe',
    emitterId: manifest.emitter_id,
    emissionId: manifest.hub_emission_id,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `mdfe-${manifest.document_number || manifest.manifest_number}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
