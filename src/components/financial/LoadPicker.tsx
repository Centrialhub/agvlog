import { useMemo, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { useAvailableLoadsForSettlement } from '@/hooks/useDriverSettlements';

const fmtNum = (v: number | null | undefined, d = 0) =>
  (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtMoney = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  driverId?: string | null;
  includeSettlementId?: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** Called whenever the available loads list changes (post-filter). Lets the parent
   *  infer driver from selection or block cross-driver selection. */
  onLoadsChange?: (loads: Array<{ id: string; driver_id: string | null; driver_name: string | null }>) => void;
  /** If set, checkboxes for loads whose driver_id ≠ lockedDriverId are disabled. */
  lockedDriverId?: string | null;
}

export default function LoadPicker({ driverId, includeSettlementId, selectedIds, onChange, onLoadsChange, lockedDriverId }: Props) {
  const [search, setSearch] = useState('');
  const { data: loads = [], isLoading } = useAvailableLoadsForSettlement({
    driver_id: driverId ?? null,
    search,
    include_settlement_id: includeSettlementId ?? null,
  });
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Notify parent when list changes
  useEffect(() => {
    if (onLoadsChange && loads.length > 0) {
      onLoadsChange(loads.map((l: any) => ({ id: l.id, driver_id: l.driver_id ?? null, driver_name: l.driver_name ?? null })));
    }
  }, [loads, onLoadsChange]);
  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  const toggleAll = () => {
    if (loads.every((l) => selectedSet.has(l.id))) onChange(selectedIds.filter((id) => !loads.find((l) => l.id === id)));
    else onChange(Array.from(new Set([...selectedIds, ...loads.map((l) => l.id)])));
  };
  const allSelected = loads.length > 0 && loads.every((l) => selectedSet.has(l.id));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar por número, origem, destino…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {isLoading ? 'Carregando romaneios…' : `${loads.length} romaneio(s) disponível(is) · ${selectedIds.length} selecionado(s)`}
      </div>
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[45vh] min-h-[200px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-8 sticky left-0 bg-background z-20"><Checkbox checked={allSelected} onCheckedChange={toggleAll} /></TableHead>
              <TableHead>Romaneio</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Origem → Destino</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead className="text-right">Notas</TableHead>
              <TableHead className="text-right">Peso</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="text-right">Frete</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {loads.length === 0 && !isLoading && (
              <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">Nenhum romaneio disponível.</TableCell></TableRow>
            )}
            {loads.map((l) => (
              (() => {
                const blocked = !!lockedDriverId && !!l.driver_id && l.driver_id !== lockedDriverId;
                return (
                <TableRow
                  key={l.id}
                  className={`hover:bg-accent/80 transition-colors ${blocked ? 'opacity-50' : 'cursor-pointer'} ${selectedSet.has(l.id) ? 'bg-primary/5 hover:bg-primary/10' : 'bg-background'}`}
                  onClick={() => { if (!blocked) toggle(l.id); }}
                  title={blocked ? 'Romaneio de outro motorista' : undefined}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} className="sticky left-0 bg-inherit z-10 border-r">
                    <Checkbox
                    checked={selectedSet.has(l.id)}
                    disabled={blocked}
                    onCheckedChange={() => { if (!blocked) toggle(l.id); }}
                  />
                </TableCell>
                <TableCell className="font-medium whitespace-nowrap">{l.load_number ?? '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{l.load_date ?? '—'}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={[l.origin, l.destination].filter(Boolean).join(' → ')}>{[l.origin, l.destination].filter(Boolean).join(' → ') || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{l.driver_name ?? '—'}</TableCell>
                <TableCell className="text-right">{l.invoice_count ?? 0}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{fmtNum(l.total_weight_kg, 0)} kg</TableCell>
                <TableCell className="text-right whitespace-nowrap">{fmtMoney(l.gross_cargo_value)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">{fmtMoney(l.freight_amount)}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px] whitespace-nowrap">{l.status ?? '—'}</Badge></TableCell>
                </TableRow>
                );
              })()
            ))}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}