import { useState, useRef } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, CheckCircle, AlertTriangle, Truck, Camera, X, ImageIcon } from 'lucide-react';

const DELIVERY_ACTIONS = [
  { key: 'delivered', label: 'Entregue', icon: CheckCircle, variant: 'default' as const },
  { key: 'partial', label: 'Entrega Parcial', icon: Package, variant: 'secondary' as const },
  { key: 'refused', label: 'Recusada', icon: AlertTriangle, variant: 'destructive' as const },
];

export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  const [actionDialog, setActionDialog] = useState<{ stopId: string; action: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const resetDialog = () => {
    setActionDialog(null);
    setNotes('');
    setReceiverName('');
    setPhotos([]);
    photoPreviews.forEach(url => URL.revokeObjectURL(url));
    setPhotoPreviews([]);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const newPhotos = [...photos, ...files].slice(0, 5);
    setPhotos(newPhotos);
    const newPreviews = newPhotos.map(f => URL.createObjectURL(f));
    photoPreviews.forEach(url => URL.revokeObjectURL(url));
    setPhotoPreviews(newPreviews);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePhoto = (idx: number) => {
    URL.revokeObjectURL(photoPreviews[idx]);
    setPhotos(prev => prev.filter((_, i) => i !== idx));
    setPhotoPreviews(prev => prev.filter((_, i) => i !== idx));
  };

  const recordDelivery = useMutation({
    mutationFn: async ({ stopId, action, notes }: { stopId: string; action: string; notes: string }) => {
      // Upload photos
      const photoUrls: string[] = [];
      for (const photo of photos) {
        const ext = photo.name.split('.').pop() || 'jpg';
        const path = `${currentTenant!.id}/deliveries/${trip!.id}/${stopId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('receipts')
          .upload(path, photo, { contentType: photo.type });
        if (upErr) throw upErr;
        photoUrls.push(path);
      }

      // Insert delivery event with photos and receiver
      const { error: evtErr } = await supabase.from('dispatch_events').insert({
        tenant_id: currentTenant!.id,
        dispatch_trip_id: trip!.id,
        dispatch_stop_id: stopId,
        event_type: `delivery_${action}`,
        notes: notes || null,
        payload: {
          receiver_name: receiverName.trim(),
          photo_paths: photoUrls,
          photo_count: photoUrls.length,
        },
      } as any);
      if (evtErr) throw evtErr;

      // Update stop status
      const { error: stopErr } = await supabase
        .from('dispatch_stops')
        .update({
          status: 'completed',
          actual_departure_at: new Date().toISOString(),
          notes: notes ? `${action}: ${notes}` : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stopId);
      if (stopErr) throw stopErr;
    },
    onSuccess: () => {
      toast({ title: 'Entrega registrada com sucesso' });
      resetDialog();
      qc.invalidateQueries({ queryKey: ['driver_delivery_stops'] });
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const canSubmit = actionDialog && receiverName.trim().length >= 2 && photos.length >= 1;

  if (!trip) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Entregas</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma viagem ativa.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const arrivedStops = stops.filter((s: any) => s.status === 'arrived');
  const completedStops = stops.filter((s: any) => s.status === 'completed');
  const pendingStops = stops.filter((s: any) => s.status === 'pending');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Entregas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {(trip as any).loads?.load_number || '—'} · {completedStops.length}/{stops.length} concluídas
        </p>
      </div>

      {arrivedStops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary uppercase">Aguardando ação</p>
          {arrivedStops.map((stop: any) => (
            <Card key={stop.id} className="border-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                  <Badge className="bg-primary/10 text-primary text-[10px]" variant="secondary">No local</Badge>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {DELIVERY_ACTIONS.map(({ key, label, icon: Icon, variant }) => (
                    <Button key={key} size="sm" variant={variant} className="text-xs" onClick={() => setActionDialog({ stopId: stop.id, action: key })}>
                      <Icon className="h-3 w-3 mr-1" /> {label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {pendingStops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">Pendentes</p>
          {pendingStops.map((stop: any) => (
            <Card key={stop.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Pendente</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {completedStops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary uppercase">Concluídas</p>
          {completedStops.map((stop: any) => (
            <Card key={stop.id} className="opacity-70">
              <CardContent className="p-3 flex items-center gap-3">
                <CheckCircle className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm">{stop.clients?.company_name || stop.destination || 'Parada'}</p>
                </div>
                <Badge className="text-[10px]" variant="secondary">OK</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {stops.length === 0 && (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma parada nesta viagem.</p>
          </CardContent>
        </Card>
      )}

      {/* Delivery confirmation dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => resetDialog()}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {actionDialog?.action === 'delivered' && 'Confirmar Entrega'}
              {actionDialog?.action === 'partial' && 'Entrega Parcial'}
              {actionDialog?.action === 'refused' && 'Entrega Recusada'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Receiver name - required */}
            <div className="space-y-1.5">
              <Label htmlFor="receiver" className="text-xs font-medium">
                Nome do recebedor <span className="text-destructive">*</span>
              </Label>
              <Input
                id="receiver"
                placeholder="Nome de quem recebeu a entrega"
                value={receiverName}
                onChange={e => setReceiverName(e.target.value)}
                className="text-sm"
                maxLength={100}
              />
              {receiverName.length > 0 && receiverName.trim().length < 2 && (
                <p className="text-[10px] text-destructive">Mínimo 2 caracteres</p>
              )}
            </div>

            {/* Photos - required */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                Fotos da entrega <span className="text-destructive">*</span>
                <span className="text-muted-foreground font-normal ml-1">({photos.length}/5)</span>
              </Label>

              {/* Photo previews */}
              {photoPreviews.length > 0 && (
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
              )}

              {photos.length === 0 && (
                <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground">Tire pelo menos 1 foto da entrega</p>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={handlePhotoSelect}
              />

              {photos.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Camera className="h-3.5 w-3.5 mr-1.5" />
                  {photos.length === 0 ? 'Tirar / Anexar Foto' : 'Adicionar mais fotos'}
                </Button>
              )}
            </div>

            {/* Notes - optional */}
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="text-xs font-medium">Observações</Label>
              <Textarea
                id="notes"
                placeholder="Observações (opcional)"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="text-sm"
                maxLength={500}
              />
            </div>

            {/* Validation summary */}
            {!canSubmit && (
              <div className="bg-muted/50 rounded-md px-3 py-2 space-y-0.5">
                {receiverName.trim().length < 2 && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-warning" /> Informe o nome do recebedor
                  </p>
                )}
                {photos.length === 0 && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-warning" /> Adicione pelo menos 1 foto
                  </p>
                )}
              </div>
            )}

            <Button
              className="w-full"
              size="sm"
              onClick={() => actionDialog && recordDelivery.mutate({ stopId: actionDialog.stopId, action: actionDialog.action, notes })}
              disabled={!canSubmit || recordDelivery.isPending}
            >
              {recordDelivery.isPending ? 'Enviando...' : 'Confirmar Entrega'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
