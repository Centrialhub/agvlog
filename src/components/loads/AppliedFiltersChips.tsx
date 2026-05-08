import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { X, Info, RotateCcw } from 'lucide-react';
import { LOAD_STATUS_LABELS } from '@/hooks/useLoads';
import { OPERATION_TYPE_LABELS, isValidOperationType } from '@/lib/operationTypeMapping';
import {
  EMPTY_LOAD_ADVANCED_FILTERS,
  LoadAdvancedFiltersValue,
} from './LoadAdvancedFilters';

type ChipKind = 'exact' | 'approx';

export interface AppliedChip {
  key: string;
  label: string;
  value: string;
  kind: ChipKind;
  hint?: string;
  clear: () => void;
}

const KIND_HINTS: Record<ChipKind, string> = {
  exact: 'Filtra diretamente em uma coluna do banco.',
  approx: 'Filtro aproximado: compara texto contra "Tipo de operação" (não há coluna dedicada).',
};

const APPROX_KEYS = new Set(['romexpTypes', 'romaneioTypes']);

const fmtRange = (from: string, to: string) =>
  from && to ? `${from} → ${to}` : from ? `≥ ${from}` : `≤ ${to}`;

interface BuildArgs {
  search: string;
  setSearch: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  datePreset: string;
  setDatePreset: (v: any) => void;
  customStart: string;
  customEnd: string;
  setCustomStart: (v: string) => void;
  setCustomEnd: (v: string) => void;
  adv: LoadAdvancedFiltersValue;
  setAdv: (v: LoadAdvancedFiltersValue) => void;
  drivers: Array<{ id: string; name: string }>;
}

export function buildAppliedChips(args: BuildArgs): AppliedChip[] {
  const { adv, setAdv, drivers } = args;
  const chips: AppliedChip[] = [];
  const setF = <K extends keyof LoadAdvancedFiltersValue>(k: K, v: LoadAdvancedFiltersValue[K]) =>
    setAdv({ ...adv, [k]: v });
  const kindOf = (k: string): ChipKind => (APPROX_KEYS.has(k) ? 'approx' : 'exact');

  if (args.search) {
    chips.push({ key: 'search', label: 'Busca', value: args.search, kind: 'exact', clear: () => args.setSearch('') });
  }
  if (args.statusFilter && args.statusFilter !== 'all') {
    chips.push({
      key: 'statusFilter',
      label: 'Status',
      value: LOAD_STATUS_LABELS[args.statusFilter] || args.statusFilter,
      kind: 'exact',
      clear: () => args.setStatusFilter('all'),
    });
  }
  if (args.datePreset && args.datePreset !== 'all') {
    const v =
      args.datePreset === 'custom'
        ? `${args.customStart || '...'} → ${args.customEnd || '...'}`
        : args.datePreset === 'today'
          ? 'Hoje'
          : `Últimos ${args.datePreset} dias`;
    chips.push({
      key: 'datePreset',
      label: 'Período',
      value: v,
      kind: 'exact',
      clear: () => {
        args.setDatePreset('all');
        args.setCustomStart('');
        args.setCustomEnd('');
      },
    });
  }

  // Texto / numéricos
  const textFields: Array<[keyof LoadAdvancedFiltersValue, string]> = [
    ['loadNumber', 'Romaneio'],
    ['plate', 'Placa'],
    ['trailerPlate', 'Placa Carreta'],
    ['monitorResponsible', 'Resp. Monit.'],
    ['driverType', 'Tipo Motorista'],
    ['smManager', 'Gerenciadora SM'],
    ['smRelease', 'Liberação SM'],
  ];
  textFields.forEach(([k, label]) => {
    const v = adv[k] as string;
    if (v && String(v).trim()) {
      chips.push({ key: k as string, label, value: String(v), kind: kindOf(k as string), clear: () => setF(k, '' as any) });
    }
  });

  if (adv.cargoType) {
    chips.push({
      key: 'cargoType',
      label: 'Tipo de Carga',
      value: isValidOperationType(adv.cargoType) ? OPERATION_TYPE_LABELS[adv.cargoType] : adv.cargoType,
      kind: 'exact',
      clear: () => setF('cargoType', ''),
    });
  }

  if (adv.driverId && adv.driverId !== 'all') {
    const d = drivers.find(x => x.id === adv.driverId);
    chips.push({ key: 'driverId', label: 'Motorista', value: d?.name || adv.driverId, kind: 'exact', clear: () => setF('driverId', 'all') });
  }

  // Tri-states
  const tri: Array<[keyof LoadAdvancedFiltersValue, string]> = [
    ['monitored', 'Monitorado'],
    ['manifest', 'Manifesto'],
    ['ciot', 'CIOT'],
    ['dedicated', 'Carro Dedicado'],
  ];
  tri.forEach(([k, label]) => {
    const v = adv[k] as string;
    if (v && v !== 'all') {
      chips.push({ key: k as string, label, value: v === 'yes' ? 'Sim' : 'Não', kind: 'exact', clear: () => setF(k, 'all' as any) });
    }
  });

  // Valor
  if (adv.valueMin || adv.valueMax) {
    chips.push({
      key: 'value',
      label: 'Valor Mercadoria',
      value: fmtRange(adv.valueMin, adv.valueMax),
      kind: 'exact',
      clear: () => setAdv({ ...adv, valueMin: '', valueMax: '' }),
    });
  }

  // Datas
  const dateRanges: Array<[keyof LoadAdvancedFiltersValue, keyof LoadAdvancedFiltersValue, string]> = [
    ['emissionFrom', 'emissionTo', 'Emissão'],
    ['loadingFrom', 'loadingTo', 'Carregamento'],
    ['arrivalEstFrom', 'arrivalEstTo', 'Previsão Chegada'],
    ['departureFrom', 'departureTo', 'Saída Portaria'],
    ['arrivalFrom', 'arrivalTo', 'Chegada'],
  ];
  dateRanges.forEach(([fromK, toK, label]) => {
    const from = adv[fromK] as string;
    const to = adv[toK] as string;
    if (from || to) {
      chips.push({
        key: `${String(fromK)}-${String(toK)}`,
        label,
        value: fmtRange(from, to),
        kind: 'exact',
        clear: () => setAdv({ ...adv, [fromK]: '', [toK]: '' } as LoadAdvancedFiltersValue),
      });
    }
  });

  // Listas
  if (adv.statuses.length) {
    chips.push({
      key: 'statuses',
      label: 'Situações',
      value: adv.statuses.map(s => LOAD_STATUS_LABELS[s] || s).join(', '),
      kind: 'exact',
      clear: () => setF('statuses', []),
    });
  }
  if (adv.romexpTypes.length) {
    chips.push({ key: 'romexp', label: 'Tipo Romexp', value: adv.romexpTypes.join(', '), kind: 'approx', clear: () => setF('romexpTypes', []) });
  }
  if (adv.romaneioTypes.length) {
    chips.push({ key: 'romaneio', label: 'Tipo Romaneio', value: adv.romaneioTypes.join(', '), kind: 'approx', clear: () => setF('romaneioTypes', []) });
  }

  return chips;
}

interface Props {
  chips: AppliedChip[];
  onClearAll: () => void;
}

export default function AppliedFiltersChips({ chips, onClearAll }: Props) {
  if (!chips.length) return null;
  return (
    <div className="flex items-start gap-2 flex-wrap rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[11px] font-medium text-muted-foreground mt-1.5 mr-1 shrink-0">Filtros aplicados:</div>
      <div className="flex flex-wrap gap-1.5 flex-1">
        {chips.map(c => (
          <Tooltip key={c.key}>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className={`gap-1 pr-1 pl-2 py-0.5 text-[11px] font-normal cursor-default ${
                  c.kind === 'approx'
                    ? 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/20'
                    : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'
                }`}
              >
                <span className="font-medium">{c.label}:</span>
                <span className="truncate max-w-[180px]">{c.value}</span>
                {c.kind === 'approx' && <Info className="h-3 w-3 opacity-70" />}
                <button
                  type="button"
                  onClick={c.clear}
                  className="ml-0.5 rounded-sm hover:bg-foreground/10 p-0.5"
                  aria-label={`Remover filtro ${c.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <div className="font-medium mb-0.5">
                {c.kind === 'approx' ? 'Filtro aproximado' : 'Filtro exato'}
              </div>
              <div className="text-muted-foreground">{c.hint || KIND_HINTS[c.kind]}</div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={onClearAll}>
        <RotateCcw className="h-3 w-3 mr-1" /> Limpar tudo
      </Button>
    </div>
  );
}

export { EMPTY_LOAD_ADVANCED_FILTERS };