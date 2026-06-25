import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RefreshCw, Wallet, Search } from 'lucide-react';
import { format } from 'date-fns';
import {
  useDriverSettlements, useGeneratePendingDriverSettlements,
  SETTLEMENT_STATUS_LABEL, DriverSettlementStatus,
} from '@/hooks/useDriverSettlements';
import DriverSettlementDrawer from '@/components/financial/DriverSettlementDrawer';

const fmtMoney = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number | null | undefined, d = 1) => (v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export default function DriverSettlements() {
  const { data: list = [], isLoading, refetch } = useDriverSettlements();
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const drivers = useMemo(() => {
    const set = new Map<string, string>();
    list.forEach((s: any) => s.driver_id && set.set(s.driver_id, s.driver_name ?? '—'));
    return Array.from(set, ([id, name]) => ({ id, name }));
  }, [list]);
  const vehicles = useMemo(() => {
    const set = new Map<string, string>();
    list.forEach((s: any) => s.vehicle_id && set.set(s.vehicle_id, s.vehicle_plate ?? '—'));
    return Array.from(set, ([id, plate]) => ({ id, plate }));
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((s: any) => {
      if (status !== 'all' && s.status !== status) return false;
      if (driverFilter !== 'all' && s.driver_id !== driverFilter) return false;
      if (vehicleFilter !== 'all' && s.vehicle_id !== vehicleFilter) return false;
      if (dateFrom && (!s.trip_completed_at || s.trip_completed_at < dateFrom)) return false;
      if (dateTo && (!s.trip_completed_at || s.trip_completed_at > dateTo + 'T23:59:59')) return false;
      if (onlyKmPending && s.km_review_status !== 'pending') return false;
      if (onlyExpPending && Number(s.pending_expenses_total ?? 0) === 0) return false;
      if (onlyNoFreight && Number(s.total_freight_value ?? 0) > 0) return false;
      if (q) {
        const hay = [s.driver_name, s.vehicle_plate, s.route_name, s.route_origin, s.route_destination].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list, search, status, driverFilter, vehicleFilter, dateFrom, dateTo, onlyKmPending, onlyExpPending, onlyNoFreight]);

  const kpi = useMemo(() => {
    const byStatus = (st: DriverSettlementStatus) => list.filter((s: any) => s.status === st);
    return {
      pending: byStatus('pending_review').length,
      inReview: byStatus('in_review').length,
      approved: byStatus('approved').length,
      paidClosed: list.filter((s: any) => s.status === 'paid' || s.status === 'closed').length,
      totalApprovedExp: list.reduce((a: number, s: any) => a + Number(s.approved_expenses_total ?? 0), 0),
      totalOpBalance: list.reduce((a: number, s: any) => a + Number(s.operational_balance ?? 0), 0),
      kmPending: list.filter((s: any) => s.km_review_status === 'pending').length,
      expPending: list.filter((s: any) => Number(s.pending_expenses_total ?? 0) > 0).length,
    };
  }, [list]);

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
            Gerar acertos pendentes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Pendentes', value: kpi.pending },
          { label: 'Em conferência', value: kpi.inReview },
          { label: 'Aprovados', value: kpi.approved },
          { label: 'Pagos / Fechados', value: kpi.paidClosed },
          { label: 'KM pendente', value: kpi.kmPending },
          { label: 'Despesas pendentes', value: kpi.expPending },
          { label: 'Despesas aprovadas', value: fmtMoney(kpi.totalApprovedExp) },
          { label: 'Resultado operacional', value: fmtMoney(kpi.totalOpBalance) },
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
              <Input className="pl-8" placeholder="Buscar motorista, placa, rota…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={status} onValueChange={(v: any) => setStatus(v)}>
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
                  <TableHead className="text-right">Notas R$</TableHead>
                  <TableHead className="text-right">Frete</TableHead>
                  <TableHead className="text-right">Despesas</TableHead>
                  <TableHead className="text-right">Result. Op.</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-8">Nenhum acerto encontrado.</TableCell></TableRow>
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
                    <TableCell className="text-right">{fmtMoney(s.total_invoice_value)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.total_freight_value)}</TableCell>
                    <TableCell className="text-right">{fmtMoney(s.approved_expenses_total)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(s.operational_balance)}</TableCell>
                    <TableCell><Badge variant="outline">{SETTLEMENT_STATUS_LABEL[s.status as DriverSettlementStatus]}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <DriverSettlementDrawer settlementId={selectedId} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}