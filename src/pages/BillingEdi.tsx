import { useEffect, useMemo, useState } from 'react';
import { DataPagination } from '@/components/ui/data-pagination';
import { localDateInputValue } from '@/lib/utils/formatDate';
import {
  useEdiProfiles, useEdiExports, useEligibleInvoicesForEdi, useRegisterEdiExport,
  useMarkEdiSent, useMarkEdiDownloaded, useCancelEdiExport, useSaveEdiProfile,
  fetchInvoicesBundle, type EligibleInvoice, type EdiProfile, type EdiExport, type EdiProfileDraft,
  fetchEdiExportContent, EDI_HISTORY_PAGE_SIZE,
  EDI_ELIGIBLE_PAGE_SIZE,
} from '@/hooks/useBillingEdi';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Download, FileText, Send, XCircle, Settings, RefreshCw } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { generateDoccob } from '@/lib/doccob/doccobGenerator';
import { validateDoccobExportInput, resolveFileName, validateFileName } from '@/lib/doccob/doccobValidator';
import { isValidCnpj } from '@/lib/fiscal/insuranceValidation';
import type { DoccobBuildInput, DoccobInvoiceInput, DoccobChargeInput, DoccobDetailInput } from '@/lib/doccob/doccobTypes';
import type { Json, Tables } from '@/integrations/supabase/types';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '-';

function jsonObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const jsonString = (value: Json | undefined, key: string) => {
  const candidate = jsonObject(value)[key];
  return typeof candidate === 'string' ? candidate : '';
};

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function BillingEdi() {
  const { currentTenant } = useTenant();
  const clientsQuery = useClients();const clients=clientsQuery.data??[];
  const profilesQuery = useEdiProfiles();const profiles=useMemo(()=>profilesQuery.data??[],[profilesQuery.data]);
  const [historyPage,setHistoryPage]=useState(1);
  const exportsQuery = useEdiExports(historyPage);const exports_=exportsQuery.data?.rows??[],loadingExports=exportsQuery.isLoading;

  const [clientFilter, setClientFilter] = useState<string>('all');
  const [ediStatusFilter, setEdiStatusFilter] = useState<'all' | 'generated' | 'not_generated'>('not_generated');
  const [issueFrom, setIssueFrom] = useState('');
  const [issueTo, setIssueTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [invoicePage,setInvoicePage]=useState(1);
  const issuePeriodInvalid = Boolean(issueFrom && issueTo && issueFrom > issueTo);
  const duePeriodInvalid = Boolean(dueFrom && dueTo && dueFrom > dueTo);
  const invalidPeriod = issuePeriodInvalid || duePeriodInvalid;

  const eligibleFilters = {
    clientId: clientFilter === 'all' ? null : clientFilter,
    ediStatus: ediStatusFilter,
    issueFrom: issueFrom || null,
    issueTo: issueTo || null,
    dueFrom: dueFrom || null,
    dueTo: dueTo || null,
    enabled: !invalidPeriod,
  };
  const eligibleQuery = useEligibleInvoicesForEdi(eligibleFilters,invoicePage);
  const eligible=useMemo(()=>eligibleQuery.data?.rows??[],[eligibleQuery.data?.rows]),eligibleTotal=eligibleQuery.data?.total??0,isLoading=eligibleQuery.isLoading,refetch=eligibleQuery.refetch;
  const readError=clientsQuery.isError||profilesQuery.isError||eligibleQuery.isError||exportsQuery.isError;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genOpen, setGenOpen] = useState(false);
  const [profileDlgOpen, setProfileDlgOpen] = useState(false);

  useEffect(() => {
    setGenOpen(false); setProfileDlgOpen(false); setSelected(new Set());
    setClientFilter('all'); setIssueFrom(''); setIssueTo(''); setDueFrom(''); setDueTo(''); setHistoryPage(1);
  }, [currentTenant?.id]);
  useEffect(()=>{setInvoicePage(1);setSelected(new Set());},[clientFilter,ediStatusFilter,issueFrom,issueTo,dueFrom,dueTo,currentTenant?.id]);

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(s => s.size === eligible.length ? new Set() : new Set(eligible.map(e => e.id)));

  const selectedInvoices = useMemo(() => eligible.filter(i => selected.has(i.id)), [eligible, selected]);
  useEffect(()=>{const available=new Set(eligible.map(row=>row.id));setSelected(current=>{
    const next=new Set([...current].filter(id=>available.has(id)));return next.size===current.size?[...next].every(id=>current.has(id))?current:next:next;
  });},[eligible]);
  const singleClientId = useMemo(() => {
    const ids = new Set(selectedInvoices.map(i => i.client_id));
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [selectedInvoices]);

  const applicableProfiles = useMemo(() => {
    const specific = singleClientId ? profiles.filter(profile => profile.enabled && profile.client_id === singleClientId) : [];
    return specific.length > 0 ? specific : profiles.filter(profile => profile.enabled && !profile.client_id);
  }, [profiles, singleClientId]);
  const profileAmbiguous = applicableProfiles.length > 1;
  const clientProfile = applicableProfiles.length === 1 ? applicableProfiles[0] : null;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">CTMS — Arquivo de Cobrança (DOCCOB)</h1>
          <p className="text-sm text-muted-foreground">
            Gere arquivos DOCCOB TXT a partir de faturas de cliente já liberadas.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setProfileDlgOpen(true)}>
            <Settings className="h-4 w-4 mr-2" /> Perfis DOCCOB
          </Button>
        </div>
      </div>

      <Tabs defaultValue="generate">
        {readError&&<Card><CardContent className="py-4" role="alert">Não foi possível carregar todos os dados do DOCCOB. Resultados indisponíveis não serão exibidos como vazios. <Button variant="outline" onClick={()=>void Promise.all([clientsQuery,profilesQuery,eligibleQuery,exportsQuery].filter(query=>query.isError).map(query=>query.refetch()))}>Tentar novamente</Button></CardContent></Card>}
        <div className="-m-1 overflow-x-auto p-1">
          <TabsList className="h-auto min-w-max justify-start">
            <TabsTrigger value="generate">Gerar arquivo</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader><h2 className="text-base font-semibold leading-none tracking-tight">Filtros</h2></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label htmlFor="billing-edi-client">Cliente</Label>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger id="billing-edi-client"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="billing-edi-status">Filtro Arq EDI</Label>
                <Select value={ediStatusFilter} onValueChange={(v) => setEdiStatusFilter(v as typeof ediStatusFilter)}>
                  <SelectTrigger id="billing-edi-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_generated">Não Gerado</SelectItem>
                    <SelectItem value="generated">Gerado</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label htmlFor="billing-edi-issue-from">Emissão de</Label><Input id="billing-edi-issue-from" type="date" max={issueTo || undefined} value={issueFrom} onChange={e => setIssueFrom(e.target.value)} /></div>
              <div><Label htmlFor="billing-edi-issue-to">Emissão até</Label><Input id="billing-edi-issue-to" type="date" min={issueFrom || undefined} value={issueTo} onChange={e => setIssueTo(e.target.value)} /></div>
              <div><Label htmlFor="billing-edi-due-from">Vencimento de</Label><Input id="billing-edi-due-from" type="date" max={dueTo || undefined} value={dueFrom} onChange={e => setDueFrom(e.target.value)} /></div>
              <div><Label htmlFor="billing-edi-due-to">Vencimento até</Label><Input id="billing-edi-due-to" type="date" min={dueFrom || undefined} value={dueTo} onChange={e => setDueTo(e.target.value)} /></div>
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button variant="outline" disabled={invalidPeriod} onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" /> Buscar</Button>
                <Button
                  disabled={selectedInvoices.length === 0 || profileAmbiguous}
                  onClick={() => setGenOpen(true)}
                >
                  <FileText className="h-4 w-4 mr-2" /> Gerar DOCCOB ({selectedInvoices.length})
                </Button>
              </div>
              {profileAmbiguous && (
                <p role="alert" className="text-sm text-destructive md:col-span-4">
                  Existem {applicableProfiles.length} perfis DOCCOB ativos aplicáveis. Desative a duplicidade em Configurar perfis antes de gerar.
                </p>
              )}
              {invalidPeriod ? <p role="alert" className="text-sm text-destructive md:col-span-4">A data inicial não pode ser posterior à data final.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><h2 className="text-base font-semibold leading-none tracking-tight">Faturas elegíveis</h2></CardHeader>
            <CardContent>
              <Table scrollLabel="Faturas elegíveis para DOCCOB; deslize horizontalmente para ver todas as colunas" className="min-w-[52rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox aria-label="Selecionar todas as faturas elegíveis" checked={eligible.length > 0 && eligible.every(row=>selected.has(row.id))} onCheckedChange={toggleAll} /></TableHead>
                    <TableHead>EDI</TableHead>
                    <TableHead>TP</TableHead>
                    <TableHead>Nº Fatura</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Emissão</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground"><span role="status">Carregando...</span></TableCell></TableRow>}
                  {!isLoading && !eligibleQuery.isError && eligible.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground"><span role="status">Nenhuma fatura elegível.</span></TableCell></TableRow>}
                  {eligible.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell><Checkbox aria-label={`Selecionar fatura ${inv.invoice_number} de ${inv.clients?.company_name || 'cliente não informado'}`} checked={selected.has(inv.id)} onCheckedChange={() => toggle(inv.id)} /></TableCell>
                      <TableCell><Badge variant={inv.edi_status === 'not_generated' ? 'outline' : 'secondary'}>{inv.edi_status === 'not_generated' ? 'Não gerado' : 'Gerado'}</Badge></TableCell>
                      <TableCell>FAT</TableCell>
                      <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                      <TableCell>{inv.clients?.company_name || '—'}</TableCell>
                      <TableCell>{dt(inv.issue_date)}</TableCell>
                      <TableCell>{dt(inv.due_date)}</TableCell>
                      <TableCell className="text-right">{brl(inv.total_amount)}</TableCell>
                      <TableCell><Badge variant="outline">{inv.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataPagination page={invoicePage} pageCount={Math.max(1,Math.ceil(eligibleTotal/EDI_ELIGIBLE_PAGE_SIZE))} totalCount={eligibleTotal} start={eligibleTotal?(invoicePage-1)*EDI_ELIGIBLE_PAGE_SIZE+1:0} end={Math.min(invoicePage*EDI_ELIGIBLE_PAGE_SIZE,eligibleTotal)} onPageChange={setInvoicePage}/>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab exports_={exports_} total={exportsQuery.data?.total??0} page={historyPage} setPage={setHistoryPage} loading={loadingExports} failed={exportsQuery.isError} retry={()=>void exportsQuery.refetch()} />
        </TabsContent>
      </Tabs>

      {genOpen && (
        <GenerateDialog
          key={`generate:${currentTenant?.id ?? 'none'}`}
          open={genOpen}
          onClose={() => setGenOpen(false)}
          selectedInvoices={selectedInvoices}
          singleClientId={singleClientId}
          profile={clientProfile}
          onSuccess={() => { setSelected(new Set()); refetch(); }}
        />
      )}

      {profileDlgOpen && (
        <ProfileDialog key={`profile:${currentTenant?.id ?? 'none'}`} open={profileDlgOpen} onClose={() => setProfileDlgOpen(false)} clients={clients} profiles={profiles} />
      )}
    </div>
  );
}

function HistoryTab({ exports_,total,page,setPage,loading,failed,retry }: { exports_: EdiExport[];total:number;page:number;setPage:(page:number)=>void;loading:boolean;failed:boolean;retry:()=>void }) {
  const toast = useSonnerToast();
  const {currentTenant}=useTenant();
  const markSent = useMarkEdiSent();
  const markDl = useMarkEdiDownloaded();
  const cancel = useCancelEdiExport();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [sendId,setSendId]=useState<string|null>(null);const [sendTo,setSendTo]=useState('');const [channel,setChannel]=useState('email');
  const [reason, setReason] = useState('');

  const redownload = async (ex: EdiExport) => {
    if(!currentTenant)return;
    let content:string;
    try{content=await fetchEdiExportContent(currentTenant.id,ex.id);}catch(error){toast.error(error instanceof Error?error.message:'Falha ao carregar o arquivo');return;}
    downloadText(ex.file_name, content);
    try {
      await markDl.mutateAsync(ex.id);
    } catch (error) {
      toast.error(error instanceof Error?`Arquivo baixado, mas a auditoria falhou: ${error.message}`:'Arquivo baixado, mas a auditoria falhou. Tente registrar novamente.');
    }
  };

  return (
    <Card>
      <CardHeader><h2 className="text-base font-semibold leading-none tracking-tight">Histórico de arquivos</h2></CardHeader>
      <CardContent>
        <Table scrollLabel="Histórico de arquivos EDI; deslize horizontalmente para ver todas as colunas" className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Arquivo</TableHead>
              <TableHead>Faturas</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Hash</TableHead>
              <TableHead className="w-40 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground"><span role="status">Carregando...</span></TableCell></TableRow>}
            {failed&&<TableRow><TableCell colSpan={7} className="text-center" role="alert">Histórico indisponível. <Button variant="outline" onClick={retry}>Tentar novamente</Button></TableCell></TableRow>}
            {!loading && !failed && exports_.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground"><span role="status">Nenhuma exportação.</span></TableCell></TableRow>}
            {exports_.map(ex => (
              <TableRow key={ex.id}>
                <TableCell>{dt(ex.generated_at)}</TableCell>
                <TableCell className="font-mono text-xs">{ex.file_name}</TableCell>
                <TableCell>{ex.invoice_count}</TableCell>
                <TableCell className="text-right">{brl(ex.total_amount)}</TableCell>
                <TableCell><Badge variant={ex.status === 'cancelled' ? 'destructive' : ex.status === 'sent' ? 'default' : 'secondary'}>{ex.status}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{ex.content_hash?.slice(0, 8) || '—'}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" title="Baixar" aria-label={`Baixar arquivo ${ex.file_name}`} onClick={() => redownload(ex)}><Download aria-hidden="true" className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Marcar enviado" aria-label={`Marcar arquivo ${ex.file_name} como enviado`} disabled={ex.status === 'cancelled' || ex.status === 'sent'} onClick={() => {setSendId(ex.id);setSendTo('');setChannel('email');}}><Send aria-hidden="true" className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Cancelar" aria-label={`Cancelar arquivo ${ex.file_name}`} disabled={ex.status === 'cancelled' || ex.status === 'sent'} onClick={() => { setCancelId(ex.id); setReason(''); }}><XCircle aria-hidden="true" className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <DataPagination page={page} pageCount={Math.max(1,Math.ceil(total/EDI_HISTORY_PAGE_SIZE))} totalCount={total} start={total?(page-1)*EDI_HISTORY_PAGE_SIZE+1:0} end={Math.min(page*EDI_HISTORY_PAGE_SIZE,total)} onPageChange={setPage}/>

        <Dialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancelar exportação</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="billing-edi-cancel-reason">Motivo</Label>
              <Textarea id="billing-edi-cancel-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} placeholder="Explique o motivo do cancelamento" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelId(null)}>Voltar</Button>
              <Button variant="destructive" disabled={reason.trim().length < 5 || cancel.isPending} onClick={async () => {
                try { await cancel.mutateAsync({ exportId: cancelId!, reason }); toast.success('Exportação cancelada'); setCancelId(null); }
                catch (error: unknown) { toast.error(error instanceof Error ? error.message : 'Erro ao cancelar'); }
              }}>Confirmar cancelamento</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={!!sendId} onOpenChange={open=>!open&&setSendId(null)}><DialogContent><DialogHeader><DialogTitle>Registrar envio do DOCCOB</DialogTitle></DialogHeader>
          <div className="space-y-3"><div><Label htmlFor="edi-send-channel">Canal utilizado</Label><Input id="edi-send-channel" value={channel} onChange={e=>setChannel(e.target.value)} placeholder="E-mail, portal, SFTP…"/></div>
          <div><Label htmlFor="edi-send-to">Destinatário</Label><Input id="edi-send-to" value={sendTo} onChange={e=>setSendTo(e.target.value)} placeholder="E-mail, empresa ou identificação do destino"/></div></div>
          <DialogFooter><Button variant="outline" onClick={()=>setSendId(null)}>Voltar</Button><Button disabled={!channel.trim()||!sendTo.trim()||markSent.isPending} onClick={async()=>{try{await markSent.mutateAsync({exportId:sendId!,channel,sentTo:sendTo});toast.success('Envio registrado com destinatário e canal.');setSendId(null);}catch(error){toast.error(error instanceof Error?error.message:'Falha ao registrar envio.');}}}>Confirmar envio</Button></DialogFooter>
        </DialogContent></Dialog>
      </CardContent>
    </Card>
  );
}

function GenerateDialog({
  open, onClose, selectedInvoices, singleClientId, profile, onSuccess,
}: {
  open: boolean; onClose: () => void;
  selectedInvoices: EligibleInvoice[];
  singleClientId: string | null;
  profile: EdiProfile | null;
  onSuccess: () => void;
}) {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const register = useRegisterEdiExport();
  const markDl = useMarkEdiDownloaded();
  const defaultPattern = profile?.file_name_pattern || 'SIAT_CTMS_DOCCOB_{dd}_{mm}_{yyyy}_{hh}_{MM}.txt';
  const [fileDate, setFileDate] = useState(() => localDateInputValue());
  const [carrierCnpj, setCarrierCnpj] = useState<string>(jsonString(profile?.metadata, 'carrier_cnpj'));
  const [carrierName, setCarrierName] = useState<string>(jsonString(profile?.metadata, 'carrier_name') || currentTenant?.name || '');
  const [pattern, setPattern] = useState(defaultPattern);
  const [bankName, setBankName] = useState(profile?.bank_name || '');
  const [destination, setDestination] = useState(profile?.destination_name || '');
  const [reprocessReason, setReprocessReason] = useState('');
  const [result, setResult] = useState<{ content: string; fileName: string; totalAmount: number; recordCount: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [reading,setReading]=useState(false);

  const needsReprocess = selectedInvoices.some(i => i.edi_status === 'generated' || i.edi_status === 'sent' || i.edi_status === 'downloaded');
  const parsedFileDate = /^\d{4}-\d{2}-\d{2}$/.test(fileDate) ? new Date(fileDate + 'T00:00:00') : null;
  const validFileDate = !!parsedFileDate && !Number.isNaN(parsedFileDate.getTime()) && parsedFileDate.toISOString().slice(0, 10) === fileDate;
  const resolvedName = validFileDate ? resolveFileName(pattern, parsedFileDate) : '';
  const nameIssue = validFileDate ? validateFileName(pattern, resolvedName) : { level: 'error' as const, message: 'Data do arquivo obrigatória e válida.' };

  const handleGenerate = async () => {
    setErrors([]);
    if (!currentTenant) return;
    if (!validFileDate) { setErrors(['Data do arquivo obrigatória e válida.']); return; }
    if (needsReprocess && !reprocessReason.trim()) {
      setErrors(['Motivo do reprocessamento é obrigatório.']);
      return;
    }
    if (nameIssue?.level === 'error') { setErrors([nameIssue.message]); return; }
    if (!isValidCnpj(carrierCnpj)) { setErrors(['CNPJ da transportadora inválido — informe 14 dígitos válidos.']); return; }

    setReading(true);
    try {
    const bundle = await fetchInvoicesBundle(currentTenant.id, selectedInvoices.map(i => i.id));
    const chargesByInv = new Map<string, Array<(typeof bundle.charges)[number]>>();
    for (const c of bundle.charges) {
      const arr = chargesByInv.get(c.invoice_id) ?? [];
      arr.push(c); chargesByInv.set(c.invoice_id, arr);
    }
    const detailsByCharge = new Map<string, Array<(typeof bundle.details)[number]>>();
    for (const d of bundle.details) {
      const arr = detailsByCharge.get(d.charge_id) ?? [];
      arr.push(d); detailsByCharge.set(d.charge_id, arr);
    }

    const invoicesInput: DoccobInvoiceInput[] = bundle.invoices.map((inv): DoccobInvoiceInput => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      issueDate: inv.issue_date,
      dueDate: inv.due_date || inv.issue_date,
      totalAmount: Number(inv.total_amount) || 0,
      clientName: jsonString(inv.payer_snapshot, 'company_name') || jsonString(inv.payer_snapshot, 'name') || inv.clients?.company_name || '',
      clientTaxId: jsonString(inv.payer_snapshot, 'tax_id') || inv.clients?.tax_id || null,
      paymentMethod: null,
      charges: (chargesByInv.get(inv.id) ?? []).map((c): DoccobChargeInput => ({
        id: c.id,
        sourceType: c.source_type,
        sourceNumber: c.source_number,
        sourceSeries: c.source_series,
        referenceNumber: c.reference_number,
        issueDate: c.issue_date,
        grossAmount: Number(c.gross_amount) || 0,
        description: c.description,
        carrierCnpj: carrierCnpj.replace(/\D/g, ''),
        details: (detailsByCharge.get(c.id) ?? []).map((d): DoccobDetailInput => ({
          id: d.id,
          chargeId: d.charge_id,
          documentNumber: d.document_number,
          emissionDate: d.emission_date,
          cargoValue: d.cargo_value != null ? Number(d.cargo_value) : null,
          weightKg: d.weight_kg != null ? Number(d.weight_kg) : null,
        })),
      })),
    }));

    const buildInput: DoccobBuildInput = {
      carrier: { cnpj: carrierCnpj, name: carrierName },
      profile: {
        destinationName: destination || undefined,
        companyCode: profile?.company_code || 'AGV',
        branchCode: profile?.branch_code || 'MOC',
        documentType: profile?.document_type || 'FAT',
        bankName: bankName || null,
        bankAgency: profile?.bank_agency || null,
        bankAccount: profile?.bank_account || null,
        layoutVersion: profile?.layout_version || 'SIAT_CTMS_DOCCOB_SAMPLE_2026',
        allowChargeWithoutDetails: jsonObject(profile?.metadata).allow_charge_without_details === true,
      },
      invoices: invoicesInput,
      generatedAt: new Date(),
    };

    const issues = validateDoccobExportInput(buildInput);
    const errs = issues.filter(i => i.level === 'error');
    if (errs.length > 0) { setErrors(errs.map(e => e.message)); return; }

      const built = await generateDoccob(buildInput);
      const payload = await register.mutateAsync({
        profileId: profile?.id || null,
        clientId: singleClientId,
        invoiceIds: selectedInvoices.map(i => i.id),
        fileName: resolvedName,
        fileDate,
        generatedContent: built.content,
        contentHash: built.hash,
        recordCount: built.recordCount,
        totalAmount: built.totalAmount,
        chargeCount: built.chargeCount,
        detailCount: built.detailCount,
        reprocessReason: needsReprocess ? reprocessReason : null,
      });
      setResult({ content: built.content, fileName: resolvedName, totalAmount: built.totalAmount, recordCount: built.recordCount });
      toast.success('DOCCOB gerado com sucesso');
      // auto-download
      downloadText(resolvedName, built.content);
      const exportId = jsonString(payload, 'export_id');
      if (exportId) {
        try {
          await markDl.mutateAsync(exportId);
        } catch (error) {
          toast.error(error instanceof Error?`Arquivo baixado, mas a auditoria falhou: ${error.message}`:'Arquivo baixado, mas a auditoria falhou.');
        }
      }
      onSuccess();
    } catch (error: unknown) {
      setErrors([error instanceof Error ? error.message : 'Falha ao gerar DOCCOB']);
    } finally {
      setReading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Gerar arquivo DOCCOB — {selectedInvoices.length} fatura(s)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!singleClientId && (
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
              Faturas de clientes diferentes selecionadas. O perfil será ignorado; ajuste os dados manualmente.
            </div>
          )}
          {!profile && (
            <div className="rounded border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
              Cliente sem perfil DOCCOB configurado — usando valores padrão.
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data do arquivo</Label><Input type="date" value={fileDate} onChange={e => setFileDate(e.target.value)} /></div>
            <div><Label>CNPJ transportadora</Label><Input value={carrierCnpj} onChange={e => setCarrierCnpj(e.target.value)} placeholder="00.000.000/0000-00" /></div>
            <div className="col-span-2"><Label>Razão social transportadora</Label><Input value={carrierName} onChange={e => setCarrierName(e.target.value)} /></div>
            <div><Label>Banco</Label><Input value={bankName} onChange={e => setBankName(e.target.value)} /></div>
            <div><Label>Destino</Label><Input value={destination} onChange={e => setDestination(e.target.value)} /></div>
            <div className="col-span-2"><Label>Padrão do nome</Label><Input value={pattern} onChange={e => setPattern(e.target.value)} /></div>
            <div className="col-span-2">
              <Label>Nome final</Label>
              <Input value={resolvedName} readOnly className={nameIssue?.level === 'error' ? 'border-destructive' : ''} />
              {nameIssue && <div className="text-xs mt-1 text-destructive">{nameIssue.message}</div>}
            </div>
          </div>
          {needsReprocess && (
            <div>
              <Label>Motivo do reprocessamento (obrigatório)</Label>
              <Textarea value={reprocessReason} onChange={e => setReprocessReason(e.target.value)} placeholder="Ex.: correção de dados bancários" />
            </div>
          )}
          {errors.length > 0 && (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive space-y-1">
              {errors.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
          {result && (
            <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs">
              Arquivo <b>{result.fileName}</b> gerado — {result.recordCount} registros, {brl(result.totalAmount)}.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {result && <Button variant="outline" onClick={() => downloadText(result.fileName, result.content)}><Download className="h-4 w-4 mr-2" />Baixar novamente</Button>}
          <Button onClick={handleGenerate} disabled={!validFileDate||reading||register.isPending}>
            <FileText className="h-4 w-4 mr-2" /> Gerar TXT
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileDialog({ open, onClose, clients, profiles }: {
  open: boolean;
  onClose: () => void;
  clients: Array<Pick<Tables<'clients'>, 'id' | 'company_name'>>;
  profiles: EdiProfile[];
}) {
  const toast = useSonnerToast();
  const save = useSaveEdiProfile();
  const [editing, setEditing] = useState<EdiProfileDraft>({ name: '', client_id: null, enabled: true, file_name_pattern: 'SIAT_CTMS_DOCCOB_{dd}_{mm}_{yyyy}_{hh}_{MM}.txt' });

  const load = (p: EdiProfile) => setEditing(p);
  const handleSave = async () => {
    if (!editing.name?.trim()) { toast.error('Nome obrigatório'); return; }
    try {
      await save.mutateAsync(editing);
      toast.success('Perfil salvo');
      setEditing({ name: '', client_id: null, enabled: true });
    } catch (error: unknown) { toast.error(error instanceof Error ? error.message : 'Erro ao salvar perfil'); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Perfis DOCCOB</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">Perfis existentes</div>
            <div className="max-h-72 overflow-auto border rounded">
              {profiles.length === 0 && <div className="p-3 text-sm text-muted-foreground">Nenhum perfil.</div>}
              {profiles.map(p => (
                <button key={p.id} className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b" onClick={() => load(p)}>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{clients.find(c => c.id === p.client_id)?.company_name || 'Global'} · {p.enabled?'Ativo':'Inativo'}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div><Label>Nome do perfil</Label><Input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
            <div>
              <Label>Cliente</Label>
              <Select value={editing.client_id || '__none__'} onValueChange={(v) => setEditing({ ...editing, client_id: v === '__none__' ? null : v })}>
                <SelectTrigger><SelectValue placeholder="Global" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Global (todos)</SelectItem>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Empresa</Label><Input value={editing.company_code || ''} onChange={e => setEditing({ ...editing, company_code: e.target.value })} /></div>
              <div><Label>Filial</Label><Input value={editing.branch_code || ''} onChange={e => setEditing({ ...editing, branch_code: e.target.value })} /></div>
            </div>
            <div><Label>Destinatário</Label><Input value={editing.destination_name || ''} onChange={e => setEditing({ ...editing, destination_name: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Banco</Label><Input value={editing.bank_name || ''} onChange={e => setEditing({ ...editing, bank_name: e.target.value })} /></div>
              <div><Label>Agência</Label><Input value={editing.bank_agency || ''} onChange={e => setEditing({ ...editing, bank_agency: e.target.value })} /></div>
              <div><Label>Conta</Label><Input value={editing.bank_account || ''} onChange={e => setEditing({ ...editing, bank_account: e.target.value })} /></div>
            </div>
            <div><Label>Padrão do arquivo</Label><Input value={editing.file_name_pattern || ''} onChange={e => setEditing({ ...editing, file_name_pattern: e.target.value })} /></div>
            <label className="flex items-center gap-2"><Checkbox checked={editing.enabled!==false} onCheckedChange={checked=>setEditing({...editing,enabled:checked===true})}/>Perfil ativo para novas gerações</label>
            <div><Label>API integração</Label><Input value={editing.api_integration_id || ''} onChange={e => setEditing({ ...editing, api_integration_id: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          <Button onClick={handleSave} disabled={save.isPending}>Salvar perfil</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
