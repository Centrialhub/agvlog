import {useState,useMemo,useRef,useEffect} from 'react';
import {useEligibleCtes,useEligibleNfse,fetchCteFiscalDocs,type ClientInvoiceChargeDraft,type ClientInvoiceDetailDraft,type CreateClientInvoicePayload} from '@/hooks/useClientInvoices';
import {useClientInvoiceLifecycle} from '@/hooks/useClientInvoiceLifecycle';
import type {InvoiceCreationContext} from '@/lib/financial/clientInvoiceCommands';
import type {Client} from '@/hooks/useClients';
import {useTenant} from '@/hooks/useTenant';
import {useAuth} from '@/hooks/useAuth';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Badge} from '@/components/ui/badge';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Textarea} from '@/components/ui/textarea';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Checkbox} from '@/components/ui/checkbox';
import {Plus,FileText} from 'lucide-react';
import {useSonnerToast} from '@/hooks/useSonnerToast';
import {computeInvoiceTotals} from '@/lib/clientInvoicePdf';
import type {Json} from '@/integrations/supabase/types';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '-';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const isJsonObject = (value: unknown): value is { [key: string]: Json | undefined } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const jsonString = (value: unknown) => typeof value === 'string' ? value : null;
const jsonNumber = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
type ManualService = { id: string; description: string; reference_number: string; gross_amount: string; net_amount: string; ir_amount: string; notes: string };

type WizardProps={open:boolean;onClose:()=>void;clients:Client[];onGenerated:(id:string)=>void};
export function NewInvoiceWizard(props:WizardProps){
 const {currentTenant}=useTenant();const {user}=useAuth();
 return <InvoiceWizardForm key={currentTenant?.id+':'+user?.id} {...props}/>;
}
function InvoiceWizardForm({open,onClose,clients,onGenerated}:WizardProps){
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>('');
  const [discount, setDiscount] = useState<string>('0');
  const [interest, setInterest] = useState<string>('0');
  const [notes, setNotes] = useState('');
  const [selectedCtes, setSelectedCtes] = useState<Set<string>>(new Set());
  const [selectedNfses, setSelectedNfses] = useState<Set<string>>(new Set());
  const [manuals, setManuals] = useState<ManualService[]>([]);
  const api=useClientInvoiceLifecycle();
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const [previewBusy,setPreviewBusy]=useState(false);const previewLock=useRef(false);
  const [draft,setDraft]=useState<CreateClientInvoicePayload|null>(null);
  const [quote,setQuote]=useState<InvoiceCreationContext|null>(null);
  const [reason,setReason]=useState('');const [error,setError]=useState('');

  const cteQuery=useEligibleCtes(clientId||null),nfseQuery=useEligibleNfse(clientId||null);
  const ctes=cteQuery.data||[],nfses=nfseQuery.data||[];
  const sourceError=cteQuery.error||nfseQuery.error;const sourceBusy=cteQuery.isFetching||nfseQuery.isFetching;

  const reset = () => {
    setStep(1); setClientId(''); setDueDate(''); setDiscount('0'); setInterest('0'); setNotes('');
    setSelectedCtes(new Set()); setSelectedNfses(new Set()); setManuals([]);setDraft(null);setQuote(null);setReason('');setError('');setPreviewCharges([]);
  };

  const closeAll = () => { reset(); onClose(); };

  // Build charges from selection
  const buildCharges = async (): Promise<ClientInvoiceChargeDraft[]> => {
    const tenantId = currentTenant?.id;
    if (!tenantId) throw new Error('Tenant ativo não encontrado.');
    if(sourceError||sourceBusy)throw new Error('Aguarde uma consulta válida de CT-e e NFS-e antes de gerar a prévia.');
    const chosenCtes=ctes.filter(c=>selectedCtes.has(c.id)),chosenNfses=nfses.filter(n=>selectedNfses.has(n.id));
    if(chosenCtes.length!==selectedCtes.size||chosenNfses.length!==selectedNfses.size)throw new Error('Uma origem selecionada não está mais disponível. Revise a seleção sem omitir documentos.');
    const fiscalIds=[...new Set(chosenCtes.flatMap(c=>c.fiscal_document_ids||[]))];
    const allFiscalDocs=await fetchCteFiscalDocs(tenantId,fiscalIds);
    if(fiscalIds.some(id=>!allFiscalDocs.some(fd=>fd.id===id)))throw new Error('Detalhes fiscais incompletos. Atualize as origens antes de faturar.');
    const charges: ClientInvoiceChargeDraft[] = [];
    let sort = 0;

    for (const cte of chosenCtes) {
      const details: ClientInvoiceDetailDraft[] = [];
      const fdIds: string[] = cte.fiscal_document_ids || [];
      if (fdIds.length) {
        const fds = allFiscalDocs.filter(fd=>fdIds.includes(fd.id));
        fds.forEach((fd, idx) => {
          details.push({
            source_type: 'fiscal_document',
            source_id: fd.id,
            emission_date: fd.issue_date,
            document_label: 'NF',
            document_number: fd.invoice_number,
            destination: [fd.recipient_city, fd.recipient_state].filter(Boolean).join('/'),
            remitter: fd.remitter,
            recipient: fd.recipient,
            weight_kg: fd.weight_kg,
            cargo_value: fd.value,
            displayed_freight_value: cte.freight_value,
            sort_order: idx,
          });
        });
      }
      charges.push({
        source_type: 'cte_document',
        source_id: cte.id,
        source_number: cte.cte_number,
        source_series: cte.cte_series,
        issue_date: cte.issued_at?.slice(0, 10),
        description: `CT-e ${cte.cte_number || ''}`,
        gross_amount: Number(cte.freight_value || 0),
        net_amount: Number(cte.freight_value || 0),
        sort_order: sort++,
        details,
      });
    }

    for (const n of chosenNfses) {
      const items = Array.isArray(n.items) ? n.items.filter(isJsonObject) : [];
      const details: ClientInvoiceDetailDraft[] = items.length ? items.map((item, idx) => ({
        source_type: 'nfse_item',
        emission_date: n.issue_date,
        document_label: 'NFS-e',
        document_number: n.nfse_number,
        ort_number: jsonString(item.ort_number) || n.reference_number,
        destination: n.cliente_municipio,
        remitter: jsonString(item.description) || n.description,
        cargo_value: jsonNumber(item.value),
        displayed_freight_value: Number(n.valor_total || 0),
        sort_order: idx,
      })) : [];
      charges.push({
        source_type: 'nfse_document',
        source_id: n.id,
        source_number: n.nfse_number,
        source_series: n.series,
        reference_number: n.reference_number,
        issue_date: n.issue_date,
        description: n.description || `NFS-e ${n.nfse_number || ''}`,
        gross_amount: Number(n.valor_total || 0),
        ir_amount: Number(n.valor_ir || 0),
        net_amount: Number(n.valor_liquido || n.valor_total || 0),
        sort_order: sort++,
        details,
      });
    }

    for (const m of manuals) {
      charges.push({
        source_type: 'manual_service',
        source_number: m.reference_number,
        reference_number: m.reference_number,
        issue_date: issueDate,
        description: m.description,
        gross_amount: Number(m.gross_amount || 0),
        ir_amount: Number(m.ir_amount || 0),
        net_amount: Number(m.net_amount || m.gross_amount || 0),
        sort_order: sort++,
      });
    }
    return charges;
  };

  const [previewCharges, setPreviewCharges] = useState<ClientInvoiceChargeDraft[]>([]);
  const goPreview=async()=>{
    if(previewLock.current)return;previewLock.current=true;setPreviewBusy(true);setError('');setQuote(null);setDraft(null);
    try{const charges=await buildCharges();if(!alive.current)return;if(!currentTenant||!charges.length)throw new Error('Selecione ao menos um documento ou adicione um serviço.');
      const candidate:CreateClientInvoicePayload={tenant_id:currentTenant.id,client_id:clientId,issue_date:issueDate,due_date:dueDate||null,discount_amount:Number(discount||0),interest_amount:Number(interest||0),notes:notes||null,charges};
      const context=await api.quote(candidate);if(!alive.current)return;
      const total=computeInvoiceTotals(charges,candidate.discount_amount,candidate.interest_amount).total;
      if(!context.can_generate||context.client_id!==clientId||context.amount_cents!==Math.round(total*100))throw new Error('Prévia financeira divergente. Confira os valores antes de continuar.');
      setDraft(candidate);setQuote(context);setPreviewCharges(charges);setStep(3);
    }catch(cause){if(alive.current)setError('Falha ao montar a prévia: '+errorMessage(cause));}
    finally{previewLock.current=false;if(alive.current)setPreviewBusy(false);}
  };

  const totals = useMemo(() => computeInvoiceTotals(previewCharges, Number(discount || 0), Number(interest || 0)), [previewCharges, discount, interest]);
  const hasCteMultiNf = previewCharges.some(c => c.source_type === 'cte_document' && (c.details?.length || 0) > 1);

  const generate=async()=>{
    if(!draft||!quote)return;setError('');
    try{const result=await api.submit({action:'generate',draft,expected_revision:quote.revision,reason});
      if(!alive.current)return;toast.success('Fatura gerada com confirmação auditada');onGenerated(result.invoice_id);reset();
    }catch(cause){if(alive.current)setError('Falha ao gerar fatura: '+errorMessage(cause));}
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && closeAll()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Fatura — Etapa {step} de 4</DialogTitle>
          <DialogDescription>Geração de cobrança comercial, sem emissão fiscal ou envio externo.</DialogDescription>
        </DialogHeader>

        {error?<p role="alert">{error}</p>:null}
        {sourceError?<p role="alert">Falha na consulta de origens. <Button variant="outline" onClick={()=>{void cteQuery.refetch();void nfseQuery.refetch();}}>Reconsultar origens</Button></p>:null}
        {sourceBusy&&step===2?<p role="status">Consultando documentos…</p>:null}
        {api.pending?<p role="alert">Há pedido de fatura sem confirmação. Recupere-o no painel global antes de gerar outra.</p>:null}
        {api.recoveryError?<p role="alert">{api.recoveryError}</p>:null}
        <fieldset disabled={previewBusy||api.isPending}>
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="invoice-client">Cliente *</Label>
                <Select value={clientId} onValueChange={id=>{setClientId(id);setSelectedCtes(new Set());setSelectedNfses(new Set());setQuote(null);setDraft(null);setPreviewCharges([]);}}>
                  <SelectTrigger id="invoice-client"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clients.map(c => (<SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="invoice-issue">Emissão</Label><Input id="invoice-issue" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
              <div><Label htmlFor="invoice-due">Vencimento</Label><Input id="invoice-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div><Label htmlFor="invoice-discount">Desconto (R$)</Label><Input id="invoice-discount" type="number" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></div>
              <div><Label htmlFor="invoice-interest">Juros (R$)</Label><Input id="invoice-interest" type="number" step="0.01" value={interest} onChange={e => setInterest(e.target.value)} /></div>
              <div className="col-span-2"><Label htmlFor="invoice-notes">Observação</Label><Textarea id="invoice-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <Tabs defaultValue="ctes">
            <TabsList>
              <TabsTrigger value="ctes">CT-e / CTRC ({ctes.length})</TabsTrigger>
              <TabsTrigger value="nfses">NFS-e / ORT ({nfses.length})</TabsTrigger>
              <TabsTrigger value="manual">Serviços avulsos ({manuals.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="ctes" className="mt-4">
              <div className="max-h-[400px] overflow-y-auto border rounded">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>CT-e</TableHead><TableHead>Emissão</TableHead><TableHead>Destinatário</TableHead><TableHead className="text-right">Frete</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {ctes.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Nenhum CT-e elegível.</TableCell></TableRow>)}
                    {ctes.map(c => (
                      <TableRow key={c.id}>
                        <TableCell><Checkbox aria-label={'Selecionar CT-e '+c.cte_number} checked={selectedCtes.has(c.id)} onCheckedChange={v => { const s = new Set(selectedCtes); if (v) s.add(c.id); else s.delete(c.id); setSelectedCtes(s); }} /></TableCell>
                        <TableCell>{c.cte_number}{c.cte_series ? '/' + c.cte_series : ''}</TableCell>
                        <TableCell>{dt(c.issued_at)}</TableCell>
                        <TableCell className="text-xs">{c.recipient} — {c.recipient_city}/{c.recipient_state}</TableCell>
                        <TableCell className="text-right">{brl(Number(c.freight_value || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
            <TabsContent value="nfses" className="mt-4">
              <div className="max-h-[400px] overflow-y-auto border rounded">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>NFS-e</TableHead><TableHead>Emissão</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {nfses.length === 0 && (<TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">Nenhuma NFS-e elegível.</TableCell></TableRow>)}
                    {nfses.map(n => (
                      <TableRow key={n.id}>
                        <TableCell><Checkbox aria-label={'Selecionar NFS-e '+n.nfse_number} checked={selectedNfses.has(n.id)} onCheckedChange={v => { const s = new Set(selectedNfses); if (v) s.add(n.id); else s.delete(n.id); setSelectedNfses(s); }} /></TableCell>
                        <TableCell>{n.nfse_number}</TableCell>
                        <TableCell>{dt(n.issue_date)}</TableCell>
                        <TableCell className="text-xs">{n.description || n.reference_number}</TableCell>
                        <TableCell className="text-right">{brl(Number(n.valor_total || 0))}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
            <TabsContent value="manual" className="mt-4 space-y-3">
              {manuals.map(m => (
                <div key={m.id} className="grid grid-cols-6 gap-2 items-end border p-2 rounded">
                  <div className="col-span-2"><Label htmlFor={m.id+'-description'} className="text-xs">Descrição</Label><Input id={m.id+'-description'} value={m.description} onChange={e => { setManuals(rows=>rows.map(row=>row.id===m.id?{...row,description:e.target.value}:row)); }} /></div>
                  <div><Label htmlFor={m.id+'-reference_number'} className="text-xs">Referência</Label><Input id={m.id+'-reference_number'} value={m.reference_number} onChange={e => { setManuals(rows=>rows.map(row=>row.id===m.id?{...row,reference_number:e.target.value}:row)); }} /></div>
                  <div><Label htmlFor={m.id+'-gross_amount'} className="text-xs">Bruto</Label><Input id={m.id+'-gross_amount'} type="number" step="0.01" value={m.gross_amount} onChange={e => { setManuals(rows=>rows.map(row=>row.id===m.id?{...row,gross_amount:e.target.value}:row)); }} /></div>
                  <div><Label htmlFor={m.id+'-net_amount'} className="text-xs">Líquido</Label><Input id={m.id+'-net_amount'} type="number" step="0.01" value={m.net_amount} onChange={e => { setManuals(rows=>rows.map(row=>row.id===m.id?{...row,net_amount:e.target.value}:row)); }} /></div>
                  <div><Button variant="ghost" size="sm" onClick={() => setManuals(manuals.filter(x => x.id !== m.id))}>Remover</Button></div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setManuals([...manuals, { id: crypto.randomUUID(), description: '', reference_number: '', gross_amount: '0', net_amount: '0', ir_amount: '0', notes: '' }])}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar serviço avulso
              </Button>
            </TabsContent>
          </Tabs>
        )}

        {step === 3 && (
          <div className="space-y-3">
            {hasCteMultiNf && (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded p-2 text-amber-900">
                ⚠️ Um ou mais CT-e possuem várias NFs. O valor do frete é contado <b>uma única vez</b> por CT-e (as linhas de detalhe são apenas apresentação).
              </div>
            )}
            <div className="border rounded overflow-hidden">
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Referência</TableHead><TableHead>Descrição</TableHead><TableHead>Linhas</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>
                  {previewCharges.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge variant="outline">{c.source_type === 'cte_document' ? 'CT-e' : c.source_type === 'nfse_document' ? 'NFS-e' : 'Serviço'}</Badge></TableCell>
                      <TableCell>{c.source_number || c.reference_number}</TableCell>
                      <TableCell className="text-xs">{c.description}</TableCell>
                      <TableCell>{c.details?.length || 0}</TableCell>
                      <TableCell className="text-right">{brl(c.gross_amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <div className="w-72 space-y-1 text-sm">
                <div className="flex justify-between"><span>Bruto</span><span>{brl(totals.gross)}</span></div>
                <div className="flex justify-between"><span>(-) Desconto</span><span>{brl(totals.discount)}</span></div>
                <div className="flex justify-between"><span>(+) Juros</span><span>{brl(totals.interest)}</span></div>
                <div className="flex justify-between font-semibold border-t pt-1 text-base"><span>Total</span><span>{brl(totals.total)}</span></div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="text-center py-8 space-y-3">
            <FileText className="h-16 w-16 mx-auto text-primary" />
            <p className="text-lg font-medium">Pronto para gerar a fatura?</p>
            <p className="text-sm text-muted-foreground">Um título único de {brl(totals.total)} será criado em Contas a Receber.</p>
            <label className="block text-left">Motivo do faturamento<Input maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
          </div>
        )}

        </fieldset>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" onClick={closeAll}>Cancelar</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" disabled={api.isPending||previewBusy} onClick={() => {setStep(step-1);if(step<=3){setDraft(null);setQuote(null);}}}>Voltar</Button>}
            {step === 1 && <Button disabled={!clientId} onClick={() => setStep(2)}>Avançar</Button>}
            {step === 2 && <Button disabled={previewBusy||sourceBusy||!!sourceError||!!api.pending||!!api.recoveryError} onClick={goPreview}>{previewBusy?'Consultando prévia…':'Ver prévia'}</Button>}
            {step === 3 && <Button onClick={() => setStep(4)}>Avançar</Button>}
            {step === 4 && <Button onClick={generate} disabled={api.isPending||!quote||!draft||reason.trim().length<5||!!api.pending||!!api.recoveryError}>{api.isPending ? 'Gerando...' : 'Gerar fatura'}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
