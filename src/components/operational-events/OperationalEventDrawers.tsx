import type React from 'react';
import { Building2, CheckCircle, Copy, MapPinned, Package, Truck, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DriverConversation, EventConversation } from '@/components/driver/DriverConversation';
import { useToast } from '@/hooks/use-toast';
import { formatOccurrenceReport } from '@/lib/occurrenceTemplate';
import { fmtDateTimeInTimeZone } from '@/lib/utils/formatDate';
import { EVENT_TYPE_LABELS, SEVERITY_LABELS, type OperationalEvent } from '@/hooks/useOperationalEvents';
import type { Json } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';

export const TYPE_COLORS: Record<string, string> = {
  missing_goods: '#ec4899',
  wrong_quantity: '#f59e0b',
  client_refused: '#ef4444',
  no_order: '#6366f1',
  expired_goods: '#8b5cf6',
  near_expiration: '#a855f7',
  damaged: '#0ea5e9',
  wrong_address: '#10b981',
  partial_delivery: '#14b8a6',
  return: '#f97316',
  other: '#64748b',
};

function jsonRecord(value: Json | null | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function reportDetail(event: OperationalEvent, ...keys: string[]): Json | undefined {
  const details = jsonRecord(event.report_details);
  for (const key of keys) {
    if (details?.[key] !== undefined) return details[key];
  }
  return undefined;
}


export function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`mt-1 inline-flex items-center text-xl font-bold rounded-md px-2 py-0.5 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export function EventDetailDrawer({ event, timeZone, onClose, onResolve, isResolving }: { event: OperationalEvent | null; timeZone: string; onClose: () => void; onResolve: (e: OperationalEvent) => void; isResolving: boolean }) {
  const isOpen = !!event;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {event && (
          <>
            <SheetHeader className="p-5 border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[event.event_type] || '#64748b' }} />
                    {EVENT_TYPE_LABELS[event.event_type as keyof typeof EVENT_TYPE_LABELS] || event.event_type}
                  </SheetTitle>
                  <SheetDescription>
                    {fmtDateTimeInTimeZone(event.created_at, timeZone)}
                    {' · '}
                    {SEVERITY_LABELS[event.severity] || event.severity}
                  </SheetDescription>
                </div>
                {!event.resolved_at && (
                  <Button size="sm" variant="outline" onClick={() => onResolve(event)} disabled={isResolving}>
                    <CheckCircle className="h-4 w-4 mr-1 text-success" /> {isResolving ? 'Resolvendo…' : 'Resolver'}
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="p-5 space-y-3 border-b bg-muted/20">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow icon={<Package className="h-3.5 w-3.5" />} label="Carga" value={event.loads?.load_number || '—'} />
                <InfoRow
                  icon={<MapPinned className="h-3.5 w-3.5" />}
                  label="Parada"
                  value={reportDetail(event, 'stop_order') ? `Parada ${String(reportDetail(event, 'stop_order'))}` : '—'}
                />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Cliente" value={event.clients?.company_name || '—'} />
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Motorista" value={event.drivers?.name || '—'} />
                <InfoRow icon={<Truck className="h-3.5 w-3.5" />} label="Impacto" value={event.financial_impact ? `R$ ${Number(event.financial_impact).toLocaleString('pt-BR')}` : '—'} />
              </div>
              <SupplierTextBlock event={event} />
              {event.description && (
                <div className="text-sm bg-background rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Descrição</div>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{event.description}</pre>
                </div>
              )}
              {event.resolution && (
                <div className="text-sm bg-success/5 border border-success/20 rounded-md p-3">
                  <div className="text-[10px] uppercase tracking-wide text-success mb-1">Resolução</div>
                  {event.resolution}
                </div>
              )}
            </div>

            <EventChat eventId={event.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate">{value}</div>
      </div>
    </div>
  );
}

function SupplierTextBlock({ event }: { event: OperationalEvent }) {
  const { toast } = useToast();
  const text = formatOccurrenceReport(event.event_type, jsonRecord(event.report_details));
  if (!text) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Texto copiado', description: 'Pronto para enviar ao fornecedor.' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };
  return (
    <div className="text-sm bg-background rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Texto para fornecedor</div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copy}>
          <Copy className="h-3 w-3 mr-1" /> Copiar
        </Button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{text}</pre>
    </div>
  );
}

function EventChat({ eventId }: { eventId: string }) {
  return <EventConversation eventId={eventId}/>;
}

export function DriverChatDrawer({ driver, onClose }: { driver: { id: string; name: string } | null; onClose: () => void }) {
  const isOpen = !!driver;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {driver && (
          <>
            <SheetHeader className="p-5 border-b">
              <SheetTitle className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Chat direto — {driver.name}
              </SheetTitle>
              <SheetDescription>
                Conversa em tempo real com o motorista (independente de uma ocorrência específica).
              </SheetDescription>
            </SheetHeader>
            <DriverChat driverId={driver.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DriverChat({ driverId }: { driverId: string }) {
  return <DriverConversation driverId={driverId} />;
}
