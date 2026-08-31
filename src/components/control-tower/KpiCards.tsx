import { Card } from '@/components/ui/card';
import type { ActiveTripLive } from '@/lib/controlTower/types';

export default function KpiCards({ trips }: { trips: ActiveTripLive[] }) {
  const total = trips.length;
  const normal = trips.filter((t) => t.state === 'normal' || t.state === 'arriving' || t.state === 'at_stop').length;
  const delayed = trips.filter((t) => t.state === 'delayed').length;
  const offRoute = trips.filter((t) => t.state === 'off_route').length;
  const stopped = trips.filter((t) => t.state === 'stopped').length;
  const noSignal = trips.filter((t) => t.state === 'no_signal').length;

  const items = [
    { label: 'Viagens ativas', value: total, tone: 'text-foreground' },
    { label: 'Normais', value: normal, tone: 'text-emerald-500' },
    { label: 'Atrasados', value: delayed, tone: 'text-orange-500' },
    { label: 'Fora da rota', value: offRoute, tone: 'text-red-600' },
    { label: 'Parados', value: stopped, tone: 'text-yellow-500' },
    { label: 'Sem sinal', value: noSignal, tone: 'text-muted-foreground' },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((i) => (
        <Card key={i.label} className="p-2.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{i.label}</p>
          <p className={`text-2xl font-bold tabular-nums ${i.tone}`}>{i.value}</p>
        </Card>
      ))}
    </div>
  );
}
