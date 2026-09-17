import { MessageSquare } from 'lucide-react';
import { EventConversation } from '@/components/driver/DriverConversation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DriverOperationalEventItem } from '@/lib/driver/driverOperationalEventHistory';

export function DriverChatSheet({ event, onClose }: {
  event: DriverOperationalEventItem | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!event} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
        {event && (
          <>
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" /> Comunicação com a operação
              </SheetTitle>
              <SheetDescription>{event.description || event.event_type}</SheetDescription>
            </SheetHeader>
            <EventConversation eventId={event.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
