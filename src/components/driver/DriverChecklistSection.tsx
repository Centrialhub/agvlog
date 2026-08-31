import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { driverErrorMessage } from '@/lib/driverChecklist';

type Props = {
  title: string; kind: 'pre' | 'post'; items: string[]; tripId: string;
  savedItems: number[]; savedId: string | null; boundaryId: string | null; disabled: boolean;
};

export function DriverChecklistSection({ title, kind, items, tripId, savedItems, savedId, boundaryId, disabled }: Props) {
  const [draft, setDraft] = useState<{ items: number[]; revision: string | null; boundary: string | null } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputId = useId();
  const checked = draft?.items ?? savedItems;
  const conflict = !!draft && (draft.revision !== savedId || draft.boundary !== boundaryId);
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['checklist_status'] }),
    qc.invalidateQueries({ queryKey: ['driver_journey_events'] }),
    qc.invalidateQueries({ queryKey: ['driver_checklist_events'] }),
    qc.invalidateQueries({ queryKey: ['pod-history'] }),
    qc.invalidateQueries({ queryKey: ['product-history'] }),
    qc.invalidateQueries({ queryKey: ['driver_events'] }),
  ]);
  const save = useMutation({
    mutationFn: async () => {
      if (disabled || conflict) throw new Error('Atualize o checklist antes de salvar.');
      const { data, error } = await supabase.rpc('driver_save_checklist', {
        _trip_id: tripId, _kind: kind,
        _payload: { checked_items: checked, total_items: items.length,
          expected_checklist_id: draft ? draft.revision : savedId,
          expected_boundary_id: draft ? draft.boundary : boundaryId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await refresh();
      setDraft(null);
      toast({ title: 'Checklist salvo' });
    },
    onError: async (error: unknown) => {
      toast({ title: 'Não foi possível salvar', description: driverErrorMessage(error, 'Atualize e tente novamente.'), variant: 'destructive' });
      await refresh();
    },
  });
  const toggle = (index: number) => setDraft(previous => {
    const current = previous?.items ?? savedItems;
    return {
      items: current.includes(index) ? current.filter(item => item !== index) : [...current, index],
      revision: previous ? previous.revision : savedId,
      boundary: previous ? previous.boundary : boundaryId,
    };
  });
  return <Card><CardContent className="p-3 space-y-2">
    <h2 className="text-sm font-medium">{title}</h2>
    <p className="text-xs">{checked.length}/{items.length} itens {draft ? '· Alterações não salvas' : '· Salvo'}</p>
    {conflict && <div role="alert" className="text-sm">
      O checklist ou turno mudou. Suas marcações foram preservadas; confira os dados atuais antes de continuar.
      <Button variant="outline" onClick={() => setDraft(null)}>Carregar versão atual de {title}</Button>
    </div>}
    {items.map((item, index) => <div key={item} className="flex items-center gap-2 py-1">
      <Checkbox id={`${inputId}-${index}`} checked={checked.includes(index)}
        disabled={disabled || conflict || save.isPending} onCheckedChange={() => toggle(index)} />
      <label htmlFor={`${inputId}-${index}`} className="text-xs cursor-pointer">{item}</label>
    </div>)}
    <Button size="sm" variant="outline" className="w-full" onClick={() => save.mutate()}
      disabled={disabled || conflict || save.isPending}>
      {save.isPending ? `Salvando ${title}…` : `Salvar ${title}`}
    </Button>
  </CardContent></Card>;
}
