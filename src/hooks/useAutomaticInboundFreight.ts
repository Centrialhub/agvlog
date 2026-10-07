import { useEffect, useMemo, useRef, useState } from 'react';
import { useTenant } from './useTenant';
import { calculateFreight, type FreightInput } from './useFreightCalculator';
import type { FiscalDocument } from './useFiscalDocuments';
import { resolveNFSeServiceValue } from '@/lib/fiscal/nfseServiceValue';

type Outcome = { value: number; error: string };
type FreightDocument = Pick<FiscalDocument, 'id' | 'tenant_id' | 'invoice_number' | 'freight_value'
  | 'freight_overridden' | 'client_id' | 'remitter_cnpj' | 'recipient' | 'recipient_city'
  | 'recipient_state' | 'value' | 'weight_kg'> & { pallet_count: number | null };

/** Read-only preparation, like CT-e: never turns an automatic amount into an override. */
export function useAutomaticInboundFreight(
  documents: readonly FreightDocument[], enabled: boolean, fetching = false, revision = 0,
  manualValues: Readonly<Record<string, number>> = {},
) {
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const requests = useRef(new Map<string, Promise<Outcome>>());
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const candidates = documents.filter(document => !document.freight_overridden
    && manualValues[document.id] === undefined && !resolveNFSeServiceValue(document.freight_value));
  const inputs = candidates.map(document => {
    const input: FreightInput = {
      tenantId: tenantId ?? '', clientId: document.client_id, supplierTaxIds: [document.remitter_cnpj],
      destination: document.recipient || document.recipient_city,
      destinationState: document.recipient_state, destinationMunicipality: document.recipient_city,
      totalValue: Number(document.value) || 0, totalWeight: Number(document.weight_kg) || 0,
      totalPallets: Number(document.pallet_count) || 0,
    };
    return { id: document.id, sourceTenant: document.tenant_id, input,
      key: JSON.stringify([document.id, document.tenant_id, input, revision]) };
  });
  const signature = JSON.stringify(inputs);
  const stableInputs = useMemo(() => JSON.parse(signature) as typeof inputs, [signature]);

  useEffect(() => {
    if (!enabled) { requests.current.clear(); setOutcomes({}); return; }
    if (!tenantId || fetching || !stableInputs.length) return;
    let cancelled = false;
    const pending = stableInputs.map(({ key, sourceTenant, input }) => {
      let request = requests.current.get(key);
      if (!request) {
        request = (async (): Promise<Outcome> => {
          try {
            if (sourceTenant !== tenantId) throw new Error('A nota não pertence à empresa ativa. Atualize a seleção.');
            const result = await calculateFreight(input);
            const value = resolveNFSeServiceValue(result.value);
            if (!result.success || !value) throw new Error(result.error || 'Nenhuma tabela retornou frete positivo.');
            return { value, error: '' };
          } catch (error) {
            return { value: 0, error: error instanceof Error ? error.message : 'Falha ao calcular o frete automático.' };
          }
        })();
        requests.current.set(key, request);
      }
      return request.then(outcome => [key, outcome] as const);
    });
    void Promise.all(pending).then(results => {
      if (!cancelled) setOutcomes(previous => ({ ...previous, ...Object.fromEntries(results) }));
    });
    return () => { cancelled = true; };
  }, [enabled, tenantId, fetching, stableInputs]);

  const values: Record<string, number> = {};
  const errors: string[] = [];
  let pending = false;
  if (enabled) for (const { id, key } of stableInputs) {
    const outcome = outcomes[key];
    if (!outcome) pending = true;
    else if (outcome.error) errors.push(`NF ${documents.find(document => document.id === id)?.invoice_number || id}: ${outcome.error}`);
    else values[id] = outcome.value;
  }
  return { values, errors, pending };
}
