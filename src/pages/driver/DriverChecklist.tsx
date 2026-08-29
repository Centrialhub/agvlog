import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Save } from 'lucide-react';
import type { Json } from '@/integrations/supabase/types';

const PRE_TRIP_ITEMS = [
  'Pneus em bom estado',
  'Nível de óleo verificado',
  'Água do radiador',
  'Luzes funcionando',
  'Freios testados',
  'Documentos do veículo',
  'Carga conferida e amarrada',
  'Espelhos ajustados',
];

const POST_TRIP_ITEMS = [
  'Veículo estacionado no local correto',
  'Chaves entregues',
  'Km registrado',
  'Avarias reportadas',
  'Veículo limpo',
];

function ChecklistSection({
  title,
  items,
  eventType,
  tripId,
  tenantId,
  savedItems,
}: {
  title: string;
  items: string[];
  eventType: string;
  tripId: string | undefined;
  tenantId: string | undefined;
  savedItems: Set<number>;
}) {
  const [checked, setChecked] = useState<Set<number>>(savedItems);
  const { toast } = useToast();
  const qc = useQueryClient();

  useEffect(() => {
    setChecked(savedItems);
  }, [savedItems]);

  const toggle = (idx: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const saveChecklist = useMutation({
    mutationFn: async () => {
      if (!tripId || !tenantId) throw new Error('Nenhuma viagem ativa');
      
      try {
        const kind = eventType === 'checklist_pre' ? 'pre' : 'post';
        const { error, data } = await supabase.rpc('driver_save_checklist', {
          _trip_id: tripId,
          _kind: kind,
          _payload: { checked_items: Array.from(checked), total_items: items.length },
        });
        
        if (error) {
          console.error('[DriverChecklist] RPC error:', error);
          throw error;
        }
        return data;
      } catch (error: unknown) {
        console.error('[DriverChecklist] Mutation error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Checklist salvo' });
      qc.invalidateQueries({ queryKey: ['driver_checklist_events'] });
    },
    onError: (error: unknown) => toast({
      title: 'Erro',
      description: error instanceof Error ? error.message : 'Não foi possível salvar o checklist.',
      variant: 'destructive',
    }),
  });

  const allChecked = checked.size === items.length;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          {allChecked && (
            <span className="text-[10px] font-medium text-green-600">✓ Completo</span>
          )}
        </div>
        {items.map((item, i) => (
          <label key={i} className="flex items-center gap-2 text-xs cursor-pointer py-1">
            <Checkbox checked={checked.has(i)} onCheckedChange={() => toggle(i)} />
            <span className={checked.has(i) ? 'line-through text-muted-foreground' : ''}>{item}</span>
          </label>
        ))}
        {tripId && (
          <Button
            size="sm"
            variant="outline"
            className="w-full text-xs mt-2"
            onClick={() => saveChecklist.mutate()}
            disabled={saveChecklist.isPending}
          >
            <Save className="h-3 w-3 mr-1" />
            {saveChecklist.isPending
              ? 'Salvando...'
              : checked.size === 0
                ? 'Salvar (limpar checklist)'
                : 'Salvar Checklist'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function DriverChecklist() {
  const { currentTenant } = useTenant();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  
  const qc = useQueryClient();

  // Load previously saved checklists
  const { data: savedEvents = [] } = useQuery({
    queryKey: ['driver_checklist_events', trip?.id],
    queryFn: async () => {
      if (!trip) return [];
      const { data, error } = await supabase
        .from('dispatch_events')
        .select('*')
        .eq('dispatch_trip_id', trip.id)
        .in('event_type', ['checklist_pre', 'checklist_post'])
        .order('event_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id,
  });


  // Realtime: se outro dispositivo salvar o checklist, refresca.
  useEffect(() => {
    if (!trip?.id) return undefined;
    const channel = supabase
      .channel(`driver_checklist_${trip.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_events', filter: `dispatch_trip_id=eq.${trip.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_checklist_events', trip.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [trip?.id, qc]);

  const checkedItems = (payload: Json | null): number[] => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
    const items = payload.checked_items;
    return Array.isArray(items)
      ? items.filter((item): item is number => typeof item === 'number')
      : [];
  };
  const lastPre = savedEvents.find((event) => event.event_type === 'checklist_pre');
  const lastPost = savedEvents.find((event) => event.event_type === 'checklist_post');
  const preChecked = new Set<number>(checkedItems(lastPre?.payload ?? null));
  const postChecked = new Set<number>(checkedItems(lastPost?.payload ?? null));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Checklist</h1>
      <ChecklistSection
        key="pre"
        title="Pré-Viagem"
        items={PRE_TRIP_ITEMS}
        eventType="checklist_pre"
        tripId={trip?.id}
        tenantId={currentTenant?.id}
        savedItems={preChecked}
      />
      <ChecklistSection
        key="post"
        title="Pós-Viagem"
        items={POST_TRIP_ITEMS}
        eventType="checklist_post"
        tripId={trip?.id}
        tenantId={currentTenant?.id}
        savedItems={postChecked}
      />
    </div>
  );
}
