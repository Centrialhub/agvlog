import { BarChart3, Layers, TrendingUp } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CHART_COLORS, displayOperationsValue, formatOperationsCurrency, formatOperationsWeight,
} from './operationsCenterPresentation';
import type { OperationsCenterViewModel } from './operationsCenterTypes';

export function OperationsCenterAnalytics({ model }: { model: OperationsCenterViewModel }) {
  const {
    destChart, statusChart, nfeByDay, stats,
    loadsPending, loadsUnavailable, fiscalPending, fiscalUnavailable,
  } = model;

  return (
    <>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div><CardTitle className="text-sm font-semibold flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /> Distribuição por Destino</CardTitle><p className="mt-1 text-[10px] text-muted-foreground">Recorte de até 200 cargas recentes.</p></div>
          </CardHeader>
          <CardContent>
            {loadsPending ? (
              <div role="status" className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Carregando distribuição de cargas…</div>
            ) : loadsUnavailable ? (
              <div role="alert" className="flex h-[220px] items-center justify-center px-6 text-center text-sm text-destructive">Distribuição indisponível. A falha não foi apresentada como ausência de destinos.</div>
            ) : destChart.length > 0 ? (
              <div role="img" aria-label={`Distribuição de cargas por destino: ${destChart.map((item) => `${item.dest}, ${item.count} carga(s)`).join('; ')}`}>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={destChart} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="dest" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }} formatter={(value: number, name: string) => [name === 'weight' ? formatOperationsWeight(value) : value, name === 'weight' ? 'Peso' : name === 'count' ? 'Cargas' : 'Paletes']} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Cargas" />
                    <Bar dataKey="pallets" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Paletes" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">Sem dados de destino</div>}
          </CardContent>
        </Card>

        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2"><div><CardTitle className="text-sm font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Status das Cargas</CardTitle><p className="mt-1 text-[10px] text-muted-foreground">Distribuição no recorte de até 200 cargas recentes.</p></div></CardHeader>
          <CardContent className="flex flex-col items-center">
            {loadsPending ? (
              <div role="status" className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">Carregando status das cargas…</div>
            ) : loadsUnavailable ? (
              <div role="alert" className="flex h-[180px] items-center justify-center px-6 text-center text-sm text-destructive">Status das cargas indisponível.</div>
            ) : statusChart.length > 0 ? (
              <>
                <div role="img" aria-label={`Status das cargas: ${statusChart.map((item) => `${item.name}, ${item.value}`).join('; ')}`} className="w-full">
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart><Pie data={statusChart} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value" strokeWidth={0}>{statusChart.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: 'hsl(var(--card))' }} /></PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">{statusChart.map((entry, index) => <div key={index} className="flex items-center gap-1"><div className="h-2 w-2 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span className="text-[10px] text-muted-foreground">{entry.name} ({entry.value})</span></div>)}</div>
              </>
            ) : <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">Sem cargas</div>}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm hover:shadow-md transition-shadow">
        <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Fluxo de NF-es Recebidas</CardTitle><div className="flex items-center gap-2"><Badge variant="secondary" className="text-[10px]">{displayOperationsValue(fiscalPending, fiscalUnavailable, `${stats.nfeCount} no recorte`)}</Badge>{!fiscalPending && !fiscalUnavailable && stats.totalFreight > 0 && <Badge variant="outline" className="text-[10px]">Frete: {formatOperationsCurrency(stats.totalFreight)}</Badge>}</div></div></CardHeader>
        <CardContent>
          {fiscalPending ? (
            <div role="status" className="flex h-[150px] items-center justify-center text-sm text-muted-foreground">Carregando fluxo documental…</div>
          ) : fiscalUnavailable ? (
            <div role="alert" className="flex h-[150px] items-center justify-center px-6 text-center text-sm text-destructive">Fluxo documental indisponível.</div>
          ) : nfeByDay.length === 0 ? (
            <div className="flex h-[150px] items-center justify-center text-sm text-muted-foreground">Sem NF-es no recorte de até 1.000 documentos recentes.</div>
          ) : (
            <div role="img" aria-label={`Fluxo documental por dia: ${nfeByDay.map((item) => `${item.day}, ${item.qty} documento(s)`).join('; ')}`}>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={nfeByDay} margin={{ left: -10, right: 10 }}>
                  <defs><linearGradient id="nfeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} /><stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" /><XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} /><Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: 'hsl(var(--card))' }} /><Area type="monotone" dataKey="qty" stroke="hsl(var(--primary))" fill="url(#nfeGrad)" strokeWidth={2} name="NF-es" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
