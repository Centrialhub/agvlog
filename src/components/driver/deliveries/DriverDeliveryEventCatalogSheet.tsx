import { ChevronRight } from 'lucide-react';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import {
  DRIVER_DELIVERY_EVENTS,
  type DeliveryEventSelection,
  type DriverStop,
  type EventCategory,
} from './driverDeliveryEvents';

type Props = {
  onCloseAutoFocus?: (event: Event) => void;
  stop: DriverStop | null;
  loading?: boolean;
  refreshError?: boolean;
  onRefresh?: () => unknown;
  actionsDisabled?: boolean;
  onClose: () => void;
  onSelect: (selection: DeliveryEventSelection) => void;
};

const GROUPS: Array<{ category: EventCategory; label: string }> = [
  { category: 'finalizador', label: 'Finalizador' },
  { category: 'informativo', label: 'Informativo' },
];

export function DriverDeliveryEventCatalogSheet({ stop, onClose, onSelect, loading = false, refreshError = false, onRefresh, actionsDisabled = false, onCloseAutoFocus }: Props) {
  return (
    <Sheet open={!!stop} onOpenChange={(open) => !open && onClose()}>
      <SheetContent onCloseAutoFocus={onCloseAutoFocus} side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Listagem de eventos</SheetTitle>
          <SheetDescription className="sr-only">Escolha um evento para a entrega selecionada.</SheetDescription>
        </SheetHeader>
        {refreshError && <div role="alert" className="space-y-2 text-sm">
          <p>Não foi possível atualizar esta entrega. Tente novamente antes de lançar um evento.</p>
          {onRefresh && <button type="button" onClick={() => void onRefresh()}>Tentar novamente</button>}
        </div>}
        {loading && <p role="status">Atualizando os dados desta entrega. Aguarde antes de lançar um evento.</p>}
        {stop && isStopTerminal(stop.status) && <p role="alert">Esta parada foi encerrada. Não é possível lançar outro evento.</p>}
        <div className="space-y-4 mt-2">
          {GROUPS.map((group) => (
            <div key={group.category} className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
              {DRIVER_DELIVERY_EVENTS.filter((event) => event.category === group.category).map((event) => {
                const Icon = event.icon;
                return (
                  <button
                    key={event.key}
                    type="button"
                    disabled={actionsDisabled || loading || !stop || isStopTerminal(stop.status)}
                    onClick={() => stop && onSelect({ stop, eventKey: event.key })}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{event.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
