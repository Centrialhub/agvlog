import { LOAD_STATUS_LABELS } from '@/hooks/useLoads';
import { OPERATION_TYPE_LABELS, isValidOperationType } from '@/lib/operationTypeMapping';

export type LoadFilterTriState = 'all' | 'yes' | 'no';
export type LoadDatePreset = 'all' | 'today' | '7' | '14' | '30' | 'custom';

export interface LoadAdvancedFiltersValue {
  loadNumber: string;
  plate: string;
  trailerPlate: string;
  driverId: string;
  cargoType: string;
  monitorResponsible: string;
  driverType: string;
  emissionFrom: string;
  emissionTo: string;
  loadingFrom: string;
  loadingTo: string;
  arrivalEstFrom: string;
  arrivalEstTo: string;
  departureFrom: string;
  departureTo: string;
  arrivalFrom: string;
  arrivalTo: string;
  romexpTypes: string[];
  monitored: LoadFilterTriState;
  manifest: LoadFilterTriState;
  ciot: LoadFilterTriState;
  dedicated: LoadFilterTriState;
  valueMin: string;
  valueMax: string;
  statuses: string[];
  romaneioTypes: string[];
  smManager: string;
  smRelease: string;
  remitter: string;
  client: string;
  city: string;
  supplier: string;
}

export const EMPTY_LOAD_ADVANCED_FILTERS: LoadAdvancedFiltersValue = {
  loadNumber: '', plate: '', trailerPlate: '', driverId: 'all',
  cargoType: '', monitorResponsible: '', driverType: '',
  emissionFrom: '', emissionTo: '', loadingFrom: '', loadingTo: '',
  arrivalEstFrom: '', arrivalEstTo: '', departureFrom: '', departureTo: '',
  arrivalFrom: '', arrivalTo: '',
  romexpTypes: [], monitored: 'all', manifest: 'all', ciot: 'all', dedicated: 'all',
  valueMin: '', valueMax: '', statuses: [], romaneioTypes: [],
  smManager: '', smRelease: '',
  remitter: '', client: '', city: '', supplier: '',
};

type ChipKind = 'exact' | 'approx';

export interface AppliedLoadFilterChip {
  key: string;
  label: string;
  value: string;
  kind: ChipKind;
  hint?: string;
  clear: () => void;
}

interface BuildAppliedLoadFilterChipsArgs {
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  datePreset: LoadDatePreset;
  setDatePreset: (value: LoadDatePreset) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (value: string) => void;
  setCustomEnd: (value: string) => void;
  adv: LoadAdvancedFiltersValue;
  setAdv: (value: LoadAdvancedFiltersValue) => void;
  drivers: Array<{ id: string; name: string }>;
}

const APPROX_KEYS = new Set<keyof LoadAdvancedFiltersValue>(['romexpTypes', 'romaneioTypes']);
const loadStatusLabels: Readonly<Record<string, string>> = LOAD_STATUS_LABELS;
const formatRange = (from: string, to: string) =>
  from && to ? `${from} → ${to}` : from ? `≥ ${from}` : `≤ ${to}`;

export function buildAppliedLoadFilterChips(
  args: BuildAppliedLoadFilterChipsArgs,
): AppliedLoadFilterChip[] {
  const { adv, setAdv, drivers } = args;
  const chips: AppliedLoadFilterChip[] = [];
  const setFilter = <K extends keyof LoadAdvancedFiltersValue>(
    key: K,
    value: LoadAdvancedFiltersValue[K],
  ) => setAdv({ ...adv, [key]: value });
  const kindOf = (key: keyof LoadAdvancedFiltersValue): ChipKind =>
    APPROX_KEYS.has(key) ? 'approx' : 'exact';

  if (args.search) {
    chips.push({ key: 'search', label: 'Busca', value: args.search, kind: 'exact', clear: () => args.setSearch('') });
  }
  if (args.statusFilter && args.statusFilter !== 'all') {
    chips.push({
      key: 'statusFilter',
      label: 'Status',
      value: loadStatusLabels[args.statusFilter] || args.statusFilter,
      kind: 'exact',
      clear: () => args.setStatusFilter('all'),
    });
  }
  if (args.datePreset && args.datePreset !== 'all') {
    const value = args.datePreset === 'custom'
      ? `${args.customStart || '...'} → ${args.customEnd || '...'}`
      : args.datePreset === 'today'
        ? 'Hoje'
        : `Últimos ${args.datePreset} dias`;
    chips.push({
      key: 'datePreset',
      label: 'Período',
      value,
      kind: 'exact',
      clear: () => {
        args.setDatePreset('all');
        args.setCustomStart('');
        args.setCustomEnd('');
      },
    });
  }

  type TextFilterKey =
    | 'loadNumber' | 'plate' | 'trailerPlate' | 'monitorResponsible'
    | 'driverType' | 'smManager' | 'smRelease';
  const textFields: Array<[TextFilterKey, string]> = [
    ['loadNumber', 'Romaneio'],
    ['plate', 'Placa'],
    ['trailerPlate', 'Placa Carreta'],
    ['monitorResponsible', 'Resp. Monit.'],
    ['driverType', 'Tipo Motorista'],
    ['smManager', 'Gerenciadora SM'],
    ['smRelease', 'Liberação SM'],
  ];
  textFields.forEach(([key, label]) => {
    const value = adv[key];
    if (value.trim()) {
      chips.push({ key, label, value, kind: kindOf(key), clear: () => setFilter(key, '') });
    }
  });

  if (adv.cargoType) {
    chips.push({
      key: 'cargoType',
      label: 'Tipo de Carga',
      value: isValidOperationType(adv.cargoType) ? OPERATION_TYPE_LABELS[adv.cargoType] : adv.cargoType,
      kind: 'exact',
      clear: () => setFilter('cargoType', ''),
    });
  }
  if (adv.driverId && adv.driverId !== 'all') {
    const driver = drivers.find(({ id }) => id === adv.driverId);
    chips.push({
      key: 'driverId',
      label: 'Motorista',
      value: driver?.name || adv.driverId,
      kind: 'exact',
      clear: () => setFilter('driverId', 'all'),
    });
  }

  type TriStateFilterKey = 'monitored' | 'manifest' | 'ciot' | 'dedicated';
  const triStateFields: Array<[TriStateFilterKey, string]> = [
    ['monitored', 'Monitorado'],
    ['manifest', 'Manifesto'],
    ['ciot', 'CIOT'],
    ['dedicated', 'Carro Dedicado'],
  ];
  triStateFields.forEach(([key, label]) => {
    const value = adv[key];
    if (value !== 'all') {
      chips.push({
        key,
        label,
        value: value === 'yes' ? 'Sim' : 'Não',
        kind: 'exact',
        clear: () => setFilter(key, 'all'),
      });
    }
  });

  if (adv.valueMin || adv.valueMax) {
    chips.push({
      key: 'value',
      label: 'Valor Mercadoria',
      value: formatRange(adv.valueMin, adv.valueMax),
      kind: 'exact',
      clear: () => setAdv({ ...adv, valueMin: '', valueMax: '' }),
    });
  }

  type DateFilterKey =
    | 'emissionFrom' | 'emissionTo' | 'loadingFrom' | 'loadingTo'
    | 'arrivalEstFrom' | 'arrivalEstTo' | 'departureFrom' | 'departureTo'
    | 'arrivalFrom' | 'arrivalTo';
  const dateRanges: Array<[DateFilterKey, DateFilterKey, string]> = [
    ['emissionFrom', 'emissionTo', 'Emissão'],
    ['loadingFrom', 'loadingTo', 'Carregamento'],
    ['arrivalEstFrom', 'arrivalEstTo', 'Previsão Chegada'],
    ['departureFrom', 'departureTo', 'Saída Portaria'],
    ['arrivalFrom', 'arrivalTo', 'Chegada'],
  ];
  dateRanges.forEach(([fromKey, toKey, label]) => {
    const from = adv[fromKey];
    const to = adv[toKey];
    if (from || to) {
      chips.push({
        key: `${fromKey}-${toKey}`,
        label,
        value: formatRange(from, to),
        kind: 'exact',
        clear: () => setAdv({ ...adv, [fromKey]: '', [toKey]: '' }),
      });
    }
  });

  if (adv.statuses.length) {
    chips.push({
      key: 'statuses',
      label: 'Situações',
      value: adv.statuses.map((status) => loadStatusLabels[status] || status).join(', '),
      kind: 'exact',
      clear: () => setFilter('statuses', []),
    });
  }
  if (adv.romexpTypes.length) {
    chips.push({
      key: 'romexp', label: 'Tipo Romexp', value: adv.romexpTypes.join(', '), kind: 'approx',
      clear: () => setFilter('romexpTypes', []),
    });
  }
  if (adv.romaneioTypes.length) {
    chips.push({
      key: 'romaneio', label: 'Tipo Romaneio', value: adv.romaneioTypes.join(', '), kind: 'approx',
      clear: () => setFilter('romaneioTypes', []),
    });
  }

  return chips;
}
