import { describe, expect, it } from 'vitest';
import { matchesCteMonitorFilters, matchesCteSearchFilters } from '@/lib/fiscal/cteListFilters';
import type { CteMonitorFilters, CteMonitorRow } from '@/hooks/useCteMonitor';
import type { CteSearchFilters, CteSearchRow } from '@/hooks/useCteSearch';

const monitor = {
  source: 'hub', cte_number: '1012', invoice_numbers: '4002', sefaz_status: 'processed',
  protocol_number: '13526012345', internal_number: 'INT-42', reference_number: 'REF-99',
  access_key: '3126 1234', vehicle_plate: 'ABC-1D23', driver_name: 'João Silva', payer_name: 'São José',
  company_branch: 'Norte', company_group: 'AGV', payer_group: 'Varejo', cte_series: '1', correction_letter: false,
  issued_at: '2026-08-30', processed_at: new Date(2026, 7, 30, 23, 59, 59, 999).toISOString(),
} as CteMonitorRow;
const search = { ...monitor, cte_type: 'normal', hub_document_id: 'hub-id', remitter: 'São José', is_voided: false, is_closed: false } as unknown as CteSearchRow;

describe('CT-e filters after merging local and Hub records', () => {
  it('applies all monitor criteria together to a Hub row', () => {
    expect(matchesCteMonitorFilters(monitor, { docNumber: '1012', payer: 'sao jose', driver: 'joao', plate: 'ABC1D23', accessKey: '31261234', protocolNumber: '12345', internalNumber: 'INT', referenceNumber: '99', branch: 'norte', companyGroup: 'agv', payerGroup: 'varejo', series: '1', correctionLetter: 'no', statuses: ['processed'], issuedStart: '2026-08-30', issuedEnd: '2026-08-30', processedEnd: '2026-08-30' })).toBe(true);
  });
  it.each<CteMonitorFilters>([
    { driver: 'Outro' }, { branch: 'Sul' }, { companyGroup: 'Outra' }, { payerGroup: 'Outro' },
    { internalNumber: 'inexistente' }, { referenceNumber: 'inexistente' }, { protocolNumber: '99999' },
    { issuedEnd: '2026-08-29' }, { processedStart: '2026-08-31' }, { correctionLetter: 'yes' }, { statuses: ['pending'] },
  ])('does not let a Hub record bypass a monitor criterion: %j', filter => {
    expect(matchesCteMonitorFilters(monitor, filter)).toBe(false);
  });
  it('uses canonical status and excludes missing processing dates', () => {
    expect(matchesCteMonitorFilters({ ...monitor, sefaz_status: 'cancelled' }, { statuses: ['processed'] })).toBe(false);
    expect(matchesCteMonitorFilters({ ...monitor, processed_at: null }, { processedEnd: '2026-08-30' })).toBe(false);
  });
  it('supports document search and download availability without assuming unknown flags', () => {
    expect(matchesCteSearchFilters(search, { text: 'sao jose', downloadable: 'yes', voided: 'no', cteTypes: ['normal'] })).toBe(true);
    expect(matchesCteSearchFilters(search, { downloadable: 'no' })).toBe(false);
    expect(matchesCteSearchFilters(search, { cteTypes: [] })).toBe(false);
  });
  it.each<(keyof CteSearchFilters)>(['voided', 'closed', 'compensated', 'autonomousFreight', 'complementaryDoc'])('never interprets missing %s metadata as confirmed yes or no', key => {
    const unknown = { ...search, is_voided: undefined, is_closed: undefined };
    expect(matchesCteSearchFilters(unknown, { [key]: 'yes' })).toBe(false);
    expect(matchesCteSearchFilters(unknown, { [key]: 'no' })).toBe(false);
    expect(matchesCteSearchFilters(unknown, { [key]: 'all' })).toBe(true);
  });
  it('does not return a canonical cancelled CT-e in an authorized search', () => {
    expect(matchesCteSearchFilters({ ...search, sefaz_status: 'cancelled' }, { statuses: ['processed'] })).toBe(false);
  });
});
