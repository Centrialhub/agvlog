import {useAuth} from '@/hooks/useAuth';
import {NewInvoiceWizard} from '@/components/financial/NewInvoiceWizard';
import {ClientInvoiceLifecycleDialog} from '@/components/financial/ClientInvoiceLifecycleDialog';
import {ReceivableFinancialDialog} from '@/components/financial/ReceivableFinancialDialog';
import { useState, useMemo, useRef, useEffect } from 'react';
import {
  useClientInvoices, useClientInvoiceDetail,
  INVOICE_STATUS_LABELS, type ClientInvoice, type InvoiceStatus,
} from '@/hooks/useClientInvoices';
import { useClients } from '@/hooks/useClients';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, FileText, Download, Settings2, DollarSign, Search } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { generateClientInvoicePdf, type InvoiceCharge } from '@/lib/clientInvoicePdf';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';

const brl = (n: number) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s?: string | null) => s ? new Date(s.length <= 10 ? s + 'T00:00:00' : s).toLocaleDateString('pt-BR') : '-';

const statusVariant = (s: string): 'default' | 'destructive' | 'secondary' | 'outline' => {
  if (s === 'paid') return 'default';
  if (s === 'cancelled') return 'destructive';
  if (s === 'sent') return 'secondary';
  return 'outline';
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const EMPTY_INVOICES:ClientInvoice[]=[];
const isInvoiceSourceType = (value: string): value is InvoiceCharge['source_type'] =>
  value === 'cte_document' || value === 'nfse_document' || value === 'manual_service';

export default function ClientInvoices(){
 const {currentTenant}=useTenant();const {user}=useAuth();return <ClientInvoicesScreen key={currentTenant?.id+':'+user?.id}/>;
}
function ClientInvoicesScreen() {
  const toast = useSonnerToast();
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const {data:invoiceList,isLoading,error:listError}=useClientInvoices();
  const invoices=invoiceList?.rows||EMPTY_INVOICES;
  const balancesUnavailable=!!listError||!invoiceList||invoiceList.truncated||invoices.some(inv=>inv.requires_reconciliation);
  const { data: clients = [] } = useClients();
  const [actionInvoice,setActionInvoice]=useState<ClientInvoice|null>(null);
  const [financialInvoice,setFinancialInvoice]=useState<ClientInvoice|null>(null);

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
      open: invoices.filter(i => i.status === 'generated' || i.status === 'sent').reduce((s, i) => s + Number(i.open_amount||0), 0),
      overdue: invoices.filter(i => (i.status === 'generated' || i.status === 'sent') && i.due_date && new Date(i.due_date + 'T23:59:59') < now).reduce((s, i) => s + Number(i.open_amount||0), 0),
      sent: invoices.filter(i => i.status === 'sent').reduce((s, i) => s + Number(i.open_amount||0), 0),
      paid: invoices.filter(i => i.status !== 'cancelled').reduce((s, i) => s + Number(i.received_amount||0), 0),
    };
  }, [invoices]);

  const handleDownloadPdf = async (inv: ClientInvoice) => {
    try {
      const tenantId = currentTenant?.id;
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { supabase } = await import('@/integrations/supabase/client');
      const [chargesRes, detailsRes] = await Promise.all([
        supabase.from('client_invoice_charges').select('*').eq('invoice_id', inv.id).eq('tenant_id', tenantId).order('sort_order'),
        supabase.from('client_invoice_details').select('*').eq('invoice_id', inv.id).eq('tenant_id', tenantId).order('sort_order'),
      ]);
      if (chargesRes.error) throw chargesRes.error;
      if (detailsRes.error) throw detailsRes.error;
      const charges: InvoiceCharge[] = (chargesRes.data || []).map(c => {
        if (!isInvoiceSourceType(c.source_type)) {
          throw new Error(`Tipo de cobrança inválido: ${c.source_type}`);
        }
        return {
          ...c,
          source_type: c.source_type,
          gross_amount: Number(c.gross_amount),
          details: (detailsRes.data || []).filter(d => d.charge_id === c.id),
        };
      });
      const doc = generateClientInvoicePdf({
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        gross_amount: Number(inv.gross_amount),
        discount_amount: Number(inv.discount_amount),
        interest_amount: Number(inv.interest_amount),
        total_amount: Number(inv.total_amount),
        notes: inv.notes,
        company: {
          name: companyProfile?.legal_name || companyProfile?.trade_name || currentTenant?.name || 'Transportadora',
          tax_id: companyProfile?.tax_id,
          state_registration: companyProfile?.state_registration,
          address: companyProfile?.address,
          city: companyProfile?.city,
          state: companyProfile?.state,
          zip: companyProfile?.zip,
          phone: companyProfile?.phone,
          email: companyProfile?.email,
          website: companyProfile?.website,
          logo_data_url: companyProfile?.logo_data_url,
        },
        payer: { name: inv.clients?.company_name, tax_id: inv.clients?.tax_id || undefined },
        charges,
      });
      if(!alive.current)return;
      doc.save(`fatura-${inv.invoice_number.replace('/', '-')}.pdf`);
    } catch (error: unknown) {
      if(alive.current)toast.error('Falha ao gerar PDF: ' + errorMessage(error));
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
          { label: 'Recebido líquido', value: totals.paid, tone: 'text-green-600' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className={`text-2xl font-semibold ${k.tone}`}>{balancesUnavailable?'—':brl(k.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {listError?<p role="alert">Falha ao consultar faturas: {errorMessage(listError)}</p>:null}
      {invoiceList?.truncated?<p role="alert">Exibindo as 500 faturas mais recentes. Totais gerais indisponíveis nesta consulta limitada.</p>:null}
      {invoices.some(inv=>inv.requires_reconciliation)?<p role="alert">Há vínculos financeiros divergentes. Confira as ações de fatura; totais não são exibidos até a conciliação.</p>:null}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Buscar faturas" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por número ou cliente..." className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filtrar status" className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {Object.entries(INVOICE_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger aria-label="Filtrar cliente" className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os clientes</SelectItem>
                {clients.map(c => (<SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>))}
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
                    <TableCell><Badge variant={statusVariant(inv.status)}>{INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] || inv.status}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{dt(inv.sent_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label="Visualizar" title="Visualizar" onClick={() => setDetailId(inv.id)}><FileText className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Baixar PDF" title="Baixar PDF" onClick={() => handleDownloadPdf(inv)}><Download className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" aria-label="Ações da fatura" title="Ações da fatura" onClick={()=>setActionInvoice(inv)}><Settings2 className="h-4 w-4"/></Button>
                        {inv.receivable_id?<Button size="icon" variant="ghost" aria-label="Recebimentos e estornos" title="Recebimentos e estornos" onClick={()=>setFinancialInvoice(inv)}><DollarSign className="h-4 w-4"/></Button>:null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {wizardOpen&&<NewInvoiceWizard open={wizardOpen} onClose={() => setWizardOpen(false)} clients={clients} onGenerated={id => { setWizardOpen(false); setDetailId(id); }} />}
      {actionInvoice&&<ClientInvoiceLifecycleDialog invoiceId={actionInvoice.id} tenantId={actionInvoice.tenant_id} onClose={()=>setActionInvoice(null)}/>}
      {financialInvoice?.receivable_id&&<ReceivableFinancialDialog receivableId={financialInvoice.receivable_id} tenantId={financialInvoice.tenant_id} onClose={()=>setFinancialInvoice(null)}/>}
      <InvoiceDetailDialog invoiceId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

/* ---------- Wizard ---------- */


/* ---------- Detail dialog ---------- */

function InvoiceDetailDialog({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }) {
  const { data,error,isPending } = useClientInvoiceDetail(invoiceId);
  if (!invoiceId) return null;
  return (
    <Dialog open={!!invoiceId} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Fatura {data?.invoice?.invoice_number}</DialogTitle><DialogDescription>Contrato comercial e suas cobranças históricas.</DialogDescription></DialogHeader>
        {error?<p role="alert">Falha ao consultar a fatura: {errorMessage(error)}</p>:isPending?<p>Carregando...</p>:!data?.invoice?<p>Fatura não encontrada nesta empresa.</p> : (
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
                  {data.charges.map(c => (
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
