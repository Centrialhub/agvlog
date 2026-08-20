import { useMemo, useState } from 'react';
import {
  useEdiProfiles, useEdiExports, useEligibleInvoicesForEdi, useRegisterEdiExport,
  useMarkEdiSent, useMarkEdiDownloaded, useCancelEdiExport, useSaveEdiProfile,
  fetchInvoicesBundle, type EligibleInvoice, type EdiProfile, type EdiExport,
} from '@/hooks/useBillingEdi';
import { useClients, useClientsArray } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from '@/components/ui/sonner';
import { generateDoccob } from '@/lib/doccob/doccobGenerator';
import { validateDoccobExportInput, resolveFileName, validateFileName } from '@/lib/doccob/doccobValidator';
import type { DoccobInvoiceInput, DoccobChargeInput, DoccobDetailInput } from '@/lib/doccob/doccobTypes';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '-';

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

export default function BillingEdi() {
  const { currentTenant } = useTenant();
  const { data: clients = [] } = useClientsArray();
  const { data: profiles = [] } = useEdiProfiles();
  const { data: exports_ = [], isLoading: loadingExports } = useEdiExports();

  const [clientFilter, setClientFilter] = useState<string>('all');
  const [ediStatusFilter, setEdiStatusFilter] = useState<'all' | 'generated' | 'not_generated'>('not_generated');
  const [issueFrom, setIssueFrom] = useState('');
  const [issueTo, setIssueTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');

  const { data: eligible = [], isLoading, refetch } = useEligibleInvoicesForEdi({
    clientId: clientFilter === 'all' ? null : clientFilter,
    ediStatus: ediStatusFilter,
    issueFrom: issueFrom || null,
    issueTo: issueTo || null,
    dueFrom: dueFrom || null,
    dueTo: dueTo || null,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [genOpen, setGenOpen] = useState(false);
  const [profileDlgOpen, setProfileDlgOpen] = useState(false);

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected(s => s.size === eligible.length ? new Set() : new Set(eligible.map(e => e.id)));

  const selectedInvoices = useMemo(() => eligible.filter(i => selected.has(i.id)), [eligible, selected]);
  const singleClientId = useMemo(() => {
    const ids = new Set(selectedInvoices.map(i => i.client_id));
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }, [selectedInvoices]);

  const clientProfile = useMemo(
    () => profiles.find(p => p.client_id === singleClientId) ?? profiles.find(p => !p.client_id) ?? null,
    [profiles, singleClientId],
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
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
        <TabsList>
          <TabsTrigger value="generate">Gerar arquivo</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Filtros</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>Cliente</Label>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Filtro Arq EDI</Label>
                <Select value={ediStatusFilter} onValueChange={(v: any) => setEdiStatusFilter(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="not_generated">Não Gerado</SelectItem>
                    <SelectItem value="generated">Gerado</SelectItem>
                    <SelectItem value="all">Todos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Emissão de</Label><Input type="date" value={issueFrom} onChange={e => setIssueFrom(e.target.value)} /></div>
              <div><Label>Emissão até</Label><Input type="date" value={issueTo} onChange={e => setIssueTo(e.target.value)} /></div>
              <div><Label>Vencto de</Label><Input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} /></div>
              <div><Label>Vencto até</Label><Input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} /></div>
              <div className="flex items-end gap-2 md:col-span-2">
                <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-2" /> Buscar</Button>
                <Button
                  disabled={selected.size === 0}
                  onClick={() => setGenOpen(true)}
                >
                  <FileText className="h-4 w-4 mr-2" /> Gerar DOCCOB ({selected.size})
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Faturas elegíveis</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><Checkbox checked={eligible.length > 0 && selected.size === eligible.length} onCheckedChange={toggleAll} /></TableHead>
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
                  {isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
                  {!isLoading && eligible.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Nenhuma fatura elegível.</TableCell></TableRow>}
                  {eligible.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell><Checkbox checked={selected.has(inv.id)} onCheckedChange={() => toggle(inv.id)} /></TableCell>
                      <TableCell><Badge variant={inv.edi_status === 'not_generated' ? 'outline' : 'secondary'}>{inv.edi_status}</Badge></TableCell>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab exports_={exports_} loading={loadingExports} />
        </TabsContent>
      </Tabs>

      {genOpen && (
        <GenerateDialog
          open={genOpen}
          onClose={() => setGenOpen(false)}
          selectedInvoices={selectedInvoices}
          singleClientId={singleClientId}
          profile={clientProfile}
          onSuccess={() => { setSelected(new Set()); refetch(); }}
        />
      )}

      {profileDlgOpen && (
        <ProfileDialog open={profileDlgOpen} onClose={() => setProfileDlgOpen(false)} clients={clients} profiles={profiles} />
      )}
    </div>
  );
}

function HistoryTab({ exports_, loading }: { exports_: EdiExport[]; loading: boolean }) {
  const markSent = useMarkEdiSent();
  const markDl = useMarkEdiDownloaded();
  const cancel = useCancelEdiExport();
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const redownload = async (ex: EdiExport) => {
    if (!ex.generated_content) { toast.error('Arquivo sem conteúdo persistido'); return; }
    downloadText(ex.file_name, ex.generated_content);
    try { await markDl.mutateAsync(ex.id); } catch {}
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Histórico de arquivos</CardTitle></CardHeader>
      <CardContent>
        <Table>
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
            {loading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>}
            {!loading && exports_.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Nenhuma exportação.</TableCell></TableRow>}
            {exports_.map(ex => (
              <TableRow key={ex.id}>
                <TableCell>{dt(ex.generated_at)}</TableCell>
                <TableCell className="font-mono text-xs">{ex.file_name}</TableCell>
                <TableCell>{ex.invoice_count}</TableCell>
                <TableCell className="text-right">{brl(ex.total_amount)}</TableCell>
                <TableCell><Badge variant={ex.status === 'cancelled' ? 'destructive' : ex.status === 'sent' ? 'default' : 'secondary'}>{ex.status}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{ex.content_hash?.slice(0, 8) || '—'}</TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="icon" variant="ghost" title="Baixar" disabled={!ex.generated_content} onClick={() => redownload(ex)}><Download className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Marcar enviado" disabled={ex.status === 'cancelled' || ex.status === 'sent'} onClick={() => markSent.mutate({ exportId: ex.id })}><Send className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" title="Cancelar" disabled={ex.status === 'cancelled'} onClick={() => { setCancelId(ex.id); setReason(''); }}><XCircle className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Dialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancelar exportação</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Explique o motivo do cancelamento" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelId(null)}>Voltar</Button>
              <Button variant="destructive" disabled={!reason.trim()} onClick={async () => {
                try { await cancel.mutateAsync({ exportId: cancelId!, reason }); toast.success('Exportação cancelada'); setCancelId(null); }
                catch (e: any) { toast.error(e.message || 'Erro ao cancelar'); }
              }}>Confirmar cancelamento</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
  const { currentTenant } = useTenant();
  const register = useRegisterEdiExport();
  const markDl = useMarkEdiDownloaded();
  const markSent = useMarkEdiSent();

  const defaultPattern = profile?.file_name_pattern || 'SIAT_CTMS_DOCCOB_{dd}_{mm}_{yyyy}_{hh}_{MM}.txt';
  const [fileDate, setFileDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [carrierCnpj, setCarrierCnpj] = useState<string>((profile?.metadata as any)?.carrier_cnpj || '');
  const [carrierName, setCarrierName] = useState<string>((profile?.metadata as any)?.carrier_name || currentTenant?.name || '');
  const [pattern, setPattern] = useState(defaultPattern);
  const [bankName, setBankName] = useState(profile?.bank_name || '');
  const [destination, setDestination] = useState(profile?.destination_name || '');
  const [reprocessReason, setReprocessReason] = useState('');
  const [result, setResult] = useState<{ content: string; fileName: string; totalAmount: number; recordCount: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const needsReprocess = selectedInvoices.some(i => i.edi_status === 'generated' || i.edi_status === 'sent' || i.edi_status === 'downloaded');
  const resolvedName = resolveFileName(pattern, new Date(fileDate + 'T00:00:00'));
  const nameIssue = validateFileName(pattern, resolvedName);

  const handleGenerate = async () => {
    setErrors([]);
    if (!currentTenant) return;
    if (needsReprocess && !reprocessReason.trim()) {
      setErrors(['Motivo do reprocessamento é obrigatório.']);
      return;
    }
    if (nameIssue?.level === 'error') { setErrors([nameIssue.message]); return; }
    if (!carrierCnpj.replace(/\D/g, '')) { setErrors(['CNPJ da transportadora obrigatório.']); return; }

    const bundle = await fetchInvoicesBundle(currentTenant.id, selectedInvoices.map(i => i.id));
    const chargesByInv = new Map<string, any[]>();
    for (const c of bundle.charges) {
      const arr = chargesByInv.get(c.invoice_id) ?? [];
      arr.push(c); chargesByInv.set(c.invoice_id, arr);
    }
    const detailsByCharge = new Map<string, any[]>();
    for (const d of bundle.details) {
      const arr = detailsByCharge.get(d.charge_id) ?? [];
      arr.push(d); detailsByCharge.set(d.charge_id, arr);
    }

    const invoicesInput: DoccobInvoiceInput[] = bundle.invoices.map((inv: any) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      totalAmount: Number(inv.total_amount) || 0,
      clientName: inv.clients?.company_name || inv.payer_snapshot?.name || '',
      clientTaxId: inv.clients?.tax_id || null,
      paymentMethod: null,
      charges: (chargesByInv.get(inv.id) ?? []).map((c: any): DoccobChargeInput => ({
        id: c.id,
        sourceType: c.source_type,
        sourceNumber: c.source_number,
        sourceSeries: c.source_series,
        referenceNumber: c.reference_number,
        issueDate: c.issue_date,
        grossAmount: Number(c.gross_amount) || 0,
        description: c.description,
        carrierCnpj: carrierCnpj.replace(/\D/g, ''),
        details: (detailsByCharge.get(c.id) ?? []).map((d: any): DoccobDetailInput => ({
          id: d.id,
          chargeId: d.charge_id,
          documentNumber: d.document_number,
          emissionDate: d.emission_date,
          cargoValue: d.cargo_value != null ? Number(d.cargo_value) : null,
          weightKg: d.weight_kg != null ? Number(d.weight_kg) : null,
        })),
      })),
    }));

    const buildInput = {
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
        allowChargeWithoutDetails: (profile?.metadata as any)?.allow_charge_without_details === true,
      },
      invoices: invoicesInput,
      generatedAt: new Date(),
    };

    const issues = validateDoccobExportInput(buildInput as any);
    const errs = issues.filter(i => i.level === 'error');
    if (errs.length > 0) { setErrors(errs.map(e => e.message)); return; }

    try {
      const built = generateDoccob(buildInput as any);
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
      if (payload?.export_id) { try { await markDl.mutateAsync(payload.export_id); } catch {} }
      onSuccess();
    } catch (e: any) {
      setErrors([e.message || 'Falha ao gerar DOCCOB']);
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
          <Button onClick={handleGenerate} disabled={register.isPending}>
            <FileText className="h-4 w-4 mr-2" /> Gerar TXT
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileDialog({ open, onClose, clients, profiles }: { open: boolean; onClose: () => void; clients: any[]; profiles: EdiProfile[] }) {
  const save = useSaveEdiProfile();
  const [editing, setEditing] = useState<Partial<EdiProfile>>({ name: '', client_id: null, enabled: true, file_name_pattern: 'SIAT_CTMS_DOCCOB_{dd}_{mm}_{yyyy}_{hh}_{MM}.txt' });

  const load = (p: EdiProfile) => setEditing(p);
  const handleSave = async () => {
    if (!editing.name?.trim()) { toast.error('Nome obrigatório'); return; }
    try {
      await save.mutateAsync(editing as any);
      toast.success('Perfil salvo');
      setEditing({ name: '', client_id: null, enabled: true });
    } catch (e: any) { toast.error(e.message); }
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
                  <div className="text-xs text-muted-foreground">{clients.find(c => c.id === p.client_id)?.company_name || 'Global'}</div>
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