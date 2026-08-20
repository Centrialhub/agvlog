import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePortalSummary } from '@/hooks/portal/usePortalSummary';
import { usePortalUpcomingDeliveries } from '@/hooks/portal/usePortalUpcomingDeliveries';
import { usePortalAlerts } from '@/hooks/portal/usePortalAlerts';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { PortalKpiCard } from '@/components/portal/PortalKpiCard';
import { PortalAlertList } from '@/components/portal/PortalAlertList';
import { PortalStatusBadge } from '@/components/portal/PortalStatusBadge';
import {
  Truck, CheckCircle2, AlertTriangle, Inbox, ClipboardCheck, FileText,
  CalendarClock, CalendarDays, CalendarCheck, MessageSquareWarning, ChevronRight, MapPin,
} from 'lucide-react';

const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

export default function PortalDashboard() {
  const { selectedClientId, clients } = usePortalClientScope();
  const { data: summary, isLoading } = usePortalSummary();
  const { data: upcoming = [], isLoading: loadingUpcoming } = usePortalUpcomingDeliveries({ clientId: selectedClientId });
  const { data: alerts = [], isLoading: loadingAlerts } = usePortalAlerts();

  const contextDescription = clients.length > 0
    ? 'Acompanhe suas mercadorias e documentos em tempo real.'
    : undefined;

  return (
    <div className="space-y-6">
      <PortalSection title="Visão geral" description={contextDescription}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PortalKpiCard label="Em trânsito" value={summary?.in_transit ?? 0} icon={Truck} tone="text-sky-600" isLoading={isLoading} />
          <PortalKpiCard label="Entregues" value={summary?.delivered ?? 0} icon={CheckCircle2} tone="text-emerald-600" isLoading={isLoading} />
          <PortalKpiCard label="Atrasadas" value={summary?.delayed ?? 0} icon={AlertTriangle} tone="text-rose-600" isLoading={isLoading} />
          <PortalKpiCard label="Aguardando coleta" value={summary?.pending_pickup ?? 0} icon={Inbox} tone="text-amber-600" isLoading={isLoading} />
          <PortalKpiCard label="Coletas programadas" value={summary?.scheduled_pickups ?? 0} icon={CalendarCheck} tone="text-sky-600" isLoading={isLoading} />
          <PortalKpiCard label="Canhotos pendentes" value={summary?.pending_pod ?? 0} icon={ClipboardCheck} tone="text-amber-600" isLoading={isLoading} />
          <PortalKpiCard label="Ocorrências abertas" value={summary?.open_occurrences ?? 0} icon={AlertTriangle} tone="text-rose-600" isLoading={isLoading} />
          <PortalKpiCard label="Ação do cliente" value={summary?.client_action_required ?? 0} icon={MessageSquareWarning} tone="text-rose-600" isLoading={isLoading} />
          <PortalKpiCard label="Entregas hoje" value={summary?.deliveries_today ?? 0} icon={CalendarClock} tone="text-sky-600" isLoading={isLoading} />
          <PortalKpiCard label="Entregas amanhã" value={summary?.deliveries_tomorrow ?? 0} icon={CalendarDays} tone="text-muted-foreground" isLoading={isLoading} />
          <PortalKpiCard label="Documentos (7 dias)" value={summary?.documents_last_7_days ?? 0} icon={FileText} tone="text-muted-foreground" isLoading={isLoading} />
        </div>
      </PortalSection>

      <PortalSection title="Próximas entregas" description="Documentos com previsão de chegada nas próximas horas.">
        {loadingUpcoming ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : upcoming.length === 0 ? (
          <PortalEmptyState title="Sem entregas programadas" description="Nenhum documento em rota no momento." />
        ) : (
          <div className="space-y-2">
            {upcoming.map((d) => (
              <Link key={d.fiscal_document_id} to={`/portal/shipments/${d.fiscal_document_id}`}>
                <Card className="hover:bg-muted/40 transition-colors">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">NF {d.invoice_number || '—'}</span>
                        <PortalStatusBadge status={d.public_status} />
                        {d.has_open_occurrence && (
                          <Badge variant="destructive" className="text-[9px]">Ocorrência</Badge>
                        )}
                        {d.has_pod && (
                          <Badge variant="outline" className="text-[9px]">Canhoto OK</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {d.recipient || '—'} · {d.recipient_city || '—'}{d.recipient_state ? `/${d.recipient_state}` : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        Previsão {fmtDateTime(d.planned_arrival_at)}
                        {d.load_number && <> · Carga {d.load_number}</>}
                        {d.vehicle_plate && <> · {d.vehicle_plate}</>}
                        {d.driver_name && <> · {d.driver_name}</>}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </PortalSection>

      <PortalSection title="Alertas" description="Atrasos, ocorrências e pendências que exigem atenção.">
        <PortalAlertList alerts={alerts} isLoading={loadingAlerts} />
      </PortalSection>
    </div>
  );
}
