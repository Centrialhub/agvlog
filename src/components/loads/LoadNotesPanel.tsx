import { useMemo, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { toast } from 'sonner';
import { Save, CheckCircle2, XCircle, FileText, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

interface Props {
  load: any;
  documents: any[];
  onSaved?: () => void;
}

const PAYMENT_METHODS = [
  { value: '__none__', label: '— Forma Pgto —' },
  { value: 'a_vista', label: 'À Vista' },
  { value: 'a_prazo', label: 'A Prazo' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'pix', label: 'PIX' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cartao_credito', label: 'Cartão Crédito' },
  { value: 'cartao_debito', label: 'Cartão Débito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'faturado', label: 'Faturado' },
];

const OCO_RESPONSIBLES = [
  { value: '__none__', label: '— Selecionar —' },
  { value: 'transportadora', label: 'Transportadora' },
  { value: 'cliente', label: 'Cliente' },
  { value: 'destinatario', label: 'Destinatário' },
  { value: 'remetente', label: 'Remetente' },
  { value: 'motorista', label: 'Motorista' },
  { value: 'embarcador', label: 'Embarcador' },
];

const OCO_CODES = [
  { value: '', label: '—' },
  { value: '01', label: '01 - Entregue' },
  { value: '02', label: '02 - Recusa' },
  { value: '03', label: '03 - Avaria' },
  { value: '04', label: '04 - Falta' },
  { value: '05', label: '05 - Endereço não localizado' },
  { value: '06', label: '06 - Estabelecimento fechado' },
  { value: '07', label: '07 - Cliente ausente' },
  { value: '08', label: '08 - Falta de pagamento' },
  { value: '09', label: '09 - Reentrega agendada' },
];

const toLocalDT = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalDT = (v: string) => (v ? new Date(v).toISOString() : null);
const fmtMoney = (n?: number | null) =>
  n == null ? 'R$ 0,00' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type DocMeta = {
  rec_canhoto?: boolean;
  ne?: boolean;
  oco_01?: string;
  oco_02?: string;
  resp_oco?: string;
  payment_method?: string;
  delivery_at?: string;
  ne_reason?: string;
  ne_at?: string;
};

export default function LoadNotesPanel({ load, documents, onSaved }: Props) {
  const qc = useQueryClient();
  const inboundDocs = useMemo(
    () => (documents || []).filter((d: any) => d.document_type === 'inbound'),
    [documents],
  );

  // Per-document meta state (keyed by doc.id)
  const [meta, setMeta] = useState<Record<string, DocMeta>>(() => {
    const m: Record<string, DocMeta> = {};
    inboundDocs.forEach((d: any) => { m[d.id] = (d.delivery_meta || {}) as DocMeta; });
    return m;
  });
  useEffect(() => {
    const m: Record<string, DocMeta> = {};
    inboundDocs.forEach((d: any) => { m[d.id] = (d.delivery_meta || {}) as DocMeta; });
    setMeta(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.id, inboundDocs.length]);

  const [savingAll, setSavingAll] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [neModal, setNeModal] = useState<{ docId: string; reason: string } | null>(null);

  const patchDoc = (id: string, patch: Partial<DocMeta>) => {
    setMeta(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
    setDirty(prev => new Set(prev).add(id));
  };

  const markAllCanhotos = () => {
    setMeta(prev => {
      const next = { ...prev };
      inboundDocs.forEach((d: any) => {
        next[d.id] = { ...(next[d.id] || {}), rec_canhoto: true };
      });
      return next;
    });
    setDirty(new Set(inboundDocs.map((d: any) => d.id)));
  };

  // Marca documento como Entregue e salva imediatamente (sincroniza com o sistema)
  const markDelivered = async (docId: string) => {
    const nowIso = new Date().toISOString();
    const next: DocMeta = {
      ...(meta[docId] || {}),
      ne: false,
      ne_reason: '',
      delivery_at: nowIso,
    };
    setMeta(prev => ({ ...prev, [docId]: next }));
    try {
      const { error } = await supabase
        .from('fiscal_documents')
        .update({ status: 'delivered', delivery_meta: next } as any)
        .eq('id', docId);
      if (error) throw error;
      toast.success('Nota marcada como Entregue');
      await qc.invalidateQueries({ queryKey: ['load_documents'] });
      await qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      setDirty(prev => { const n = new Set(prev); n.delete(docId); return n; });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao marcar como entregue');
    }
  };

  // Volta a nota para Pendente (desmarca Entregue/Não Entregue)
  const clearDeliveryStatus = async (docId: string) => {
    const next: DocMeta = {
      ...(meta[docId] || {}),
      ne: false,
      ne_reason: '',
      ne_at: undefined,
      delivery_at: undefined,
    };
    setMeta(prev => ({ ...prev, [docId]: next }));
    try {
      const { error } = await supabase
        .from('fiscal_documents')
        .update({ status: 'confirmed', delivery_meta: next } as any)
        .eq('id', docId);
      if (error) throw error;
      toast.success('Status revertido para Pendente');
      await qc.invalidateQueries({ queryKey: ['load_documents'] });
      await qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      setDirty(prev => { const n = new Set(prev); n.delete(docId); return n; });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao reverter status');
    }
  };

  // Confirma modal de Não Entregue (exige motivo)
  const confirmNotDelivered = async () => {
    if (!neModal) return;
    if (!neModal.reason.trim()) {
      toast.error('Informe o motivo da não entrega');
      return;
    }
    const nowIso = new Date().toISOString();
    const docId = neModal.docId;
    const next: DocMeta = {
      ...(meta[docId] || {}),
      ne: true,
      ne_reason: neModal.reason.trim(),
      ne_at: nowIso,
      delivery_at: undefined,
    };
    setMeta(prev => ({ ...prev, [docId]: next }));
    try {
      const { error } = await supabase
        .from('fiscal_documents')
        .update({ status: 'not_delivered', delivery_meta: next } as any)
        .eq('id', docId);
      if (error) throw error;
      toast.success('Nota marcada como Não Entregue');
      await qc.invalidateQueries({ queryKey: ['load_documents'] });
      await qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      setNeModal(null);
      setDirty(prev => { const n = new Set(prev); n.delete(docId); return n; });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar não entrega');
    }
  };

  const saveAll = async () => {
    setSavingAll(true);
    try {
      const ids = Array.from(dirty);
      for (const id of ids) {
        const { error } = await supabase
          .from('fiscal_documents')
          .update({ delivery_meta: meta[id] || {} } as any)
          .eq('id', id);
        if (error) throw error;
      }
      toast.success(`Notas salvas (${ids.length} alteração(ões))`);
      setDirty(new Set());
      await qc.invalidateQueries({ queryKey: ['load_documents'] });
      await qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao salvar notas');
    } finally {
      setSavingAll(false);
    }
  };

  return (
    <div className="border rounded-md">
      <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-bold uppercase flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Notas Fiscais ({inboundDocs.length})
        </span>
        <span className="text-[10px] font-normal normal-case text-muted-foreground">
          Carga: {load.load_number}
        </span>
      </div>

      {/* AÇÕES EM MASSA */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-muted/5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={markAllCanhotos}
          disabled={!inboundDocs.length}
        >
          <CheckCircle2 className="h-3 w-3 mr-1 text-success" />
          Marcar todos canhotos como Recebidos
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={saveAll}
          disabled={savingAll || !dirty.size}
          className="h-7 text-xs"
        >
          <Save className="h-3 w-3 mr-1" />
          {savingAll ? 'Salvando...' : `Salvar Notas${dirty.size ? ` (${dirty.size})` : ''}`}
        </Button>
      </div>

      {/* TABELA */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-[10px] whitespace-nowrap text-center">Rec. Canhoto</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Nº NFS</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">NUMREF</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Situação</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Destinatário</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Município</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap text-right">Vl NFS</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Forma Pgto</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Oco 01</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Oco 02</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Resp. Oco</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Dt. Entrega/Oco</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap text-center">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inboundDocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="text-center text-xs text-muted-foreground py-6">
                  Nenhuma nota fiscal vinculada a esta carga.
                </TableCell>
              </TableRow>
            ) : inboundDocs.map((d: any) => {
              const m = meta[d.id] || {};
              const isDelivered = d.status === 'delivered';
              const isNotDelivered = d.status === 'not_delivered' || m.ne;
              return (
                <TableRow key={d.id} className={isNotDelivered ? 'bg-destructive/5' : isDelivered ? 'bg-success/5' : ''}>
                  <TableCell className="p-1 text-center">
                    <Checkbox
                      checked={!!m.rec_canhoto}
                      onCheckedChange={v => patchDoc(d.id, { rec_canhoto: !!v })}
                    />
                  </TableCell>
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{d.invoice_number || '—'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{d.reference_number || '0'}</TableCell>
                  <TableCell className="text-xs">
                    {isNotDelivered ? (
                      <Badge variant="destructive" className="text-[10px]" title={m.ne_reason || ''}>Não Entregue</Badge>
                    ) : isDelivered ? (
                      <Badge className="text-[10px] bg-success text-success-foreground">Entregue</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Pendente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate" title={d.recipient || ''}>
                    {d.recipient || '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {d.recipient_city || '—'}{d.recipient_state ? `/${d.recipient_state}` : ''}
                  </TableCell>
                  <TableCell className="text-xs text-right whitespace-nowrap font-medium">
                    {fmtMoney(Number(d.value || 0))}
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.payment_method || '__none__'}
                      onChange={v => patchDoc(d.id, { payment_method: v === '__none__' ? '' : v })}
                      options={PAYMENT_METHODS}
                      placeholder="—"
                      className="h-7 w-32"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.oco_01 || ''}
                      onChange={v => patchDoc(d.id, { oco_01: v })}
                      options={OCO_CODES}
                      placeholder="—"
                      className="h-7 w-24"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.oco_02 || ''}
                      onChange={v => patchDoc(d.id, { oco_02: v })}
                      options={OCO_CODES}
                      placeholder="—"
                      className="h-7 w-24"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.resp_oco || '__none__'}
                      onChange={v => patchDoc(d.id, { resp_oco: v === '__none__' ? '' : v })}
                      options={OCO_RESPONSIBLES}
                      placeholder="—"
                      className="h-7 w-28"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      type="datetime-local"
                      value={toLocalDT(m.delivery_at)}
                      onChange={e => patchDoc(d.id, { delivery_at: fromLocalDT(e.target.value) || undefined })}
                      className="h-7 text-xs w-40"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <div className="flex items-center gap-1 justify-center">
                      <Button
                        size="sm"
                        variant={isDelivered ? 'default' : 'outline'}
                        className={`h-7 px-2 text-[10px] ${isDelivered ? 'bg-success hover:bg-success/90 text-success-foreground' : 'text-success border-success/40 hover:bg-success/10'}`}
                        onClick={() => isDelivered ? clearDeliveryStatus(d.id) : markDelivered(d.id)}
                        title={isDelivered ? 'Clique para desmarcar Entregue' : 'Marcar como Entregue (sincroniza no sistema)'}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Entregue
                      </Button>
                      <Button
                        size="sm"
                        variant={isNotDelivered ? 'destructive' : 'outline'}
                        className={`h-7 px-2 text-[10px] ${isNotDelivered ? '' : 'text-destructive border-destructive/40 hover:bg-destructive/10'}`}
                        onClick={() => isNotDelivered ? clearDeliveryStatus(d.id) : setNeModal({ docId: d.id, reason: m.ne_reason || '' })}
                        title={isNotDelivered ? 'Clique para desmarcar Não Entregue' : 'Marcar como Não Entregue (exige observação)'}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Não Entregue
                      </Button>
                    </div>
                    {isNotDelivered && m.ne_reason && (
                      <div className="text-[10px] text-destructive mt-1 px-1 truncate max-w-[280px]" title={m.ne_reason}>
                        <AlertTriangle className="h-2.5 w-2.5 inline mr-1" />{m.ne_reason}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {inboundDocs.length > 0 && (
            <TableBody>
              <TableRow className="bg-muted/40 font-bold">
                <TableCell colSpan={6} className="text-xs text-right">Total:</TableCell>
                <TableCell className="text-xs text-right whitespace-nowrap">
                  {fmtMoney(inboundDocs.reduce((s: number, d: any) => s + Number(d.value || 0), 0))}
                </TableCell>
                <TableCell colSpan={6} />
              </TableRow>
            </TableBody>
          )}
        </Table>
      </div>

      {/* MODAL NÃO ENTREGUE */}
      <Dialog open={!!neModal} onOpenChange={(o) => !o && setNeModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-destructive" />
              Marcar Nota como Não Entregue
            </DialogTitle>
            <DialogDescription>
              Informe o motivo da não entrega. Esta observação será usada nos relatórios operacionais.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Motivo / Observação *</Label>
            <Textarea
              rows={4}
              autoFocus
              placeholder="Ex.: Cliente ausente, endereço incorreto, recusou mercadoria..."
              value={neModal?.reason || ''}
              onChange={e => setNeModal(prev => prev ? { ...prev, reason: e.target.value } : prev)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNeModal(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmNotDelivered}>
              <XCircle className="h-4 w-4 mr-1" />
              Confirmar Não Entrega
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
