import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RefreshCw, Wallet, Search, AlertTriangle, Plus } from 'lucide-react';
import { format } from 'date-fns';
import {
  useDriverSettlements, useGeneratePendingDriverSettlements,
  useDriverSettlementFilterOptions,
  SETTLEMENT_STATUS_LABEL, DriverSettlementStatus,
  DriverSettlementSnapshotChangedError,
  useDriverSettlementCollectionEpoch,
} from '@/hooks/useDriverSettlements';
import DriverSettlementDrawer from '@/components/financial/DriverSettlementDrawer';
import NewManualSettlementDialog from '@/components/financial/NewManualSettlementDialog';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import type { DriverSettlementCursor } from '@/lib/financial/settlementListResponse';

const fmtMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, d = 1) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DriverSettlements() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  if (!user || !currentTenant) return <p role="status">Selecione uma conta e um tenant para consultar acertos.</p>;
  return <SettlementList key={`${user.id}:${currentTenant.id}`} />;
}

function SettlementList() {
  const genPending = useGeneratePendingDriverSettlements();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DriverSettlementStatus>('all');
  const [driverFilter, setDriverFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [driverOptionSearch,setDriverOptionSearch]=useState('');
  const [vehicleOptionSearch,setVehicleOptionSearch]=useState('');
  const [driverOptionPage,setDriverOptionPage]=useState(1);
  const [vehicleOptionPage,setVehicleOptionPage]=useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyKmPending, setOnlyKmPending] = useState(false);
  const [onlyExpPending, setOnlyExpPending] = useState(false);
  const [onlyNoFreight, setOnlyNoFreight] = useState(false);
  const [onlyNeedsRecalc, setOnlyNeedsRecalc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [snapshotAt, setSnapshotAt] = useState<string | undefined>();
  const [pageCursors, setPageCursors] = useState<Record<number, NonNullable<DriverSettlementCursor> | null>>({ 1: null });
  const [snapshotNotice, setSnapshotNotice] = useState('');
  const collectionEpoch = useDriverSettlementCollectionEpoch();
  const collectionEpochRef = useRef(collectionEpoch);
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const resetPaging = () => {
    setPage(1);
    setSnapshotAt(undefined);
    setPageCursors({ 1: null });
    setSnapshotNotice('');
  };

  const { data: response, isLoading, isError, isFetching, error: listError, refetch: refetchSettlements } = useDriverSettlements({
    search,
    driver_id: driverFilter === 'all' ? null : driverFilter,
    vehicle_id: vehicleFilter === 'all' ? null : vehicleFilter,
    status: status === 'all' ? null : status,
    date_from: dateFrom || null,
    date_to: dateTo || null,
    only_km_pending: onlyKmPending,
    only_expense_pending: onlyExpPending,
    only_no_freight: onlyNoFreight,
    only_needs_recalculation: onlyNeedsRecalc,
    page,
    page_size: pageSize,
    snapshot_at: snapshotAt,
    cursor: pageCursors[page] ?? null,
    enabled: !invalidDateRange,
  });
  useEffect(()=>{if(collectionEpochRef.current!==collectionEpoch){collectionEpochRef.current=collectionEpoch;resetPaging();}},[collectionEpoch]);
  useEffect(()=>{if(listError instanceof DriverSettlementSnapshotChangedError){setSnapshotNotice(listError.message);setPage(1);setSnapshotAt(undefined);setPageCursors({1:null});}},[listError]);
  const data = isError || invalidDateRange ? undefined : response;
  const list = data?.items ?? [];
  const totalCount = data?.total_count ?? 0;
  const summary = data?.summary ?? null;
  const driverOptions = useDriverSettlementFilterOptions('drivers',driverOptionSearch,driverOptionPage);
  const vehicleOptions = useDriverSettlementFilterOptions('vehicles',vehicleOptionSearch,vehicleOptionPage);
  useEffect(() => {
    if (driverOptions.error instanceof DriverSettlementSnapshotChangedError && driverOptionPage > 1) setDriverOptionPage(1);
  }, [driverOptionPage, driverOptions.error]);
  useEffect(() => {
    if (vehicleOptions.error instanceof DriverSettlementSnapshotChangedError && vehicleOptionPage > 1) setVehicleOptionPage(1);
  }, [vehicleOptionPage, vehicleOptions.error]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const drivers = driverOptions.isError?[]:driverOptions.data?.rows??[];
  const vehicles = vehicleOptions.isError?[]:vehicleOptions.data?.rows??[];

  const filtered = list;

  const kpi = {
    pending: Number(summary?.pending_count ?? 0),
    inReview: Number(summary?.in_review_count ?? 0),
    needsRecalc: Number(summary?.needs_recalculation_count ?? 0),
    kmPending: Number(summary?.km_pending_count ?? 0),
    expPending: Number(summary?.expense_pending_count ?? 0),
    totalPayable: Number(summary?.total_payable ?? 0),
    totalPaid: Number(summary?.total_paid ?? 0),
    totalRouteResult: Number(summary?.route_result_total ?? 0),
  };

  const openSettlement = (id: string) => { setSelectedId(id); setDrawerOpen(true); };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Acerto de Motoristas</h1>
          <p className="text-sm text-muted-foreground">Conferência financeira das viagens finalizadas</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button className="min-h-11 w-full sm:w-auto" variant="outline" disabled={isFetching || driverOptions.isFetching||vehicleOptions.isFetching} onClick={() => { const needsExplicitRefetch = page === 1 && snapshotAt === undefined; resetPaging(); if (needsExplicitRefetch) void refetchSettlements(); if (driverOptionPage === 1) void driverOptions.refetch(); else setDriverOptionPage(1); if (vehicleOptionPage === 1) void vehicleOptions.refetch(); else setVehicleOptionPage(1); }}><RefreshCw aria-hidden="true" className="h-4 w-4 mr-1" /> Atualizar</Button>
          <Button className="min-h-11 w-full sm:w-auto" variant="outline" disabled={!data} onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo acerto manual
          </Button>
          <Button className="min-h-11 w-full sm:w-auto" onClick={() => genPending.mutate()} disabled={!data || genPending.isPending}>
            Gerar / Recalcular pendentes
          </Button>
        </div>
      </div>

      {isError && <p role="alert">Não foi possível consultar os acertos. Os dados anteriores foram ocultados. Tente atualizar.</p>}
      {snapshotNotice && <p role="status">{snapshotNotice}</p>}
      {invalidDateRange && <p role="alert">A data inicial não pode ser posterior à data final. Corrija o intervalo para consultar os acertos.</p>}
      {(driverOptions.isError||vehicleOptions.isError) && <p role="alert">Não foi possível consultar os filtros de motorista e veículo. Tente atualizar.</p>}
      {genPending.data?.errors.length ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-medium">O processamento terminou com {genPending.data.errors.length} falha(s). As viagens abaixo continuam pendentes:</p>
        <ul className="mt-2 list-disc pl-5">{genPending.data.errors.map((error, index) => <li key={index}>{String(error)}</li>)}</ul>
      </div> : null}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Pendentes', value: kpi.pending },
          { label: 'Em conferência', value: kpi.inReview },
          { label: 'Desatualizados', value: kpi.needsRecalc },
          { label: 'KM pendente', value: kpi.kmPending },
          { label: 'Despesas pendentes', value: kpi.expPending },
          { label: 'A pagar motoristas', value: fmtMoney(kpi.totalPayable) },
          { label: 'Pago', value: fmtMoney(kpi.totalPaid) },
          { label: 'Resultado das rotas', value: fmtMoney(kpi.totalRouteResult) },
        ].map((k) => (
          <Card key={k.label}><CardHeader className="pb-2"><p className="text-xs font-medium text-muted-foreground">{k.label}</p></CardHeader>
            <CardContent className="text-lg font-semibold">{data ? k.value : '—'}</CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input aria-label="Pesquisar acertos" className="pl-8" placeholder="Motorista, placa, rota, romaneio, nota…" value={search} onChange={(e) => { resetPaging(); setSearch(e.target.value); }} />
            </div>
            <Select value={status} onValueChange={value => { resetPaging(); setStatus(value as 'all' | DriverSettlementStatus); }}>
              <SelectTrigger aria-label="Status do acerto"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                {(Object.keys(SETTLEMENT_STATUS_LABEL) as DriverSettlementStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{SETTLEMENT_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1"><Input aria-label="Buscar motorista do filtro" placeholder="Buscar motorista" value={driverOptionSearch} onChange={e=>{setDriverOptionSearch(e.target.value);setDriverOptionPage(1);}}/><Select value={driverFilter} onValueChange={(v) => { resetPaging(); setDriverFilter(v); }}><SelectTrigger aria-label="Motorista" disabled={!driverOptions.data}><SelectValue placeholder="Motorista" /></SelectTrigger><SelectContent><SelectItem value="all">Todos motoristas</SelectItem>{drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>)}</SelectContent></Select><div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={driverOptionPage===1} onClick={()=>setDriverOptionPage(p=>p-1)}>Anteriores</Button><Button type="button" size="sm" variant="outline" disabled={!driverOptions.data||driverOptionPage*50>=driverOptions.data.total} onClick={()=>setDriverOptionPage(p=>p+1)}>Mais</Button></div></div>
            <div className="space-y-1"><Input aria-label="Buscar veículo do filtro" placeholder="Buscar placa" value={vehicleOptionSearch} onChange={e=>{setVehicleOptionSearch(e.target.value);setVehicleOptionPage(1);}}/><Select value={vehicleFilter} onValueChange={(v) => { resetPaging(); setVehicleFilter(v); }}><SelectTrigger aria-label="Veículo" disabled={!vehicleOptions.data}><SelectValue placeholder="Veículo" /></SelectTrigger><SelectContent><SelectItem value="all">Todos veículos</SelectItem>{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent></Select><div className="flex gap-1"><Button type="button" size="sm" variant="outline" disabled={vehicleOptionPage===1} onClick={()=>setVehicleOptionPage(p=>p-1)}>Anteriores</Button><Button type="button" size="sm" variant="outline" disabled={!vehicleOptions.data||vehicleOptionPage*50>=vehicleOptions.data.total} onClick={()=>setVehicleOptionPage(p=>p+1)}>Mais</Button></div></div>
            <Input aria-label="Finalizada de" type="date" value={dateFrom} onChange={(e) => { resetPaging(); setDateFrom(e.target.value); }} placeholder="De" />
            <Input aria-label="Finalizada até" type="date" value={dateTo} onChange={(e) => { resetPaging(); setDateTo(e.target.value); }} placeholder="Até" />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <Label className="flex items-center gap-2"><Checkbox checked={onlyKmPending} onCheckedChange={(v) => { resetPaging(); setOnlyKmPending(Boolean(v)); }} /> KM pendente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyExpPending} onCheckedChange={(v) => { resetPaging(); setOnlyExpPending(Boolean(v)); }} /> Despesa pendente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyNoFreight} onCheckedChange={(v) => { resetPaging(); setOnlyNoFreight(Boolean(v)); }} /> Frete ausente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyNeedsRecalc} onCheckedChange={(v) => { resetPaging(); setOnlyNeedsRecalc(Boolean(v)); }} /> Desatualizado</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div>
            <Table scrollLabel="Acertos de motoristas; deslize horizontalmente para ver todas as colunas" containerClassName="rounded-md border" className="min-w-[96rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Viagem / Rota</TableHead>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Finalizada</TableHead>
                  <TableHead className="text-right">Rom.</TableHead>
                  <TableHead className="text-right">Notas</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">KM est.</TableHead>
                  <TableHead className="text-right">KM aud.</TableHead>
                  <TableHead className="text-right">Mercadoria</TableHead>
                  <TableHead className="text-right">Receita Frete</TableHead>
                  <TableHead className="text-right">Despesas</TableHead>
                  <TableHead className="text-right">Result. Rota</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pendências</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={17} className="text-center text-muted-foreground"><span role="status">Carregando…</span></TableCell></TableRow>}
                {!isLoading && data && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={17} className="text-center text-muted-foreground py-8"><span role="status">Nenhum acerto encontrado.</span></TableCell></TableRow>
                )}
                {filtered.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="max-w-xs truncate">{s.route_name || `${s.route_origin ?? '—'} → ${s.route_destination ?? '—'}`}</TableCell>
                    <TableCell>{s.driver_name ?? '—'}</TableCell>
                    <TableCell>{s.vehicle_plate ?? '—'}</TableCell>
                    <TableCell>{s.trip_completed_at ? format(new Date(s.trip_completed_at), 'dd/MM/yy HH:mm') : '—'}</TableCell>
                    <TableCell className="text-right">{s.loads_count}</TableCell>
                    <TableCell className="text-right">{s.documents_count}</TableCell>
                    <TableCell className="text-right">{fmtNum(s.total_weight_kg, 0)}</TableCell>
                    <TableCell className="text-right">{s.estimated_km != null ? fmtNum(s.estimated_km, 1) : '—'}</TableCell>
                    <TableCell className="text-right">{s.audited_km != null ? fmtNum(s.audited_km, 1) : <Badge variant="outline" className="text-xs">pendente</Badge>}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.total_goods_value ?? s.total_invoice_value)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.total_freight_revenue ?? s.total_freight_value)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.approved_expenses_total)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.route_result ?? s.operational_balance)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(s.driver_payable_amount)}</TableCell>
                    <TableCell><Badge variant="outline">{SETTLEMENT_STATUS_LABEL[s.status as DriverSettlementStatus]}</Badge></TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {s.needs_recalculation && <Badge variant="destructive" className="flex min-h-5 items-center gap-1 text-xs"><AlertTriangle aria-hidden="true" className="h-3 w-3" />Desatualizado</Badge>}
                        {s.km_review_status === 'pending' && <Badge variant="secondary" className="min-h-5 text-xs">KM</Badge>}
                        {Number(s.pending_expenses_total ?? 0) > 0 && <Badge variant="secondary" className="min-h-5 text-xs">Despesa</Badge>}
                        {Number(s.total_freight_value ?? 0) === 0 && <Badge variant="secondary" className="min-h-5 text-xs">Sem frete</Badge>}
                        {Number(s.loads_count ?? 0) === 0 && <Badge variant="secondary" className="min-h-5 text-xs">Sem rom.</Badge>}
                        {Number(s.documents_count ?? 0) === 0 && <Badge variant="secondary" className="min-h-5 text-xs">Sem doc.</Badge>}
                        {s.approved_with_exception && <Badge variant="outline" className="min-h-5 text-xs">Exceção</Badge>}
                        {s.status === 'approved' && Number(s.total_paid_amount ?? 0) > 0 && Number(s.total_paid_amount ?? 0) < Number(s.driver_payable_amount ?? 0) && (
                          <Badge variant="outline" className="min-h-5 text-xs">Pag. parcial</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button type="button" variant="outline" size="sm" onClick={() => openSettlement(s.id)} aria-label={`Abrir acerto de ${s.driver_name ?? 'motorista não informado'}`}>
                        Abrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{data ? `${totalCount} acerto(s)` : 'Total indisponível'}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={!data || isFetching || page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</Button>
              <span className="px-2 self-center">Página {page}</span>
              <Button variant="outline" size="sm" disabled={!data?.next_cursor || isFetching} onClick={() => {
                if (!data?.next_cursor) return;
                setSnapshotAt(data.snapshot_at);
                setPageCursors(current => ({ ...current, [page + 1]: data.next_cursor }));
                setPage(current => current + 1);
              }}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DriverSettlementDrawer settlementId={selectedId} open={drawerOpen} onOpenChange={setDrawerOpen} />
      <NewManualSettlementDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={(id) => { setSelectedId(id); setDrawerOpen(true); }}
      />
    </div>
  );
}
