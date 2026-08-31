import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, History } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { supabase } from '@/integrations/supabase/client';
import FreightBreakdownPanel from './FreightBreakdownPanel';
import { useOverrideFreightValue, useConfirmFreightValue } from '@/hooks/useOverrideFreightValue';
import { freightBreakdownFromJson } from '@/hooks/useFreightCalculator';
import { useTenant } from '@/hooks/useTenant';
import type { Json, Tables } from '@/integrations/supabase/types';

interface Doc {
  id: string;
  invoice_number?: string | null;
  freight_value?: number | null;
  freight_value_original?: number | null;
  freight_breakdown?: Json | null;
  freight_overridden?: boolean | null;
  freight_override_reason?: string | null;
  freight_confirmed_at?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  doc: Doc | null;
}

const fmtBRL = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function FreightReviewDialog({ open, onOpenChange, doc }: Props) {
  const toast = useSonnerToast();
  const [newValue, setNewValue] = useState<string>('');
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState<Tables<'freight_override_log'>[]>([]);
  const override = useOverrideFreightValue();
  const confirm = useConfirmFreightValue();
  const { currentTenant } = useTenant();

  const original = Number(doc?.freight_value_original ?? doc?.freight_value ?? 0);
  const current = Number(doc?.freight_value ?? 0);
  const parsedBreakdown = freightBreakdownFromJson(doc?.freight_breakdown);

  useEffect(() => {
    let active = true;
    if (open && doc && currentTenant) {
      setNewValue(String(current.toFixed(2)));
      setReason('');
      // Load audit history
      supabase
        .from('freight_override_log')
        .select('*')
        .eq('fiscal_document_id', doc.id)
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .then(({ data, error }) => {
          if (!active) return;
          if (error) {
            setHistory([]);
            return;
          }
          setHistory(data || []);
        });
    }
    return () => { active = false; };
  }, [current, currentTenant, doc, open]);

  if (!doc) return null;

  const parsedNew = Number(newValue.replace(',', '.'));
  const isChanged = !isNaN(parsedNew) && Math.abs(parsedNew - current) > 0.005;

  const handleSave = async () => {
    try {
      await override.mutateAsync({
        fiscalDocumentId: doc.id,
        newValue: parsedNew,
        reason,
        previousValue: current,
        freightBreakdown: doc.freight_breakdown ?? null,
      });
      toast.success('Valor do frete atualizado com auditoria registrada');
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao atualizar valor'));
    }
  };

  const handleConfirm = async () => {
    try {
      await confirm.mutateAsync(doc.id);
      toast.success('Valor confirmado');
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao confirmar'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Revisar valor do frete — {doc.invoice_number || 'CT-e'}
            {doc.freight_overridden && (
              <Badge variant="outline" className="text-amber-600 border-amber-600">
                <AlertTriangle className="h-3 w-3 mr-1" /> Alterado manualmente
              </Badge>
            )}
            {doc.freight_confirmed_at && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmado
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Valor original (regra)</div>
              <div className="text-lg font-semibold">{fmtBRL(original)}</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-xs text-muted-foreground">Valor atual</div>
              <div className="text-lg font-semibold">{fmtBRL(current)}</div>
            </div>
          </div>

          {parsedBreakdown && (
            <div>
              <div className="text-sm font-medium mb-2">Breakdown da regra original</div>
              <FreightBreakdownPanel
                breakdown={parsedBreakdown}
                finalValue={original}
              />
            </div>
          )}

          <div className="border-t pt-4 space-y-3">
            <div className="text-sm font-medium">Ajustar valor</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-value">Novo valor (R$)</Label>
                <Input
                  id="new-value"
                  type="number"
                  step="0.01"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                {isChanged && (
                  <div className="text-xs text-muted-foreground">
                    Diferença: <span className={parsedNew > current ? 'text-green-600' : 'text-red-600'}>
                      {fmtBRL(parsedNew - current)}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="reason">Justificativa {isChanged && <span className="text-destructive">*</span>}</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: Negociação com cliente, ajuste manual aprovado por..."
                rows={3}
              />
            </div>
          </div>

          {history.length > 0 && (
            <div className="border-t pt-4">
              <div className="text-sm font-medium mb-2 flex items-center gap-2">
                <History className="h-4 w-4" /> Histórico de alterações ({history.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {history.map((h) => (
                  <div key={h.id} className="text-xs border rounded-md p-2 bg-muted/30">
                    <div className="flex justify-between gap-2">
                      <span>
                        {fmtBRL(Number(h.previous_value || 0))} → <strong>{fmtBRL(Number(h.new_value))}</strong>
                      </span>
                      <span className="text-muted-foreground">
                        {new Date(h.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-foreground italic">"{h.reason}"</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          {!isChanged && !doc.freight_confirmed_at && (
            <Button onClick={handleConfirm} disabled={confirm.isPending}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar valor atual
            </Button>
          )}
          {isChanged && (
            <Button onClick={handleSave} disabled={override.isPending || !reason.trim()}>
              Salvar alteração
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
