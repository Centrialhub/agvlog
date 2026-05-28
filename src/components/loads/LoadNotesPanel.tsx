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
import { Save, CheckCircle2, XCircle, FileText } from 'lucide-react';

interface Props {
  load: any;
  documents: any[];
  onSaved?: () => void;
}

const PAYMENT_METHODS = [
  { value: '__none__', label: '— Selecionar —' },
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
  palete?: string;
  rec_canhoto?: boolean;
  lote_canhoto?: string;
  ne?: boolean;
  oco_01?: string;
  oco_02?: string;
  resp_oco?: string;
  delivery_at?: string;
};

export default function LoadNotesPanel({ load, documents, onSaved }: Props) {
  const qc = useQueryClient();
  const inboundDocs = useMemo(
    () => (documents || []).filter((d: any) => d.document_type === 'inbound'),
    [documents],
  );

  // Header (per-load) state
  const [header, setHeader] = useState({
    payment_method: load.payment_method || '__none__',
    schedule_at: toLocalDT(load.schedule_at),
    occurrence_at: toLocalDT(load.occurrence_at),
    occurrence_responsible: load.occurrence_responsible || '__none__',
    occurrence_notes: load.occurrence_notes || '',
  });
  useEffect(() => {
    setHeader({
      payment_method: load.payment_method || '__none__',
      schedule_at: toLocalDT(load.schedule_at),
      occurrence_at: toLocalDT(load.occurrence_at),
      occurrence_responsible: load.occurrence_responsible || '__none__',
      occurrence_notes: load.occurrence_notes || '',
    });
  }, [load.id]);

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
  }, [load.id, inboundDocs.length]);

  const [savingAll, setSavingAll] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const patchDoc = (id: string, patch: Partial<DocMeta>) => {
    setMeta(prev => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
    setDirty(prev => new Set(prev).add(id));
  };

  const markAll = (patch: Partial<DocMeta>) => {
    setMeta(prev => {
      const next = { ...prev };
      inboundDocs.forEach((d: any) => {
        next[d.id] = { ...(next[d.id] || {}), ...patch };
      });
      return next;
    });
    setDirty(new Set(inboundDocs.map((d: any) => d.id)));
  };

  const saveAll = async () => {
    setSavingAll(true);
    try {
      // 1) Save load header
      const { error: lerr } = await supabase
        .from('loads')
        .update({
          payment_method: header.payment_method !== '__none__' ? header.payment_method : null,
          schedule_at: fromLocalDT(header.schedule_at),
          occurrence_at: fromLocalDT(header.occurrence_at),
          occurrence_responsible:
            header.occurrence_responsible !== '__none__' ? header.occurrence_responsible : null,
          occurrence_notes: header.occurrence_notes || null,
        } as any)
        .eq('id', load.id);
      if (lerr) throw lerr;

      // 2) Save per-document metadata (only dirty)
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
      await qc.invalidateQueries({ queryKey: ['loads'] });
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

      {/* HEADER (replica do POPUP_LG_ROMEXP_CLI) */}
      <div className="p-3 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2 border-b bg-muted/10">
        <div>
          <Label className="text-[10px]">Forma de Pagamento</Label>
          <SearchableSelect
            value={header.payment_method}
            onChange={v => setHeader({ ...header, payment_method: v })}
            options={PAYMENT_METHODS.map(p => ({ value: p.value, label: p.label }))}
            placeholder="Selecionar"
            searchPlaceholder="Buscar..."
          />
        </div>
        <div>
          <Label className="text-[10px]">Dt. Agendamento</Label>
          <Input
            type="datetime-local"
            className="h-8 text-xs"
            value={header.schedule_at}
            onChange={e => setHeader({ ...header, schedule_at: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-[10px]">Dt. Ocorrência</Label>
          <Input
            type="datetime-local"
            className="h-8 text-xs"
            value={header.occurrence_at}
            onChange={e => setHeader({ ...header, occurrence_at: e.target.value })}
          />
        </div>
        <div>
          <Label className="text-[10px]">Responsável Ocorrência</Label>
          <SearchableSelect
            value={header.occurrence_responsible}
            onChange={v => setHeader({ ...header, occurrence_responsible: v })}
            options={OCO_RESPONSIBLES.map(p => ({ value: p.value, label: p.label }))}
            placeholder="Selecionar"
            searchPlaceholder="Buscar..."
          />
        </div>
        <div className="md:col-span-3 lg:col-span-4">
          <Label className="text-[10px]">Observações</Label>
          <Textarea
            rows={2}
            className="text-xs"
            value={header.occurrence_notes}
            onChange={e => setHeader({ ...header, occurrence_notes: e.target.value })}
          />
        </div>
      </div>

      {/* AÇÕES EM MASSA */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-muted/5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => markAll({ ne: true })}
          disabled={!inboundDocs.length}
        >
          <XCircle className="h-3 w-3 mr-1 text-destructive" />
          Marcar todas como Não Entregue
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => markAll({ rec_canhoto: true })}
          disabled={!inboundDocs.length}
        >
          <CheckCircle2 className="h-3 w-3 mr-1 text-success" />
          Marcar todas como Canhoto Recebido
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={saveAll}
          disabled={savingAll || (!dirty.size && header.payment_method === (load.payment_method || '__none__'))}
          className="h-7 text-xs"
        >
          <Save className="h-3 w-3 mr-1" />
          {savingAll ? 'Salvando...' : `Salvar Notas${dirty.size ? ` (${dirty.size})` : ''}`}
        </Button>
      </div>

      {/* TABELA — replica das colunas do POPUP */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-[10px] whitespace-nowrap">Palete</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap text-center">Rec. Canhoto</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Lote Canhoto</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap text-center">Ne</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Nº NFS</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">NUMREF</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Situação</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Fornecedor</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Município</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Destinatário</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Oco 01</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Oco 02</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Resp. Oco</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap text-right">Vl NFS</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Dt. Entrega/Oco</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inboundDocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center text-xs text-muted-foreground py-6">
                  Nenhuma nota fiscal vinculada a esta carga.
                </TableCell>
              </TableRow>
            ) : inboundDocs.map((d: any) => {
              const m = meta[d.id] || {};
              return (
                <TableRow key={d.id} className={m.ne ? 'bg-destructive/5' : ''}>
                  <TableCell className="p-1">
                    <Input
                      value={m.palete || ''}
                      onChange={e => patchDoc(d.id, { palete: e.target.value })}
                      className="h-7 text-xs w-16"
                    />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <Checkbox
                      checked={!!m.rec_canhoto}
                      onCheckedChange={v => patchDoc(d.id, { rec_canhoto: !!v })}
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      value={m.lote_canhoto || ''}
                      onChange={e => patchDoc(d.id, { lote_canhoto: e.target.value })}
                      className="h-7 text-xs w-24"
                    />
                  </TableCell>
                  <TableCell className="p-1 text-center">
                    <Checkbox
                      checked={!!m.ne}
                      onCheckedChange={v => patchDoc(d.id, { ne: !!v })}
                    />
                  </TableCell>
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{d.invoice_number || '—'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{d.reference_number || '0'}</TableCell>
                  <TableCell className="text-xs">
                    {m.ne ? (
                      <Badge variant="destructive" className="text-[10px]">Não Entregue</Badge>
                    ) : m.rec_canhoto ? (
                      <Badge className="text-[10px] bg-success text-success-foreground">Entregue</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Pendente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate" title={d.remitter || ''}>
                    {d.remitter || '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {d.recipient_city || '—'}{d.recipient_state ? `/${d.recipient_state}` : ''}
                  </TableCell>
                  <TableCell className="text-xs max-w-[180px] truncate" title={d.recipient || ''}>
                    {d.recipient || '—'}
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
                  <TableCell className="text-xs text-right whitespace-nowrap font-medium">
                    {fmtMoney(Number(d.value || 0))}
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      type="datetime-local"
                      value={toLocalDT(m.delivery_at)}
                      onChange={e => patchDoc(d.id, { delivery_at: fromLocalDT(e.target.value) || undefined })}
                      className="h-7 text-xs w-40"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {inboundDocs.length > 0 && (
            <TableBody>
              <TableRow className="bg-muted/40 font-bold">
                <TableCell colSpan={13} className="text-xs text-right">Total:</TableCell>
                <TableCell className="text-xs text-right whitespace-nowrap">
                  {fmtMoney(inboundDocs.reduce((s: number, d: any) => s + Number(d.value || 0), 0))}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          )}
        </Table>
      </div>
    </div>
  );
}