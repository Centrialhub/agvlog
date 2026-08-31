import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ReceivableFinancialDialog } from '@/components/financial/ReceivableFinancialDialog';
import { ClosingInvoiceCreationDialog } from '@/components/financial/ClosingInvoiceCreationDialog';
import { Download, FileText, RefreshCw, DollarSign, FileSpreadsheet } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import {
  useClosingReportsList,
  STATUS_LABELS, PAYMENT_LABELS, REPORT_TYPE_LABELS,
  type ClosingFilters, type ClosingReportRow,
} from '@/hooks/useClosingReports';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type BuiltItem, type SummaryLine } from '@/lib/closingReports/closingReportBuilder';
import { downloadClosingReportPdf } from '@/lib/closingReports/closingReportPdf';
import { buildWorkbook, downloadWorkbook } from '@/lib/closingReports/closingReportExcel';
import { buildDetailedCsv, buildSummaryCsv, downloadCsv } from '@/lib/closingReports/closingReportCsv';
import { CreateClosingReportPanel } from '@/components/closingReports/CreateClosingReportPanel';
import { ClosingImportPanel } from '@/components/closingReports/ClosingImportPanel';
import { ClosingTripEditor } from '@/components/closingReports/ClosingTripEditor';
import { ClosingLifecycleDialog } from '@/components/closingReports/ClosingLifecycleDialog';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';
import type { Tables } from '@/integrations/supabase/types';

const brl = (n: unknown) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' kg';
const dt = (v?: string | null) => v ? v.slice(0, 10).split('-').reverse().join('/') : '—';

const STATUS_VARIANT: Record<string, React.ComponentProps<typeof Badge>['variant']> = {
  paid: 'default', partially_paid: 'secondary', unpaid: 'outline', overdue: 'destructive',
  cancelled: 'outline', closed: 'default', draft: 'outline', reviewing: 'secondary', sent: 'secondary', invoiced: 'default',
};

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isBuiltItemSource = (source: string): source is BuiltItem['source_type'] =>
  source === 'system' || source === 'xml_import' || source === 'spreadsheet_import' || source === 'manual_adjustment';

const toBuiltItems = (rows: Tables<'closing_report_items'>[]): BuiltItem[] => rows.map(row => {
  if (!isBuiltItemSource(row.source_type)) throw new Error(`Origem inválida no fechamento: ${row.source_type}`);
  return { ...row, source_type: row.source_type };
});

export default function ClosingReports() {
  const {currentTenant}=useTenant();const {user}=useAuth();
  return <ClosingReportsScreen key={`${currentTenant?.id}:${user?.id}`}/>;
}
function ClosingReportsScreen() {
  const toast = useSonnerToast();
  const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const [filters, setFilters] = useState<ClosingFilters>({});
  const [applied, setApplied] = useState<ClosingFilters>({});
  const { data: rows = [], isLoading } = useClosingReportsList(applied);
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const { data: clients = [] } = useClients();
  const { data: vehicles = [] } = useVehicles();
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers-min', currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      const tenantId = currentTenant?.id;
      if (!tenantId) return [];
      const { data, error } = await supabase.from('drivers').select('id, name').eq('tenant_id', tenantId).order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  const [payDlg, setPayDlg] = useState<ClosingReportRow | null>(null);

  const [editTripsFor, setEditTripsFor] = useState<ClosingReportRow | null>(null);
  const [actionReport,setActionReport]=useState<ClosingReportRow|null>(null);

  const [invoiceReport,setInvoiceReport]=useState<ClosingReportRow|null>(null);

  const kpis = useMemo(() => {
    const acc = { open: 0, closed: 0, sent: 0, paid: 0, overdue: 0, totalValue: 0, totalFreight: 0, totalWeight: 0, openAmount: 0 };
    for (const r of rows) {
      if (['draft', 'reviewing'].includes(r.status)) acc.open++;
      if (r.status === 'closed') acc.closed++;
      if (r.status === 'sent') acc.sent++;
      if (r.payment_status === 'paid') acc.paid++;
      if (r.payment_status === 'overdue') acc.overdue++;
      acc.totalValue += Number(r.total_invoice_value || 0);
      acc.totalFreight += Number(r.total_freight_value || 0);
      acc.totalWeight += Number(r.total_weight_kg || 0);
      acc.openAmount += Number(r.open_amount || 0);
    }
    return acc;
  }, [rows]);

  const fetchReportItems = async (reportId: string): Promise<{items:BuiltItem[];summary:SummaryLine[]}> => {
    const tenantId = currentTenant?.id;
    if (!tenantId) throw new Error('Tenant ativo não encontrado.');
    const { data, error } = await supabase
      .from('closing_report_items')
      .select('*')
      .eq('closing_report_id', reportId)
      .eq('tenant_id', tenantId)
      .order('sort_order');
    if (error) throw error;
    const {data:summary,error:summaryError}=await supabase.from('closing_report_summary_lines').select('*').eq('closing_report_id',reportId).eq('tenant_id',tenantId).order('sort_order');
    if(summaryError)throw summaryError;
    if(!active.current)throw new Error('A sessão ou empresa mudou. Abra novamente o relatório.');
    const source=summary??[];const group=source.some(row=>row.group_type==='arrival_date')?'arrival_date':'billing_period';
    return {items:toBuiltItems(data||[]),summary:source.filter(row=>row.group_type===group).map(row=>({...row,group_type:group}))};
  };

  const exportPdf = async (r: ClosingReportRow, model: 'summary' | 'detailed' | 'trips' = 'detailed') => {
    try {
      const {items,summary} = await fetchReportItems(r.id);
      downloadClosingReportPdf(`${r.closing_number}.pdf`, {
        title: r.title, clientName: r.client?.name, periodStart: r.period_start, periodEnd: r.period_end,
        closingNumber: r.closing_number, items, summaryLines:summary, model:r.report_model==='summary'?'summary':model,
        company: toCompanyPdfInfo(companyProfile, currentTenant?.name),
      });
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao exportar PDF'));
    }
  };
  const exportExcel = async (r: ClosingReportRow) => {
    try {
      const {items,summary} = await fetchReportItems(r.id);
      const wb = buildWorkbook({ title: r.title, clientName: r.client?.name ?? null, periodStart: r.period_start, periodEnd: r.period_end, items, summaryLines:summary });
      downloadWorkbook(`${r.closing_number}.xlsx`, wb);
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao exportar Excel'));
    }
  };
  const exportCsv = async (r: ClosingReportRow) => {
    try {
      const {items,summary} = await fetchReportItems(r.id);
      downloadCsv(`${r.closing_number}.csv`, r.report_model==='summary'?buildSummaryCsv(summary):buildDetailedCsv(items));
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao exportar CSV'));
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Relatórios de Fechamento</h1>
          <p className="text-sm text-muted-foreground">Fechamentos decenais, quinzenais, mensais e por período livre.</p>
        </div>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Fechamentos</TabsTrigger>
          <TabsTrigger value="new">Novo Fechamento</TabsTrigger>
          <TabsTrigger value="review">Conferência</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="legacy">Importar Legado</TabsTrigger>
        </TabsList>

        {/* ------- LIST ------- */}
        <TabsContent value="list" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Kpi label="Em aberto" value={kpis.open} />
            <Kpi label="Fechados" value={kpis.closed} />
            <Kpi label="Enviados" value={kpis.sent} />
            <Kpi label="Pagos" value={kpis.paid} />
            <Kpi label="Vencidos" value={kpis.overdue} tone="destructive" />
            <Kpi label="Valor total" value={brl(kpis.totalValue)} />
            <Kpi label="Frete total" value={brl(kpis.totalFreight)} />
            <Kpi label="Saldo em aberto" value={brl(kpis.openAmount)} />
          </div>

          <Card>
            <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-6 gap-3">
              <div><Label>Cliente</Label>
                <Select value={filters.clientId ?? '__all__'} onValueChange={v => setFilters({ ...filters, clientId: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {clients.map(client => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Tipo</Label>
                <Select value={filters.reportType ?? '__all__'} onValueChange={v => setFilters({ ...filters, reportType: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Status</Label>
                <Select value={filters.status ?? '__all__'} onValueChange={v => setFilters({ ...filters, status: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Financeiro</Label>
                <Select value={filters.paymentStatus ?? '__all__'} onValueChange={v => setFilters({ ...filters, paymentStatus: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {Object.entries(PAYMENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Nº fechamento</Label><Input value={filters.closingNumber ?? ''} onChange={e => setFilters({ ...filters, closingNumber: e.target.value || null })} /></div>
              <div><Label>Período de</Label><Input type="date" value={filters.periodFrom ?? ''} onChange={e => setFilters({ ...filters, periodFrom: e.target.value || null })} /></div>
              <div><Label>Período até</Label><Input type="date" value={filters.periodTo ?? ''} onChange={e => setFilters({ ...filters, periodTo: e.target.value || null })} /></div>
              <div><Label>Placa</Label>
                <Select value={filters.plate ?? '__all__'} onValueChange={v => setFilters({ ...filters, plate: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={(v.plate || '').toUpperCase()}>{v.plate}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Motorista</Label>
                <Select value={filters.driverName ?? '__all__'} onValueChange={v => setFilters({ ...filters, driverName: v === '__all__' ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todos</SelectItem>
                    {drivers.map(d => <SelectItem key={d.id} value={(d.name || '').toUpperCase()}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={() => setApplied(filters)} className="w-full"><RefreshCw className="h-4 w-4 mr-2" />Aplicar</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Valor NF</TableHead>
                    <TableHead>Frete</TableHead>
                    <TableHead>Peso</TableHead>
                    <TableHead>NFs</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Financeiro</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && <TableRow><TableCell colSpan={11}>Carregando…</TableCell></TableRow>}
                  {!isLoading && rows.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">Nenhum fechamento.</TableCell></TableRow>}
                  {rows.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.closing_number}</TableCell>
                      <TableCell>{r.client?.name ?? '—'}</TableCell>
                      <TableCell className="text-xs">{dt(r.period_start)} — {dt(r.period_end)}</TableCell>
                      <TableCell>{REPORT_TYPE_LABELS[r.report_type] ?? r.report_type}</TableCell>
                      <TableCell>{brl(r.total_invoice_value)}</TableCell>
                      <TableCell>{brl(r.total_freight_value)}</TableCell>
                      <TableCell>{kg(r.total_weight_kg)}</TableCell>
                      <TableCell>{r.fiscal_document_count}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>{STATUS_LABELS[r.status] ?? r.status}</Badge></TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[r.payment_status] ?? 'outline'}>{PAYMENT_LABELS[r.payment_status] ?? r.payment_status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="outline" onClick={()=>setActionReport(r)} aria-label={`Gerenciar fechamento ${r.closing_number}`}>Ações</Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(r, 'detailed')} title="PDF detalhado"><FileText className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(r, 'trips')} title="PDF controle de viagens"><FileText className="h-3 w-3" />V</Button>
                          <Button size="sm" variant="outline" onClick={() => exportExcel(r)} title="Excel"><FileSpreadsheet className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => exportCsv(r)} title="CSV"><Download className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => setEditTripsFor(r)} title="Editar KMs por viagem">KM</Button>
                          {['closed', 'sent'].includes(r.status) && !r.client_invoice_id && (
                            <Button size="sm" variant="secondary" onClick={() => setInvoiceReport(r)}>
                              <FileText className="h-3 w-3 mr-1" />Fatura
                            </Button>
                          )}
                          {r.receivable_id && (
                            <Button size="sm" aria-label={`Recebimentos do fechamento ${r.closing_number}`} onClick={() => setPayDlg(r)}><DollarSign className="h-3 w-3" /></Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" forceMount className="space-y-4 data-[state=inactive]:hidden">
          <CreateClosingReportPanel clients={clients} vehicles={vehicles} drivers={drivers}/>
        </TabsContent>

        <TabsContent value="review"><p>A conferência de tentativas, valores e divergências aparece junto à prévia na aba Novo Fechamento.</p></TabsContent>

        {/* ------- REPORTS ------- */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Exportar de um fechamento</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Use os botões de ação na lista "Fechamentos" para exportar PDF (resumo/detalhado), Excel (Resumo/Detalhado/Divergências/Metadados) e CSV.
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legacy"><ClosingImportPanel/></TabsContent>
      </Tabs>

      {payDlg?.receivable_id && <ReceivableFinancialDialog receivableId={payDlg.receivable_id} tenantId={payDlg.tenant_id} onClose={()=>setPayDlg(null)}/>}
      {editTripsFor && <ClosingTripEditor report={editTripsFor} onClose={()=>setEditTripsFor(null)}/>}
      {actionReport && <ClosingLifecycleDialog reportId={actionReport.id} tenantId={actionReport.tenant_id} onClose={()=>setActionReport(null)}/>}
      {invoiceReport && <ClosingInvoiceCreationDialog reportId={invoiceReport.id} tenantId={invoiceReport.tenant_id} onClose={()=>setInvoiceReport(null)}/>}
    </div>
  );
}


function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </CardContent></Card>
  );
}
