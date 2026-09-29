import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateFreight, type FreightInput } from '@/hooks/useFreightCalculator';
import { resolveCtePreviewFreight } from '@/lib/fiscal/ctePreviewFreight';
import type { CteGroupPreview } from '@/lib/cteGroupingModes';

type Row = Record<string, string | number | boolean | null>;
const database = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, errors: {} as Record<string, unknown> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const predicates: ((row: Row) => boolean)[] = [];
  let start = 0, end = 499;
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    is: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
    in: (key: string, values: unknown[]) => { predicates.push(row => values.includes(row[key])); return query; },
    lte: (key: string, value: string) => { predicates.push(row => String(row[key]) <= value); return query; },
    order: () => query,
    range: (from: number, to: number) => { start = from; end = to; return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data: (database.rows[table] || []).filter(row => predicates.every(predicate => predicate(row))).slice(start, end + 1),
      error: database.errors[table] || null,
    }).then(resolve),
  };
  return query;
} } }));

const input: FreightInput = { tenantId: 'tenant-a', clientId: 'recipient-a',
  supplierTaxIds: ['11.222.333/0001-81'], destinationState: 'MG', destinationMunicipality: 'São João',
  totalValue: 1000, totalWeight: 100, totalPallets: 2, referenceDate: '2026-09-29' };
const region = { id: 'region-a', tenant_id: 'tenant-a', municipality: 'SAO JOAO', state_code: 'MG',
  client_id: null, payer_group: 'GROUP', region_name: 'NORTE' };

beforeEach(() => {
  database.errors = {};
  database.rows = {
    clients: [{ id: 'supplier-a', tenant_id: 'tenant-a', is_supplier: true, tax_id: '11222333000181', payer_group: 'GROUP' }],
    client_regions: [region],
    freight_tables: [{ id: 'table-a', tenant_id: 'tenant-a', table_name: 'Fornecedor A', table_code: 1,
      client_id: 'supplier-a', payer_group: 'GROUP', destination_region: 'NORTE', blocked: false,
      valid_from: '2026-01-01', valid_until: null, per_kg_value: 2, min_value: 150 }],
    fiscal_documents: [{ id: 'nf-a', tenant_id: 'tenant-a', document_type: 'inbound', deleted_at: null, remitter_cnpj: '11222333000181' }],
  };
});

describe('motor compartilhado — fornecedor da NF e região do destinatário', () => {
  it('seleciona tabela do remetente com destinatário diferente e região geral', async () => {
    const result = await calculateFreight(input);
    expect(result.success).toBe(true);
    expect(result.value).toBe(200);
    expect(result.breakdown).toMatchObject({ tableId: 'table-a', regionId: 'region-a',
      matchedCriteria: { client_id: 'supplier-a', payer_group: 'GROUP', destination_region: 'NORTE' } });
  });
  it('resolve o fornecedor a partir das NF-es vinculadas', async () => {
    expect((await calculateFreight({ ...input, supplierTaxIds: undefined, sourceDocumentIds: ['nf-a'] })).value).toBe(200);
  });
  it('resolve seleção explícita de fornecedor no simulador', async () => {
    expect((await calculateFreight({ ...input, supplierTaxIds: undefined, supplierId: 'supplier-a' })).value).toBe(200);
  });
  it('nunca usa a identidade do destinatário como fornecedor', async () => {
    expect((await calculateFreight({ ...input, supplierTaxIds: undefined, clientId: 'supplier-a' })).success).toBe(false);
  });
  it('não consulta fornecedor nem documentos de outra empresa', async () => {
    database.rows.clients[0].tenant_id = 'tenant-b';
    expect((await calculateFreight(input)).success).toBe(false);
    database.rows.fiscal_documents[0].tenant_id = 'tenant-b';
    expect((await calculateFreight({ ...input, sourceDocumentIds: ['nf-a'] })).error).toContain('indisponível');
  });
  it('não utiliza regiões nem tabelas de outra empresa', async () => {
    database.rows.client_regions[0] = { ...region, tenant_id: 'tenant-b' };
    expect((await calculateFreight(input)).success).toBe(false);
    database.rows.client_regions[0] = region;
    database.rows.freight_tables[0].tenant_id = 'tenant-b';
    expect((await calculateFreight(input)).success).toBe(false);
  });
  it.each([[null], [''], ['123'], ['11222333000181', '22333444000181']])('recusa identidade ausente/incompleta ou lote misto: %j', async (...taxIds) => {
    expect((await calculateFreight({ ...input, supplierTaxIds: taxIds })).success).toBe(false);
  });
  it('recusa cadastro ambíguo de fornecedor', async () => {
    database.rows.clients.push({ ...database.rows.clients[0], id: 'duplicate' });
    expect((await calculateFreight(input)).error).toContain('Mais de um fornecedor');
  });
  it('recusa fornecedor explícito incompatível com o remetente', async () => {
    expect((await calculateFreight({ ...input, supplierId: 'someone-else' })).success).toBe(false);
  });
  it('prioriza região específica do destinatário sobre a geral', async () => {
    database.rows.client_regions.push({ ...region, id: 'specific', client_id: 'recipient-a' });
    expect((await calculateFreight(input)).breakdown?.regionId).toBe('specific');
  });
  it('recusa empate entre regiões e não escolhe outra UF ou grupo', async () => {
    database.rows.client_regions.push({ ...region, id: 'duplicate' });
    expect((await calculateFreight(input)).error).toContain('ambígua');
    database.rows.client_regions = [{ ...region, state_code: 'SP' }, { ...region, payer_group: 'OTHER' }];
    expect((await calculateFreight(input)).success).toBe(false);
  });
  it('transforma erro do catálogo em falha explícita, sem rejeitar a promessa', async () => {
    database.errors.client_regions = { message: 'permission denied' };
    await expect(calculateFreight(input)).resolves.toMatchObject({ success: false, value: 0, breakdown: null, error: expect.stringContaining('regiões') });
  });
  it('preserva bloqueio, vigência e ambiguidade das tabelas', async () => {
    database.rows.freight_tables[0].blocked = true;
    expect((await calculateFreight(input)).success).toBe(false);
    database.rows.freight_tables[0].blocked = false;
    database.rows.freight_tables[0].valid_until = '2026-09-28';
    expect((await calculateFreight(input)).success).toBe(false);
    database.rows.freight_tables[0].valid_until = null;
    database.rows.freight_tables.push({ ...database.rows.freight_tables[0], id: 'tie' });
    expect((await calculateFreight(input)).error).toContain('mesma prioridade');
  });
  it('calcula a pré-emissão com o motor real e não aceita soma parcial diante de fornecedor sem tabela', async () => {
    const document = { id: 'nf-a', tenant_id: 'tenant-a', client_id: 'recipient-a',
      remitter_cnpj: '11222333000181', recipient_city: 'São João', recipient_state: 'MG',
      value: 1000, weight_kg: 100, pallet_count: 2, freight_value: null };
    const group = { documents: [document] } as unknown as CteGroupPreview;
    expect(await resolveCtePreviewFreight(group, 'tenant-a', [{ id: 'recipient-a' }], calculateFreight))
      .toEqual({ freightValue: 200, freightError: '' });
    group.documents.push({ ...group.documents[0], id: 'nf-b', remitter_cnpj: '22333444000181' });
    database.rows.clients.push({ ...database.rows.clients[0], id: 'supplier-b', tax_id: '22333444000181' });
    expect(await resolveCtePreviewFreight(group, 'tenant-a', [{ id: 'recipient-a' }], calculateFreight))
      .toMatchObject({ freightValue: 0, freightError: expect.stringContaining('Frete automático incompleto') });
  });
  it('busca fornecedor além da primeira página e recusa NF excluída', async () => {
    database.rows.clients.unshift(...Array.from({ length: 500 }, (_, index) => ({
      ...database.rows.clients[0], id: `other-${index}`, tax_id: `900${index}`,
    })));
    expect((await calculateFreight(input)).value).toBe(200);
    database.rows.fiscal_documents[0].deleted_at = '2026-09-29';
    expect((await calculateFreight({ ...input, sourceDocumentIds: ['nf-a'] })).error).toContain('indisponível');
  });
});
