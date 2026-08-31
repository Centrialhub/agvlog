import { supabase } from '@/integrations/supabase/client';
import { restoreStateRegistrationLeadingZeros } from '@/lib/stateRegistrationZeros';

export interface FiscalCertificateSummary {
  id: string;
  label: string;
  thumbprint_sha256: string;
  serial_number: string | null;
  subject_name: string | null;
  certificate_cnpj: string | null;
  valid_from: string;
  valid_to: string;
  status: 'active' | 'inactive' | 'expired' | 'revoked' | 'invalid';
  last_tested_at: string | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfficialTaxAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  cityCode: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface OfficialTaxProfile {
  id: string;
  cnpj: string;
  uf: string;
  state_registration: string | null;
  legal_name: string | null;
  trade_name: string | null;
  registry_status: string;
  status_code: string | null;
  tax_regime: string | null;
  economic_activity_code: string | null;
  official_address: OfficialTaxAddress;
  verified_at: string;
}

export interface TaxRegistryResult {
  query_id: string;
  c_stat: number | null;
  reason: string | null;
  status: string;
  cached: boolean;
  profiles: OfficialTaxProfile[];
}

export async function listFiscalCertificates(emitterId: string): Promise<FiscalCertificateSummary[]> {
  const response = await invoke<{ certificates: FiscalCertificateSummary[] }>('fiscal-certificate-manage', {
    action: 'list', emitter_id: emitterId,
  });
  return response.certificates;
}

export async function uploadFiscalCertificate(input: {
  emitterId: string;
  file: File;
  password: string;
  label?: string;
}): Promise<void> {
  const form = new FormData();
  form.set('action', 'upload');
  form.set('emitter_id', input.emitterId);
  form.set('certificate', input.file);
  form.set('password', input.password);
  form.set('label', input.label || 'Certificado A1');
  await invoke('fiscal-certificate-manage', form);
}

export async function deactivateFiscalCertificate(emitterId: string, certificateId: string): Promise<void> {
  await invoke('fiscal-certificate-manage', {
    action: 'deactivate', emitter_id: emitterId, certificate_id: certificateId,
  });
}

export async function consultOfficialTaxRegistry(input: {
  emitterId: string;
  uf: string;
  lookupValue: string;
  lookupType?: 'CNPJ' | 'CPF' | 'IE';
  forceRefresh?: boolean;
  environment?: 'production' | 'homologation';
}): Promise<TaxRegistryResult> {
  return invoke<TaxRegistryResult>('tax-registry-consult', {
    emitter_id: input.emitterId,
    uf: input.uf,
    lookup_type: input.lookupType || 'CNPJ',
    lookup_value: input.lookupValue,
    force_refresh: Boolean(input.forceRefresh),
    environment: input.environment || 'production',
  });
}

export async function applyOfficialTaxProfile(input: {
  emitterId: string;
  queryId: string;
  registryId: string;
  targetTable: 'clients' | 'tenant_emitters';
  targetId: string;
}): Promise<Record<string, unknown>> {
  const response = await invoke<{ target: Record<string, unknown> }>('tax-registry-consult', {
    action: 'apply',
    emitter_id: input.emitterId,
    query_id: input.queryId,
    registry_id: input.registryId,
    target_table: input.targetTable,
    target_id: input.targetId,
  });
  return response.target;
}

export function validateOfficialParty(
  input: { cnpj?: string | null; stateRegistration?: string | null },
  profiles: OfficialTaxProfile[],
): string | null {
  const cnpj = onlyDigits(input.cnpj);
  const profile = profiles.find(item => onlyDigits(item.cnpj) === cnpj);
  if (!profile) return 'CNPJ não localizado no cadastro oficial da UF';
  if (profile.registry_status !== 'active') return 'Contribuinte não está ativo no cadastro oficial';
  const informedIe = onlyDigits(restoreStateRegistrationLeadingZeros(input.stateRegistration, profile.uf) || input.stateRegistration);
  const officialIe = onlyDigits(profile.state_registration);
  if (informedIe && officialIe && informedIe !== officialIe) {
    return `IE informada ${informedIe} não corresponde à IE oficial ${officialIe}`;
  }
  if (!officialIe) return 'Cadastro oficial não retornou Inscrição Estadual ativa';
  return null;
}

async function invoke<T = unknown>(functionName: string, body: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    let message = error.message || 'Falha ao chamar serviço cadastral';
    const context = (error as { context?: Response }).context;
    if (context && typeof context.clone === 'function') {
      try {
        const payload = await context.clone().json() as { error?: string };
        if (payload?.error) message = payload.error;
      } catch {
        // Preserve the transport error when the backend did not return JSON.
      }
    }
    throw new Error(message);
  }
  const payload = data as T & { error?: string };
  if (payload && typeof payload === 'object' && typeof payload.error === 'string') throw new Error(payload.error);
  return payload as T;
}

function onlyDigits(value?: string | null): string {
  return String(value || '').replace(/\D/g, '');
}
