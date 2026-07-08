import { describe, it, expect } from 'vitest';
import {
  inferRuralAttributes,
  detectRequiresContact,
  detectTaxiRequired,
  detectDirtRoad,
  containsRuralTerms,
  ruralProfileDedupeKey,
  ruralMatchScore,
} from '@/lib/ruralClients/ruralDeliveryMatcher';
import { dedupeRuralRows, type ParsedRuralRow } from '@/lib/ruralClients/ruralClientsSpreadsheetImport';
import { ruralProfilesToCsv, accessTypeLabel, deliveryModeLabel } from '@/lib/ruralClients/ruralDeliveryReports';

describe('rural text detection', () => {
  it('detects "ligar" as requires_contact', () => {
    expect(detectRequiresContact('Ligar sempre antes de sair')).toBe(true);
    expect(detectRequiresContact('VENDEDOR FALOU QUE ENTREGA EM MAMONAS, LIGAR SEMPRE.')).toBe(true);
    expect(detectRequiresContact('Sem contato')).toBe(false);
  });

  it('detects taxi requirement and "não tem taxi"', () => {
    expect(detectTaxiRequired('Taxi Ademir (38)99787310 - combrou 20,00')).toBe(true);
    expect(detectTaxiRequired('Não tem taxi')).toBe(false);
    expect(detectTaxiRequired('mototaxi disponível')).toBe(true);
  });

  it('detects estrada de terra', () => {
    expect(detectDirtRoad('ESTRADA DE TERRA E TEM TAXI VALOR 150')).toBe(true);
    expect(detectDirtRoad('asfalto até o local')).toBe(false);
  });

  it('recognizes rural terms in address', () => {
    expect(containsRuralTerms('ZONA RURAL')).toBe(true);
    expect(containsRuralTerms('FAZENDA SANTA MARTA')).toBe(true);
    expect(containsRuralTerms('Rua principal, centro')).toBe(false);
  });

  it('inferRuralAttributes combines flags', () => {
    const r = inferRuralAttributes('ESTRADA DE TERRA', 'Taxi Ademir (38)99787310');
    expect(r.taxi_required).toBe(true);
    expect(r.access_type).toBe('dirt_road');
    expect(r.delivery_mode).toBe('taxi');
  });

  it('inferRuralAttributes handles city pickup', () => {
    const r = inferRuralAttributes('Vamos na cidade');
    expect(r.can_deliver_in_city).toBe(true);
    expect(r.delivery_mode).toBe('city_pickup');
  });

  it('inferRuralAttributes ignores "não tem taxi"', () => {
    const r = inferRuralAttributes('Não tem taxi, entregar direto');
    expect(r.taxi_required).toBe(false);
  });
});

describe('rural profile dedupe key', () => {
  it('same client+city+bairro+remetente collides', () => {
    const a = ruralProfileDedupeKey({ client_id: 'c1', city: 'Salinas', neighborhood: 'Maristela', related_remitter_id: 'r1' });
    const b = ruralProfileDedupeKey({ client_id: 'c1', city: 'SALINAS ', neighborhood: 'maristela', related_remitter_id: 'r1' });
    expect(a).toBe(b);
  });

  it('different remetente => different key', () => {
    const a = ruralProfileDedupeKey({ client_id: 'c1', city: 'X', neighborhood: 'Y', related_remitter_id: 'r1' });
    const b = ruralProfileDedupeKey({ client_id: 'c1', city: 'X', neighborhood: 'Y', related_remitter_id: 'r2' });
    expect(a).not.toBe(b);
  });
});

describe('rural match score', () => {
  it('high when client rural + full match', () => {
    expect(ruralMatchScore({ clientHasRuralFlag: true, cityMatches: true, neighborhoodMatches: true })).toBe('high');
  });
  it('medium when only address matches', () => {
    expect(ruralMatchScore({ cityMatches: true, neighborhoodMatches: true })).toBe('medium');
  });
  it('low when only text hint', () => {
    expect(ruralMatchScore({ addressRuralHint: true })).toBe('low');
  });
});

describe('dedupeRuralRows', () => {
  it('keeps the row with the richest resolution/taxi text', () => {
    const base: Partial<ParsedRuralRow> = {
      sheet: 'A', supplier_name_snapshot: 'X', recipient_name_snapshot: 'Cliente',
      city: 'Salinas', neighborhood: 'Maristela',
      invoice_number: '1', cte_number: null, issue_date: null,
      invoice_value: null, weight_kg: null, volumes: null, origin_city: null,
      round_trip_km: null, inferred: inferRuralAttributes(null), raw: {},
    };
    const rows: ParsedRuralRow[] = [
      { ...base, resolution_text: null, taxi_text: null } as ParsedRuralRow,
      { ...base, resolution_text: 'Estrada de terra, ligar antes', taxi_text: 'Taxi Ademir' } as ParsedRuralRow,
    ];
    const out = dedupeRuralRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].resolution_text).toContain('Estrada');
  });
});

describe('reports helpers', () => {
  it('csv escapes semicolons and quotes', () => {
    const rows: any[] = [{
      client_name: 'Fulano; da Silva', city: 'X', neighborhood: 'Y',
      access_type: 'dirt_road', delivery_mode: 'taxi',
      requires_contact_before_delivery: true, taxi_required: true,
      contact_name: '', contact_phone: '', taxi_contact_phone: '',
      taxi_estimated_cost: 25.5, driver_instructions: 'Ligar "antes"',
      internal_notes: '',
    }];
    const csv = ruralProfilesToCsv(rows);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Fulano; da Silva"');
    expect(csv).toContain('"Ligar ""antes"""');
    expect(csv).toContain('25,5');
  });

  it('labels map correctly', () => {
    expect(accessTypeLabel('dirt_road')).toBe('Estrada de terra');
    expect(deliveryModeLabel('taxi')).toBe('Táxi/terceiro');
  });
});