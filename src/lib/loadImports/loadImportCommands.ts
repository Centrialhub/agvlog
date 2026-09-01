import { z } from 'zod';
import type { ParsedSpreadsheet } from './spreadsheetLoadImport';
import type { ParsedCte, ParsedNfe } from './xmlLoadImport';

const id = z.string().uuid();
const nullableText = (max: number) => z.string().max(max).nullable();
const nullableDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const natural = z.number().int().nonnegative().max(99_999_999_999_999);

const loadSchema = z.object({
  external_load_number: z.string().trim().min(1).max(120),
  load_date: nullableDate,
  arrival_date: nullableDate,
  gross_cargo_cents: natural,
  freight_cents: natural,
  cte_count: z.number().int().nonnegative().max(1_000_000),
  legacy_status_text: nullableText(1000),
  expected_payment_date: nullableDate,
  closed_at: z.string().max(40).nullable(),
}).strict();

const documentSchema = z.object({
  external_load_number: z.string().trim().min(1).max(120),
  kind: z.enum(['nfe', 'cte']),
  access_key: z.string().regex(/^\d{44}$/).nullable(),
  number: nullableText(60),
  issue_date: nullableDate,
  issuer_name: nullableText(255),
  issuer_cnpj: nullableText(30),
  recipient_name: nullableText(255),
  recipient_cnpj: nullableText(30),
  origin_city: nullableText(255),
  origin_state: nullableText(2),
  destination_city: nullableText(255),
  destination_state: nullableText(2),
  cargo_cents: natural,
  freight_cents: natural,
  weight_grams: natural,
  volume_milliunits: natural,
  freight_rate_ppm: z.number().int().min(0).max(1_000_000).nullable(),
  referenced_nfe_keys: z.array(z.string().regex(/^\d{44}$/)).max(10_000),
}).strict().refine(
  value => !!value.access_key || (!!value.number && !!value.issuer_name),
  'Documento sem chave de acesso ou identidade de número + emitente',
);

const unloadingSchema = z.object({
  external_load_number: nullableText(120),
  invoice_number: nullableText(60),
  client_name: nullableText(255),
  supplier_name: nullableText(255),
  city: nullableText(255),
  service_date: nullableDate,
  amount_cents: natural,
  suppliers: z.array(z.string().max(255)).max(1000),
}).strict();

export const loadImportCommandSchema = z.object({
  version: z.literal(1),
  tenant_id: id,
  actor_id: id,
  request_id: id,
  source_type: z.enum(['spreadsheet', 'xml']),
  file_name: z.string().trim().min(1).max(255),
  file_count: z.number().int().min(1).max(1000),
  loads: z.array(loadSchema).min(1).max(5000),
  documents: z.array(documentSchema).max(20_000),
  unloading_charges: z.array(unloadingSchema).max(20_000),
}).strict();

export type LoadImportCommand = z.infer<typeof loadImportCommandSchema>;
export type LoadImportCommandInput = Omit<LoadImportCommand, 'version' | 'tenant_id' | 'actor_id' | 'request_id'>;

export interface ImportPreview {
  newLoads: number;
  updatedLoads: number;
  newDocuments: number;
  duplicated: number;
  pending: number;
  errors: Array<{ row?: number; message: string }>;
}

const previewSchema = z.object({
  newLoads: z.number().int().nonnegative(), updatedLoads: z.number().int().nonnegative(),
  newDocuments: z.number().int().nonnegative(), duplicated: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  errors: z.array(z.object({ row: z.number().int().optional(), message: z.string() }).strict()),
}).strict();
const resultSchema = z.object({
  version: z.literal(1), tenant_id: id, actor_id: id, request_id: id,
  confirmed: z.literal(true), command_id: id, batch_id: id, preview: previewSchema,
  counts: z.object({
    new_items: z.number().int().nonnegative(), duplicate_items: z.number().int().nonnegative(),
    new_unloading_charges: z.number().int().nonnegative(), duplicate_unloading_charges: z.number().int().nonnegative(),
    freight_rates: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type LoadImportResult = z.infer<typeof resultSchema>;

const clean = (value: string | null | undefined, max = 255) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : null;
};
const digits = (value: string | null | undefined) => clean(value)?.replace(/\D/g, '') || null;
const cents = (value: number) => {
  const result = Math.round((Number.isFinite(value) ? value : 0) * 100);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Valor monetário fora do limite de importação.');
  return result;
};
const milli = (value: number) => {
  const result = Math.round((Number.isFinite(value) ? value : 0) * 1000);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Quantidade fora do limite de importação.');
  return result;
};
const allocate = (total: number, count: number) => {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) => base + (index < total % count ? 1 : 0));
};

export function buildSpreadsheetLoadImport(fileName: string, parsed: ParsedSpreadsheet[]): LoadImportCommandInput {
  const parserErrors = parsed.flatMap(sheet => sheet.errors.map(error => `${sheet.sheetName}, linha ${error.row}: ${error.message}`));
  if (parserErrors.length) throw new Error(`A planilha contém erros e não foi enviada: ${parserErrors.slice(0, 3).join('; ')}`);
  const loads = new Map<string, z.infer<typeof loadSchema>>();
  const invoiceToLoads = new Map<string, Set<string>>();
  const documents: z.infer<typeof documentSchema>[] = [];
  const unloading_charges: z.infer<typeof unloadingSchema>[] = [];

  for (const sheet of parsed) for (const row of sheet.summary) {
    const external = row.external_load_number.trim();
    if (!external) throw new Error('Carga sem número externo.');
    const candidate = loadSchema.parse({
      external_load_number: external, load_date: row.load_date, arrival_date: row.arrival_date,
      gross_cargo_cents: cents(row.gross_cargo_value), freight_cents: cents(row.freight_amount),
      cte_count: row.cte_numbers.length, legacy_status_text: clean(row.legacy_status_text, 1000),
      expected_payment_date: row.expected_payment_date, closed_at: row.closed_at,
    });
    const previous = loads.get(external.toUpperCase());
    if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) throw new Error(`Carga ${external} aparece com dados conflitantes.`);
    loads.set(external.toUpperCase(), candidate);
  }

  for (const sheet of parsed) for (const row of sheet.detail) {
    const external = row.external_load_number.trim();
    if (!external) throw new Error('Documento sem carga externa.');
    if (!loads.has(external.toUpperCase())) loads.set(external.toUpperCase(), loadSchema.parse({
      external_load_number: external, load_date: null, arrival_date: null, gross_cargo_cents: 0,
      freight_cents: 0, cte_count: 0, legacy_status_text: null, expected_payment_date: null, closed_at: null,
    }));
    const invoices = [...new Set(row.invoice_numbers.map(value => value.trim()).filter(Boolean))];
    if (!invoices.length) throw new Error(`Carga ${external} possui detalhe sem nota fiscal.`);
    const cargo = allocate(cents(row.cargo_value), invoices.length);
    const freight = allocate(cents(row.freight_value), invoices.length);
    const weight = allocate(milli(row.weight_kg), invoices.length);
    invoices.forEach((invoice, index) => {
      const key = invoice.toUpperCase();
      const related = invoiceToLoads.get(key) ?? new Set<string>(); related.add(external); invoiceToLoads.set(key, related);
      documents.push(documentSchema.parse({
        external_load_number: external, kind: 'nfe', access_key: null, number: invoice,
        issue_date: row.issue_date, issuer_name: clean(row.issuer_name), issuer_cnpj: null,
        recipient_name: clean(row.recipient_name), recipient_cnpj: null, origin_city: null, origin_state: null,
        destination_city: clean(row.destination_city), destination_state: null, cargo_cents: cargo[index],
        freight_cents: freight[index], weight_grams: weight[index], volume_milliunits: 0,
        freight_rate_ppm: row.freight_percent == null ? null : Math.round(row.freight_percent * 1_000_000), referenced_nfe_keys: [],
      }));
    });
  }

  for (const sheet of parsed) for (const row of sheet.unloading) {
    const invoices = [...new Set(row.invoice_numbers.map(value => value.trim()).filter(Boolean))];
    const identities = invoices.length ? invoices : [null];
    const amounts = allocate(cents(row.amount), identities.length);
    identities.forEach((invoice, index) => {
      const targets = invoice ? invoiceToLoads.get(invoice.toUpperCase()) : undefined;
      const external = targets?.size === 1 ? [...targets][0] : null;
      const suppliers = [...new Set(row.supplier_names.map(value => value.trim()).filter(Boolean))].sort();
      unloading_charges.push(unloadingSchema.parse({
        external_load_number: external, invoice_number: invoice, client_name: clean(row.client_name),
        supplier_name: suppliers[0] ?? null, city: clean(row.city), service_date: row.service_date,
        amount_cents: amounts[index], suppliers,
      }));
    });
  }
  if (!loads.size) throw new Error('Nenhuma carga válida foi encontrada para importação.');
  return loadImportCommandSchema.omit({ version: true, tenant_id: true, actor_id: true, request_id: true }).parse({
    source_type: 'spreadsheet', file_name: fileName, file_count: 1,
    loads: [...loads.values()], documents, unloading_charges,
  });
}

export function buildXmlLoadImport(fileName: string, docs: Array<ParsedNfe | ParsedCte>): LoadImportCommandInput {
  if (!docs.length) throw new Error('Nenhum XML NF-e/CT-e válido foi selecionado.');
  const external = 'XML-PENDING';
  const documents = docs.map(doc => {
    const key = digits(doc.access_key);
    if (!key || key.length !== 44) throw new Error(`${doc.kind.toUpperCase()} sem chave de acesso válida.`);
    const nfe = doc.kind === 'nfe';
    return documentSchema.parse({
      external_load_number: external, kind: doc.kind, access_key: key, number: clean(doc.number, 60),
      issue_date: doc.issue_date, issuer_name: clean(nfe ? doc.issuer_name : doc.remitter_name),
      issuer_cnpj: nfe ? digits(doc.issuer_cnpj) : null, recipient_name: clean(doc.recipient_name),
      recipient_cnpj: nfe ? digits(doc.recipient_cnpj) : null, origin_city: clean(doc.origin_city),
      origin_state: clean(doc.origin_state, 2), destination_city: clean(doc.destination_city),
      destination_state: clean(doc.destination_state, 2), cargo_cents: cents(nfe ? doc.total_value : doc.cargo_value),
      freight_cents: cents(nfe ? 0 : doc.freight_value), weight_grams: milli(nfe ? doc.weight_kg : 0),
      volume_milliunits: milli(nfe ? doc.volume_count : 0), freight_rate_ppm: null,
      referenced_nfe_keys: nfe ? [] : doc.referenced_nfe_keys.map(value => digits(value)).filter((value): value is string => value?.length === 44),
    });
  });
  return loadImportCommandSchema.omit({ version: true, tenant_id: true, actor_id: true, request_id: true }).parse({
    source_type: 'xml', file_name: fileName, file_count: docs.length,
    loads: [{ external_load_number: external, load_date: null, arrival_date: null,
      gross_cargo_cents: documents.reduce((sum, doc) => sum + (doc.kind === 'nfe' ? doc.cargo_cents : 0), 0),
      freight_cents: documents.reduce((sum, doc) => sum + (doc.kind === 'cte' ? doc.freight_cents : 0), 0),
      cte_count: documents.filter(doc => doc.kind === 'cte').length, legacy_status_text: null,
      expected_payment_date: null, closed_at: null }],
    documents, unloading_charges: [],
  });
}

export function parseLoadImportResult(value: unknown, payload: LoadImportCommand): LoadImportResult {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new Error('Importação sem confirmação compatível. Recupere o mesmo pedido.');
  const result = parsed.data;
  if (result.tenant_id !== payload.tenant_id || result.actor_id !== payload.actor_id || result.request_id !== payload.request_id) {
    throw new Error('A confirmação não corresponde à importação. Recupere o pedido na sessão original.');
  }
  return result;
}

export function loadImportError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : typeof cause === 'object' && cause && 'message' in cause ? String(cause.message) : '';
  if (/concurrent_change/.test(raw)) return 'Outra importação está atualizando essas cargas. Aguarde e recupere o pedido.';
  if (/not_authorized|permission denied/.test(raw)) return 'Sua sessão não pode importar cargas nesta empresa.';
  if (/request_key_mismatch/.test(raw)) return 'O pedido salvo não corresponde ao arquivo. Recupere a importação original.';
  if (/document_graph_conflict/.test(raw)) return 'Um documento já pertence a outra carga ou entrega. Revise o arquivo inteiro.';
  if (/invalid_|unknown_load|conflicting_/.test(raw)) return 'O arquivo contém dados conflitantes ou inválidos e nada foi importado.';
  return raw || 'Importação sem confirmação. Recupere o mesmo pedido antes de reenviar.';
}
