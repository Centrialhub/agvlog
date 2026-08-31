import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle, XCircle } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useCancelCTe } from '@/hooks/useIssueCTe';

const CONFIRM_WORD = 'CANCELAR';
const MIN_JUSTIFICATION = 15;

const REASON_PRESETS = [
  'Erro de digitação nos dados do CT-e',
  'Frete calculado com valor incorreto',
  'Destinatário/remetente incorreto no documento',
  'Serviço de transporte não realizado',
];

export interface CancelCteTarget {
  id: string;
  label: string;
  accessKey?: string | null;
  notesCount?: number;
}

/**
 * Cancelamento de CT-e autorizado com redundância de confirmação:
 * 1) justificativa SEFAZ (mín. 15 caracteres), 2) ciência do efeito nas NFs,
 * 3) digitação da palavra CANCELAR. Só então o cancelamento é transmitido.
 */
export function CancelCteDialog({
  target,
  onOpenChange,
}: {
  target: CancelCteTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useSonnerToast();
  const cancelCte = useCancelCTe();
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (target) {
      setReason('');
      setAcknowledged(false);
      setConfirmText('');
    }
  }, [target]);

  const trimmed = reason.trim();
  const reasonValid = trimmed.length >= MIN_JUSTIFICATION && trimmed.length <= 255;
  const confirmValid = confirmText.trim().toUpperCase() === CONFIRM_WORD;
  const canSubmit = useMemo(
    () => reasonValid && acknowledged && confirmValid && !cancelCte.isPending,
    [reasonValid, acknowledged, confirmValid, cancelCte.isPending],
  );

  async function handleConfirm() {
    if (!target || !canSubmit) return;
    try {
      await cancelCte.mutateAsync({ fiscalDocumentId: target.id, justificativa: trimmed });
      toast.success('CT-e cancelado', {
        description: 'As NFs vinculadas foram liberadas e voltam a aparecer no CT-e Hub.',
      });
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Falha ao cancelar CT-e', { description: e?.message });
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Cancelar CT-e {target?.label}
          </DialogTitle>
          <DialogDescription>
            O cancelamento é transmitido à SEFAZ e não pode ser desfeito. As{' '}
            {target?.notesCount ?? 0} nota(s) vinculada(s) serão liberadas para nova emissão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {target?.accessKey ? (
            <p className="text-xs font-mono break-all text-muted-foreground">{target.accessKey}</p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="cte-cancel-reason">Motivo do cancelamento (mín. {MIN_JUSTIFICATION} caracteres)</Label>
            <Textarea
              id="cte-cancel-reason"
              rows={3}
              maxLength={255}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo que será enviado à SEFAZ"
            />
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {REASON_PRESETS.map((p) => (
                  <Button key={p} type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setReason(p)}>
                    {p.split(' ').slice(0, 3).join(' ')}
                  </Button>
                ))}
              </div>
              <span className={`text-xs ${reasonValid ? 'text-muted-foreground' : 'text-destructive'}`}>
                {trimmed.length}/255
              </span>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <Checkbox
              id="cte-cancel-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            <Label htmlFor="cte-cancel-ack" className="text-xs font-normal leading-relaxed">
              Confirmo que este CT-e deve ser cancelado na SEFAZ e que as notas vinculadas ficarão
              disponíveis para reemissão.
            </Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cte-cancel-confirm">
              Digite <span className="font-mono font-semibold">{CONFIRM_WORD}</span> para liberar a ação
            </Label>
            <Input
              id="cte-cancel-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelCte.isPending}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={!canSubmit}>
            <XCircle className="h-4 w-4 mr-1" />
            {cancelCte.isPending ? 'Cancelando...' : 'Cancelar CT-e na SEFAZ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
