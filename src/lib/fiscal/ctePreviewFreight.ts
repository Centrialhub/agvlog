import type { CteGroupPreview } from '@/lib/cteGroupingModes';
import type { FreightInput, FreightResult } from '@/hooks/useFreightCalculator';
import { recalcIcms } from './ctePreviewIcms';

/** Preserve saved/overridden NF freight; calculate only missing notes, without writes. */
export async function resolveCtePreviewFreight(
  group: CteGroupPreview, tenantId: string,
  clients: ReadonlyArray<{ id: string; payer_group?: string | null }>,
  calculate: (input: FreightInput) => Promise<FreightResult>,
): Promise<{ freightValue: number; freightError: string }> {
  let cents = 0;
  for (const document of group.documents) {
    if (document.tenant_id !== tenantId) {
      return { freightValue: 0, freightError: 'As notas não pertencem à empresa ativa. Feche a prévia e selecione o lote novamente.' };
    }
    const saved = Number(document.freight_value);
    if (Number.isFinite(saved) && saved > 0) { cents += Math.round(saved * 100); continue; }
    if (document.freight_overridden) {
      return { freightValue: 0, freightError: 'Há uma nota com frete manual sem valor positivo. Informe o frete base do grupo.' };
    }
    try {
      const client = clients.find(client => client.id === document.client_id);
      if (document.client_id && !client) throw new Error('Cadastro do cliente indisponível para conferir a tabela.');
      const result = await calculate({
        tenantId, clientId: document.client_id,
        supplierTaxIds: [document.remitter_cnpj],
        destination: document.recipient || document.recipient_city,
        destinationState: document.recipient_state,
        destinationMunicipality: document.recipient_city,
        totalValue: Number(document.value) || 0,
        totalWeight: Number(document.weight_kg) || 0,
        totalPallets: Number(document.pallet_count) || 0,
      });
      if (!result.success || !Number.isFinite(result.value) || result.value <= 0) {
        throw new Error(result.error || 'Nenhuma tabela retornou frete positivo.');
      }
      cents += Math.round(result.value * 100);
    } catch (error) {
      return { freightValue: 0, freightError: `Frete automático incompleto: ${error instanceof Error ? error.message : 'falha na consulta.'} Informe o frete base do grupo ou revise a tabela.` };
    }
  }
  return { freightValue: cents / 100, freightError: '' };
}

type FreightDraft = {
  freightValue: number; fcFreightWeight: number; icmsAliquota: number;
  icmsEmbutido: boolean; icmsIsento: boolean; icmsBase: number; icmsValor: number;
};

/** Both base-freight controls represent the same amount sent to the builder. */
export function applyCteFreightPatch<T extends FreightDraft>(item: T, patch: Partial<T>): T {
  const next = { ...item, ...patch };
  const value = patch.freightValue ?? patch.fcFreightWeight;
  if (value === undefined) return next;
  const tax = recalcIcms(value, next.icmsAliquota, next.icmsEmbutido, next.icmsIsento);
  return { ...next, freightValue: value, fcFreightWeight: value,
    icmsBase: tax.base, icmsValor: tax.valor, freightError: '' };
}

/** Keep tax edits made while defaults were loading, just like other draft fields. */
export function applyCteFreightDefaults<T extends FreightDraft>(base: T, previous: T, merged: T, freightValue: number): T {
  const next = applyCteFreightPatch(merged, { freightValue } as Partial<T>);
  return { ...next,
    icmsBase: previous.icmsBase !== base.icmsBase ? previous.icmsBase : next.icmsBase,
    icmsValor: previous.icmsValor !== base.icmsValor ? previous.icmsValor : next.icmsValor };
}
