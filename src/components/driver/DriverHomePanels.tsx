import { AlertTriangle, ClipboardCheck, Clock, FileText, Map } from 'lucide-react';
import DriverDeliveryMap, { type DeliveryPoint, type VehiclePoint } from '@/components/driver/DriverDeliveryMap';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function DriverHomeLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="p-4 space-y-3" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Falha ao carregar a operação</p>
            <p className="text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>
      </CardContent>
    </Card>
  );
}

export function DriverHomeVehiclePositionError({
  refreshing,
  onRetry,
}: {
  refreshing: boolean;
  onRetry: () => void;
}) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="p-4 space-y-3" role="alert">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">Posição do veículo indisponível</p>
            <p className="text-xs text-muted-foreground">
              Não foi possível atualizar a localização. As paradas e demais dados da viagem continuam disponíveis.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={onRetry}>
          {refreshing ? 'Atualizando posição…' : 'Tentar atualizar posição'}
        </Button>
      </CardContent>
    </Card>
  );
}

export function DriverHomeChecklistAlert({
  preCompleted,
  preCheckedCount,
  preTotalCount,
  postCheckedCount,
  postTotalCount,
  onOpen,
}: {
  preCompleted: boolean;
  preCheckedCount: number;
  preTotalCount: number;
  postCheckedCount: number;
  postTotalCount: number;
  onOpen: () => void;
}) {
  return (
    <Card className="border-warning/50 bg-warning/5 cursor-pointer hover:bg-warning/10 transition-colors"
      role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}>
      <CardContent className="p-3 flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-medium">Checklist pendente</p>
          <p className="text-[10px] text-muted-foreground">
            {preCompleted
              ? `Pós-viagem: ${postCheckedCount}/${postTotalCount} itens`
              : `Pré-viagem: ${preCheckedCount}/${preTotalCount} itens`}
          </p>
        </div>
        <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

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
