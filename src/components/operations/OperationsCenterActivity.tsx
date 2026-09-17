import { ArrowRight, ChevronRight, Eye, FileText, MapPin, PackageCheck, Receipt, ShieldAlert, Truck, Wrench, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatOperationsWeight, LOAD_STATUS_COLORS, LOAD_STATUS_LABELS } from './operationsCenterPresentation';
import type { OperationsCenterViewModel } from './operationsCenterTypes';

export function OperationsCenterActivity({ model, onNavigate }: {
  model: OperationsCenterViewModel;
  onNavigate: (path: string) => void;
}) {
  const {
    loads, fleetStats, pendingExpenses, openMaintenance,
    loadsPending, loadsUnavailable, expensesPending, expensesUnavailable,
    maintenancePending, maintenanceUnavailable, fleetPending, fleetUnavailable,
  } = model;

  const quickActions = [
    { icon: Eye, label: 'Torre de Controle', path: '/operations-control', color: 'text-cyan-600' },
    { icon: ShieldAlert, label: 'Ocorrências Operacionais', path: '/events', color: 'text-orange-600' },
    { icon: FileText, label: 'Importar NF-es', path: '/ingestion', color: 'text-blue-500' },
    { icon: MapPin, label: 'Planejar Rotas', path: '/route-planning', color: 'text-emerald-500' },
    { icon: Receipt, label: 'Documentos Fiscais', path: '/fiscal-documents', color: 'text-purple-500' },
    { icon: Truck, label: 'Mapa da Frota', path: '/fleet-map', color: 'text-indigo-500' },
  ];

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      <Card className="lg:col-span-3 shadow-sm">
        <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm font-semibold flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Cargas Recentes</CardTitle><Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => onNavigate('/loads')}>Ver todas <ArrowRight className="h-3 w-3 ml-1" /></Button></div></CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {loadsPending ? (
              <p role="status" className="text-xs text-muted-foreground text-center py-8">Carregando cargas recentes…</p>
            ) : loadsUnavailable ? (
              <p role="alert" className="text-xs text-destructive text-center py-8">Cargas indisponíveis. Nenhum estado vazio foi presumido.</p>
            ) : loads.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">Nenhuma carga encontrada. Importe NF-es para começar.</p>
            ) : loads.slice(0, 8).map((load) => {
              const vehicle = load.vehicles;
              const driver = load.drivers;
              return (
                <button type="button" key={load.id} className="group flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" onClick={() => onNavigate(`/loads/${load.id}`)} aria-label={`Abrir carga ${load.load_number}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-semibold">{load.load_number}</span>{vehicle && <span className="text-[10px] text-muted-foreground"><Truck className="inline h-2.5 w-2.5 mr-0.5" />{vehicle.plate}</span>}</div><p className="text-[10px] text-muted-foreground truncate">{load.origin || '—'} → {load.destination || '—'}{driver && <span className="ml-2">• {driver.name}</span>}</p></div></div>
                  <div className="flex items-center gap-2 shrink-0"><div className="text-right mr-2 hidden sm:block"><p className="text-[10px] text-muted-foreground">{formatOperationsWeight(Number(load.total_weight_kg || 0))}</p><p className="text-[10px] text-muted-foreground">{load.total_pallet_count || 0} pal</p></div><Badge className={`text-[10px] ${LOAD_STATUS_COLORS[load.status] || ''}`} variant="secondary">{LOAD_STATUS_LABELS[load.status] || load.status}</Badge><ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="lg:col-span-2 space-y-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Ações Rápidas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {quickActions.map(({ icon: Icon, label, path, color }) => <Button key={path} variant="outline" size="sm" className="w-full justify-start text-xs h-8 hover:bg-muted/60 transition-colors" onClick={() => onNavigate(path)}><Icon className={`h-3.5 w-3.5 mr-2 ${color}`} /> {label}</Button>)}
            {expensesPending ? (
              <p role="status" className="px-2 text-[10px] text-muted-foreground">Consultando despesas pendentes…</p>
            ) : expensesUnavailable ? (
              <p role="alert" className="px-2 text-[10px] text-destructive">Despesas pendentes indisponíveis.</p>
            ) : (pendingExpenses ?? 0) > 0 ? (
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-warning/40 text-warning" onClick={() => onNavigate('/expense-approval')}><Receipt className="h-3.5 w-3.5 mr-2" /> {pendingExpenses} despesa(s) pendente(s)</Button>
            ) : null}
            {maintenancePending ? (
              <p role="status" className="px-2 text-[10px] text-muted-foreground">Consultando ordens de manutenção…</p>
            ) : maintenanceUnavailable ? (
              <p role="alert" className="px-2 text-[10px] text-destructive">Ordens de manutenção indisponíveis.</p>
            ) : (openMaintenance ?? 0) > 0 ? (
              <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-orange-400/40 text-orange-600" onClick={() => onNavigate('/maintenance-orders')}><Wrench className="h-3.5 w-3.5 mr-2" /> {openMaintenance} OS de manutenção</Button>
            ) : null}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><Truck className="h-4 w-4 text-primary" /> Resumo da Frota</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {fleetPending ? (
              <p role="status" className="py-4 text-center text-xs text-muted-foreground">Carregando resumo da frota…</p>
            ) : fleetUnavailable ? (
              <p role="alert" className="py-4 text-center text-xs text-destructive">Resumo da frota indisponível.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">{[
                  { label: 'Movendo', count: fleetStats.moving, dot: 'bg-green-500' },
                  { label: 'Parados', count: fleetStats.stopped, dot: 'bg-amber-500' },
                  { label: 'Ociosos', count: fleetStats.idle, dot: 'bg-blue-500' },
                  { label: 'Offline', count: fleetStats.offline, dot: 'bg-slate-400' },
                ].map(({ label, count, dot }) => <div key={label} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-muted/30"><div className={`h-2 w-2 rounded-full ${dot}`} /><span className="text-[11px] text-muted-foreground">{label}</span><span className="text-[11px] font-semibold ml-auto">{count}</span></div>)}</div>
                {fleetStats.total > 0 && <div><div className="flex justify-between text-[10px] text-muted-foreground mb-1"><span>Utilização</span><span>{Math.round((fleetStats.online / fleetStats.total) * 100)}%</span></div><Progress aria-label="Utilização da frota" aria-valuetext={`${fleetStats.online} de ${fleetStats.total} veículos online`} value={(fleetStats.online / fleetStats.total) * 100} className="h-1.5" /></div>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
