import type { CteMonitorFilters, CteMonitorRow } from '@/hooks/useCteMonitor';
import type { CteSearchFilters, CteSearchRow, TriState } from '@/hooks/useCteSearch';
import { matchesDateRange, normalizeSearch } from '@/lib/listFilters';

const contains = (value: unknown, query?: string) => !query?.trim() || normalizeSearch(value).includes(normalizeSearch(query));
const identifier = (value: unknown) => normalizeSearch(value).replace(/[^a-z0-9]/g, '');
const containsIdentifier = (value: unknown, query?: string) => !query?.trim() || (identifier(query).length > 0 && identifier(value).includes(identifier(query)));
const triState = (value: boolean | null | undefined, filter?: TriState) => !filter || filter === 'all' || value === (filter === 'yes');

/** Apply after merging sources: the status displayed must also be the status filtered. */
export function matchesCteMonitorFilters(row: CteMonitorRow, filters: CteMonitorFilters): boolean {
  return (!filters.statuses?.length || filters.statuses.includes(row.sefaz_status))
    && (contains(row.cte_number, filters.docNumber) || contains(row.invoice_numbers, filters.docNumber))
    && contains(row.payer_name, filters.payer)
    && contains(row.internal_number, filters.internalNumber)
    && contains(row.reference_number, filters.referenceNumber)
    && contains(row.protocol_number, filters.protocolNumber)
    && containsIdentifier(row.access_key, filters.accessKey)
    && containsIdentifier(row.vehicle_plate, filters.plate)
    && contains(row.driver_name, filters.driver)
    && (!filters.series?.trim() || row.cte_series === filters.series.trim())
    && contains(row.company_branch, filters.branch)
    && contains(row.company_group, filters.companyGroup)
    && contains(row.payer_group, filters.payerGroup)
    && triState(row.correction_letter, filters.correctionLetter)
    && matchesDateRange(row.processed_at, filters.processedStart ?? '', filters.processedEnd ?? '')
    && matchesDateRange(row.issued_at, filters.issuedStart ?? '', filters.issuedEnd ?? '');
}

export function matchesCteSearchFilters(row: CteSearchRow, filters: CteSearchFilters): boolean {
  const searchable = [row.cte_number, row.access_key, row.remitter, row.recipient, row.payer_name, row.vehicle_plate, row.driver_name, row.invoice_numbers, row.recipient_city];
  return (!filters.text?.trim() || searchable.some(value => contains(value, filters.text)))
    && (!filters.statuses?.length || filters.statuses.includes(row.sefaz_status))
    && (!filters.cteTypes || filters.cteTypes.some(type => type === row.cte_type))
    && (contains(row.cte_number, filters.docNumber) || contains(row.invoice_numbers, filters.docNumber))
    && containsIdentifier(row.access_key, filters.accessKey)
    && contains(row.remitter, filters.remitter) && contains(row.recipient, filters.recipient)
    && contains(row.recipient_city, filters.recipientCity) && contains(row.payer_name, filters.payer)
    && (!filters.series?.trim() || row.cte_series === filters.series.trim())
    && contains(row.internal_number, filters.internalNumber) && contains(row.reference_number, filters.referenceNumber)
    && contains(row.consignee, filters.consignee) && contains(row.payer_group, filters.payerGroup)
    && contains(row.driver_name, filters.driverName) && containsIdentifier(row.vehicle_plate, filters.vehiclePlate)
    && containsIdentifier(row.trailer_plate, filters.trailerPlate) && contains(row.insurance_company, filters.insuranceCompany)
    && contains(row.contract_number, filters.contractNumber) && contains(row.trip_number, filters.tripNumber)
    && contains(row.invoice_numbers, filters.invoiceNumber) && contains(row.romexp_number, filters.romexpNumber)
    && matchesDateRange(row.issued_at, filters.issueDateStart ?? '', filters.issueDateEnd ?? '')
    && triState(Boolean(row.hub_document_id || row.pdf_url || row.xml_url), filters.downloadable)
    && triState(row.is_voided, filters.voided) && triState(row.is_closed, filters.closed)
    && triState(row.is_compensated, filters.compensated) && triState(row.autonomous_freight, filters.autonomousFreight)
    && triState(row.complementary_doc, filters.complementaryDoc);
}
