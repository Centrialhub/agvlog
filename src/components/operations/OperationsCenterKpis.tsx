import {
  Bell, Clock, FileText, Navigation, Package, PackageCheck, Receipt, Scale,
  ShieldAlert, Truck, Users, Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  displayOperationsValue, formatOperationsCurrency, formatOperationsWeight,
} from './operationsCenterPresentation';
import type { OperationsCenterViewModel } from './operationsCenterTypes';

export function OperationsCenterKpis({ model, onNavigate }: {
  model: OperationsCenterViewModel;
  onNavigate: (path: string) => void;
}) {
  const {
    stats, fleetStats, pendingExpenses, openMaintenance, alertTotal,
    loadsPending, loadsUnavailable, fiscalPending, fiscalUnavailable,
    fleetPending, fleetUnavailable, driversPending, driversUnavailable,
    maintenancePending, maintenanceUnavailable, expensesPending, expensesUnavailable,
    alertsPending, alertsUnavailable, incidentsPending, incidentsUnavailable,
    tripsPending, tripsUnavailable, hasDelayedLoads, hasOpenIncidents,
  } = model;

  const secondaryKpis = [
    { icon: FileText, label: 'NF-es (recorte)', value: displayOperationsValue(fiscalPending, fiscalUnavailable, stats.nfeCount), sub: fiscalPending ? 'consultando' : fiscalUnavailable ? 'indisponível' : `até 1.000 docs · ${formatOperationsCurrency(stats.totalNfeValue)}`, color: 'text-blue-500', path: '/fiscal-documents' },
    { icon: Receipt, label: 'CT-es (recorte)', value: displayOperationsValue(fiscalPending, fiscalUnavailable, stats.cteCount), sub: fiscalPending ? 'consultando' : fiscalUnavailable ? 'indisponível' : `até 1.000 docs · ${stats.cteCount > 0 ? formatOperationsCurrency(stats.totalCteValue) : '—'}`, color: 'text-emerald-500', path: '/fiscal-documents' },
    { icon: Truck, label: 'Frota', value: displayOperationsValue(fleetPending, fleetUnavailable, fleetStats.total), sub: fleetPending ? 'consultando' : fleetUnavailable ? 'indisponível' : `${fleetStats.online} online`, color: 'text-indigo-500', path: '/vehicles' },
    { icon: Users, label: 'Motoristas', value: displayOperationsValue(driversPending, driversUnavailable, stats.activeDrivers), sub: driversPending ? 'consultando' : driversUnavailable ? 'indisponível' : `${stats.driversWithVehicle} alocados`, color: 'text-teal-500', path: '/drivers' },
    { icon: Wrench, label: 'Manutenção', value: displayOperationsValue(maintenancePending, maintenanceUnavailable, openMaintenance ?? 0), sub: maintenancePending ? 'consultando' : maintenanceUnavailable ? 'indisponível' : 'OS abertas · total exato', color: 'text-orange-500', path: '/maintenance-orders', warn: !maintenancePending && !maintenanceUnavailable && (openMaintenance ?? 0) > 0 },
    { icon: Receipt, label: 'Despesas', value: displayOperationsValue(expensesPending, expensesUnavailable, pendingExpenses ?? 0), sub: expensesPending ? 'consultando' : expensesUnavailable ? 'indisponível' : 'pendentes · total exato', color: 'text-amber-500', path: '/expense-approval', warn: !expensesPending && !expensesUnavailable && (pendingExpenses ?? 0) > 0 },
    { icon: Bell, label: 'Alertas', value: displayOperationsValue(alertsPending, alertsUnavailable, alertTotal), sub: alertsPending ? 'consultando' : alertsUnavailable ? 'indisponível' : 'ativos · total exato', color: 'text-red-500', path: '/alerts', warn: !alertsPending && !alertsUnavailable && alertTotal > 0 },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 border-primary/20 group" onClick={() => onNavigate('/loads')}>
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-primary/5 group-hover:bg-primary/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center"><PackageCheck className="h-5 w-5 text-primary" /></div>
              <Badge variant="secondary" className="text-[10px] font-medium">ativas</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{displayOperationsValue(loadsPending, loadsUnavailable, stats.activeLoads)}</p>
            <p className="text-xs text-muted-foreground mt-1">Cargas em operação · {loadsPending ? 'consultando' : loadsUnavailable ? 'indisponível' : 'total exato'}</p>
            <p className="mt-3 text-[9px] text-muted-foreground">Peso e paletes no recorte de até 200 cargas recentes:</p>
            <div className="flex gap-3 mt-1 text-[10px]">
              <span className="flex items-center gap-1 text-muted-foreground"><Scale className="h-3 w-3" /> {displayOperationsValue(loadsPending, loadsUnavailable, formatOperationsWeight(stats.totalWeightActive))}</span>
              <span className="flex items-center gap-1 text-muted-foreground"><Package className="h-3 w-3" /> {displayOperationsValue(loadsPending, loadsUnavailable, `${stats.totalPalletsActive} pal`)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 border-purple-500/20 group" onClick={() => onNavigate('/loads')}>
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/8 via-purple-500/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-purple-500/5 group-hover:bg-purple-500/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center"><Truck className="h-5 w-5 text-purple-600" /></div>
              <Badge variant="secondary" className="text-[10px] font-medium">trânsito</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{displayOperationsValue(loadsPending, loadsUnavailable, stats.inTransit)}</p>
            <p className="text-xs text-muted-foreground mt-1">Em trânsito agora · {loadsPending ? 'consultando' : loadsUnavailable ? 'indisponível' : 'total exato'}</p>
            <div className="flex gap-3 mt-3 text-[10px]"><span className="flex items-center gap-1 text-muted-foreground"><Navigation className="h-3 w-3" />{tripsPending ? 'consultando viagens' : tripsUnavailable ? 'viagens indisponíveis' : `${stats.activeTrips} viagens ativas`}</span></div>
          </CardContent>
        </Card>

        <Card className={`relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 group ${hasDelayedLoads ? 'border-destructive/30' : 'border-border'}`}>
          <div className={`absolute inset-0 ${hasDelayedLoads ? 'bg-gradient-to-br from-destructive/8 via-destructive/4 to-transparent' : ''}`} />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${hasDelayedLoads ? 'bg-destructive/10' : 'bg-muted'}`}><Clock className={`h-5 w-5 ${hasDelayedLoads ? 'text-destructive' : 'text-muted-foreground'}`} /></div>
              {hasDelayedLoads && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{displayOperationsValue(loadsPending, loadsUnavailable, stats.delayed)}</p>
            <p className="text-xs text-muted-foreground mt-1">Fora do prazo operacional · {loadsPending ? 'consultando' : loadsUnavailable ? 'indisponível' : 'total exato'}</p>
          </CardContent>
        </Card>

        <Card className={`relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 group ${hasOpenIncidents ? 'border-warning/30' : 'border-border'}`} onClick={() => onNavigate('/incidents')}>
          <div className={`absolute inset-0 ${hasOpenIncidents ? 'bg-gradient-to-br from-warning/8 via-warning/4 to-transparent' : ''}`} />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${hasOpenIncidents ? 'bg-warning/10' : 'bg-muted'}`}><ShieldAlert className={`h-5 w-5 ${hasOpenIncidents ? 'text-warning' : 'text-muted-foreground'}`} /></div>
              {hasOpenIncidents && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" /></span>}
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{displayOperationsValue(incidentsPending, incidentsUnavailable, stats.openIncidents)}</p>
            <p className="text-xs text-muted-foreground mt-1">Incidentes abertos · {incidentsPending ? 'consultando' : incidentsUnavailable ? 'indisponível' : 'total exato'}</p>
            {!incidentsPending && !incidentsUnavailable && stats.criticalIncidents > 0 && <p className="text-[10px] text-destructive font-medium mt-1">{stats.criticalIncidents} crítico(s)</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        {secondaryKpis.map(({ icon: Icon, label, value, sub, color, path, warn }) => (
          <Card key={label} className={`cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${warn ? 'border-warning/40' : ''}`} onClick={() => onNavigate(path)}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1"><Icon className={`h-3.5 w-3.5 ${color}`} /><span className="text-[10px] text-muted-foreground font-medium">{label}</span></div>
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
