import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Route, Clock, AlertTriangle, Gauge, TrendingUp, MapPin, Download } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function Reports() {
  const { currentTenant } = useTenant();
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: metrics = [], isLoading } = useQuery({
    queryKey: ['reports_metrics', currentTenant?.id, from, to],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('metrics_daily')
        .select('*, vehicles(plate, nickname)')
        .eq('tenant_id', currentTenant.id)
        .gte('day', from).lte('day', to)
        .order('day', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  // Aggregate by vehicle
  const byVehicle = useMemo(() => {
    const map: Record<string, { plate: string; km: number; moving: number; stopped: number; trips: number; stops: number; overspeed: number; offline: number }> = {};
    for (const m of metrics as any[]) {
      const vid = m.vehicle_id;
      if (!map[vid]) map[vid] = { plate: m.vehicles?.plate || vid, km: 0, moving: 0, stopped: 0, trips: 0, stops: 0, overspeed: 0, offline: 0 };
      map[vid].km += m.km_estimated || 0;
      map[vid].moving += m.moving_time_seconds || 0;
      map[vid].stopped += m.stopped_time_seconds || 0;
      map[vid].trips += m.trips_count || 0;
      map[vid].stops += m.stops_count || 0;
      map[vid].overspeed += m.overspeed_events || 0;
      map[vid].offline += m.offline_minutes || 0;
    }
    return Object.values(map).sort((a, b) => b.km - a.km);
  }, [metrics]);

  const totals = useMemo(() => byVehicle.reduce((acc, v) => ({
    km: acc.km + v.km, moving: acc.moving + v.moving, stopped: acc.stopped + v.stopped,
    trips: acc.trips + v.trips, stops: acc.stops + v.stops, overspeed: acc.overspeed + v.overspeed,
  }), { km: 0, moving: 0, stopped: 0, trips: 0, stops: 0, overspeed: 0 }), [byVehicle]);

  // Daily evolution chart
  const dailyEvolution = useMemo(() => {
    const byDay: Record<string, { day: string; km: number; trips: number; stops: number }> = {};
    for (const m of metrics as any[]) {
      if (!byDay[m.day]) byDay[m.day] = { day: m.day, km: 0, trips: 0, stops: 0 };
      byDay[m.day].km += m.km_estimated || 0;
      byDay[m.day].trips += m.trips_count || 0;
      byDay[m.day].stops += m.stops_count || 0;
    }
    return Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).map(d => ({
      ...d, km: Math.round(d.km), label: d.day.slice(5),
    }));
  }, [metrics]);

  // Vehicle km chart data
  const vehicleChartData = useMemo(() => {
    return byVehicle.slice(0, 10).map(v => ({ plate: v.plate, km: Math.round(v.km) }));
  }, [byVehicle]);

  const fmtHours = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  // CSV export
  const exportCSV = useCallback(() => {
    const headers = ['Veículo', 'Km', 'Mov. (h)', 'Parado (h)', 'Viagens', 'Paradas', 'Excesso Vel.'];
    const rows = byVehicle.map(v => [
      v.plate, Math.round(v.km),
      `${Math.floor(v.moving / 3600)}h${Math.floor((v.moving % 3600) / 60)}m`,
      `${Math.floor(v.stopped / 3600)}h${Math.floor((v.stopped % 3600) / 60)}m`,
      v.trips, v.stops, v.overspeed,
    ]);
    const csv = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_frota_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [byVehicle, from, to]);

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileText className="h-6 w-6 text-primary" /> Relatórios
        </h1>
        <p className="text-sm text-muted-foreground">KPIs e ranking da frota por período</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
        <span className="text-muted-foreground">até</span>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        <Badge variant="outline" className="text-xs">{metrics.length} registros</Badge>
        {byVehicle.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" />Exportar CSV
          </Button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard icon={<Route className="h-4 w-4" />} label="Km estimado" value={`${Math.round(totals.km)} km`} note="Via GPS" />
        <KPICard icon={<TrendingUp className="h-4 w-4" />} label="Tempo mov." value={fmtHours(totals.moving)} />
        <KPICard icon={<Clock className="h-4 w-4" />} label="Tempo parado" value={fmtHours(totals.stopped)} />
        <KPICard icon={<MapPin className="h-4 w-4" />} label="Viagens" value={String(totals.trips)} />
        <KPICard icon={<MapPin className="h-4 w-4" />} label="Paradas" value={String(totals.stops)} />
        <KPICard icon={<Gauge className="h-4 w-4" />} label="Excesso vel." value={String(totals.overspeed)} variant="destructive" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Evolução Diária</CardTitle></CardHeader>
          <CardContent>
            {dailyEvolution.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={dailyEvolution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="km" stroke="hsl(var(--primary))" strokeWidth={2} name="Km" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="trips" stroke="hsl(var(--success))" strokeWidth={2} name="Viagens" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="stops" stroke="hsl(var(--warning))" strokeWidth={2} name="Paradas" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">Sem dados no período</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Km por Veículo</CardTitle></CardHeader>
          <CardContent>
            {vehicleChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={vehicleChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <YAxis dataKey="plate" type="category" width={90} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="km" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Km" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-sm text-muted-foreground">Sem dados</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicle ranking */}
      <Card>
        <CardHeader><CardTitle className="text-base">Ranking por Veículo</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Veículo</TableHead>
                <TableHead className="text-right">Km</TableHead>
                <TableHead className="text-right">Mov.</TableHead>
                <TableHead className="text-right">Parado</TableHead>
                <TableHead className="text-right">Viagens</TableHead>
                <TableHead className="text-right">Paradas</TableHead>
                <TableHead className="text-right">Excesso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : byVehicle.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Nenhum dado no período selecionado. Execute o processamento de inteligência primeiro.
                </TableCell></TableRow>
              ) : byVehicle.map(v => (
                <TableRow key={v.plate}>
                  <TableCell className="font-medium">{v.plate}</TableCell>
                  <TableCell className="text-right">{Math.round(v.km)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtHours(v.moving)}</TableCell>
                  <TableCell className="text-right text-xs">{fmtHours(v.stopped)}</TableCell>
                  <TableCell className="text-right">{v.trips}</TableCell>
                  <TableCell className="text-right">{v.stops}</TableCell>
                  <TableCell className="text-right">{v.overspeed > 0 ? <Badge variant="destructive" className="text-xs">{v.overspeed}</Badge> : '0'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Valores estimados via GPS (modo básico). Maior precisão disponível com ignição/odômetro quando configurados.
      </p>
    </div>
  );
}

function KPICard({ icon, label, value, note, variant }: { icon: React.ReactNode; label: string; value: string; note?: string; variant?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
        <p className={`text-lg font-bold ${variant === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
        {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}
