export type DriverFiscalDocumentKind = 'nfe' | 'cte' | 'nfse';

export interface DriverFiscalDocument {
  kind: DriverFiscalDocumentKind;
  id: string;
  number: string | null;
  series: string | null;
  issued_at: string | null;
  issuer: string | null;
  recipient: string | null;
  destination_city: string | null;
  destination_state: string | null;
  amount: number | null;
  weight_kg: number | null;
  volume_count: number | null;
  pallet_count: number | null;
}

export interface DriverFiscalCatalog {
  load_id: string;
  documents: DriverFiscalDocument[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_RESPONSE = 'Resposta inválida do catálogo fiscal.';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID_RESPONSE);
  return value as Record<string, unknown>;
}

function nullableString(value: unknown, maxLength = 300): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(INVALID_RESPONSE);
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(INVALID_RESPONSE);
  return value;
}

function document(value: unknown): DriverFiscalDocument {
  const row = object(value);
  if (row.kind !== 'nfe' && row.kind !== 'cte' && row.kind !== 'nfse') throw new Error(INVALID_RESPONSE);
  if (typeof row.id !== 'string' || !UUID.test(row.id)) throw new Error(INVALID_RESPONSE);
  return {
    kind: row.kind,
    id: row.id,
    number: nullableString(row.number, 100),
    series: nullableString(row.series, 40),
    issued_at: nullableString(row.issued_at, 40),
    issuer: nullableString(row.issuer),
    recipient: nullableString(row.recipient),
    destination_city: nullableString(row.destination_city, 180),
    destination_state: nullableString(row.destination_state, 10),
    amount: nullableNumber(row.amount),
    weight_kg: nullableNumber(row.weight_kg),
    volume_count: nullableNumber(row.volume_count),
    pallet_count: nullableNumber(row.pallet_count),
  };
}

export function parseDriverFiscalCatalog(value: unknown, expectedLoadId: string): DriverFiscalCatalog {
  const payload = object(value);
  if (!UUID.test(expectedLoadId) || payload.load_id !== expectedLoadId || !Array.isArray(payload.documents)) {
    throw new Error(INVALID_RESPONSE);
  }
  if (payload.documents.length > 1_000) throw new Error(INVALID_RESPONSE);
  return { load_id: expectedLoadId, documents: payload.documents.map(document) };
}
