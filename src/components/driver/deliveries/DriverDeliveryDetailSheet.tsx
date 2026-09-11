import { CheckCircle, Package, PenLine } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { isStopTerminal, stopStatusLabel } from '@/lib/status/stopStatus';
import { getStopOrderNumber, type DeliveryEventSelection, type DriverStop } from './driverDeliveryEvents';

type Props = {
  stop: DriverStop | null;
  onClose: () => void;
  onOpenCatalog: (stop: DriverStop) => void;
  onSelectEvent: (selection: DeliveryEventSelection) => void;
};

export function DriverDeliveryDetailSheet({ stop, onClose, onOpenCatalog, onSelectEvent }: Props) {
  return (
    <Sheet open={!!stop} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base text-center">Entrega</SheetTitle>
        </SheetHeader>
        {stop && (
          <div className="space-y-4 mt-2">
            <div className="flex justify-center">
              <Badge variant="secondary" className="bg-primary/10 text-primary px-3 py-1 text-xs">
                Outro: {getStopOrderNumber(stop) || '—'}
              </Badge>
            </div>

            <div className="rounded-lg border border-border overflow-hidden flex">
              <div className="w-1.5 bg-primary" />
              <div className="flex-1 p-3 flex items-start gap-3">
                <div className="h-9 w-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <Package className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-bold truncate">{stop.clients?.company_name || 'Cliente'}</p>
                  {stop.destination && <p className="text-[11px] text-muted-foreground leading-snug">{stop.destination}</p>}
                  {stop.notes && <p className="text-[11px] text-muted-foreground">{stop.notes}</p>}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-xs font-semibold">Saída</p>
                <p className="text-xs text-muted-foreground">
                  {stop.actual_departure_at
                    ? new Date(stop.actual_departure_at).toLocaleString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })
                    : 'Saída não registrada'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold">Previsão</p>
                <p className="text-xs text-muted-foreground">
                  {stop.planned_arrival_at ? new Date(stop.planned_arrival_at).toLocaleString('pt-BR') : 'Sem previsão cadastrada'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
              <span className="text-[11px] text-muted-foreground">Status</span>
              <Badge variant="secondary" className={cn(
                'text-[10px]',
                stop.status === 'arrived' && 'bg-primary/10 text-primary',
                stop.status === 'completed' && 'bg-green-100 text-green-700',
              )}>
                {stopStatusLabel(stop.status)}
              </Badge>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="lg"
                className="flex-1"
                onClick={() => onOpenCatalog(stop)}
                disabled={isStopTerminal(stop.status)}
              >
                <PenLine className="h-4 w-4 mr-1.5" /> Lançar evento
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => onSelectEvent({ stop, eventKey: 'entregue' })}
                disabled={isStopTerminal(stop.status)}
              >
                <CheckCircle className="h-4 w-4 mr-1.5" /> TudoEntregue
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
