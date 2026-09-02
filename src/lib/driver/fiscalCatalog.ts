export type DriverFiscalDocumentKind = 'nfe' | 'cte' | 'nfse';
export type DriverFiscalFileFormat = 'pdf' | 'xml';

export interface DriverFiscalFileAvailability {
  pdf: boolean;
  xml: boolean;
}

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
  available_files: DriverFiscalFileAvailability;
}

export interface DriverFiscalCatalog {
  load_id: string;
  documents: DriverFiscalDocument[];
}

export type DriverFiscalFile = {
  load_id: string;
  kind: Exclude<DriverFiscalDocumentKind, 'nfe'>;
  document_id: string;
  format: DriverFiscalFileFormat;
  filename: string;
} & (
  | { source: 'url'; url: string; content?: never }
  | { source: 'inline'; content: string; url?: never }
);

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

function fileAvailability(value: unknown): DriverFiscalFileAvailability {
  const row = object(value);
  if (typeof row.pdf !== 'boolean' || typeof row.xml !== 'boolean') throw new Error(INVALID_RESPONSE);
  return { pdf: row.pdf, xml: row.xml };
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
    available_files: fileAvailability(row.available_files),
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

function expectedFileName(value: unknown, format: DriverFiscalFileFormat): string {
  if (typeof value !== 'string' || value.length < 5 || value.length > 180) throw new Error(INVALID_RESPONSE);
  if (!/^[A-Za-z0-9._-]+$/.test(value) || !value.endsWith('.' + format)) throw new Error(INVALID_RESPONSE);
  return value;
}

function secureHttpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_096) throw new Error(INVALID_RESPONSE);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(INVALID_RESPONSE);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error(INVALID_RESPONSE);
  return parsed.toString();
}

export function parseDriverFiscalFile(
  value: unknown,
  expected: {
    loadId: string;
    kind: Exclude<DriverFiscalDocumentKind, 'nfe'>;
    documentId: string;
    format: DriverFiscalFileFormat;
  },
): DriverFiscalFile {
  const payload = object(value);
  if (
    !UUID.test(expected.loadId)
    || !UUID.test(expected.documentId)
    || payload.load_id !== expected.loadId
    || payload.kind !== expected.kind
    || payload.document_id !== expected.documentId
    || payload.format !== expected.format
  ) {
    throw new Error(INVALID_RESPONSE);
  }

  const filename = expectedFileName(payload.filename, expected.format);
  if (payload.source === 'url') {
    if (payload.content !== undefined && payload.content !== null) throw new Error(INVALID_RESPONSE);
    return {
      load_id: expected.loadId,
      kind: expected.kind,
      document_id: expected.documentId,
      format: expected.format,
      filename,
      source: 'url',
      url: secureHttpsUrl(payload.url),
    };
  }

  if (payload.source === 'inline') {
    if (payload.url !== undefined && payload.url !== null) throw new Error(INVALID_RESPONSE);
    if (expected.format !== 'xml' || typeof payload.content !== 'string' || payload.content.length === 0 || payload.content.length > 10_485_760) {
      throw new Error(INVALID_RESPONSE);
    }
    return {
      load_id: expected.loadId,
      kind: expected.kind,
      document_id: expected.documentId,
      format: expected.format,
      filename,
      source: 'inline',
      content: payload.content,
    };
  }

  throw new Error(INVALID_RESPONSE);
}
