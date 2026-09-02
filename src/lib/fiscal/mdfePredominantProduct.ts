export interface MdfeLinkedNfeProduct {
  documentId: string;
  description: string;
  value: number;
  weightKg: number;
}

export interface MdfeProductSource {
  predominant_product?: string | null;
  linked_nfe_products?: MdfeLinkedNfeProduct[];
}

export interface FiscalSourceReservationLink {
  source_id: string;
  outbound_id: string | null;
}

export interface LinkedNfeSourceRow {
  id: string;
  cte_emitted_outbound_id: string | null;
  product_summary: string | null;
  value: number | null;
  weight_kg: number | null;
}

function cleanDescription(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function positiveNumber(value: number | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function groupLinkedNfeProducts(
  reservations: FiscalSourceReservationLink[],
  sourceDocuments: LinkedNfeSourceRow[],
): Map<string, MdfeLinkedNfeProduct[]> {
  const reservedOutboundsBySource = new Map<string, Set<string>>();

  for (const reservation of reservations) {
    if (!reservation.outbound_id) continue;
    const targets = reservedOutboundsBySource.get(reservation.source_id) || new Set<string>();
    targets.add(reservation.outbound_id);
    reservedOutboundsBySource.set(reservation.source_id, targets);
  }

  const grouped = new Map<string, MdfeLinkedNfeProduct[]>();
  const seen = new Set<string>();

  for (const document of sourceDocuments) {
    const description = cleanDescription(document.product_summary);
    if (!description) continue;

    const reservedTargets = reservedOutboundsBySource.get(document.id);
    const targets = reservedTargets?.size
      ? [...reservedTargets]
      : document.cte_emitted_outbound_id
        ? [document.cte_emitted_outbound_id]
        : [];

    for (const outboundId of targets) {
      const uniqueKey = `${outboundId}:${document.id}`;
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);

      const products = grouped.get(outboundId) || [];
      products.push({
        documentId: document.id,
        description,
        value: positiveNumber(document.value),
        weightKg: positiveNumber(document.weight_kg),
      });
      grouped.set(outboundId, products);
    }
  }

  return grouped;
}

export function deriveMdfePredominantProduct(sources: MdfeProductSource[]): string {
  const products = sources.flatMap(source => source.linked_nfe_products || []);

  if (products.length) {
    const aggregated = new Map<string, {
      description: string;
      value: number;
      weightKg: number;
      firstIndex: number;
    }>();

    products.forEach((product, index) => {
      const description = cleanDescription(product.description);
      if (!description) return;
      const key = description.toLocaleUpperCase('pt-BR');
      const current = aggregated.get(key);

      if (current) {
        current.value += positiveNumber(product.value);
        current.weightKg += positiveNumber(product.weightKg);
      } else {
        aggregated.set(key, {
          description,
          value: positiveNumber(product.value),
          weightKg: positiveNumber(product.weightKg),
          firstIndex: index,
        });
      }
    });

    const selected = [...aggregated.values()].sort((left, right) =>
      right.value - left.value
      || right.weightKg - left.weightKg
      || left.firstIndex - right.firstIndex,
    )[0];

    if (selected) return selected.description.slice(0, 120);
  }

  for (const source of sources) {
    const fallback = cleanDescription(source.predominant_product);
    if (fallback) return fallback.slice(0, 120);
  }

  return '';
}
