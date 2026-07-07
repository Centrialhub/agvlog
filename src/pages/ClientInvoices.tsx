import { useState, useMemo } from 'react';
import {
  useClientInvoices, useEligibleCtes, useEligibleNfse,
  useCreateClientInvoice, useCancelClientInvoice, useMarkInvoiceSent,
  useClientInvoiceDetail, fetchCteFiscalDocs,
  INVOICE_STATUS_LABELS, type ClientInvoice, type InvoiceStatus,
} from '@/hooks/useClientInvoices';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, FileText, Download, Send, XCircle, Search } from 'lucide-react';
import { toast } from 'sonner';
import { generateClientInvoicePdf, type InvoiceCharge, computeInvoiceTotals } from '@/lib/clientInvoicePdf';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '-';

const statusVariant = (s: string) => {
  if (s === 'paid') return 'default';
  if (s === 'cancelled') return 'destructive';
  if (s === 'sent') return 'secondary';
  return 'outline';
};

export default function ClientInvoices() {
  const { currentTenant } = useTenant();
  const { data: invoices = [], isLoading } = useClientInvoices();
  const { data: clients = [] } = useClients();
  const cancelMut = useCancelClientInvoice();
  const markSent = useMarkInvoiceSent();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return invoices.filter(inv => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (clientFilter !== 'all' && inv.client_id !== clientFilter) return false;
      if (q && !inv.invoice_number.toLowerCase().includes(q) &&
        !(inv.clients?.company_name || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [invoices, search, statusFilter, clientFilter]);

  const totals = useMemo(() => {
    const now = new Date();
    return {
      open: invoices.filter(i => i.status === 'generated' || i.status === 'sent').reduce((s, i) => s + Number(i.total_amount), 0),
      overdue: invoices.filter(i => (i.status === 'generated' || i.status === 'sent') && i.due_date && new Date(i.due_date + 'T23:59:59') < now).reduce((s, i) => s + Number(i.total_amount), 0),
      sent: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + Number(i.total_amount), 0),
      paid: invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total_amount), 0),
    };
  }, [invoices]);

  const handleDownloadPdf = async (inv: ClientInvoice) => {
    try {
      const [chargesRes, detailsRes] = await Promise.all([
        (await import('@/integrations/supabase/client')).supabase.from('client_invoice_charges').select('*').eq('invoice_id', inv.id).order('sort_order'),
        (await import('@/integrations/supabase/client')).supabase.from('client_invoice_details').select('*').eq('invoice_id', inv.id).order('sort_order'),
      ]);
      const charges: any[] = (chargesRes.data || []).map(c => ({
        ...c,
        details: (detailsRes.data || []).filter((d: any) => d.charge_id === c.id),
      }));
      const doc = generateClientInvoicePdf({
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        gross_amount: Number(inv.gross_amount),
        discount_amount: Number(inv.discount_amount),
        interest_amount: Number(inv.interest_amount),
        total_amount: Number(inv.total_amount),
        notes: inv.notes,
        company: { name: currentTenant?.name || 'Transportadora' },
        payer: { name: inv.clients?.company_name, tax_id: inv.clients?.tax_id || undefined },
        charges: charges as any,
      });
      doc.save(`fatura-${inv.invoice_number.replace('/', '-')}.pdf`);
    } catch (e: any) {
      toast.error('Falha ao gerar PDF: ' + e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Faturas por Cliente</h1>
          <p className="text-sm text-muted-foreground">Consolide CT-e, NFS-e e serviços em uma única fatura de cobrança.</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nova Fatura
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Em aberto', value: totals.open, tone: 'text-blue-600' },
          { label: 'Vencidas', value: totals.overdue, tone: 'text-red-600' },
          { label: 'Enviadas', value: totals.sent, tone: 'text-amber-600' },
          { label: 'Pagas', value: totals.paid, tone: 'text-green-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={`text-2xl font-semibold ${k.tone}`}>{brl(k.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por número ou cliente..." className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Fatura</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enviada</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-6">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground">Nenhuma fatura encontrada.</TableCell></TableRow>
                ) : filtered.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                    <TableCell>{inv.clients?.company_name || '-'}</TableCell>
                    <TableCell>{dt(inv.issue_date)}</TableCell>
                    <TableCell>{dt(inv.due_date)}</TableCell>
                    <TableCell className="text-right font-medium">{brl(Number(inv.total_amount))}</TableCell>
                    <TableCell><Badge variant={statusVariant(inv.status) as any}>{INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] || inv.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{dt(inv.sent_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" title="Visualizar" onClick={() => setDetailId(inv.id)}><FileText className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" title="Baixar PDF" onClick={() => handleDownloadPdf(inv)}><Download className="h-4 w-4" /></Button>
                        {inv.status !== 'cancelled' && inv.status !== 'paid' && (
                          <>
                            <Button size="icon" variant="ghost" title="Marcar como enviada"
                              onClick={() => markSent.mutateAsync({ id: inv.id }).then(() => toast.success('Fatura marcada como enviada'))}>
                              <Send className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Cancelar"
                              onClick={() => {
                                const reason = prompt('Motivo do cancelamento:');
                                if (!reason) return;
                                cancelMut.mutateAsync({ id: inv.id, reason })
                                  .then(() => toast.success('Fatura cancelada'))
                                  .catch(e => toast.error(e.message));
                              }}>
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <NewInvoiceWizard open={wizardOpen} onClose={() => setWizardOpen(false)} clients={clients as any[]} onGenerated={id => { setWizardOpen(false); setDetailId(id); }} />
      <InvoiceDetailDialog invoiceId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

/* ---------- Wizard ---------- */

type ManualService = { id: string; description: string; reference_number: string; gross_amount: string; net_amount: string; ir_amount: string; notes: string };

function NewInvoiceWizard({ open, onClose, clients, onGenerated }: { open: boolean; onClose: () => void; clients: any[]; onGenerated: (id: string) => void }) {
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
  const createMut = useCreateClientInvoice();

  const { data: ctes = [] } = useEligibleCtes(clientId || null);
  const { data: nfses = [] } = useEligibleNfse(clientId || null);

  const reset = () => {
    setStep(1); setClientId(''); setDueDate(''); setDiscount('0'); setInterest('0'); setNotes('');
    setSelectedCtes(new Set()); setSelectedNfses(new Set()); setManuals([]);
  };

  const closeAll = () => { reset(); onClose(); };

  // Build charges from selection
  const buildCharges = async (): Promise<any[]> => {
    const charges: any[] = [];
    let sort = 0;

    for (const cte of ctes.filter((c: any) => selectedCtes.has(c.id))) {
      const details: any[] = [];
      const fdIds: string[] = cte.fiscal_document_ids || [];
      if (fdIds.length) {
        const fds = await fetchCteFiscalDocs(fdIds);
        fds.forEach((fd: any, idx: number) => {
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

    for (const n of nfses.filter((x: any) => selectedNfses.has(x.id))) {
      const items: any[] = Array.isArray((n as any).items) ? (n as any).items : [];
      const details = items.length ? items.map((it: any, idx: number) => ({
        source_type: 'nfse_item',
        emission_date: n.issue_date,
        document_label: 'NFS-e',
        document_number: n.nfse_number,
        ort_number: it.ort_number || n.reference_number,
        destination: n.cliente_municipio,
        remitter: it.description || n.description,
        cargo_value: Number(it.value || 0),
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

  const [previewCharges, setPreviewCharges] = useState<any[]>([]);
  const goPreview = async () => {
    const c = await buildCharges();
    if (c.length === 0) { toast.error('Selecione ao menos um documento ou adicione um serviço.'); return; }
    setPreviewCharges(c);
    setStep(3);
  };

  const totals = useMemo(() => computeInvoiceTotals(previewCharges, Number(discount || 0), Number(interest || 0)), [previewCharges, discount, interest]);
  const hasCteMultiNf = previewCharges.some(c => c.source_type === 'cte_document' && (c.details?.length || 0) > 1);

  const generate = async () => {
    if (!currentTenant || !clientId) return;
    try {
      const id = await createMut.mutateAsync({
        tenant_id: currentTenant.id,
        client_id: clientId,
        issue_date: issueDate,
        due_date: dueDate || null,
        discount_amount: Number(discount || 0),
        interest_amount: Number(interest || 0),
        notes: notes || null,
        charges: previewCharges,
      });
      toast.success('Fatura gerada com sucesso');
      onGenerated(id);
      reset();
    } catch (e: any) {
      toast.error('Falha ao gerar fatura: ' + e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && closeAll()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Fatura — Etapa {step} de 4</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Cliente *</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (<SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Emissão</Label><Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} /></div>
              <div><Label>Vencimento</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></div>
              <div><Label>Desconto (R$)</Label><Input type="number" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></div>
              <div><Label>Juros (R$)</Label><Input type="number" step="0.01" value={interest} onChange={e => setInterest(e.target.value)} /></div>
              <div className="col-span-2"><Label>Observação</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></div>
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
                    {ctes.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell><Checkbox checked={selectedCtes.has(c.id)} onCheckedChange={v => { const s = new Set(selectedCtes); if (v) s.add(c.id); else s.delete(c.id); setSelectedCtes(s); }} /></TableCell>
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
                    {nfses.map((n: any) => (
                      <TableRow key={n.id}>
                        <TableCell><Checkbox checked={selectedNfses.has(n.id)} onCheckedChange={v => { const s = new Set(selectedNfses); if (v) s.add(n.id); else s.delete(n.id); setSelectedNfses(s); }} /></TableCell>
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
              {manuals.map((m, idx) => (
                <div key={m.id} className="grid grid-cols-6 gap-2 items-end border p-2 rounded">
                  <div className="col-span-2"><Label className="text-xs">Descrição</Label><Input value={m.description} onChange={e => { const copy = [...manuals]; copy[idx].description = e.target.value; setManuals(copy); }} /></div>
                  <div><Label className="text-xs">Referência</Label><Input value={m.reference_number} onChange={e => { const copy = [...manuals]; copy[idx].reference_number = e.target.value; setManuals(copy); }} /></div>
                  <div><Label className="text-xs">Bruto</Label><Input type="number" step="0.01" value={m.gross_amount} onChange={e => { const copy = [...manuals]; copy[idx].gross_amount = e.target.value; setManuals(copy); }} /></div>
                  <div><Label className="text-xs">Líquido</Label><Input type="number" step="0.01" value={m.net_amount} onChange={e => { const copy = [...manuals]; copy[idx].net_amount = e.target.value; setManuals(copy); }} /></div>
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
          </div>
        )}

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button variant="outline" onClick={closeAll}>Cancelar</Button>
          <div className="flex gap-2">
            {step > 1 && <Button variant="outline" onClick={() => setStep(step - 1)}>Voltar</Button>}
            {step === 1 && <Button disabled={!clientId} onClick={() => setStep(2)}>Avançar</Button>}
            {step === 2 && <Button onClick={goPreview}>Ver prévia</Button>}
            {step === 3 && <Button onClick={() => setStep(4)}>Avançar</Button>}
            {step === 4 && <Button onClick={generate} disabled={createMut.isPending}>{createMut.isPending ? 'Gerando...' : 'Gerar fatura'}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Detail dialog ---------- */

function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const { data } = useClientInvoiceDetail(invoiceId);
  if (!invoiceId) return null;
  return (
    <Dialog open={!!invoiceId} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Fatura {data?.invoice?.invoice_number}</DialogTitle></DialogHeader>
        {!data ? <p>Carregando...</p> : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <div><b>Cliente:</b> {data.invoice?.clients?.company_name}</div>
              <div><b>Emissão:</b> {dt(data.invoice?.issue_date)}</div>
              <div><b>Vencimento:</b> {dt(data.invoice?.due_date)}</div>
              <div><b>Bruto:</b> {brl(Number(data.invoice?.gross_amount || 0))}</div>
              <div><b>Desconto:</b> {brl(Number(data.invoice?.discount_amount || 0))}</div>
              <div><b>Juros:</b> {brl(Number(data.invoice?.interest_amount || 0))}</div>
              <div className="col-span-3"><b>Total:</b> <span className="text-lg font-semibold">{brl(Number(data.invoice?.total_amount || 0))}</span></div>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Cobranças</h3>
              <Table>
                <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Referência</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.charges.map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.source_type}</TableCell>
                      <TableCell>{c.source_number || c.reference_number}</TableCell>
                      <TableCell className="text-right">{brl(Number(c.gross_amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}