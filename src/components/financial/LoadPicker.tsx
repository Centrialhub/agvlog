import { useMemo, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { DriverSettlementSnapshotChangedError, useAvailableLoadsForSettlement } from '@/hooks/useDriverSettlements';

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
  const [page, setPage] = useState(1);
  const [pagingNotice, setPagingNotice] = useState('');
  useEffect(() => { setPage(1); setPagingNotice(''); }, [driverId, includeSettlementId, search]);
  const { data, isLoading, isFetching, isError, error, refetch } = useAvailableLoadsForSettlement({
    driver_id: driverId ?? null,
    search,
    include_settlement_id: includeSettlementId ?? null,
    page,
    page_size: 100,
  });
  const loads = useMemo(() => data?.rows ?? [], [data?.rows]);
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 100;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectableLoads = useMemo(
    () => loads.filter(load => !lockedDriverId || !load.driver_id || load.driver_id === lockedDriverId),
    [loads, lockedDriverId],
  );
  // Notify parent when list changes
  useEffect(() => {
    if (onLoadsChange && loads.length > 0) {
      onLoadsChange(loads.map(l => ({ id: l.id, driver_id: l.driver_id ?? null, driver_name: l.driver_name ?? null })));
    }
  }, [loads, onLoadsChange]);
  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  };
  const toggleAll = () => {
    if (selectableLoads.every((load) => selectedSet.has(load.id))) onChange(selectedIds.filter((id) => !selectableLoads.some((load) => load.id === id)));
    else onChange(Array.from(new Set([...selectedIds, ...selectableLoads.map((load) => load.id)])));
  };
  const allSelected = selectableLoads.length > 0 && selectableLoads.every((load) => selectedSet.has(load.id));
  useEffect(() => {
    if (page > 1 && error instanceof DriverSettlementSnapshotChangedError) {
      setPagingNotice(error.message);
      setPage(1);
    }
  }, [error, page]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
        <Input className="pl-8" placeholder="Buscar por número, origem, destino…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="text-xs text-muted-foreground">
        {isError ? 'Romaneios indisponíveis.' : isLoading ? 'Carregando romaneios…' : `${total} romaneio(s) disponível(is) · ${selectedIds.length} selecionado(s)`}
      </div>
      {pagingNotice && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{pagingNotice}</p>}
      {isError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>Não foi possível consultar os romaneios elegíveis{error instanceof Error && error.message ? `: ${error.message}` : '.'}</span>
          <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()}>Tentar novamente</Button>
        </div>
      )}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[45vh] min-h-[200px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-30 shadow-sm">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12 sticky left-0 bg-background z-40 border-r text-center">
                  <Checkbox aria-label="Selecionar todos os romaneios disponíveis" checked={allSelected} disabled={selectableLoads.length === 0} onCheckedChange={toggleAll} />
                </TableHead>
                <TableHead className="whitespace-nowrap">Romaneio</TableHead>
                <TableHead className="whitespace-nowrap">Data</TableHead>
                <TableHead className="whitespace-nowrap">Origem → Destino</TableHead>
                <TableHead className="whitespace-nowrap">Motorista</TableHead>
                <TableHead className="text-right whitespace-nowrap">Notas</TableHead>
                <TableHead className="text-right whitespace-nowrap">Peso</TableHead>
                <TableHead className="text-right whitespace-nowrap">Valor</TableHead>
                <TableHead className="text-right whitespace-nowrap">Frete</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            {loads.length === 0 && !isLoading && !isError && (
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
                  <TableCell onClick={(e) => e.stopPropagation()} className="sticky left-0 bg-inherit z-20 border-r text-center">
                    <Checkbox
                      aria-label={`Selecionar romaneio ${l.load_number ?? l.id}`}
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
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Página {page} de {totalPages}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1 || isFetching || isError} onClick={() => setPage(value => Math.max(1, value - 1))}>Anterior</Button>
          <Button type="button" size="sm" variant="outline" disabled={page >= totalPages || isFetching || isError} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>Próxima</Button>
        </div>
      </div>
    </div>
  );
}
