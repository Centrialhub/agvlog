import { useState } from 'react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { useGeneratePayrollPeriod } from '@/hooks/usePayroll';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getErrorMessage } from '@/lib/errors';

export function GeneratePeriodDialog({ open, onOpenChange, onGenerated }: { open: boolean; onOpenChange: (open: boolean) => void; onGenerated: (id: string) => void }) {
  const toast = useSonnerToast();
  const gen = useGeneratePayrollPeriod();
  const today = new Date();
  const [start, setStart] = useState(format(startOfMonth(today), 'yyyy-MM-dd'));
  const [end, setEnd] = useState(format(endOfMonth(today), 'yyyy-MM-dd'));
  const [name, setName] = useState('');
  const [incDrivers, setIncDrivers] = useState(true);
  const [incNonDrivers, setIncNonDrivers] = useState(true);

  const handle = async () => {
    if (new Date(end) < new Date(start)) { toast.error('Fim menor que início'); return; }
    if (!incDrivers && !incNonDrivers) { toast.error('Selecione ao menos um grupo'); return; }
    try {
      const id = await gen.mutateAsync({ period_start: start, period_end: end, period_name: name || undefined, include_drivers: incDrivers, include_non_drivers: incNonDrivers });
      toast.success('Folha gerada');
      onGenerated(id);
      onOpenChange(false);
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Não foi possível gerar a folha.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Gerar folha de pagamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Início *</Label><Input type="date" value={start} onChange={event => setStart(event.target.value)} /></div>
          <div><Label className="text-xs">Fim *</Label><Input type="date" value={end} onChange={event => setEnd(event.target.value)} /></div>
          <div className="col-span-2"><Label className="text-xs">Nome (opcional)</Label><Input value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Folha novembro/2026" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incDrivers} onChange={event => setIncDrivers(event.target.checked)} /> Incluir motoristas</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={incNonDrivers} onChange={event => setIncNonDrivers(event.target.checked)} /> Incluir demais</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handle} disabled={gen.isPending}>Gerar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
