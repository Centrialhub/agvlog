import { ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  DRIVER_DELIVERY_EVENTS,
  type DeliveryEventSelection,
  type DriverStop,
  type EventCategory,
} from './driverDeliveryEvents';

type Props = {
  stop: DriverStop | null;
  onClose: () => void;
  onSelect: (selection: DeliveryEventSelection) => void;
};

const GROUPS: Array<{ category: EventCategory; label: string }> = [
  { category: 'finalizador', label: 'Finalizador' },
  { category: 'informativo', label: 'Informativo' },
];

export function DriverDeliveryEventCatalogSheet({ stop, onClose, onSelect }: Props) {
  return (
    <Sheet open={!!stop} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Listagem de eventos</SheetTitle>
        </SheetHeader>
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
