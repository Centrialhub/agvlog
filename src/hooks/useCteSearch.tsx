import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export type TriState = 'all' | 'yes' | 'no';
export type CteType = 'normal' | 'complementary' | 'voiding' | 'substitute';

export const CTE_TYPE_LABELS: Record<CteType, string> = {
  normal: 'Normal',
  complementary: 'Complementar',
  voiding: 'Anulação',
  substitute: 'Substituto',
};

export interface CteSearchFilters {
  docNumber?: string;
  internalNumber?: string;
  batchNumber?: string;
  referenceNumber?: string;
  series?: string;
  issueDateStart?: string;
  issueDateEnd?: string;
  remitter?: string;
  recipient?: string;
  consignee?: string;
  payer?: string;
  payerGroup?: string;
  driverName?: string;
  vehiclePlate?: string;
  trailerPlate?: string;
  insuranceCompany?: string;
  contractNumber?: string;
  tripNumber?: string;
  invoiceNumber?: string;
  romexpNumber?: string;
  clientLoadNumber?: string;
  cteTypes?: CteType[];
  voided?: TriState;
  closed?: TriState;
  compensated?: TriState;
  autonomousFreight?: TriState;
  complementaryDoc?: TriState;
}

function nz(v?: string) {
  if (!v) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}
function bool(v?: TriState) {
  if (v === 'yes') return true;
  if (v === 'no') return false;
  return null;
}

export function useCteSearch(filters: CteSearchFilters, opts?: { enabled?: boolean }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['cte_search', currentTenant?.id, filters],
    enabled: !!currentTenant && (opts?.enabled ?? true),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('cte_documents')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('issued_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(2000);

      const f = filters;
      const docNumber = nz(f.docNumber); if (docNumber) q = q.ilike('cte_number', `%${docNumber}%`);
      const internal = nz(f.internalNumber); if (internal) q = q.ilike('internal_number', `%${internal}%`);
      const ref = nz(f.referenceNumber); if (ref) q = q.ilike('reference_number', `%${ref}%`);
      const series = nz(f.series); if (series) q = q.eq('cte_series', series);
      const remitter = nz(f.remitter); if (remitter) q = q.ilike('remitter', `%${remitter}%`);
      const recipient = nz(f.recipient); if (recipient) q = q.ilike('recipient', `%${recipient}%`);
      const consignee = nz(f.consignee); if (consignee) q = q.ilike('consignee', `%${consignee}%`);
      const payer = nz(f.payer); if (payer) q = q.ilike('payer_name', `%${payer}%`);
      const payerGroup = nz(f.payerGroup); if (payerGroup) q = q.ilike('payer_group', `%${payerGroup}%`);
      const driver = nz(f.driverName); if (driver) q = q.ilike('driver_name', `%${driver}%`);
      const plate = nz(f.vehiclePlate); if (plate) q = q.ilike('vehicle_plate', `%${plate.replace(/\W/g, '')}%`);
      const trailer = nz(f.trailerPlate); if (trailer) q = q.ilike('trailer_plate', `%${trailer.replace(/\W/g, '')}%`);
      const ins = nz(f.insuranceCompany); if (ins) q = q.ilike('insurance_company', `%${ins}%`);
      const contract = nz(f.contractNumber); if (contract) q = q.ilike('contract_number', `%${contract}%`);
      const trip = nz(f.tripNumber); if (trip) q = q.ilike('trip_number', `%${trip}%`);
      const invoice = nz(f.invoiceNumber); if (invoice) q = q.ilike('invoice_numbers', `%${invoice}%`);
      const romexp = nz(f.romexpNumber); if (romexp) q = q.ilike('romexp_number', `%${romexp}%`);

      if (f.issueDateStart) q = q.gte('issued_at', f.issueDateStart);
      if (f.issueDateEnd) q = q.lte('issued_at', f.issueDateEnd + 'T23:59:59');

      if (f.cteTypes && f.cteTypes.length > 0) q = q.in('cte_type', f.cteTypes);

      const v = bool(f.voided); if (v !== null) q = q.eq('is_voided', v);
      const c = bool(f.closed); if (c !== null) q = q.eq('is_closed', c);
      const cp = bool(f.compensated); if (cp !== null) q = q.eq('is_compensated', cp);
      const af = bool(f.autonomousFreight); if (af !== null) q = q.eq('autonomous_freight', af);
      const cd = bool(f.complementaryDoc); if (cd !== null) q = q.eq('complementary_doc', cd);

      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}