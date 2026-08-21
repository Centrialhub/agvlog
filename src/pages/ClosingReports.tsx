import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertCircle, CheckCircle2, Download, FileText, Play, RefreshCw, Send, X, Upload, DollarSign, FileSpreadsheet } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
  useClosingReportsList, useBuildPreview, useCreateClosingReport,
  useCloseClosingReport, useCancelClosingReport, useRegisterClosingPayment,
  useMarkClosingSent, useGenerateInvoiceFromClosing,
  useUpdateClosingReportItem,
  STATUS_LABELS, PAYMENT_LABELS, REPORT_TYPE_LABELS,
  type ClosingFilters, type ClosingReportRow,
} from '@/hooks/useClosingReports';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { periodFromType, type BuiltPreview, type FreightAllocation, type ReportType } from '@/lib/closingReports/closingReportBuilder';
import { downloadClosingReportPdf } from '@/lib/closingReports/closingReportPdf';
import { buildWorkbook, downloadWorkbook } from '@/lib/closingReports/closingReportExcel';
import { buildDetailedCsv, downloadCsv } from '@/lib/closingReports/closingReportCsv';
import { parseLegacyWorkbook, legacyDetailedToItems, type LegacyImport } from '@/lib/closingReports/closingReportImporter';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { useTenant } from '@/hooks/useTenant';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';

const brl = (n: any) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (n: any) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3 }) + ' kg';
const dt = (v?: string | null) => v ? v.slice(0, 10).split('-').reverse().join('/') : '—';

const STATUS_VARIANT: Record<string, any> = {
  paid: 'default', partially_paid: 'secondary', unpaid: 'outline', overdue: 'destructive',
  cancelled: 'outline', closed: 'default', draft: 'outline', reviewing: 'secondary', sent: 'secondary', invoiced: 'default',
};

export default function ClosingReports() {
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
      const { data, error } = await (supabase as any).from('drivers').select('id, name').eq('tenant_id', currentTenant!.id).order('name');
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const [openReport, setOpenReport] = useState<ClosingReportRow | null>(null);
  const [payDlg, setPayDlg] = useState<ClosingReportRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: 'pix', notes: '' });
  const [editTripsFor, setEditTripsFor] = useState<ClosingReportRow | null>(null);
  const closeMut = useCloseClosingReport();
  const cancelMut = useCancelClosingReport();
  const regPay = useRegisterClosingPayment();
  const sendMut = useMarkClosingSent();
  const invoiceMut = useGenerateInvoiceFromClosing();
  const updateItem = useUpdateClosingReportItem();

  // New closing form
  const [form, setForm] = useState({
    clientId: '', payerId: '', title: '', reportType: 'ten_day' as ReportType,
    periodStart: '', periodEnd: '', freightAllocation: 'per_nf' as FreightAllocation,
    onlyWithCte: false, onlyDelivered: false, expectedPay: '', notes: '',
    vehicleId: '', driverId: '',
  });
  const previewMut = useBuildPreview();
  const createMut = useCreateClosingReport();
  const [preview, setPreview] = useState<BuiltPreview | null>(null);

  // Legacy import
  const [legacy, setLegacy] = useState<LegacyImport | null>(null);
  const [legacyFileName, setLegacyFileName] = useState<string>('');

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

  const doPreview = async () => {
    if (!form.periodStart || !form.periodEnd) { toast.error('Informe período'); return; }
    const result = await previewMut.mutateAsync({
      clientId: form.clientId || null,
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      onlyWithCte: form.onlyWithCte,
      onlyDelivered: form.onlyDelivered,
      freightAllocation: form.freightAllocation,
      vehicleId: form.vehicleId || null,
      driverId: form.driverId || null,
    });
    setPreview(result);
    toast.success(`${result.items.length} notas encontradas`);
  };

  const doCreate = async () => {
    if (!preview) return;
    const title = form.title || `Fechamento ${REPORT_TYPE_LABELS[form.reportType]} ${form.periodStart} a ${form.periodEnd}`;
    const r = await createMut.mutateAsync({
      clientId: form.clientId || null,
      payerClientId: form.payerId || null,
      title,
      reportType: form.reportType,
      reportModel: 'detailed',
      periodStart: form.periodStart, periodEnd: form.periodEnd,
      expectedPaymentDate: form.expectedPay || null,
      notes: form.notes || null,
      preview,
      filtersSnapshot: form,
    });
    toast.success('Fechamento criado: ' + r.closing_number);
    setPreview(null);
    setApplied({ ...applied });
  };

  const applyType = (t: ReportType) => {
    const p = periodFromType(t);
    setForm(f => ({ ...f, reportType: t, periodStart: p.period_start, periodEnd: p.period_end }));
  };

  const exportPdf = (r: ClosingReportRow, model: 'summary' | 'detailed' | 'trips' = 'detailed') => {
    // Reload items to build snapshot pdf
    (async () => {
      const { data: items } = await (await import('@/integrations/supabase/client')).supabase
        .from('closing_report_items' as any).select('*').eq('closing_report_id', r.id).order('sort_order');
      downloadClosingReportPdf(`${r.closing_number}.pdf`, {
        title: r.title, clientName: r.client?.name, periodStart: r.period_start, periodEnd: r.period_end,
        closingNumber: r.closing_number, items: (items ?? []) as any, model,
        company: toCompanyPdfInfo(companyProfile, currentTenant?.name),
      });
    })();
  };
  const exportExcel = async (r: ClosingReportRow) => {
    const { data: items } = await (await import('@/integrations/supabase/client')).supabase
      .from('closing_report_items' as any).select('*').eq('closing_report_id', r.id).order('sort_order');
    const wb = buildWorkbook({ title: r.title, clientName: r.client?.name ?? null, periodStart: r.period_start, periodEnd: r.period_end, items: (items ?? []) as any });
    downloadWorkbook(`${r.closing_number}.xlsx`, wb);
  };
  const exportCsv = async (r: ClosingReportRow) => {
    const { data: items } = await (await import('@/integrations/supabase/client')).supabase
      .from('closing_report_items' as any).select('*').eq('closing_report_id', r.id).order('sort_order');
    downloadCsv(`${r.closing_number}.csv`, buildDetailedCsv((items ?? []) as any));
  };

  const onLegacyFile = async (f: File) => {
    setLegacyFileName(f.name);
    const buf = await f.arrayBuffer();
    setLegacy(parseLegacyWorkbook(buf));
    toast.success('Planilha lida');
  };

  const importLegacy = async () => {
    if (!legacy) return;
    if (legacy.model === 'unknown') { toast.error('Modelo não reconhecido'); return; }
    if (legacy.model === 'detailed' && legacy.detailedRows.length === 0) { toast.error('Sem linhas para importar'); return; }
    const items = legacy.model === 'detailed' ? legacyDetailedToItems(legacy.detailedRows) : [];
    const previewLike: BuiltPreview = {
      items,
      totals: {
        total_invoice_value: legacy.totals.total_invoice_value,
        total_freight_value: legacy.totals.total_freight_value,
        total_weight_kg: legacy.totals.total_weight_kg,
        total_volume: 0,
        fiscal_document_count: items.length,
        cte_count: 0, load_count: 0,
      },
      divergences: [], summaryByArrival: [], summaryByDestination: [],
    };
    const today = new Date().toISOString().slice(0, 10);
    await createMut.mutateAsync({
      title: legacy.title || `Import legado ${legacyFileName}`,
      reportType: 'custom', reportModel: 'detailed',
      periodStart: today, periodEnd: today,
      preview: previewLike,
      filtersSnapshot: { source: 'legacy_spreadsheet', fileName: legacyFileName, model: legacy.model },
    });
    toast.success('Fechamento legado importado');
    setLegacy(null); setLegacyFileName('');
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
                    {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
                          <Button size="sm" variant="outline" onClick={() => setOpenReport(r)}>Abrir</Button>
                          {['draft', 'reviewing'].includes(r.status) && (
                            <Button size="sm" onClick={() => closeMut.mutate(r.id, { onSuccess: () => toast.success('Fechado') })}><CheckCircle2 className="h-3 w-3" /></Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => exportPdf(r, 'detailed')} title="PDF detalhado"><FileText className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(r, 'trips' as any)} title="PDF controle de viagens"><FileText className="h-3 w-3" />V</Button>
                          <Button size="sm" variant="outline" onClick={() => exportExcel(r)} title="Excel"><FileSpreadsheet className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => exportCsv(r)} title="CSV"><Download className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" onClick={() => setEditTripsFor(r)} title="Editar KMs por viagem">KM</Button>
                          {['closed', 'sent'].includes(r.status) && !r.client_invoice_id && (
                            <Button size="sm" variant="secondary" onClick={() => invoiceMut.mutate(r.id, { onSuccess: () => toast.success('Fatura gerada'), onError: (e: any) => toast.error(e.message) })}>
                              <FileText className="h-3 w-3 mr-1" />Fatura
                            </Button>
                          )}
                          {['closed', 'invoiced'].includes(r.status) && (
                            <Button size="sm" variant="outline" onClick={() => sendMut.mutate({ id: r.id })}><Send className="h-3 w-3" /></Button>
                          )}
                          {['closed', 'sent', 'invoiced', 'partially_paid'].includes(r.status) && (
                            <Button size="sm" onClick={() => { setPayDlg(r); setPayForm({ amount: String(r.open_amount || r.total_amount), date: new Date().toISOString().slice(0, 10), method: 'pix', notes: '' }); }}>
                              <DollarSign className="h-3 w-3" />
                            </Button>
                          )}
                          {r.status !== 'cancelled' && r.status !== 'paid' && (
                            <Button size="sm" variant="destructive" onClick={() => { const reason = prompt('Motivo do cancelamento:'); if (reason) cancelMut.mutate({ id: r.id, reason }); }}><X className="h-3 w-3" /></Button>
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

        {/* ------- NEW ------- */}
        <TabsContent value="new" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Dados do Fechamento</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><Label>Cliente/remetente *</Label>
                <Select value={form.clientId || '__none__'} onValueChange={v => setForm({ ...form, clientId: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Tomador (se diferente)</Label>
                <Select value={form.payerId || '__none__'} onValueChange={v => setForm({ ...form, payerId: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Igual ao remetente" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Tipo</Label>
                <Select value={form.reportType} onValueChange={v => applyType(v as ReportType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3"><Label>Título</Label>
                <Input placeholder="RELATÓRIO DA 1ª QUINZENA JUNHO/2026 ASTRUM" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
              <div><Label>Período início</Label><Input type="date" value={form.periodStart} onChange={e => setForm({ ...form, periodStart: e.target.value })} /></div>
              <div><Label>Período fim</Label><Input type="date" value={form.periodEnd} onChange={e => setForm({ ...form, periodEnd: e.target.value })} /></div>
              <div><Label>Vencimento previsto</Label><Input type="date" value={form.expectedPay} onChange={e => setForm({ ...form, expectedPay: e.target.value })} /></div>
              <div><Label>Rateio de frete</Label>
                <Select value={form.freightAllocation} onValueChange={v => setForm({ ...form, freightAllocation: v as FreightAllocation })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="per_nf">Frete por NF (padrão)</SelectItem>
                    <SelectItem value="cte_by_value">Ratear CT-e por valor</SelectItem>
                    <SelectItem value="cte_by_weight">Ratear CT-e por peso</SelectItem>
                    <SelectItem value="first_nf_only">Só na 1ª NF do CT-e</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.onlyWithCte} onChange={e => setForm({ ...form, onlyWithCte: e.target.checked })} />Só com CT-e</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.onlyDelivered} onChange={e => setForm({ ...form, onlyDelivered: e.target.checked })} />Só entregues</label>
              </div>
              <div><Label>Filtrar por placa</Label>
                <Select value={form.vehicleId || '__none__'} onValueChange={v => setForm({ ...form, vehicleId: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Todas</SelectItem>
                    {vehicles.map(v => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Filtrar por motorista</Label>
                <Select value={form.driverId || '__none__'} onValueChange={v => setForm({ ...form, driverId: v === '__none__' ? '' : v })}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Todos</SelectItem>
                    {drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-3"><Label>Observação</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
              <div className="md:col-span-3 flex gap-2">
                <Button onClick={doPreview} disabled={previewMut.isPending}><Play className="h-4 w-4 mr-2" />Gerar prévia</Button>
                <Button onClick={doCreate} disabled={!preview || createMut.isPending} variant="default"><CheckCircle2 className="h-4 w-4 mr-2" />Salvar Fechamento</Button>
              </div>
            </CardContent>
          </Card>

          {preview && (
            <Card>
              <CardHeader><CardTitle>Prévia — {preview.items.length} notas</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  <Kpi label="Notas" value={preview.totals.fiscal_document_count} />
                  <Kpi label="CT-es" value={preview.totals.cte_count} />
                  <Kpi label="Cargas" value={preview.totals.load_count} />
                  <Kpi label="Peso" value={kg(preview.totals.total_weight_kg)} />
                  <Kpi label="Valor NF" value={brl(preview.totals.total_invoice_value)} />
                  <Kpi label="Frete" value={brl(preview.totals.total_freight_value)} />
                </div>
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>NF</TableHead><TableHead>Remetente</TableHead><TableHead>Destino</TableHead>
                      <TableHead>Emissão</TableHead><TableHead>Valor</TableHead><TableHead>Peso</TableHead><TableHead>Frete</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {preview.items.slice(0, 200).map((it, i) => (
                        <TableRow key={i}>
                          <TableCell>{it.invoice_number}</TableCell>
                          <TableCell className="text-xs">{it.remitter_name}</TableCell>
                          <TableCell className="text-xs">{it.destination_city}</TableCell>
                          <TableCell>{dt(it.issue_date)}</TableCell>
                          <TableCell>{brl(it.invoice_value)}</TableCell>
                          <TableCell>{kg(it.weight_kg)}</TableCell>
                          <TableCell>{brl(it.freight_value)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------- REVIEW ------- */}
        <TabsContent value="review" className="space-y-4">
          {!preview ? <p className="text-sm text-muted-foreground">Gere uma prévia na aba "Novo Fechamento" para ver divergências.</p> : (
            <Card>
              <CardHeader><CardTitle>Divergências ({preview.divergences.length})</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Severidade</TableHead><TableHead>Código</TableHead><TableHead>Descrição</TableHead><TableHead>NF</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {preview.divergences.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell><Badge variant={d.severity === 'error' ? 'destructive' : d.severity === 'warning' ? 'secondary' : 'outline'}><AlertCircle className="h-3 w-3 mr-1" />{d.severity}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{d.code}</TableCell>
                        <TableCell>{d.description}</TableCell>
                        <TableCell>{d.invoice_number ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------- REPORTS ------- */}
        <TabsContent value="reports" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Exportar de um fechamento</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Use os botões de ação na lista "Fechamentos" para exportar PDF (resumo/detalhado), Excel (Resumo/Detalhado/Divergências/Metadados) e CSV.
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------- LEGACY ------- */}
        <TabsContent value="legacy" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Importar planilha legada</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <input type="file" accept=".xlsx,.xls" onChange={e => e.target.files && onLegacyFile(e.target.files[0])} />
              {legacy && (
                <div className="space-y-2">
                  <div className="text-sm">Modelo detectado: <Badge>{legacy.model}</Badge> — {legacyFileName}</div>
                  {legacy.title && <div className="text-sm"><b>Título:</b> {legacy.title}</div>}
                  <div className="text-sm">
                    Linhas resumo: {legacy.summaryRows.length} · Linhas detalhadas: {legacy.detailedRows.length} ·
                    Valor total: {brl(legacy.totals.total_invoice_value)} · Peso: {kg(legacy.totals.total_weight_kg)} · Frete: {brl(legacy.totals.total_freight_value)}
                  </div>
                  <Button onClick={importLegacy}><Upload className="h-4 w-4 mr-2" />Criar fechamento legado</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Payment dialog */}
      <Dialog open={!!payDlg} onOpenChange={() => setPayDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pagamento — {payDlg?.closing_number}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor</Label><Input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} /></div>
            <div><Label>Data</Label><Input type="date" value={payForm.date} onChange={e => setPayForm({ ...payForm, date: e.target.value })} /></div>
            <div><Label>Método</Label>
              <Select value={payForm.method} onValueChange={v => setPayForm({ ...payForm, method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem><SelectItem value="ted">TED</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem><SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notas</Label><Input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDlg(null)}>Cancelar</Button>
            <Button onClick={() => { if (!payDlg) return; regPay.mutate({ id: payDlg.id, payment: { amount: Number(payForm.amount), payment_date: payForm.date, payment_method: payForm.method, notes: payForm.notes } }, { onSuccess: () => { toast.success('Pagamento registrado'); setPayDlg(null); } }); }}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editTripsFor && (
        <TripEditorDialog
          report={editTripsFor}
          onClose={() => setEditTripsFor(null)}
          onSaveItem={(itemId, patch) => updateItem.mutateAsync({ itemId, closingReportId: editTripsFor.id, patch })}
        />
      )}
    </div>
  );
}


function TripEditorDialog({ report, onClose, onSaveItem }: { report: ClosingReportRow; onClose: () => void; onSaveItem: (itemId: string, patch: any) => Promise<void> | void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any).from('closing_report_items')
        .select('id, load_id, load_number, route_label, route_complement, destination_city, origin_city, vehicle_plate, driver_name, departure_at, arrival_at_ts, km_initial, km_final, km_driven, fuel_liters, fuel_unit_price, fuel_total, consumption_km_l, sort_order')
        .eq('closing_report_id', report.id).order('sort_order');
      // dedupe by load_id (keep first)
      const seen = new Set<string>();
      const uniq: any[] = [];
      for (const r of (data ?? [])) {
        const k = r.load_id || `nf-${r.id}`;
        if (seen.has(k)) continue;
        seen.add(k); uniq.push(r);
      }
      setRows(uniq);
      setLoading(false);
    })();
  }, [report.id]);

  const setField = (id: string, field: string, value: any) => {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const saveRow = async (r: any) => {
    setSaving(r.id);
    try {
      await onSaveItem(r.id, {
        km_initial: r.km_initial !== '' && r.km_initial != null ? Number(r.km_initial) : null,
        km_final: r.km_final !== '' && r.km_final != null ? Number(r.km_final) : null,
        fuel_liters: r.fuel_liters !== '' && r.fuel_liters != null ? Number(r.fuel_liters) : null,
        fuel_unit_price: r.fuel_unit_price !== '' && r.fuel_unit_price != null ? Number(r.fuel_unit_price) : null,
        vehicle_plate: r.vehicle_plate || null,
        driver_name: r.driver_name || null,
        departure_at: r.departure_at || null,
        arrival_at_ts: r.arrival_at_ts || null,
        route_label: r.route_label || null,
        route_complement: r.route_complement || null,
      });
      toast.success('Viagem atualizada');
    } finally { setSaving(null); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-6xl">
        <DialogHeader><DialogTitle>Editar viagens — {report.closing_number}</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {loading ? <p className="text-sm">Carregando…</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Carga</TableHead><TableHead>Rota</TableHead><TableHead>Placa</TableHead><TableHead>Motorista</TableHead>
                <TableHead>Saída</TableHead><TableHead>Chegada</TableHead>
                <TableHead>KM Ini</TableHead><TableHead>KM Fim</TableHead><TableHead>KM</TableHead>
                <TableHead>Litros</TableHead><TableHead>R$/L</TableHead><TableHead>km/L</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.load_number ?? '—'}</TableCell>
                    <TableCell><Input className="w-32 h-8" value={r.route_label ?? r.destination_city ?? ''} onChange={e => setField(r.id, 'route_label', e.target.value)} /></TableCell>
                    <TableCell><Input className="w-24 h-8" value={r.vehicle_plate ?? ''} onChange={e => setField(r.id, 'vehicle_plate', e.target.value.toUpperCase())} /></TableCell>
                    <TableCell><Input className="w-32 h-8" value={r.driver_name ?? ''} onChange={e => setField(r.id, 'driver_name', e.target.value.toUpperCase())} /></TableCell>
                    <TableCell><Input className="w-40 h-8" type="datetime-local" value={r.departure_at ? String(r.departure_at).slice(0, 16) : ''} onChange={e => setField(r.id, 'departure_at', e.target.value ? new Date(e.target.value).toISOString() : null)} /></TableCell>
                    <TableCell><Input className="w-40 h-8" type="datetime-local" value={r.arrival_at_ts ? String(r.arrival_at_ts).slice(0, 16) : ''} onChange={e => setField(r.id, 'arrival_at_ts', e.target.value ? new Date(e.target.value).toISOString() : null)} /></TableCell>
                    <TableCell><Input className="w-24 h-8" type="number" value={r.km_initial ?? ''} onChange={e => setField(r.id, 'km_initial', e.target.value)} /></TableCell>
                    <TableCell><Input className="w-24 h-8" type="number" value={r.km_final ?? ''} onChange={e => setField(r.id, 'km_final', e.target.value)} /></TableCell>
                    <TableCell className="text-xs">{(Number(r.km_final || 0) - Number(r.km_initial || 0)) || '—'}</TableCell>
                    <TableCell><Input className="w-20 h-8" type="number" step="0.01" value={r.fuel_liters ?? ''} onChange={e => setField(r.id, 'fuel_liters', e.target.value)} /></TableCell>
                    <TableCell><Input className="w-20 h-8" type="number" step="0.01" value={r.fuel_unit_price ?? ''} onChange={e => setField(r.id, 'fuel_unit_price', e.target.value)} /></TableCell>
                    <TableCell className="text-xs">{r.consumption_km_l ? Number(r.consumption_km_l).toFixed(2) : '—'}</TableCell>
                    <TableCell><Button size="sm" disabled={saving === r.id} onClick={() => saveRow(r)}>{saving === r.id ? '…' : 'Salvar'}</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </CardContent></Card>
  );
}
