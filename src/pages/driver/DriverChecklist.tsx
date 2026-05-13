import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ClipboardCheck, Save } from 'lucide-react';
import DemoBanner from '@/components/driver/DemoBanner';

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
      const { error } = await supabase.from('dispatch_events').insert({
        tenant_id: tenantId,
        dispatch_trip_id: tripId,
        event_type: eventType,
        payload: { checked_items: Array.from(checked), total_items: items.length },
        event_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Checklist salvo' });
      qc.invalidateQueries({ queryKey: ['driver_checklist_events'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
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
            disabled={saveChecklist.isPending || checked.size === 0}
          >
            <Save className="h-3 w-3 mr-1" />
            {saveChecklist.isPending ? 'Salvando...' : 'Salvar Checklist'}
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
  const [demoVersion, setDemoVersion] = useState(0);

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

  const isDemo = !trip;
  const lastPre = savedEvents.find((e: any) => e.event_type === 'checklist_pre');
  const lastPost = savedEvents.find((e: any) => e.event_type === 'checklist_post');
  const preChecked = isDemo
    ? new Set<number>([0, 1, 2, 3, 4])
    : new Set<number>((lastPre?.payload as any)?.checked_items || []);
  const postChecked = isDemo
    ? new Set<number>([0, 1])
    : new Set<number>((lastPost?.payload as any)?.checked_items || []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Checklist</h1>
      {isDemo && (
        <DemoBanner
          message="Sem viagem ativa — checklist fictício, não será salvo."
          onReset={() => setDemoVersion((v) => v + 1)}
        />
      )}
      <ChecklistSection
        key={`pre-${demoVersion}`}
        title="Pré-Viagem"
        items={PRE_TRIP_ITEMS}
        eventType="checklist_pre"
        tripId={trip?.id}
        tenantId={currentTenant?.id}
        savedItems={preChecked}
      />
      <ChecklistSection
        key={`post-${demoVersion}`}
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
