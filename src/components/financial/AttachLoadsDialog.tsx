import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import LoadPicker from './LoadPicker';
import { useAttachLoadsToSettlement } from '@/hooks/useDriverSettlements';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settlementId: string;
  driverId?: string | null;
}

export default function AttachLoadsDialog({ open, onOpenChange, settlementId, driverId }: Props) {
  const attach = useAttachLoadsToSettlement();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  useEffect(() => { if (open) setSelectedIds([]); }, [open]);

  const submit = async () => {
    if (selectedIds.length === 0) return;
    await attach.mutateAsync({ settlement_id: settlementId, load_ids: selectedIds });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader><DialogTitle>Adicionar romaneios ao acerto</DialogTitle></DialogHeader>
        <LoadPicker
          driverId={driverId ?? null}
          includeSettlementId={settlementId}
          selectedIds={selectedIds}
          onChange={setSelectedIds}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={selectedIds.length === 0 || attach.isPending}>
            Vincular ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}