import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { driverErrorMessage } from '@/lib/driverChecklist';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';

type Props = {
  title: string; kind: 'pre' | 'post'; items: string[]; tripId: string;
  savedItems: number[]; savedId: string | null; boundaryId: string | null; disabled: boolean;
};

export function DriverChecklistSection({ title, kind, items, tripId, savedItems, savedId, boundaryId, disabled }: Props) {
  const [draft, setDraft] = useState<{ items: number[]; revision: string | null; boundary: string | null } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const offlineCommands = useDriverOperationalOffline();
  const inputId = useId();
  const queued = [...offlineCommands.commands].reverse().find(command => command.kind === 'checklist'
    && command.aggregateId === tripId && command.payload && typeof command.payload === 'object'
    && !Array.isArray(command.payload) && command.payload.kind === kind);
  const queuedPayload = queued?.payload && typeof queued.payload === 'object' && !Array.isArray(queued.payload)
    ? queued.payload.checklist_payload : null;
  const queuedItems = queuedPayload && typeof queuedPayload === 'object' && !Array.isArray(queuedPayload)
    && Array.isArray(queuedPayload.checked_items) ? queuedPayload.checked_items.filter(Number.isInteger) as number[] : null;
  const checked = draft?.items ?? queuedItems ?? savedItems;
  const boundaryEventType = kind === 'pre' ? 'end_shift' : 'start_shift';
  const queuedBoundary = [...offlineCommands.commands].reverse().find(command => command.kind === 'journey'
    && command.aggregateId === tripId && command.payload && typeof command.payload === 'object'
    && !Array.isArray(command.payload) && command.payload.event_type === boundaryEventType);
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
      return offlineCommands.submit({
        kind: 'checklist', aggregateId: tripId,
        payload: { trip_id: tripId, kind,
          checklist_payload: { checked_items: checked, total_items: items.length,
            expected_checklist_id: draft ? draft.revision : savedId,
            expected_boundary_id: draft ? draft.boundary : boundaryId,
            expected_boundary_request_id: queuedBoundary?.id ?? null } },
      });
    },
    onSuccess: async result => {
      if (!result.queued) await refresh();
      setDraft(null);
      toast({ title: result.queued ? 'Checklist salvo no aparelho' : 'Checklist salvo',
        description: result.queued ? 'Será sincronizado automaticamente quando houver conexão.' : undefined });
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
    <p className="text-xs">{checked.length}/{items.length} itens {draft ? '· Alterações não salvas' : queued ? '· Sincronização pendente' : '· Salvo'}</p>
    {conflict && <div role="alert" className="text-sm">
      O checklist ou turno mudou. Suas marcações foram preservadas; confira os dados atuais antes de continuar.
      <Button variant="outline" onClick={() => setDraft(null)}>Carregar versão atual de {title}</Button>
    </div>}
    {items.map((item, index) => <div key={item} className="flex items-center gap-2 py-1">
      <Checkbox id={`${inputId}-${index}`} checked={checked.includes(index)}
        disabled={disabled || !!queued || conflict || save.isPending} onCheckedChange={() => toggle(index)} />
      <label htmlFor={`${inputId}-${index}`} className="text-xs cursor-pointer">{item}</label>
    </div>)}
    <Button size="sm" variant="outline" className="w-full" onClick={() => save.mutate()}
      disabled={disabled || !!queued || conflict || save.isPending}>
      {save.isPending ? `Salvando ${title}…` : `Salvar ${title}`}
    </Button>
  </CardContent></Card>;
}
