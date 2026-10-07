import type { CteGroupPreview } from '@/lib/cteGroupingModes';
import type { CteTakerRole, CteDocType } from '@/lib/fiscal/cteBuilder';
import { stateFromNfeAccessKey } from '@/lib/fiscal/cteAddressAutocomplete';

export interface EditableCte {
  key: string;
  emitterId: string;
  remitterName: string;
  remitterCnpj: string;
  remitterIe: string;
  remitterStreet: string;
  remitterNumber: string;
  remitterNeighborhood: string;
  remitterCity: string;
  remitterState: string;
  remitterZip: string;
  remitterCityIbge: string;
  recipientName: string;
  recipientCnpj: string;
  recipientIe: string;
  recipientCity: string;
  recipientState: string;
  recipientStreet: string;
  recipientNumber: string;
  recipientNeighborhood: string;
  recipientZip: string;
  recipientCityIbge: string;
  consigneeClientId: string | null;
  consigneeName: string;
  consigneeCnpj: string;
  expedidorName: string;
  expedidorCnpj: string;
  recebedorName: string;
  recebedorCnpj: string;
  insurerName: string;
  insurerCnpj: string;
  insurerPolicy: string;
  insurerEndorsement: string;
  insurerInsuredAmount: number;
  takerRole: CteTakerRole;
  takerName: string;
  takerCnpj: string;
  driverId: string | null;
  driverName: string;
  driverCpf: string;
  vehicleId: string | null;
  vehiclePlate: string;
  vehicleState: string;
  vehicleRenavam: string;
  vehicleType: string;
  trailerPlate1: string;
  trailerPlate2: string;
  trailerPlate3: string;
  documentType: CteDocType;
  refNumber: string;
  clientOrderNumber: string;
  nature: string;
  cfop: string;
  observations: string;
  freightValue: number;
  freightError: string;
  _freightManual?: boolean;
  cargoValue: number;
  weightKg: number;
  palletCount: number;

  // Composição do frete (opcional)
  fcFreightWeight: number;
  fcDeliveryFee: number;
  fcOthers: number;
  fcInsurance: number;
  fcDispatch: number;
  fcGris: number;
  fcToll: number;
  fcTracking: number;
  fcLoading: number;
  fcHelper: number;
  // ICMS
  icmsCst: string;
  icmsEmbutido: boolean;
  icmsIsento: boolean;
  icmsAliquota: number;
  icmsBase: number;
  icmsValor: number;
  // CBS/IBS
  cbsAliquota: number;
  ibsAliquota: number;
  cbsIbsBase: number;
  _aliqManual?: boolean;
  // Mercadoria
  cargoContent: string;
  cargoSpecies: string;
  cargoPredominant: string;
  clientId: string | null;
  invoices: {
    id: string;
    access_key: string | null;
    number: string | null;
    series: string | null;
    issue_date: string | null;
    value: number | null;
    weight_kg: number | null;
  }[];
  loadIds: string[];
  fiscalDocumentIds: string[];
  transmitted?: 'ok' | 'error' | null;
  transmitMessage?: string;
}

export function groupToEditable(g: CteGroupPreview, defaultEmitterId: string): EditableCte {
  const first = g.documents[0];
  return {
    key: g.key,
    emitterId: defaultEmitterId,
    remitterName: g.remitter || '',
    remitterCnpj: first?.remitter_cnpj || '',
    remitterIe: '',
    remitterStreet: '',
    remitterNumber: '',
    remitterNeighborhood: '',
    remitterCity: '',
    remitterState: stateFromNfeAccessKey(first?.access_key),
    remitterZip: '',
    remitterCityIbge: '',
    recipientName: g.recipient || '',
    recipientCnpj: first?.recipient_cnpj || '',
    recipientIe: '',
    recipientCity: g.recipient_city || '',
    recipientState: g.recipient_state || '',
    recipientStreet: '',
    recipientNumber: '',
    recipientNeighborhood: '',
    recipientZip: '',
    recipientCityIbge: '',

    consigneeClientId: null,
    consigneeName: '',
    consigneeCnpj: '',
    expedidorName: '',
    expedidorCnpj: '',
    recebedorName: '',
    recebedorCnpj: '',
    insurerName: '',
    insurerCnpj: '',
    insurerPolicy: '',
    insurerEndorsement: '',
    insurerInsuredAmount: 0,
    takerRole: 'remetente',
    takerName: g.remitter || '',
    takerCnpj: first?.remitter_cnpj || '',
    driverId: null,
    driverName: '',
    driverCpf: '',
    vehicleId: null,
    vehiclePlate: '',
    vehicleState: '',
    vehicleRenavam: '',
    vehicleType: '01',
    trailerPlate1: '',
    trailerPlate2: '',
    trailerPlate3: '',
    documentType: '01',
    refNumber: '',
    clientOrderNumber: '',
    nature: 'PRESTACAO DE SERVICO DE TRANSPORTE',
    cfop: '',
    observations: '',
    freightValue: g.freight_value,
    freightError: '',
    cargoValue: g.cargo_value,
    weightKg: g.weight_kg,
    palletCount: g.pallet_count,
    fcFreightWeight: 0,
    fcDeliveryFee: 0,
    fcOthers: 0,
    fcInsurance: 0,
    fcDispatch: 0,
    fcGris: 0,
    fcToll: 0,
    fcTracking: 0,
    fcLoading: 0,
    fcHelper: 0,
    icmsEmbutido: true,
    icmsIsento: false,
    icmsAliquota: 0,
    icmsBase: 0,
    icmsValor: 0,
    icmsCst: '00',
    cbsAliquota: 0.9,
    ibsAliquota: 0.1,
    cbsIbsBase: 0,
    cargoContent: 'CONFORME NF',
    cargoSpecies: 'CONFORME NF',
    cargoPredominant: '',
    clientId: g.client_id,
    invoices: g.documents.map((d) => ({
      id: d.id,
      access_key: d.access_key || null,
      number: d.invoice_number || null,
      series: d.invoice_series || null,
      issue_date: d.issue_date || null,
      value: d.value ?? null,
      weight_kg: d.weight_kg ?? null,
    })),
    loadIds: g.load_ids,
    fiscalDocumentIds: g.fiscal_document_ids,
  };
}
