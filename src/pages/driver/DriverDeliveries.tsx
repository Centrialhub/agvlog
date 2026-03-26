import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Package, CheckCircle, AlertTriangle, Truck } from 'lucide-react';

const DELIVERY_ACTIONS = [
  { key: 'delivered', label: 'Entregue', icon: CheckCircle, variant: 'default' as const },
  { key: 'partial', label: 'Entrega Parcial', icon: Package, variant: 'secondary' as const },
  { key: 'refused', label: 'Recusada', icon: AlertTriangle, variant: 'destructive' as const },
];

export default function DriverDeliveries() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actionDialog, setActionDialog] = useState<{ stopId: string; action: string } | null>(null);
  const [notes, setNotes] = useState('');

  // Get active trip
  const { data: trip } = useQuery({
    queryKey: ['driver_active_trip_deliveries', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(load_number)')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  // Get stops for delivery actions (only arrived or completed)
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

  const recordDelivery = useMutation({
    mutationFn: async ({ stopId, action, notes }: { stopId: string; action: string; notes: string }) => {
      // Create dispatch event
      const { error: evtErr } = await supabase.from('dispatch_events').insert({
        tenant_id: currentTenant!.id,
        dispatch_trip_id: trip!.id,
        dispatch_stop_id: stopId,
        event_type: `delivery_${action}`,
        notes: notes || null,
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
      toast({ title: 'Entrega registrada' });
      setActionDialog(null);
      setNotes('');
      qc.invalidateQueries({ queryKey: ['driver_delivery_stops'] });
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

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

      {/* Stops ready for delivery action (arrived) */}
      {arrivedStops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary uppercase">Aguardando ação</p>
          {arrivedStops.map((stop: any) => (
            <Card key={stop.id} className="border-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {stop.clients?.company_name || stop.destination || 'Parada'}
                  </p>
                  <Badge className="bg-primary/10 text-primary text-[10px]" variant="secondary">No local</Badge>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {DELIVERY_ACTIONS.map(({ key, label, icon: Icon, variant }) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={variant}
                      className="text-xs"
                      onClick={() => setActionDialog({ stopId: stop.id, action: key })}
                    >
                      <Icon className="h-3 w-3 mr-1" /> {label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pending */}
      {pendingStops.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase">Pendentes</p>
          {pendingStops.map((stop: any, i: number) => (
            <Card key={stop.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <Truck className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm">{stop.clients?.company_name || stop.destination || `Parada`}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">Pendente</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Completed */}
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

      {/* Delivery action dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => { setActionDialog(null); setNotes(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">
              {actionDialog?.action === 'delivered' && 'Confirmar Entrega'}
              {actionDialog?.action === 'partial' && 'Entrega Parcial'}
              {actionDialog?.action === 'refused' && 'Entrega Recusada'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              placeholder="Observações (opcional)"
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="text-sm"
            />
            <Button
              className="w-full"
              size="sm"
              onClick={() => actionDialog && recordDelivery.mutate({ stopId: actionDialog.stopId, action: actionDialog.action, notes })}
              disabled={recordDelivery.isPending}
            >
              {recordDelivery.isPending ? 'Registrando...' : 'Confirmar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
