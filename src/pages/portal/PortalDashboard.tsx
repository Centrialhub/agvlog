import { Card, CardContent } from '@/components/ui/card';
import { usePortalSummary } from '@/hooks/portal/usePortalSummary';
import { useClientPortalAccess } from '@/hooks/portal/useClientPortalAccess';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import {
  Truck, CheckCircle2, AlertTriangle, Inbox, ClipboardCheck, FileText, CalendarClock, CalendarDays,
} from 'lucide-react';

const KPIS = [
  { key: 'in_transit', label: 'Em trânsito', icon: Truck, tone: 'text-sky-600' },
  { key: 'delivered', label: 'Entregues', icon: CheckCircle2, tone: 'text-emerald-600' },
  { key: 'delayed', label: 'Atrasadas', icon: AlertTriangle, tone: 'text-rose-600' },
  { key: 'pending_pickup', label: 'Aguardando coleta', icon: Inbox, tone: 'text-amber-600' },
  { key: 'pending_pod', label: 'Canhotos pendentes', icon: ClipboardCheck, tone: 'text-amber-600' },
  { key: 'open_occurrences', label: 'Ocorrências abertas', icon: AlertTriangle, tone: 'text-rose-600' },
  { key: 'deliveries_today', label: 'Entregas hoje', icon: CalendarClock, tone: 'text-sky-600' },
  { key: 'deliveries_tomorrow', label: 'Entregas amanhã', icon: CalendarDays, tone: 'text-muted-foreground' },
] as const;

export default function PortalDashboard() {
  const { data: summary, isLoading } = usePortalSummary();
  const { data: access } = useClientPortalAccess();

  return (
    <div className="space-y-6">
      <PortalSection
        title="Visão geral"
        description={access && access.length > 0 ? `Acompanhe suas mercadorias e documentos em tempo real.` : undefined}
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {KPIS.map(({ key, label, icon: Icon, tone }) => (
            <Card key={key}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Icon className={`h-4 w-4 ${tone}`} />
                </div>
                <p className="text-2xl font-bold mt-2 tabular-nums">
                  {isLoading ? '—' : (summary?.[key] ?? 0)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </PortalSection>

      <PortalSection title="Próximas entregas" description="Documentos com previsão de chegada nas próximas horas.">
        <PortalEmptyState
          title="Em construção"
          description="A lista detalhada será habilitada quando a área de mercadorias for liberada."
        />
      </PortalSection>

      <PortalSection title="Alertas" description="Atrasos, ocorrências e pendências documentais.">
        <PortalEmptyState title="Sem alertas no momento" />
      </PortalSection>
    </div>
  );
}
