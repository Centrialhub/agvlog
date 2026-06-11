import { Badge } from '@/components/ui/badge';
import { PUBLIC_STATUS_LABELS, PUBLIC_STATUS_TONE, type PublicShipmentStatus } from '@/lib/portal/portalStatus';
import { cn } from '@/lib/utils';

const TONE_CLASS: Record<string, string> = {
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  danger: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function PortalStatusBadge({ status }: { status: PublicShipmentStatus }) {
  const tone = PUBLIC_STATUS_TONE[status] ?? 'muted';
  return (
    <Badge variant="outline" className={cn('text-[10px] font-medium', TONE_CLASS[tone])}>
      {PUBLIC_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
