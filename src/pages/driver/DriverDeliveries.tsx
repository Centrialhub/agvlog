import { useState, useRef, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Package, CheckCircle, AlertTriangle, Truck, Camera, X, ImageIcon,
  ChevronRight, ChevronDown, Search, PenLine, FileSignature,
  Ban, AlertCircle, PackageX, MapPinned, UserX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import SignaturePad from '@/components/driver/SignaturePad';

// ====== Catálogo de eventos (inspirado no app de referência) ======
type EventCategory = 'finalizador' | 'informativo';
type EventDef = {
  key: string;          // event_subtype salvo em payload
  label: string;
  icon: React.ComponentType<any>;
  category: EventCategory;
  finalAction?: 'delivered' | 'partial' | 'refused'; // o que aciona no stop
  requiresReceiver?: boolean;
  requiresPhoto?: boolean;
  requiresSignature?: boolean;
};

const EVENTS: EventDef[] = [
  { key: 'entregue',            label: 'ENTREGUE',          icon: CheckCircle, category: 'finalizador', finalAction: 'delivered', requiresReceiver: true, requiresPhoto: true, requiresSignature: true },
  { key: 'entrega_cancelada',   label: 'ENTREGA CANCELADA', icon: Ban,         category: 'finalizador', finalAction: 'refused' },
  { key: 'avaria',              label: 'AVARIA',            icon: AlertCircle, category: 'informativo', requiresPhoto: true },
  { key: 'cliente_recusou',     label: 'CLIENTE RECUSOU',   icon: PackageX,    category: 'informativo' },
  { key: 'coleta_realizada',    label: 'COLETA REALIZADA',  icon: Package,     category: 'informativo', requiresPhoto: true },
  { key: 'chegada_no_cliente',  label: 'CHEGADA NO CLIENTE',icon: MapPinned,   category: 'informativo' },
  { key: 'cliente_estava_fora', label: 'CLIENTE ESTAVA FORA',icon: UserX,      category: 'informativo' },
];

function getEventDef(key: string) {
  return EVENTS.find(e => e.key === key);
}

// ====== Helpers ======
function getStopOrderNumber(stop: any): string | null {
  // Procura nº pedido/nota em vários campos prováveis
  const candidates = [stop?.order_number, stop?.invoice_number, stop?.reference, stop?.external_id];
  for (const c of candidates) if (c) return String(c);
  // fallback: extrai dígitos do notes
  if (stop?.notes) {
    const m = String(stop.notes).match(/\d{4,}/);
    if (m) return m[0];
  }
  return null;
}

export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);

  const [tab, setTab] = useState<'em_rota' | 'planejadas'>('em_rota');
  const [search, setSearch] = useState('');
  const [expandedStop, setExpandedStop] = useState<string | null>(null);

  // catálogo de eventos do stop selecionado
  const [eventCatalogStop, setEventCatalogStop] = useState<any | null>(null);
  // formulário "Dados do evento"
  const [eventForm, setEventForm] = useState<{ stop: any; eventKey: string } | null>(null);

  const [receiverName, setReceiverName] = useState('');
  const [receiverDoc, setReceiverDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const { data: stops = [] } = useQuery({
    queryKey: ['driver_delivery_stops', trip?.id],
    queryFn: async () => {
      if (!trip) return [];
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

  const filteredStops = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = stops as any[];
    if (tab === 'em_rota') {
      list = list.filter((s) => s.status === 'arrived' || s.status === 'pending');
    } else {
      list = list.filter((s) => s.status === 'pending');
    }
    if (!q) return list;
    return list.filter((s) => {
      const name = (s.clients?.company_name || s.destination || '').toLowerCase();
      const order = (getStopOrderNumber(s) || '').toLowerCase();
      const notes = (s.notes || '').toLowerCase();
      return name.includes(q) || order.includes(q) || notes.includes(q);
    });
  }, [stops, search, tab]);

  const completedStops = (stops as any[]).filter((s) => s.status === 'completed');

  const resetForm = () => {
    setEventForm(null);
    setReceiverName('');
    setReceiverDoc('');
    setNotes('');
    setPhotos([]);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews([]);
    setSignatureDataUrl(null);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const next = [...photos, ...files].slice(0, 5);
    setPhotos(next);
    photoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setPhotoPreviews(next.map((f) => URL.createObjectURL(f)));
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviews[idx]);
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const submitEvent = useMutation({
    mutationFn: async () => {
      if (!eventForm) throw new Error('Sem evento');
      const def = getEventDef(eventForm.eventKey);
      if (!def) throw new Error('Evento inválido');

      const photoPaths: string[] = [];
      for (const photo of photos) {
        const ext = photo.name.split('.').pop() || 'jpg';
        const path = `${currentTenant!.id}/deliveries/${trip!.id}/${eventForm.stop.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from('receipts').upload(path, photo, { contentType: photo.type });
        if (error) throw error;
        photoPaths.push(path);
      }

      let signaturePath: string | null = null;
      if (signatureDataUrl) {
        const blob = await (await fetch(signatureDataUrl)).blob();
        const path = `${currentTenant!.id}/deliveries/${trip!.id}/${eventForm.stop.id}/signature_${Date.now()}.png`;
        const { error } = await supabase.storage.from('receipts').upload(path, blob, { contentType: 'image/png' });
        if (error) throw error;
        signaturePath = path;
      }

      const { error: evtErr } = await supabase.from('dispatch_events').insert({
        tenant_id: currentTenant!.id,
        dispatch_trip_id: trip!.id,
        dispatch_stop_id: eventForm.stop.id,
        event_type: def.finalAction ? `delivery_${def.finalAction}` : `info_${def.key}`,
        notes: notes || null,
        payload: {
          event_subtype: def.key,
          event_label: def.label,
          receiver_name: receiverName.trim() || null,
          receiver_document: receiverDoc.trim() || null,
          photo_paths: photoPaths,
          photo_count: photoPaths.length,
          signature_path: signaturePath,
        },
      } as any);
      if (evtErr) throw evtErr;

      // Se for finalizador, atualiza o stop
      if (def.finalAction) {
        const { error: stopErr } = await supabase
          .from('dispatch_stops')
          .update({
            status: 'completed',
            actual_departure_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            notes: notes ? `${def.label}: ${notes}` : null,
          })
          .eq('id', eventForm.stop.id);
        if (stopErr) throw stopErr;
      } else if (def.key === 'chegada_no_cliente' && eventForm.stop.status === 'pending') {
        await supabase
          .from('dispatch_stops')
          .update({ status: 'arrived', actual_arrival_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', eventForm.stop.id);
      }
    },
    onSuccess: () => {
      toast({ title: 'Evento lançado com sucesso' });
      resetForm();
      setEventCatalogStop(null);
      qc.invalidateQueries({ queryKey: ['driver_delivery_stops'] });
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const def = eventForm ? getEventDef(eventForm.eventKey) : null;
  const canSubmit =
    !!def &&
    (!def.requiresReceiver || receiverName.trim().length >= 2) &&
    (!def.requiresPhoto || photos.length >= 1) &&
    (!def.requiresSignature || !!signatureDataUrl);

  if (!trip) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Entregas e Coletas</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma viagem ativa.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Entregas e Coletas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {(trip as any).loads?.load_number || '—'} · {completedStops.length}/{stops.length} concluídas
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente ou nº da nota"
          className="pl-9 h-10 text-sm"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="grid grid-cols-2 w-full h-10">
          <TabsTrigger value="em_rota" className="text-xs">Em Rota</TabsTrigger>
          <TabsTrigger value="planejadas" className="text-xs">Planejadas</TabsTrigger>
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
          ) : (
            filteredStops.map((stop: any, idx: number) => {
              const isExpanded = expandedStop === stop.id;
              const orderNum = getStopOrderNumber(stop);
              const isArrived = stop.status === 'arrived';
              return (
                <Card key={stop.id} className={cn(isArrived && 'border-primary')}>
                  <button
                    type="button"
                    onClick={() => setExpandedStop(isExpanded ? null : stop.id)}
                    className="w-full text-left"
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md shrink-0 text-xs font-bold',
                        isArrived ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'
                      )}>
                        <span className="relative">
                          <Package className="h-4 w-4" />
                          <span className="absolute -top-2 -right-3 text-[9px] bg-warning text-warning-foreground rounded-full h-3.5 w-3.5 flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {stop.clients?.company_name || stop.destination || `Parada ${idx + 1}`}
                        </p>
                        {orderNum && (
                          <p className="text-[11px] text-muted-foreground">
                            Pedido: {orderNum}
                          </p>
                        )}
                      </div>
                      {isArrived && (
                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] mr-1">No local</Badge>
                      )}
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </CardContent>
                  </button>

                  {isExpanded && (
                    <CardContent className="p-3 pt-0 space-y-2 border-t border-border">
                      {stop.destination && (
                        <p className="text-xs text-muted-foreground">{stop.destination}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => setEventCatalogStop(stop)}
                        >
                          <PenLine className="h-3.5 w-3.5 mr-1" /> Lançar evento
                        </Button>
                        <Button
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => setEventForm({ stop, eventKey: 'entregue' })}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> TudoEntregue
                        </Button>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })
          )}

          {tab === 'em_rota' && completedStops.length > 0 && (
            <div className="pt-2 space-y-2">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Concluídas</p>
              {completedStops.map((stop: any) => (
                <Card key={stop.id} className="opacity-70">
                  <CardContent className="p-3 flex items-center gap-3">
                    <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">OK</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Sheet: Catálogo de eventos */}
      <Sheet open={!!eventCatalogStop} onOpenChange={(o) => !o && setEventCatalogStop(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Listagem de eventos</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Finalizador</p>
              {EVENTS.filter((e) => e.category === 'finalizador').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Informativo</p>
              {EVENTS.filter((e) => e.category === 'informativo').map((e) => {
                const Icon = e.icon;
                return (
                  <button
                    key={e.key}
                    onClick={() => {
                      setEventForm({ stop: eventCatalogStop, eventKey: e.key });
                      setEventCatalogStop(null);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-md border border-border hover:bg-accent active:bg-accent/70 transition-colors"
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm font-medium flex-1 text-left">{e.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Sheet: Dados do evento */}
      <Sheet open={!!eventForm} onOpenChange={(o) => !o && resetForm()}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[92vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Dados do evento</SheetTitle>
          </SheetHeader>
          {def && (
            <div className="space-y-4 mt-2">
              <div className="bg-primary/10 text-primary rounded-md px-3 py-2 text-sm font-medium flex items-center gap-2">
                <def.icon className="h-4 w-4" />
                Evento: <span className="font-bold">{def.label}</span>
              </div>

              {/* Recebedor */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  Recebedor {def.requiresReceiver && <span className="text-destructive">*</span>}
                </Label>
                <Input
                  placeholder="Digite o nome aqui"
                  value={receiverName}
                  onChange={(e) => setReceiverName(e.target.value)}
                  className="text-sm h-10"
                  maxLength={120}
                />
              </div>

              {/* Documento */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Número do documento</Label>
                <Input
                  placeholder="RG/CPF"
                  value={receiverDoc}
                  onChange={(e) => setReceiverDoc(e.target.value)}
                  className="text-sm h-10"
                  inputMode="numeric"
                  maxLength={20}
                />
              </div>

              {/* Observações */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Observações</Label>
                <Textarea
                  placeholder="Observações"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="text-sm"
                  maxLength={500}
                />
              </div>

              {/* Fotos preview */}
              {photoPreviews.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Fotos <span className="text-muted-foreground font-normal">({photos.length}/5)</span>
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {photoPreviews.map((url, i) => (
                      <div key={i} className="relative aspect-square rounded-md overflow-hidden border border-border">
                        <img src={url} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assinatura inline */}
              {def.requiresSignature && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Assinatura <span className="text-destructive">*</span>
                  </Label>
                  <SignaturePad onChange={setSignatureDataUrl} />
                </div>
              )}

              {/* Action grid: Assinatura | Câmera | Galeria */}
              <div className="grid grid-cols-3 gap-2">
                <ActionButton
                  icon={FileSignature}
                  label="Assinatura"
                  active={!!signatureDataUrl}
                  onClick={() => {
                    // se não estiver visível ainda, força requisitos
                    if (!def.requiresSignature) {
                      toast({ title: 'Assinatura opcional', description: 'Use o quadro abaixo para assinar.' });
                    }
                    document.getElementById('sig-anchor')?.scrollIntoView({ behavior: 'smooth' });
                  }}
                />
                <ActionButton
                  icon={Camera}
                  label="Câmera"
                  active={photos.length > 0}
                  onClick={() => cameraInputRef.current?.click()}
                />
                <ActionButton
                  icon={ImageIcon}
                  label="Galeria"
                  active={photos.length > 0}
                  onClick={() => galleryInputRef.current?.click()}
                />
              </div>

              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />

              <div id="sig-anchor" />

              {/* Fallback signature pad para finalizador requerido — já renderizado acima quando required */}

              {/* Validação */}
              {!canSubmit && (
                <div className="bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
                  {def.requiresReceiver && receiverName.trim().length < 2 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Informe o nome do recebedor
                    </p>
                  )}
                  {def.requiresPhoto && photos.length === 0 && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Adicione pelo menos 1 foto
                    </p>
                  )}
                  {def.requiresSignature && !signatureDataUrl && (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-warning" /> Capture a assinatura
                    </p>
                  )}
                </div>
              )}

              <Button
                size="lg"
                className="w-full"
                onClick={() => submitEvent.mutate()}
                disabled={!canSubmit || submitEvent.isPending}
              >
                {submitEvent.isPending ? 'Enviando...' : 'Lançar evento'}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ActionButton({
  icon: Icon, label, active, onClick,
}: { icon: React.ComponentType<any>; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 py-3 rounded-md border transition-colors min-h-16',
        active
          ? 'border-primary bg-primary/5 text-primary'
          : 'border-border hover:bg-accent active:bg-accent/70 text-foreground'
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}