/**
 * Aplicação do perfil da seguradora (padrão do tenant) ao lote de CT-es.
 * Nome, CNPJ e apólice são compartilhados por todo o lote. Neste fluxo, o
 * número da averbação/CGC usa o CNPJ da seguradora como valor padrão.
 */

import { onlyDigits } from './insuranceValidation';

export interface InsuranceProfileLike {
  name?: string | null;
  cnpj?: string | null;
  policy?: string | null;
}

/** Campos de seguradora presentes em cada CT-e editável do lote. */
export interface InsurerFields {
  insurerName: string;
  insurerCnpj: string;
  insurerPolicy: string;
  insurerEndorsement: string;
}

export function normalizeInsuranceProfile(
  profile?: InsuranceProfileLike | null,
): { name: string; cnpj: string; policy: string } {
  return {
    name: (profile?.name || '').trim(),
    cnpj: onlyDigits(profile?.cnpj || '').slice(0, 14),
    policy: (profile?.policy || '').trim(),
  };
}

export function hasInsuranceProfile(profile?: InsuranceProfileLike | null): boolean {
  const p = normalizeInsuranceProfile(profile);
  return !!(p.name || p.cnpj || p.policy);
}

/**
 * Devolve os campos de seguradora de um item já com o padrão aplicado.
 * - `force = false` (auto-preenchimento): só preenche campos vazios.
 * - `force = true` (usuário clicou em salvar/usar padrão): sobrescreve.
 */
export function mergeInsurerFields<T extends InsurerFields>(
  item: T,
  profile?: InsuranceProfileLike | null,
  force = false,
): T {
  const p = normalizeInsuranceProfile(profile);
  const pick = (current: string, next: string) =>
    next && (force || !(current || '').trim()) ? next : current || '';
  return {
    ...item,
    insurerName: pick(item.insurerName, p.name),
    insurerCnpj: pick(item.insurerCnpj, p.cnpj),
    insurerPolicy: pick(item.insurerPolicy, p.policy),
    insurerEndorsement: pick(item.insurerEndorsement, p.cnpj),
  };
}

/**
 * Aplica o padrão a todos os itens do lote e informa se algo mudou
 * (evita setState em loop nos efeitos do diálogo).
 */
export function applyInsuranceProfileToBatch<T extends InsurerFields>(
  items: T[],
  profile?: InsuranceProfileLike | null,
  force = false,
): { items: T[]; changed: boolean } {
  if (!hasInsuranceProfile(profile)) return { items, changed: false };
  let changed = false;
  const next = items.map((it) => {
    const merged = mergeInsurerFields(it, profile, force);
    if (
      merged.insurerName !== it.insurerName ||
      merged.insurerCnpj !== it.insurerCnpj ||
      merged.insurerPolicy !== it.insurerPolicy ||
      merged.insurerEndorsement !== it.insurerEndorsement
    ) {
      changed = true;
      return merged;
    }
    return it;
  });
  return { items: changed ? next : items, changed };
}

/**
 * Mescla o resultado de um pré-preenchimento assíncrono (RPC) preservando os
 * dados de seguradora já presentes no estado atual — sem isso, um RPC lento
 * sobrescreve o padrão que acabou de ser aplicado/salvo.
 */
export function preserveInsurerFields<T extends InsurerFields>(current: T, incoming: T): T {
  return {
    ...incoming,
    insurerName: (current.insurerName || '').trim() || incoming.insurerName,
    insurerCnpj: (current.insurerCnpj || '').trim() || incoming.insurerCnpj,
    insurerPolicy: (current.insurerPolicy || '').trim() || incoming.insurerPolicy,
    insurerEndorsement:
      (current.insurerEndorsement || '').trim() || incoming.insurerEndorsement,
  };
}
