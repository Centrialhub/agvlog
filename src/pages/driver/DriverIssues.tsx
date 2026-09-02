import { useState, useEffect, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Plus, Clock, MessageSquare } from 'lucide-react';

import { EventConversation } from '@/components/driver/DriverConversation';
import { OCCURRENCE_TEMPLATES, getTemplateFields, formatOccurrenceReport } from '@/lib/occurrenceTemplate';
import { EVENT_TYPE_LABELS, OperationalEventType } from '@/hooks/useOperationalEvents';
import { buildDriverOccurrenceRpcArgs } from '@/lib/driver/driverOccurrence';
import { useDriverOperationalEventHistory } from '@/hooks/useDriverOperationalEventHistory';
import type { DriverOperationalEventItem } from '@/lib/driver/driverOperationalEventHistory';

// Tipos com modelo padronizado (texto pronto para o fornecedor) + tipos genéricos para casos do dia-a-dia.
const TEMPLATE_TYPES = Object.keys(OCCURRENCE_TEMPLATES) as OperationalEventType[];
const GENERIC_TYPES: OperationalEventType[] = ['damaged', 'wrong_address', 'wrong_quantity', 'partial_delivery', 'return', 'other'];
const ISSUE_TYPES = [...TEMPLATE_TYPES, ...GENERIC_TYPES].map(v => ({
  value: v,
  label: EVENT_TYPE_LABELS[v] || v,
}));

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
];


export default function DriverIssues() {
  const { currentTenant } = useTenant();
  const {user}=useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  const [open, setOpen] = useState(false);
  const fieldPrefix = useId();
  const [form, setForm] = useState<{ event_type: string; severity: string; description: string; details: Record<string, unknown> }>({
    event_type: 'missing_goods', severity: 'medium', description: '', details: {},
  });

  const {
    data: eventHistory,
    error: eventsError,
    isPending: eventsPending,
    refetch: refetchEvents,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDriverOperationalEventHistory({
    driverId: driver?.id,
    enabled: !!currentTenant && !!user,
  });
  const events = eventHistory?.items ?? [];

  const { data: stops = [] } = useQuery({
    queryKey: ['driver_trip_stops_for_issues', trip?.id],
    queryFn: async () => {
      if (!trip?.id) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name)')
        .eq('dispatch_trip_id', trip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id,
  });

  // Realtime: refletir mudanças (severidade, status, novas ocorrências) sem reabrir a tela.
  useEffect(() => {
    if (!driver?.id) return undefined;
    const channel = supabase
      .channel(`driver_issues_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'operational_events', filter: `driver_id=eq.${driver.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_operational_event_history'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, qc]);

  const createIssue = useMutation({
    mutationFn: async () => {
      const report = formatOccurrenceReport(form.event_type, form.details);
      const description = report || form.description || null;
      if (!currentTenant || !driver || !trip) throw new Error('Sem viagem ativa.');
      
      try {
        const { error, data } = await supabase.rpc(
          'driver_create_operational_occurrence',
          buildDriverOccurrenceRpcArgs({
            tripId: trip.id,
            eventType: form.event_type,
            description: description || '',
            severity: form.severity,
            stopId: typeof form.details.stop_id === 'string' ? form.details.stop_id : null,
            clientId: typeof form.details.client_id === 'string' ? form.details.client_id : null,
          }),
        );
        
        if (error) {
          console.error('[DriverIssues] RPC error:', error);
          throw error;
        }
        return data;
      } catch (error: unknown) {
        console.error('[DriverIssues] Mutation error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Ocorrência registrada' });
      setOpen(false);
      setForm({ event_type: 'missing_goods', severity: 'medium', description: '', details: {} });
      qc.invalidateQueries({ queryKey: ['driver_operational_event_history'] });
    },
    onError: (error: unknown) => toast({
      title: 'Erro',
      description: error instanceof Error ? error.message : 'Não foi possível registrar a ocorrência.',
      variant: 'destructive',
    }),
  });

  const effectiveEvents = driver && !eventsError ? events : [];
  const [chatEvent, setChatEvent] = useState<DriverOperationalEventItem | null>(null);

  const severityColors: Record<string, string> = {
    low: 'bg-muted text-muted-foreground',
    medium: 'bg-amber-100 text-amber-700',
    high: 'bg-destructive/10 text-destructive',
  };

  const templateFields = getTemplateFields(form.event_type);
  const previewText = formatOccurrenceReport(form.event_type, form.details);
  const setDetail = (key: string, value: unknown) => setForm((current) => ({
    ...current,
    details: { ...current.details, [key]: value },
  }));
  const detailText = (key: string): string => {
    const value = form.details[key];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  };
  const allRequiredFilled = templateFields.filter(f => f.required).every(f => {
    const v = form.details[f.key];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Ocorrências</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nova Ocorrência</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {trip && (
                <div>
                  <Label htmlFor={`${fieldPrefix}-stop`} className="text-xs">Parada / Cliente (opcional)</Label>
                  <Select 
                    value={detailText('stop_id') || "none"}
                    onValueChange={v => {
                      const stop = stops.find((candidate) => candidate.id === v);
                      setForm(f => ({ 
                        ...f, 
                        details: { 
                          ...f.details, 
                          stop_id: v === "none" ? null : v,
                          client_id: stop?.client_id || null,
                          razao_social: v === "none" ? '' : (stop?.clients?.company_name || f.details.razao_social)
                        } 
                      }));
                    }}
                  >
                    <SelectTrigger id={`${fieldPrefix}-stop`} className="h-9">
                      <SelectValue placeholder="Selecione a parada..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma específica</SelectItem>
                      {stops.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.stop_order}. {s.clients?.company_name || s.destination}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor={`${fieldPrefix}-type`} className="text-xs">Tipo</Label>
                <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v, details: { ...f.details } }))}>
                  <SelectTrigger id={`${fieldPrefix}-type`} className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ISSUE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor={`${fieldPrefix}-severity`} className="text-xs">Severidade</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger id={`${fieldPrefix}-severity`} className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {templateFields.length > 0 ? (
                <>
                  <div className="rounded-md border bg-muted/30 p-2 text-[10px] text-muted-foreground">
                    Preencha os campos abaixo para gerar automaticamente o texto que será enviado ao fornecedor.
                  </div>
                  {templateFields.map(f => {
                    const fieldId = `${fieldPrefix}-detail-${f.key}`;
                    return (
                    <div key={f.key}>
                      <Label htmlFor={fieldId} className="text-xs">{f.label}{f.required && ' *'}</Label>
                      {f.type === 'textarea' ? (
                        <Textarea
                          id={fieldId}
                          rows={2}
                          className="text-sm"
                          placeholder={f.placeholder}
                          value={detailText(f.key)}
                          onChange={e => setDetail(f.key, e.target.value)}
                        />
                      ) : f.type === 'select' ? (
                        <Select value={detailText(f.key)} onValueChange={v => setDetail(f.key, v)}>
                          <SelectTrigger id={fieldId} className="h-9"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                          <SelectContent>
                            {(f.options || []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : f.type === 'date' ? (
                        <Input id={fieldId} type="date" className="h-9 text-sm" value={detailText(f.key)} onChange={e => setDetail(f.key, e.target.value)} />
                      ) : (
                        <Input id={fieldId} className="h-9 text-sm" placeholder={f.placeholder} value={detailText(f.key)} onChange={e => setDetail(f.key, e.target.value)} />
                      )}
                    </div>
                  );})}
                  {previewText && (
                    <div className="rounded-md border bg-background p-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Pré-visualização (para fornecedor)</div>
                      <pre className="text-[11px] whitespace-pre-wrap leading-snug">{previewText}</pre>
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <Label htmlFor={`${fieldPrefix}-description`} className="text-xs">Descrição</Label>
                  <Textarea id={`${fieldPrefix}-description`} rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Descreva o ocorrido..." className="text-sm" />
                </div>
              )}

              <Button
                className="w-full"
                size="sm"
                onClick={() => createIssue.mutate()}
                disabled={
                  createIssue.isPending ||
                  (templateFields.length > 0 && !allRequiredFilled) ||
                  (templateFields.length === 0 && !form.description.trim())
                }
              >
                {createIssue.isPending ? 'Salvando...' : 'Registrar Ocorrência'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>


      {eventsError ? <div role="alert">Não foi possível consultar as ocorrências. <Button onClick={()=>void refetchEvents()}>Tentar novamente</Button></div> : eventsPending && driver ? <p role="status">Carregando ocorrências...</p> : effectiveEvents.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {effectiveEvents.map((evt) => {
            const typeLabel = EVENT_TYPE_LABELS[evt.event_type as OperationalEventType] || ISSUE_TYPES.find(t => t.value === evt.event_type)?.label || evt.event_type;
            return (
              <Card
                key={evt.id}
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                role="button"
                tabIndex={0}
                onClick={() => setChatEvent(evt)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setChatEvent(evt);
                  }
                }}
              >
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{typeLabel}</p>
                    <Badge className={`text-[10px] ${severityColors[evt.severity] || ''}`} variant="secondary">{evt.severity}</Badge>
                  </div>
                  {evt.description && <p className="text-xs text-muted-foreground">{evt.description}</p>}
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(evt.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="flex items-center gap-1 text-primary">
                      <MessageSquare className="h-2.5 w-2.5" /> Chat
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {hasNextPage && (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Carregando mais ocorrências...' : 'Carregar mais ocorrências'}
            </Button>
          )}
        </div>
      )}

      <DriverChatSheet
        event={effectiveEvents.find(event=>event.id===chatEvent?.id)??null}
        onClose={() => setChatEvent(null)}
      />
    </div>
  );
}

function DriverChatSheet({ event, onClose }: {
  event: DriverOperationalEventItem | null;
  onClose: () => void;
}) {
  const isOpen = !!event;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
        {event && (
          <>
            <SheetHeader className="p-4 border-b">
              <SheetTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" /> Comunicação com a operação
              </SheetTitle>
              <SheetDescription>{event.description || event.event_type}</SheetDescription>
            </SheetHeader>
            <DriverChat eventId={event.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DriverChat({ eventId }: { eventId: string }) {
  return <EventConversation eventId={eventId}/>;
}
