export interface MdfeDefaultEmitter {
  id: string;
  is_default: boolean;
  active: boolean;
  city_code?: string | null;
  endereco?: {
    municipio?: string | null;
  } | null;
}

export interface MdfeDefaultVehicle {
  id: string;
  renavam?: string | null;
}

export interface MdfeDefaultDocument {
  cargo_value?: number | null;
  cargo_weight?: number | null;
  recipient_city?: string | null;
  recipient_city_ibge?: string | null;
  recipient_state?: string | null;
  vehicle_id?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_cpf?: string | null;
}

export interface MdfeDialogDefaults {
  emitterId: string;
  vehicleId: string;
  vehicleRenavam: string;
  driverName: string;
  driverCpf: string;
  originCity: string;
  originIbge: string;
  originUf: string;
  destinationCity: string;
  destinationIbge: string;
  destinationUf: string;
  totalCargoValue: string;
  totalCargoWeight: string;
}

const digits = (value: unknown): string => String(value ?? '').replace(/\D/g, '');

function commonValue<T>(items: T[], read: (item: T) => string | null | undefined): string {
  if (items.length === 0) return '';
  const values = new Set(items.map(read).map(value => String(value ?? '').trim()).filter(Boolean));
  return values.size === 1 ? [...values][0] : '';
}

export function stateCodeFromCityIbge(value?: string | null): string {
  const cityCode = digits(value);
  return cityCode.length === 7 ? cityCode.slice(0, 2) : '';
}

export function deriveMdfeDialogDefaults(
  documents: MdfeDefaultDocument[],
  emitters: MdfeDefaultEmitter[],
  vehicles: MdfeDefaultVehicle[],
): MdfeDialogDefaults {
  const emitter = emitters.find(item => item.active && item.is_default)
    || emitters.find(item => item.active)
    || null;
  const firstDocument = documents[0];
  const vehicleId = commonValue(documents, document => document.vehicle_id);
  const vehicle = vehicles.find(item => item.id === vehicleId);
  const driverId = commonValue(documents, document => document.driver_id);
  const driverName = driverId ? commonValue(documents, document => document.driver_name) : '';
  const driverCpf = driverId ? commonValue(documents, document => document.driver_cpf) : '';
  const originIbge = digits(emitter?.city_code);
  const destinationIbge = digits(firstDocument?.recipient_city_ibge);

  return {
    emitterId: emitter?.id || '',
    vehicleId,
    vehicleRenavam: vehicle?.renavam || '',
    driverName,
    driverCpf: digits(driverCpf),
    originCity: emitter?.endereco?.municipio || '',
    originIbge,
    originUf: stateCodeFromCityIbge(originIbge),
    destinationCity: firstDocument?.recipient_city || '',
    destinationIbge,
    destinationUf: stateCodeFromCityIbge(destinationIbge),
    totalCargoValue: documents.reduce((total, document) => total + Number(document.cargo_value || 0), 0).toFixed(2),
    totalCargoWeight: documents.reduce((total, document) => total + Number(document.cargo_weight || 0), 0).toFixed(3),
  };
}
