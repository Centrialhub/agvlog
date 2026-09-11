import { AlertTriangle, ClipboardCheck, Clock, FileText, Map } from 'lucide-react';
import DriverDeliveryMap, { type DeliveryPoint, type VehiclePoint } from '@/components/driver/DriverDeliveryMap';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

export function DriverHomeDeliveryMap({ stops, vehicle }: { stops: DeliveryPoint[]; vehicle: VehiclePoint }) {
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Mapa das entregas</span>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {stops.filter((stop) => stop.status === 'done').length}/{stops.length} entregues
          </Badge>
        </div>
        <DriverDeliveryMap stops={stops} vehicle={vehicle} height={240} />
        <div className="flex items-center justify-around text-[10px] text-muted-foreground pt-1">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-success" /> Entregue</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> Atual</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Pendente</span>
        </div>
      </CardContent>
    </Card>
  );
}

const actions = [
  { path: '/driver/journey', label: 'Jornada', icon: Clock },
  { path: '/driver/checklist', label: 'Checklist', icon: ClipboardCheck },
  { path: '/driver/events', label: 'Eventos', icon: FileText },
  { path: '/driver/issues', label: 'Ocorrências', icon: AlertTriangle, wide: true },
];

export function DriverHomeQuickActions({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map(({ path, label, icon: Icon, wide }) => (
        <Card key={path} className={`cursor-pointer hover:bg-accent/50 transition-colors${wide ? ' col-span-2' : ''}`}
          role="button" tabIndex={0} onClick={() => onNavigate(path)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate(path); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">{label}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
