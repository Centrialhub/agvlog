import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RefreshCw, Wallet, Search, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import {
  useDriverSettlements, useGeneratePendingDriverSettlements,
  useDriverSettlementFilterOptions,
  SETTLEMENT_STATUS_LABEL, DriverSettlementStatus,
} from '@/hooks/useDriverSettlements';
import DriverSettlementDrawer from '@/components/financial/DriverSettlementDrawer';

const fmtMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, d = 1) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DriverSettlements() {
  const genPending = useGeneratePendingDriverSettlements();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | DriverSettlementStatus>('all');
  const [driverFilter, setDriverFilter] = useState('all');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyKmPending, setOnlyKmPending] = useState(false);
  const [onlyExpPending, setOnlyExpPending] = useState(false);
  const [onlyNoFreight, setOnlyNoFreight] = useState(false);
  const [onlyNeedsRecalc, setOnlyNeedsRecalc] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading, refetch } = useDriverSettlements({
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
  });
  const list = (data?.items ?? []) as any[];
  const totalCount = data?.total_count ?? 0;
  const summary = data?.summary ?? null;
  const { data: filterOpts } = useDriverSettlementFilterOptions();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const drivers = filterOpts?.drivers ?? [];
  const vehicles = filterOpts?.vehicles ?? [];

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
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="h-6 w-6" /> Acerto de Motoristas</h1>
          <p className="text-sm text-muted-foreground">Conferência financeira das viagens finalizadas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" /> Atualizar</Button>
          <Button onClick={() => genPending.mutate()} disabled={genPending.isPending}>
            Gerar / Recalcular pendentes
          </Button>
        </div>
      </div>

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
          <Card key={k.label}><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{k.label}</CardTitle></CardHeader>
            <CardContent className="text-lg font-semibold">{k.value}</CardContent></Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-8" placeholder="Motorista, placa, rota, romaneio, nota…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
            </div>
            <Select value={status} onValueChange={(v: any) => { setPage(1); setStatus(v); }}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos status</SelectItem>
                {(Object.keys(SETTLEMENT_STATUS_LABEL) as DriverSettlementStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{SETTLEMENT_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={driverFilter} onValueChange={setDriverFilter}>
              <SelectTrigger><SelectValue placeholder="Motorista" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos motoristas</SelectItem>
                {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
              <SelectTrigger><SelectValue placeholder="Veículo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos veículos</SelectItem>
                {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} placeholder="De" />
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} placeholder="Até" />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <Label className="flex items-center gap-2"><Checkbox checked={onlyKmPending} onCheckedChange={(v) => setOnlyKmPending(Boolean(v))} /> KM pendente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyExpPending} onCheckedChange={(v) => setOnlyExpPending(Boolean(v))} /> Despesa pendente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyNoFreight} onCheckedChange={(v) => setOnlyNoFreight(Boolean(v))} /> Frete ausente</Label>
            <Label className="flex items-center gap-2"><Checkbox checked={onlyNeedsRecalc} onCheckedChange={(v) => setOnlyNeedsRecalc(Boolean(v))} /> Desatualizado</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border overflow-x-auto">
            <Table>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={16} className="text-center text-muted-foreground py-8">Nenhum acerto encontrado.</TableCell></TableRow>
                )}
                {filtered.map((s: any) => (
                  <TableRow key={s.id} className="cursor-pointer hover:bg-accent" onClick={() => openSettlement(s.id)}>
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
                        {s.needs_recalculation && <Badge variant="destructive" className="text-[10px] flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Desatualizado</Badge>}
                        {s.km_review_status === 'pending' && <Badge variant="secondary" className="text-[10px]">KM</Badge>}
                        {Number(s.pending_expenses_total ?? 0) > 0 && <Badge variant="secondary" className="text-[10px]">Despesa</Badge>}
                        {Number(s.total_freight_value ?? 0) === 0 && <Badge variant="secondary" className="text-[10px]">Sem frete</Badge>}
                        {Number(s.loads_count ?? 0) === 0 && <Badge variant="secondary" className="text-[10px]">Sem rom.</Badge>}
                        {Number(s.documents_count ?? 0) === 0 && <Badge variant="secondary" className="text-[10px]">Sem doc.</Badge>}
                        {s.approved_with_exception && <Badge variant="outline" className="text-[10px]">Exceção</Badge>}
                        {s.status === 'approved' && Number(s.total_paid_amount ?? 0) > 0 && Number(s.total_paid_amount ?? 0) < Number(s.driver_payable_amount ?? 0) && (
                          <Badge variant="outline" className="text-[10px]">Pag. parcial</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-between items-center mt-3 text-sm text-muted-foreground">
            <span>{totalCount} acerto(s)</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Anterior</Button>
              <span className="px-2 self-center">Página {page}</span>
              <Button variant="outline" size="sm" disabled={page * pageSize >= totalCount} onClick={() => setPage(p => p + 1)}>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DriverSettlementDrawer settlementId={selectedId} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}