import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Truck, TruckIcon, AlertTriangle, Clock } from 'lucide-react';

export default function Dashboard() {
  const { currentTenant } = useTenant();

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {currentTenant?.name} — Visão geral da frota
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Veículos"
          value="—"
          subtitle="Cadastrados"
          icon={<Truck className="h-5 w-5" />}
        />
        <StatCard
          title="Online"
          value="—"
          subtitle="Com atualização recente"
          icon={<TruckIcon className="h-5 w-5" />}
          variant="success"
        />
        <StatCard
          title="Alertas"
          value="—"
          subtitle="Abertos"
          icon={<AlertTriangle className="h-5 w-5" />}
          variant="warning"
        />
        <StatCard
          title="Offline"
          value="—"
          subtitle="Sem atualização"
          icon={<Clock className="h-5 w-5" />}
          variant="destructive"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Próximos passos</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>1. Cadastre seus veículos na aba "Veículos"</p>
          <p>2. Configure a integração SSX nas "Configurações" (Fase 2)</p>
          <p>3. Acompanhe sua frota no "Mapa da Frota" (Fase 3)</p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, variant }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  variant?: 'success' | 'warning' | 'destructive';
}) {
  const colorClass = variant === 'success'
    ? 'text-success'
    : variant === 'warning'
      ? 'text-warning'
      : variant === 'destructive'
        ? 'text-destructive'
        : 'text-primary';

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className={cn(colorClass)}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
