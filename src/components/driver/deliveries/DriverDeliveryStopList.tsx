import { CheckCircle, ChevronRight, Package, Search, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { stopStatusLabel } from '@/lib/status/stopStatus';
import { getStopOrderNumber, type DriverStop } from './driverDeliveryEvents';

export type DeliveryStopTab = 'em_rota' | 'concluidas';

type Props = {
  search: string;
  tab: DeliveryStopTab;
  filteredStops: DriverStop[];
  completedStops: DriverStop[];
  pendingStopIds: Set<string>;
  onSearchChange: (value: string) => void;
  onTabChange: (value: DeliveryStopTab) => void;
  onOpenStop: (stop: DriverStop) => void;
};

export function DriverDeliveryStopList({
  search,
  tab,
  filteredStops,
  completedStops,
  pendingStopIds,
  onSearchChange,
  onTabChange,
  onOpenStop,
}: Props) {
  return (
    <>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Buscar cliente ou número da nota"
          placeholder="Buscar cliente ou nº da nota"
          className="pl-9 h-10 text-sm"
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => {
        if (value === 'em_rota' || value === 'concluidas') onTabChange(value);
      }}>
        <TabsList className="grid grid-cols-2 w-full h-10">
          <TabsTrigger value="em_rota" className="text-xs">Em Rota ({filteredStops.length})</TabsTrigger>
          <TabsTrigger value="concluidas" className="text-xs">Concluídas ({completedStops.length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3 space-y-2">
          {filteredStops.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? 'Nenhum resultado para a busca.' : 'Nenhuma parada nesta aba.'}
                </p>
              </CardContent>
            </Card>
          ) : filteredStops.map((stop, index) => {
            const orderNumber = getStopOrderNumber(stop);
            const isArrived = stop.status === 'arrived';
            return (
              <Card key={stop.id} className={cn(isArrived && 'border-primary')}>
                <button type="button" onClick={() => onOpenStop(stop)} className="w-full text-left">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-md shrink-0 text-xs font-bold',
                      isArrived ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
                    )}>
                      <span className="relative">
                        <Package className="h-4 w-4" />
                        <span className="absolute -top-2 -right-3 text-[9px] bg-warning text-warning-foreground rounded-full h-3.5 w-3.5 flex items-center justify-center font-bold">
                          {index + 1}
                        </span>
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {stop.clients?.company_name || stop.destination || `Parada ${index + 1}`}
                      </p>
                      {orderNumber && <p className="text-[11px] text-muted-foreground">Pedido: {orderNumber}</p>}
                    </div>
                    {isArrived && <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] mr-1">No local</Badge>}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </button>
              </Card>
            );
          })}

          {tab === 'em_rota' && completedStops.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Concluídas</p>
              {completedStops.map((stop) => (
                <Card key={stop.id} className="opacity-70">
                  <CardContent className="p-3 flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {pendingStopIds.has(stop.id) ? 'Sincronização pendente' : stopStatusLabel(stop.status)}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
