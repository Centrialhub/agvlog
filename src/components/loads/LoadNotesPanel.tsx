import { useMemo, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Save, CheckCircle2, XCircle, FileText, AlertTriangle, RotateCcw, Printer, Search } from 'lucide-react';
import { Wand2 } from 'lucide-react';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { printLoadNotesReport } from '@/lib/printLoadNotes';
import { detectPaymentMethod } from '@/lib/paymentMethodDetection';
import type { Json, Tables } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';
import type { Load } from '@/hooks/useLoads';
import { getErrorMessage } from '@/lib/errors';
import { OperationOutcomeDialog } from './OperationOutcomeDialog';
import { OperationCorrectionDialog } from './OperationCorrectionDialog';
import { RedeliveryDialog } from './RedeliveryDialog';
import { useRedelivery } from '@/hooks/useRedelivery';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useDocumentMetadataWrites } from '@/hooks/useDocumentMetadataWrites';
import { useDocumentMetadataDrafts } from '@/hooks/useDocumentMetadataDrafts';
import { DocumentMetadataDialog } from './DocumentMetadataDialog';
import { ADMIN_FIELD_LABELS, type AdminFields, type MetadataItem } from '@/lib/loads/documentMetadata';
import { documentStatusLabel } from '@/lib/status/documentStatus';
import { useOperationDocumentOutcomes } from '@/hooks/useOperationDocumentOutcomes';
import { operationResultMessage, type OperationOutcome } from '@/lib/loads/operationDocumentOutcome';

type LoadNoteDocument = Pick<Tables<'fiscal_documents'>,
  'id' | 'document_type' | 'deleted_at' | 'delivery_meta' | 'client_load_source' |
  'invoice_number' | 'recipient' | 'recipient_city' | 'recipient_neighborhood' |
  'recipient_state' | 'reference_number' | 'remitter' | 'status' | 'value'
> & { is_historical?: boolean; current_delivery_attempt_id?: string | null; operational_metadata?: unknown };

interface Props {
  load: Load;
  documents: LoadNoteDocument[];
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

const getDocObservation = (document: LoadNoteDocument): string => {
  const source = jsonObject(document.client_load_source);
  return String(source.observationSnippet || source.infCpl || source.observation || '');
};

const toLocalDT = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
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
  redelivery?: boolean;
  redelivery_reason?: string;
  redelivery_at?: string;
  correction_of?: string;
  returned_items?: Record<string,number>;
};

const jsonObject = (value: Json): JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
const docMeta = (value: Json): DocMeta => jsonObject(value) as unknown as DocMeta;

export default function LoadNotesPanel({ load, documents, onSaved }: Props) {
  const toast = useSonnerToast();
  const qc = useQueryClient();
  const outcomeWrites=useOperationDocumentOutcomes();
  const redeliveryWrites=useRedelivery();
  const metadataWrites=useDocumentMetadataWrites();
  const {user}=useAuth();const {currentTenant}=useTenant();
  const outcomeBlocked=outcomeWrites.isPending||outcomeWrites.pending.length>0||!!outcomeWrites.recoveryError
    ||redeliveryWrites.isPending||redeliveryWrites.pending.length>0||!!redeliveryWrites.recoveryError
    ||metadataWrites.isPending||metadataWrites.pending.length>0||!!metadataWrites.recoveryError;
  const inboundDocs = useMemo(
    () => documents.filter(document => document.document_type === 'inbound' && !document.deleted_at && !document.is_historical),
    [documents],
  );
  const historicalDocs = documents.filter(document => document.document_type === 'inbound' && document.is_historical);

  const drafts=useDocumentMetadataDrafts(currentTenant?.id,user?.id,load.id,inboundDocs,outcomeBlocked);
  const {dirty}=drafts;
  const meta:Record<string,DocMeta>=Object.fromEntries(inboundDocs.map(document=>[document.id,{
    ...docMeta(document.delivery_meta),
    ...drafts.contexts.get(document.id)?.fields,
    ...(!drafts.stale.includes(document.id)?drafts.rows[document.id]?.changes:{}),
  }]));
  const [metadataReview,setMetadataReview]=useState<{scope:string;items:MetadataItem[];documentLabels:Record<string,string>}|null>(null);
  const [inboundFilters, setInboundFilters] = useState({ invoice: '', recipient: '', neighborhood: '', city: '' });
  const [debouncedInboundFilters, setDebouncedInboundFilters] = useState(inboundFilters);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedInboundFilters(inboundFilters), 300);
    return () => clearTimeout(timeout);
  }, [inboundFilters]);

  const normalizeStr = (v: string) => v.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const filteredDocs = useMemo(() => {
    return inboundDocs.filter((d) => {
      const docInvoice = normalizeStr(d.invoice_number || '');
      const docRecipient = normalizeStr(d.recipient || '');
      const docNeighborhood = normalizeStr(d.recipient_neighborhood || '');
      const docCity = normalizeStr(d.recipient_city || '');

      const fInvoice = normalizeStr(debouncedInboundFilters.invoice);
      const fRecipient = normalizeStr(debouncedInboundFilters.recipient);
      const fNeighborhood = normalizeStr(debouncedInboundFilters.neighborhood);
      const fCity = normalizeStr(debouncedInboundFilters.city);

      if (fInvoice && !docInvoice.includes(fInvoice)) return false;
      if (fRecipient && !docRecipient.includes(fRecipient)) return false;
      if (fNeighborhood && !docNeighborhood.includes(fNeighborhood)) return false;
      if (fCity && !docCity.includes(fCity)) return false;
      return true;
    });
  }, [inboundDocs, debouncedInboundFilters]);

  const [outcomeSelection,setOutcomeSelection]=useState<{docId:string;outcome:OperationOutcome;correction?:boolean}|null>(null);
  const OutcomeDialog=outcomeSelection?.correction?OperationCorrectionDialog:OperationOutcomeDialog;
  const [reModal, setReModal] = useState<{ docId: string; reason: string } | null>(null);
  const [cashToReceive, setCashToReceive] = useState<string>(
    load?.cash_to_receive != null ? String(load.cash_to_receive) : '0',
  );
  const [pixToReceive, setPixToReceive] = useState<string>(
    load?.pix_to_receive != null ? String(load.pix_to_receive) : '0',
  );
  const [savingTotals, setSavingTotals] = useState(false);
  const totalsDirty =
    Number(cashToReceive || 0) !== Number(load?.cash_to_receive || 0)
    || Number(pixToReceive || 0) !== Number(load?.pix_to_receive || 0);

  // Payment suggestions are drafts only. Opening this panel must never update a load or note.

  const saveTotals = async () => {
    setSavingTotals(true);
    try {
      const { error } = await supabase
        .from('loads')
        .update({
          cash_to_receive: Number(cashToReceive || 0),
          pix_to_receive: Number(pixToReceive || 0),
        })
        .eq('id', load.id);
      if (error) throw error;
      toast.success('Totais de fechamento salvos');
      await qc.invalidateQueries({ queryKey: ['load', load.id] });
      await qc.invalidateQueries({ queryKey: ['loads'] });
      onSaved?.();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Erro ao salvar totais'));
    } finally {
      setSavingTotals(false);
    }
  };

  const patchDoc=drafts.patch;
  const markAllCanhotos=()=>{
    for(const document of inboundDocs){
      if(drafts.contexts.get(document.id)?.can_receive_receipt)patchDoc(document.id,{rec_canhoto:true});
    }
  };
  const detectAllPayments=()=>{
    let count=0;
    for(const document of inboundDocs){
      const detected=detectPaymentMethod(getDocObservation(document));
      if(drafts.canEdit(document.id)&&detected&&detected!==meta[document.id]?.payment_method){
        patchDoc(document.id,{payment_method:detected});count++;
      }
    }
    toast.info(count?'Sugestões preparadas em '+count+' nota(s). Revise antes de salvar.':'Nenhuma nova forma de pagamento detectada nas observações');
  };

  const markDelivered = (docId: string) => setOutcomeSelection({docId,outcome:'delivered'});



  const saveAll=()=>{
    if(outcomeBlocked||!dirty.size||drafts.stale.length||!currentTenant?.id||!user?.id)return;
    setMetadataReview({scope:drafts.scope,items:drafts.items(),documentLabels:Object.fromEntries(inboundDocs.map(document=>[
      document.id,[document.invoice_number||document.id.slice(0,8),document.recipient].filter(Boolean).join(' — '),
    ]))});
  };

  return (
    <div className="border rounded-md">
      {historicalDocs.length > 0 ? <section aria-label="Tentativas anteriores desta carga" className="space-y-2 border-b p-3">
        <h3 className="text-sm font-semibold">Tentativas anteriores desta carga — somente leitura</h3>
        <p className="text-xs text-muted-foreground">O saldo foi liberado para outra tentativa. Os resultados desta carga permanecem preservados.</p>
        {historicalDocs.map(document => <p key={document.id} className="text-sm">
          Nota {document.invoice_number || document.id.slice(0, 8)} — {documentStatusLabel(document.status)} — {document.recipient || 'Destinatário não informado'}
        </p>)}
      </section> : null}
      <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-bold uppercase flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3" /> Notas Fiscais ({inboundDocs.length})
        </span>
        <span className="text-[10px] font-normal normal-case text-muted-foreground">
          Carga: {load.load_number}
        </span>
      </div>

      {/* TOTAIS DE FECHAMENTO (entrada manual) */}
      <div className="flex flex-wrap items-end gap-3 px-3 py-2 border-b bg-muted/10">
        <div className="flex flex-col">
          <Label className="text-[10px] uppercase text-muted-foreground">Total a receber em Dinheiro</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={cashToReceive}
            onChange={(e) => setCashToReceive(e.target.value)}
            className="h-7 text-xs w-36 tabular-nums"
          />
        </div>
        <div className="flex flex-col">
          <Label className="text-[10px] uppercase text-muted-foreground">Total a receber em PIX</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={pixToReceive}
            onChange={(e) => setPixToReceive(e.target.value)}
            className="h-7 text-xs w-36 tabular-nums"
          />
        </div>
        <div className="flex flex-col">
          <Label className="text-[10px] uppercase text-muted-foreground">Total Fechamento</Label>
          <div className="h-7 px-2 flex items-center text-xs font-semibold tabular-nums rounded-md border bg-background w-36">
            {fmtMoney(Number(cashToReceive || 0) + Number(pixToReceive || 0))}
          </div>
        </div>
        <Button
          size="sm"
          variant={totalsDirty ? 'default' : 'outline'}
          className="h-7 text-xs"
          onClick={saveTotals}
          disabled={savingTotals || !totalsDirty}
        >
          <Save className="h-3 w-3 mr-1" />
          {savingTotals ? 'Salvando...' : 'Salvar totais'}
        </Button>
      </div>

      {/* AÇÕES EM MASSA */}
      <div className="flex flex-wrap gap-2 px-3 py-2 border-b bg-muted/5">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={markAllCanhotos}
          disabled={!inboundDocs.some(document=>drafts.canEdit(document.id)&&drafts.contexts.get(document.id)?.can_receive_receipt)}
        >
          <CheckCircle2 className="h-3 w-3 mr-1 text-success" />
          Preparar recebimento dos canhotos elegíveis
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => printLoadNotesReport(load, inboundDocs.map(d => ({
            ...d,
            delivery_meta: docMeta(d.delivery_meta),
          })))}
          disabled={!inboundDocs.length}
          title="Gerar relatório imprimível / Salvar como PDF"
        >
          <Printer className="h-3 w-3 mr-1" />
          Imprimir / PDF
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={detectAllPayments}
          disabled={!inboundDocs.some(document=>drafts.canEdit(document.id))}
          title="Re-analisa observações dos XMLs e preenche a forma de pagamento detectada"
        >
          <Wand2 className="h-3 w-3 mr-1" />
          Detectar formas de pagamento
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={saveAll}
          disabled={outcomeBlocked || !dirty.size || drafts.stale.length>0}
          className="h-7 text-xs"
        >
          <Save className="h-3 w-3 mr-1" />
          {`Salvar Notas${dirty.size ? ` (${dirty.size})` : ''}`}
        </Button>
      </div>

      {/* TABELA */}
      {inboundDocs.some(document=>!drafts.contexts.has(document.id))?<p role="status" className="p-3 text-sm">
        Conferência administrativa indisponível para notas sem contexto auditado. Atualize a página após a publicação do contrato de conferência.
      </p>:null}
      {dirty.size>0?<section aria-label="Rascunhos de conferência" className="space-y-2 border-b p-3 text-sm">
        <p>Há {dirty.size} nota(s) com rascunhos ainda não salvos. As ações de baixa e reentrega dessas notas aguardam salvar ou descartar o rascunho.</p>
        {drafts.stale.length>0?<>
          <p role="alert">As notas mudaram desde a edição. A tabela mostra os dados atuais; revise os rascunhos abaixo antes de reaplicá-los. Uma nova tentativa ou resultado exige descartar e conferir novamente.</p>
          {Object.entries(drafts.rows).map(([id,draft])=><p key={id}>Nota {inboundDocs.find(document=>document.id===id)?.invoice_number||id.slice(0,8)}: {Object.entries(draft.changes).map(([field,value])=>`${ADMIN_FIELD_LABELS[field as keyof AdminFields]} → ${typeof value==='boolean'?(value?'Recebido':'Não recebido'):value||'Não informado'}`).join('; ')}</p>)}
          <Button variant="outline" disabled={outcomeBlocked} onClick={()=>{
            if(!drafts.rebase())toast.error('A tentativa ou o resultado mudou. Descarte os rascunhos e confira novamente a nota atual.');
          }}>Revisar rascunhos sobre valores atuais</Button>
        </>:null}
        <Button variant="outline" disabled={outcomeBlocked} onClick={()=>void qc.invalidateQueries({queryKey:['load_documents']})}>Atualizar notas</Button>
        <Button variant="outline" disabled={outcomeBlocked} onClick={()=>drafts.drop(Array.from(dirty))}>Descartar rascunhos</Button>
      </section>:null}
      {/* FILTROS NF */}
      <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b bg-muted/5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input 
            placeholder="Nº NF..." 
            className="h-7 pl-7 text-[11px]" 
            value={inboundFilters.invoice}
            onChange={e => setInboundFilters(f => ({ ...f, invoice: e.target.value }))}
          />
        </div>
        <Input 
          placeholder="Destinatário..." 
          className="h-7 text-[11px]" 
          value={inboundFilters.recipient}
          onChange={e => setInboundFilters(f => ({ ...f, recipient: e.target.value }))}
        />
        <Input 
          placeholder="Bairro..." 
          className="h-7 text-[11px]" 
          value={inboundFilters.neighborhood}
          onChange={e => setInboundFilters(f => ({ ...f, neighborhood: e.target.value }))}
        />
        <Input 
          placeholder="Cidade..." 
          className="h-7 text-[11px]" 
          value={inboundFilters.city}
          onChange={e => setInboundFilters(f => ({ ...f, city: e.target.value }))}
        />
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-[10px] whitespace-nowrap text-center">Rec. Canhoto</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Nº NFS</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">NUMREF</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Situação</TableHead>
              <TableHead className="text-[10px] whitespace-nowrap">Fornecedor</TableHead>
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
            {filteredDocs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="text-center text-xs text-muted-foreground py-6">
                  {inboundDocs.length === 0 ? 'Nenhuma nota fiscal vinculada a esta carga.' : 'Nenhuma nota fiscal corresponde aos filtros.'}
                </TableCell>
              </TableRow>
            ) : filteredDocs.map((d) => {
              const m = meta[d.id] || {};
              const isDelivered = d.status === 'delivered';
              const isPartial = d.status === 'partial_delivery';
              const isFinal = ['delivered','partial_delivery','returned','refused','failed','not_delivered','cancelled'].includes(d.status||'');
              const isNotDelivered = ['not_delivered','returned','refused','failed'].includes(d.status||'') || (!isDelivered&&m.ne);
              return (
                <TableRow key={d.id} className={isNotDelivered ? 'bg-destructive/5' : isDelivered ? 'bg-success/5' : ''}>
                  <TableCell className="p-1 text-center">
                    <Checkbox
                      checked={!!m.rec_canhoto}
                      aria-label={`Canhoto recebido da nota ${d.invoice_number}`}
                      disabled={!drafts.canEdit(d.id)||(!drafts.contexts.get(d.id)?.can_receive_receipt&&!m.rec_canhoto)}
                      onCheckedChange={v => patchDoc(d.id, { rec_canhoto: !!v })}
                    />
                  </TableCell>
                  <TableCell className="text-xs font-semibold whitespace-nowrap">{d.invoice_number || '—'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{d.reference_number || '0'}</TableCell>
                  <TableCell className="text-xs">
                    {isPartial ? <Badge variant="outline" className="text-[10px]">Entrega parcial</Badge> : isNotDelivered ? (
                      <Badge variant="destructive" className="text-[10px]" title={m.ne_reason || ''}>Não Entregue</Badge>
                    ) : isDelivered ? (
                      <Badge className="text-[10px] bg-success text-success-foreground">Entregue</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">Pendente</Badge>
                    )}
                    {m.redelivery && (
                      <Badge variant="outline" className="text-[10px] ml-1 border-info/40 text-info" title={m.redelivery_reason || ''}>
                        Reentrega
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs max-w-[160px] truncate" title={d.remitter || ''}>
                    {d.remitter || '—'}
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
                    <div className="flex items-center gap-1">
                      <SearchableSelect
                        value={m.payment_method || '__none__'}
                        ariaLabel={`Forma de pagamento da nota ${d.invoice_number}`}
                        disabled={!drafts.canEdit(d.id)}
                        onChange={v => patchDoc(d.id, { payment_method: v === '__none__' ? '' : v })}
                        options={PAYMENT_METHODS}
                        placeholder="—"
                        className="h-7 w-32"
                      />
                      {getDocObservation(d) && (
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                disabled={!drafts.canEdit(d.id)}
                                aria-label={`Sugerir pagamento pela observação da nota ${d.invoice_number}`}
                                className="text-muted-foreground hover:text-primary"
                                onClick={() => {
                                  const detected = detectPaymentMethod(getDocObservation(d));
                                  if (detected) {
                                    patchDoc(d.id, { payment_method: detected });
                                    toast.info(`Sugestão: ${PAYMENT_METHODS.find(p => p.value === detected)?.label}. Revise antes de salvar.`);
                                  } else {
                                    toast.info('Nenhum padrão de pagamento identificado na observação');
                                  }
                                }}
                                title="Ver observação da NF / Detectar pagamento"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs whitespace-pre-wrap">
                              {getDocObservation(d)}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.oco_01 || ''}
                      ariaLabel={`Ocorrência 01 da nota ${d.invoice_number}`}
                      disabled={!drafts.canEdit(d.id)}
                      onChange={v => patchDoc(d.id, { oco_01: v })}
                      options={OCO_CODES}
                      placeholder="—"
                      className="h-7 w-24"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.oco_02 || ''}
                      ariaLabel={`Ocorrência 02 da nota ${d.invoice_number}`}
                      disabled={!drafts.canEdit(d.id)}
                      onChange={v => patchDoc(d.id, { oco_02: v })}
                      options={OCO_CODES}
                      placeholder="—"
                      className="h-7 w-24"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <SearchableSelect
                      value={m.resp_oco || '__none__'}
                      ariaLabel={`Responsável pela ocorrência da nota ${d.invoice_number}`}
                      disabled={!drafts.canEdit(d.id)}
                      onChange={v => patchDoc(d.id, { resp_oco: v === '__none__' ? '' : v })}
                      options={OCO_RESPONSIBLES}
                      placeholder="—"
                      className="h-7 w-28"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <Input
                      type="datetime-local"
                      value={toLocalDT(m.delivery_at||m.ne_at)}
                      readOnly
                      aria-label={'Data e hora auditadas da nota '+d.invoice_number}
                      title="Use Registrar ou Corrigir resultado para alterar a data auditada."
                      className="h-7 text-xs w-40"
                    />
                  </TableCell>
                  <TableCell className="p-1">
                    <div className="flex items-center gap-1 justify-center">
                      <Button
                        size="sm"
                        variant={isDelivered ? 'default' : 'outline'}
                        className={`h-7 px-2 text-[10px] ${isDelivered ? 'bg-success hover:bg-success/90 text-success-foreground' : 'text-success border-success/40 hover:bg-success/10'}`}
                        onClick={() => markDelivered(d.id)}
                        disabled={outcomeBlocked||isFinal||dirty.has(d.id)}
                        title={isFinal ? 'Use Corrigir resultado para revisar a baixa registrada' : 'Marcar como Entregue (sincroniza no sistema)'}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Entregue
                      </Button>
                      <Button
                        size="sm"
                        variant={isNotDelivered ? 'destructive' : 'outline'}
                        className={`h-7 px-2 text-[10px] ${isNotDelivered ? '' : 'text-destructive border-destructive/40 hover:bg-destructive/10'}`}
                        onClick={() => setOutcomeSelection({docId:d.id,outcome:'not_delivered'})}
                        disabled={outcomeBlocked||isFinal||dirty.has(d.id)}
                        title={isFinal ? 'Use Corrigir resultado para revisar a baixa registrada' : 'Marcar como Não Entregue (exige observação)'}
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Não Entregue
                      </Button>
                      {isFinal?<Button size="sm" variant="outline" disabled={outcomeBlocked||dirty.has(d.id)}
                        onClick={()=>setOutcomeSelection({docId:d.id,outcome:'delivered',correction:true})}>Corrigir resultado</Button>:null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[10px] text-info border-info/40 hover:bg-info/10"
                        onClick={() => setReModal({ docId: d.id, reason: m.redelivery_reason || '' })}
                        disabled={outcomeBlocked||dirty.has(d.id)}
                        title="Marcar para Reentrega — libera nota para entrar na próxima carga"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" /> Reentrega
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
                <TableCell colSpan={7} className="text-xs text-right">Total:</TableCell>
                <TableCell className="text-xs text-right whitespace-nowrap">
                  {fmtMoney(inboundDocs.reduce((sum, document) => sum + Number(document.value || 0), 0))}
                </TableCell>
                <TableCell colSpan={6} />
              </TableRow>
              <TableRow className="bg-muted/20 text-[11px]">
                <TableCell colSpan={7} className="text-right text-muted-foreground">Fechamento — Dinheiro / PIX:</TableCell>
                <TableCell className="text-right whitespace-nowrap font-medium">
                  {fmtMoney(Number(load?.cash_to_receive || 0))} <span className="text-muted-foreground">+</span> {fmtMoney(Number(load?.pix_to_receive || 0))}
                </TableCell>
                <TableCell colSpan={6} className="text-xs font-semibold">
                  = {fmtMoney(Number(load?.cash_to_receive || 0) + Number(load?.pix_to_receive || 0))}
                </TableCell>
              </TableRow>
            </TableBody>
          )}
        </Table>
      </div>

      {outcomeSelection?<OutcomeDialog loadId={load.id} documentId={outcomeSelection.docId}
        invoiceNumber={inboundDocs.find(d=>d.id===outcomeSelection.docId)?.invoice_number||'—'} outcome={outcomeSelection.outcome}
        onClose={()=>setOutcomeSelection(null)} onConfirmed={result=>{
          drafts.drop([result.document_id]);
          toast.success(operationResultMessage(result));onSaved?.();
        }}/>:null}

      {reModal ? <RedeliveryDialog loadId={load.id} documentId={reModal.docId}
        invoiceNumber={inboundDocs.find(document => document.id === reModal.docId)?.invoice_number || '—'}
        onClose={() => setReModal(null)} onConfirmed={result => {
          drafts.drop([result.document_id]);
          toast.success('Reentrega confirmada; histórico preservado e saldo disponível para nova carga.');
          onSaved?.();
        }} /> : null}
      {metadataReview?.scope===drafts.scope&&currentTenant?.id&&user?.id?<DocumentMetadataDialog
        loadId={load.id} tenantId={currentTenant.id} actorId={user.id} items={metadataReview.items} documentLabels={metadataReview.documentLabels}
        onClose={()=>setMetadataReview(null)} onConfirmed={result=>{
          drafts.drop(result.items.map(item=>item.document_id));
          toast.success(`Conferência confirmada em ${result.document_count} nota(s); resultados de entrega preservados.`);
          onSaved?.();
        }}/>:null}
    </div>
  );
}
