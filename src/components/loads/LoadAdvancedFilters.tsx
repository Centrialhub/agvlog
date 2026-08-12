import { useMemo, useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ChevronDown, Filter, RotateCcw } from 'lucide-react';
import PlateInput from './PlateInput';
import { OPERATION_TYPE_OPTIONS } from '@/lib/operationTypeMapping';

export type TriState = 'all' | 'yes' | 'no';

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
  monitored: TriState;
  manifest: TriState;
  ciot: TriState;
  dedicated: TriState;
  valueMin: string;
  valueMax: string;
  statuses: string[];
  romaneioTypes: string[];
  smManager: string;
  smRelease: string;
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
};

const ROMEXP_TYPES = ['Normal', 'Devolução', 'Transferência', 'Redespacho', 'Subcontratação'];
const ROMANEIO_TYPES = ['Entrega', 'Viagem', 'Retira', 'Transferência', 'Devolução', 'Redespacho'];
const SITUACAO_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'planned', label: 'Planejamento' },
  { key: 'assembling', label: 'Carregamento planejado' },
  { key: 'loading', label: 'Carregamento realizado' },
  { key: 'ready', label: 'Entrega liberada' },
  { key: 'in_transit', label: 'Entrega em andamento' },
  { key: 'delivered', label: 'Finalizado' },
  { key: 'loaded', label: 'Carga fechada' },
  { key: 'divergent', label: 'Divergente' },
];

const countApplied = (v: LoadAdvancedFiltersValue): number => {
  let n = 0;
  if (v.loadNumber) n++;
  if (v.plate) n++;
  if (v.trailerPlate) n++;
  if (v.driverId && v.driverId !== 'all') n++;
  if (v.cargoType) n++;
  if (v.monitorResponsible) n++;
  if (v.driverType) n++;
  if (v.emissionFrom || v.emissionTo) n++;
  if (v.loadingFrom || v.loadingTo) n++;
  if (v.arrivalEstFrom || v.arrivalEstTo) n++;
  if (v.departureFrom || v.departureTo) n++;
  if (v.arrivalFrom || v.arrivalTo) n++;
  if (v.romexpTypes.length) n++;
  if (v.monitored !== 'all') n++;
  if (v.manifest !== 'all') n++;
  if (v.ciot !== 'all') n++;
  if (v.dedicated !== 'all') n++;
  if (v.valueMin || v.valueMax) n++;
  if (v.statuses.length) n++;
  if (v.romaneioTypes.length) n++;
  if (v.smManager) n++;
  if (v.smRelease) n++;
  if (v.remitter) n++;
  if (v.client) n++;
  if (v.city) n++;
  if (v.supplier) n++;
  return n;
};

interface Props {
  value: LoadAdvancedFiltersValue;
  onChange: (next: LoadAdvancedFiltersValue) => void;
  drivers: Array<{ id: string; name: string }>;
  vehicles?: Array<{ plate?: string | null; trailer_plate?: string | null }>;
  trailerPlateSuggestions?: string[];
}

const TriStateGroup = ({ label, value, onChange }: { label: string; value: TriState; onChange: (v: TriState) => void }) => (
  <div className="flex items-center gap-2">
    <Label className="text-xs text-muted-foreground w-32 shrink-0">{label}:</Label>
    <div className="flex rounded-md border border-border overflow-hidden">
      {(['yes', 'no', 'all'] as TriState[]).map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-2.5 py-1 text-[11px] transition-colors ${value === opt ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}
        >
          {opt === 'yes' ? 'Sim' : opt === 'no' ? 'Não' : 'Todos'}
        </button>
      ))}
    </div>
  </div>
);

const DateRange = ({ label, from, to, onFrom, onTo }: { label: string; from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) => (
  <div className="space-y-1">
    <Label className="text-[11px] text-muted-foreground">{label}</Label>
    <div className="flex items-center gap-1.5">
      <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="h-8 text-xs" />
      <span className="text-xs text-muted-foreground">—</span>
      <Input type="date" value={to} onChange={e => onTo(e.target.value)} className="h-8 text-xs" />
    </div>
  </div>
);

const CheckboxList = ({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) => (
  <div className="grid grid-cols-2 gap-1.5">
    {options.map(opt => {
      const checked = value.includes(opt);
      return (
        <label key={opt} className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox
            checked={checked}
            onCheckedChange={c => onChange(c ? [...value, opt] : value.filter(x => x !== opt))}
          />
          {opt}
        </label>
      );
    })}
  </div>
);

export default function LoadAdvancedFilters({ value, onChange, drivers, vehicles = [], trailerPlateSuggestions = [] }: Props) {
  const [open, setOpen] = useState(false);
  const applied = useMemo(() => countApplied(value), [value]);
  const set = <K extends keyof LoadAdvancedFiltersValue>(k: K, v: LoadAdvancedFiltersValue[K]) =>
    onChange({ ...value, [k]: v });
  const plateOptions = useMemo(
    () => Array.from(new Set(vehicles.map(v => v.plate || '').filter(Boolean))),
    [vehicles],
  );
  const trailerOptions = useMemo(
    () => Array.from(new Set([
      ...vehicles.map(v => v.trailer_plate || '').filter(Boolean),
      ...trailerPlateSuggestions,
    ])),
    [vehicles, trailerPlateSuggestions],
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <CollapsibleTrigger asChild>
          <button type="button" className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Filter className="h-4 w-4" />
            Filtros avançados (Romaneio)
            {applied > 0 && <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{applied}</Badge>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        {applied > 0 && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onChange(EMPTY_LOAD_ADVANCED_FILTERS)}>
            <RotateCcw className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      <CollapsibleContent className="px-3 pb-3 pt-1 border-t border-border space-y-4">
        {/* Identificação */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Remetente</Label>
            <Input value={value.remitter} onChange={e => set('remitter', e.target.value)} className="h-8 text-xs" placeholder="Nome do remetente" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Cliente</Label>
            <Input value={value.client} onChange={e => set('client', e.target.value)} className="h-8 text-xs" placeholder="Nome do cliente" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Município</Label>
            <Input value={value.city} onChange={e => set('city', e.target.value)} className="h-8 text-xs" placeholder="Cidade de destino" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Fornecedor</Label>
            <Input value={value.supplier} onChange={e => set('supplier', e.target.value)} className="h-8 text-xs" placeholder="Nome do fornecedor" />
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Romaneio de Expedição</Label>
            <Input value={value.loadNumber} onChange={e => set('loadNumber', e.target.value)} className="h-8 text-xs" placeholder="Nº do romaneio" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Placa</Label>
            <PlateInput value={value.plate} onChange={v => set('plate', v)} placeholder="Placa cavalo" suggestions={plateOptions} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Placa Carreta</Label>
            <PlateInput value={value.trailerPlate} onChange={v => set('trailerPlate', v)} placeholder="Placa carreta" suggestions={trailerOptions} />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Motorista</Label>
            <Select value={value.driverId} onValueChange={v => set('driverId', v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Tipo de Carga</Label>
            <Select value={value.cargoType || 'all'} onValueChange={v => set('cargoType', v === 'all' ? '' : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {OPERATION_TYPE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Resp. Monitoramento</Label>
            <Input value={value.monitorResponsible} onChange={e => set('monitorResponsible', e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Tipo de Motorista</Label>
            <Input value={value.driverType} onChange={e => set('driverType', e.target.value)} className="h-8 text-xs" placeholder="Agregado, Frota, Autônomo..." />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Valor Mercadoria (R$)</Label>
            <div className="flex items-center gap-1.5">
              <Input type="number" value={value.valueMin} onChange={e => set('valueMin', e.target.value)} className="h-8 text-xs" placeholder="mín." />
              <span className="text-xs text-muted-foreground">—</span>
              <Input type="number" value={value.valueMax} onChange={e => set('valueMax', e.target.value)} className="h-8 text-xs" placeholder="máx." />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Gerenciadora SM</Label>
            <Input value={value.smManager} onChange={e => set('smManager', e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Nº Liberação SM</Label>
            <Input value={value.smRelease} onChange={e => set('smRelease', e.target.value)} className="h-8 text-xs" />
          </div>
        </div>

        {/* Datas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DateRange label="Data Emissão" from={value.emissionFrom} to={value.emissionTo} onFrom={v => set('emissionFrom', v)} onTo={v => set('emissionTo', v)} />
          <DateRange label="Data Real Carregamento" from={value.loadingFrom} to={value.loadingTo} onFrom={v => set('loadingFrom', v)} onTo={v => set('loadingTo', v)} />
          <DateRange label="Data Previsão Chegada" from={value.arrivalEstFrom} to={value.arrivalEstTo} onFrom={v => set('arrivalEstFrom', v)} onTo={v => set('arrivalEstTo', v)} />
          <DateRange label="Data Saída (Portaria)" from={value.departureFrom} to={value.departureTo} onFrom={v => set('departureFrom', v)} onTo={v => set('departureTo', v)} />
          <DateRange label="Data Chegada" from={value.arrivalFrom} to={value.arrivalTo} onFrom={v => set('arrivalFrom', v)} onTo={v => set('arrivalTo', v)} />
        </div>

        {/* Estados Sim/Não */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <TriStateGroup label="Monitorado" value={value.monitored} onChange={v => set('monitored', v)} />
          <TriStateGroup label="Manifesto" value={value.manifest} onChange={v => set('manifest', v)} />
          <TriStateGroup label="CIOT" value={value.ciot} onChange={v => set('ciot', v)} />
          <TriStateGroup label="Carro Dedicado" value={value.dedicated} onChange={v => set('dedicated', v)} />
        </div>

        {/* Tipos / Situação */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">Tipo Romexp</Label>
            <CheckboxList options={ROMEXP_TYPES} value={value.romexpTypes} onChange={v => set('romexpTypes', v)} />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">Tipo Romaneio</Label>
            <CheckboxList options={ROMANEIO_TYPES} value={value.romaneioTypes} onChange={v => set('romaneioTypes', v)} />
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground mb-1.5 block">Situação Romaneio Expedição</Label>
            <div className="grid grid-cols-1 gap-1.5">
              {SITUACAO_OPTIONS.map(opt => {
                const checked = value.statuses.includes(opt.key);
                return (
                  <label key={opt.key} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={c => set('statuses', c ? [...value.statuses, opt.key] : value.statuses.filter(x => x !== opt.key))}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
