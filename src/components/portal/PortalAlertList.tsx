import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Clock, ClipboardCheck, Inbox, MessageSquareWarning, ChevronRight } from 'lucide-react';
import type { PortalAlert, PortalAlertType } from '@/hooks/portal/usePortalAlerts';
import { cn } from '@/lib/utils';

const ICONS: Record<PortalAlertType, typeof AlertTriangle> = {
  delay: Clock,
  occurrence: AlertTriangle,
  client_action: MessageSquareWarning,
  pod_pending: ClipboardCheck,
  pod_rejected: ClipboardCheck,
  pickup_pending: Inbox,
};

const SEVERITY_TONE = {
  danger: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30',
  warning: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
  info: 'text-sky-600 bg-sky-50 dark:bg-sky-950/30',
} as const;

export function PortalAlertList({ alerts, isLoading }: { alerts: PortalAlert[]; isLoading?: boolean }) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando alertas...</p>;
  }
  if (!alerts || alerts.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Nenhum alerta no momento.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const Icon = ICONS[a.type] ?? AlertTriangle;
        return (
          <Card key={`${a.type}-${a.related_id}`} className="hover:bg-muted/40 transition-colors">
            <CardContent className="p-3 flex items-start gap-3">
              <div className={cn('h-8 w-8 rounded-md flex items-center justify-center shrink-0', SEVERITY_TONE[a.severity])}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{a.title}</span>
                  <Badge variant="outline" className="text-[9px]">{a.type}</Badge>
                </div>
                {a.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{a.description}</p>
                )}
              </div>
              <Link to={a.action_url}>
                <Button variant="ghost" size="sm" className="gap-1">
                  {a.action_label}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
