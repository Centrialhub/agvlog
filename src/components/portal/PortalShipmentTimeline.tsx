import { TimelineEntry } from '@/hooks/portal/usePortalShipmentDetail';
import { CheckCircle2, AlertTriangle, Package, Truck, ClipboardCheck, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS = {
  document: Package,
  status: Truck,
  event: Info,
  occurrence: AlertTriangle,
  pod: ClipboardCheck,
  pickup: Package,
} as const;

const TONE: Record<string, string> = {
  success: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40',
  warning: 'text-amber-600 bg-amber-100 dark:bg-amber-950/40',
  danger: 'text-rose-600 bg-rose-100 dark:bg-rose-950/40',
  info: 'text-sky-600 bg-sky-100 dark:bg-sky-950/40',
};

const fmt = (d: string) => new Date(d).toLocaleString('pt-BR');

export function PortalShipmentTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries || entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>;
  }
  return (
    <ol className="relative border-l border-border ml-3 space-y-4 pl-6">
      {entries.map((e) => {
        const Icon = ICONS[e.type] ?? Info;
        const tone = TONE[e.severity ?? 'info'];
        return (
          <li key={e.id} className="relative">
            <span className={cn('absolute -left-[34px] top-0 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-background', tone)}>
              <Icon className="h-3 w-3" />
            </span>
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-medium">{e.title}</p>
              <span className="text-[11px] text-muted-foreground tabular-nums">{fmt(e.occurred_at)}</span>
            </div>
            {e.description && <p className="text-xs text-muted-foreground mt-0.5">{e.description}</p>}
          </li>
        );
      })}
    </ol>
  );
}

export { CheckCircle2 };
