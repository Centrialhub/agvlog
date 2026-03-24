import { Card, CardContent } from '@/components/ui/card';
import { MapPin } from 'lucide-react';

export default function DriverStops() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Paradas</h1>
      <Card>
        <CardContent className="py-8 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma parada programada.</p>
          <p className="text-xs text-muted-foreground mt-1">As paradas aparecerão aqui quando uma viagem estiver ativa.</p>
        </CardContent>
      </Card>
    </div>
  );
}
