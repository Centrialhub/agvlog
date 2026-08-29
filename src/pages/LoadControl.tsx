import { confirmAction } from '@/hooks/useAlertStore';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Download, Printer, Upload, Search, RefreshCw, FileText, CheckCircle2, Undo2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import {
  useLoadControlList, useLoadDocuments, useUnloadingCharges, useImportBatches,
  useRegisterPayment, useMarkUnpaid, commitSpreadsheetImport, commitXmlImport,
  PAYMENT_STATUS_LABELS, OPERATIONAL_STATUS_LABELS,
  type LoadControlRow, type LoadControlFilters,
} from '@/hooks/useLoadControl';
import { useTenant } from '@/hooks/useTenant';
import { parseLoadSpreadsheet } from '@/lib/loadImports/spreadsheetLoadImport';
import { parseFiscalXml, type ParsedNfe, type ParsedCte } from '@/lib/loadImports/xmlLoadImport';
import { downloadLoadControlPdf, type LoadReportKind } from '@/lib/loadReports/loadControlPdf';
import { exportLoadControlCsv } from '@/lib/loadReports/loadControlCsv';
import { useCompanyProfile } from '@/hooks/useCompanyProfile';
import { toCompanyPdfInfo } from '@/lib/pdf/companyHeader';
import { getErrorMessage } from '@/lib/errors';
import type { ImportPreview } from '@/hooks/useLoadControl';
import type { ReactNode } from 'react';

const brl = (value: number | string | null | undefined) => 'R$ ' + Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (v?: string | null) => v ? v.slice(0, 10).split('-').reverse().join('/') : '—';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  paid: 'default', partially_paid: 'secondary', unpaid: 'outline',
  overdue: 'destructive', disputed: 'destructive', cancelled: 'outline',
};

export default function LoadControl() {
  const { currentTenant } = useTenant();
  const { data: companyProfile } = useCompanyProfile();
  const [filters, setFilters] = useState<LoadControlFilters>({});
  const [applied, setApplied] = useState<LoadControlFilters>({});
  const { data: rows = [], isLoading, refetch } = useLoadControlList(applied);
  const [detailRow, setDetailRow] = useState<LoadControlRow | null>(null);
  const [payDlg, setPayDlg] = useState<LoadControlRow | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), method: 'pix', notes: '' });
  const regPay = useRegisterPayment();
  const markUnpaid = useMarkUnpaid();
  const { data: batches = [] } = useImportBatches();

  const kpis = useMemo(() => {
    const acc = { total: rows.length, paid: 0, unpaid: 0, overdue: 0, billed: 0, freight: 0, open: 0, weight: 0, nfs: 0, ctes: 0 };
    for (const r of rows) {
      if (r.payment_status === 'paid') acc.paid++;
      if (r.payment_status === 'unpaid' || r.payment_status === 'partially_paid') acc.unpaid++;
      if (r.payment_status === 'overdue') acc.overdue++;
      acc.billed += Number(r.gross_cargo_value || 0);
      acc.freight += Number(r.freight_amount || 0);
      acc.open += Math.max(0, Number(r.freight_amount || 0) - Number(r.received_amount || 0));
      acc.weight += Number(r.total_weight_kg || 0);
      acc.nfs += Number(r.invoice_count || 0);
      acc.ctes += Number(r.cte_count || 0);
    }
    return acc;
  }, [rows]);

  const set = (key: keyof LoadControlFilters, value: string | null) => setFilters(filters => ({ ...filters, [key]: value === '' ? null : value }));

  const doSearch = () => setApplied(filters);
  const doClear = () => { setFilters({}); setApplied({}); };

  const openPay = (r: LoadControlRow) => {
    setPayForm({ amount: String(Math.max(0, Number(r.freight_amount || 0) - Number(r.received_amount || 0)).toFixed(2)),
                 date: new Date().toISOString().slice(0, 10), method: 'pix', notes: '' });
    setPayDlg(r);
  };
  const submitPay = async () => {
    if (!payDlg) return;
    try {
      await regPay.mutateAsync({
        loadId: payDlg.id, amount: Number(payForm.amount.replace(',', '.')),
        paymentDate: payForm.date, method: payForm.method, notes: payForm.notes,
      });
      toast.success('Pagamento registrado'); setPayDlg(null);
    } catch (error: unknown) { toast.error(getErrorMessage(error, 'Falha')); }
  };

  const [reportKind, setReportKind] = useState<LoadReportKind>('summary');
  const runReport = async () => {
    if (!rows.length) { toast.error('Sem dados no filtro atual.'); return; }
    if (rows.length > 5000 && !await confirmAction(`${rows.length} linhas serão incluídas. Continuar?`, {
      title: 'Gerar relatório extenso',
    })) return;
    downloadLoadControlPdf({
      kind: reportKind, rows, carrierName: currentTenant?.name || 'Transportadora',
      company: toCompanyPdfInfo(companyProfile, currentTenant?.name),
      title: REPORT_TITLES[reportKind],
      filtersText: JSON.stringify(applied),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Controle de Cargas</h1>
          <p className="text-sm text-muted-foreground">Consolidação operacional e financeira das cargas recebidas.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}><RefreshCw className="h-4 w-4 mr-1" />Atualizar</Button>
          <Button variant="outline" onClick={() => exportLoadControlCsv(rows)}><Download className="h-4 w-4 mr-1" />CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi label="Cargas" value={kpis.total} />
        <Kpi label="Pagas" value={kpis.paid} />
        <Kpi label="Em aberto" value={kpis.unpaid} tone="warning" />
        <Kpi label="Vencidas" value={kpis.overdue} tone="destructive" />
        <Kpi label="Frete total" value={brl(kpis.freight)} />
      </div>

      <Tabs defaultValue="loads">
        <TabsList>
          <TabsTrigger value="loads">Cargas</TabsTrigger>
          <TabsTrigger value="import">Importar XML/Planilha</TabsTrigger>
          <TabsTrigger value="unloading">Descargas</TabsTrigger>
          <TabsTrigger value="reports">Relatórios</TabsTrigger>
          <TabsTrigger value="pending">Pendências</TabsTrigger>
        </TabsList>

        <TabsContent value="loads" className="space-y-3">
          <Card>
            <CardContent className="p-3 grid gap-2 md:grid-cols-6">
              <div><Label className="text-xs">Nº carga</Label><Input value={filters.loadNumber || ''} onChange={e => set('loadNumber', e.target.value)} /></div>
              <div><Label className="text-xs">Status financeiro</Label>
                <Select value={filters.paymentStatus || 'all'} onValueChange={v => set('paymentStatus', v === 'all' ? null : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Data carga (de)</Label><Input type="date" value={filters.loadDateFrom || ''} onChange={e => set('loadDateFrom', e.target.value)} /></div>
              <div><Label className="text-xs">Data carga (até)</Label><Input type="date" value={filters.loadDateTo || ''} onChange={e => set('loadDateTo', e.target.value)} /></div>
              <div><Label className="text-xs">Prev. pagto (de)</Label><Input type="date" value={filters.expectedPayFrom || ''} onChange={e => set('expectedPayFrom', e.target.value)} /></div>
              <div><Label className="text-xs">Prev. pagto (até)</Label><Input type="date" value={filters.expectedPayTo || ''} onChange={e => set('expectedPayTo', e.target.value)} /></div>
              <div className="md:col-span-6 flex gap-2 justify-end">
                <Button variant="ghost" onClick={doClear}>Limpar</Button>
                <Button onClick={doSearch}><Search className="h-4 w-4 mr-1" />Buscar</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº Carga</TableHead>
                    <TableHead>Data carga</TableHead>
                    <TableHead>Chegada</TableHead>
                    <TableHead className="text-right">Faturado</TableHead>
                    <TableHead className="text-right">Frete</TableHead>
                    <TableHead>NFs</TableHead>
                    <TableHead>CT-es</TableHead>
                    <TableHead>Motorista</TableHead>
                    <TableHead>Placa</TableHead>
                    <TableHead>Status Op.</TableHead>
                    <TableHead>Status Fin.</TableHead>
                    <TableHead>Prev. Pag.</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? <TableRow><TableCell colSpan={14}>Carregando…</TableCell></TableRow> :
                    rows.length === 0 ? <TableRow><TableCell colSpan={14}>Nenhuma carga.</TableCell></TableRow> :
                    rows.map(r => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailRow(r)}>
                        <TableCell className="font-medium">{r.external_load_number || r.load_number}</TableCell>
                        <TableCell>{dt(r.load_date)}</TableCell>
                        <TableCell>{dt(r.arrival_date)}</TableCell>
                        <TableCell className="text-right">{brl(r.gross_cargo_value)}</TableCell>
                        <TableCell className="text-right">{brl(r.freight_amount)}</TableCell>
                        <TableCell>{r.invoice_count}</TableCell>
                        <TableCell>{r.cte_count}</TableCell>
                        <TableCell>{r.driver_name || '—'}</TableCell>
                        <TableCell>{r.plate || '—'}</TableCell>
                        <TableCell><Badge variant="outline">{OPERATIONAL_STATUS_LABELS[r.operational_status || ''] || r.operational_status || '—'}</Badge></TableCell>
                        <TableCell><Badge variant={STATUS_VARIANT[r.payment_status] || 'outline'}>{PAYMENT_STATUS_LABELS[r.payment_status] || r.payment_status}</Badge></TableCell>
                        <TableCell>{dt(r.expected_payment_date)}</TableCell>
                        <TableCell className="text-right">{brl(Number(r.freight_amount || 0) - Number(r.received_amount || 0))}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()} className="whitespace-nowrap">
                          {r.payment_status === 'paid' ? (
                            <Button size="sm" variant="ghost" onClick={() => markUnpaid.mutate(r.id)} title="Marcar como não pago"><Undo2 className="h-4 w-4" /></Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => openPay(r)} title="Marcar como pago"><CheckCircle2 className="h-4 w-4" /></Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-3">
          <ImportPanel tenantId={currentTenant?.id} onDone={() => refetch()} />
          <Card>
            <CardHeader><CardTitle className="text-sm">Últimas importações</CardTitle></CardHeader>
            <CardContent className="p-0 overflow-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Data</TableHead><TableHead>Arquivo</TableHead><TableHead>Tipo</TableHead>
                  <TableHead>Importados</TableHead><TableHead>Duplicados</TableHead><TableHead>Erros</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{new Date(b.created_at).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-xs">{b.file_name}</TableCell>
                      <TableCell>{b.source_type}</TableCell>
                      <TableCell>{b.imported_count}</TableCell>
                      <TableCell>{b.duplicated_count}</TableCell>
                      <TableCell>{b.error_count}</TableCell>
                      <TableCell><Badge variant="outline">{b.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unloading">
          <UnloadingTab />
        </TabsContent>

        <TabsContent value="reports" className="space-y-3">
          <Card><CardContent className="p-3 flex gap-2 items-end">
            <div className="flex-1 max-w-sm">
              <Label className="text-xs">Relatório</Label>
              <Select value={reportKind} onValueChange={(value) => setReportKind(value as LoadReportKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">Resumo de Cargas Recebidas</SelectItem>
                  <SelectItem value="detailed">Detalhado da Carga</SelectItem>
                  <SelectItem value="open">Cargas em Aberto</SelectItem>
                  <SelectItem value="paid">Cargas Pagas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runReport}><Printer className="h-4 w-4 mr-1" />Gerar PDF</Button>
            <Button variant="outline" onClick={() => exportLoadControlCsv(rows)}><Download className="h-4 w-4 mr-1" />CSV</Button>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pending">
          <PendingPanel rows={rows} />
        </TabsContent>
      </Tabs>

      {/* Payment dialog */}
      <Dialog open={!!payDlg} onOpenChange={o => !o && setPayDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar pagamento — {payDlg?.external_load_number}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label>Valor</Label><Input value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} /></div>
            <div><Label>Data</Label><Input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><Label>Método</Label>
              <Select value={payForm.method} onValueChange={v => setPayForm(f => ({ ...f, method: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">PIX</SelectItem>
                  <SelectItem value="ted">TED</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Observação</Label><Input value={payForm.notes} onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayDlg(null)}>Cancelar</Button>
            <Button onClick={submitPay} disabled={regPay.isPending}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet open={!!detailRow} onOpenChange={o => !o && setDetailRow(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-auto">
          {detailRow && <LoadDetailPanel row={detailRow} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const REPORT_TITLES: Record<LoadReportKind, string> = {
  summary: 'Resumo de Cargas Recebidas', detailed: 'Relatório Detalhado da Carga',
  open: 'Cargas em Aberto', paid: 'Cargas Pagas',
  by_client: 'Por Cliente', by_city: 'Por Cidade', unloading: 'Descargas',
};

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warning' | 'destructive' }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold ${tone === 'warning' ? 'text-amber-600' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </CardContent></Card>
  );
}

function ImportPanel({ tenantId, onDone }: { tenantId?: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const onXlsx = async (file: File) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseLoadSpreadsheet(buf);
      const { preview: p } = await commitSpreadsheetImport(tenantId, file.name, parsed);
      setPreview(p); onDone();
      toast.success('Planilha importada');
    } catch (error: unknown) { toast.error(getErrorMessage(error, 'Falha ao importar')); }
    finally { setBusy(false); }
  };

  const onXml = async (files: FileList) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const docs: Array<ParsedNfe | ParsedCte> = [];
      let unsupported = 0;
      for (const f of Array.from(files)) {
        const txt = await f.text();
        const r = parseFiscalXml(txt);
        if (r.kind === 'unsupported') { unsupported++; continue; }
        docs.push(r);
      }
      if (unsupported) toast.warning(`${unsupported} arquivo(s) fora do escopo ignorado(s).`);
      const { preview: p } = await commitXmlImport(tenantId, `xmls-${files.length}`, docs);
      setPreview(p); onDone();
      toast.success('XMLs importados');
    } catch (error: unknown) { toast.error(getErrorMessage(error, 'Falha')); }
    finally { setBusy(false); }
  };

  return (
    <Card><CardContent className="p-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="border rounded p-3">
          <div className="flex items-center gap-2 mb-2"><FileText className="h-4 w-4" /><span className="font-medium">Planilha legada (.xlsx)</span></div>
          <Input type="file" accept=".xlsx" disabled={busy}
                 onChange={e => e.target.files?.[0] && onXlsx(e.target.files[0])} />
          <p className="text-xs text-muted-foreground mt-1">Detecta automaticamente Resumo / Detalhada / Descarga.</p>
        </div>
        <div className="border rounded p-3">
          <div className="flex items-center gap-2 mb-2"><Upload className="h-4 w-4" /><span className="font-medium">XMLs (NF-e / CT-e)</span></div>
          <Input type="file" accept=".xml" multiple disabled={busy}
                 onChange={e => e.target.files && onXml(e.target.files)} />
          <p className="text-xs text-muted-foreground mt-1">Vários arquivos. XMLs fora do escopo são ignorados.</p>
        </div>
      </div>
      {preview && (
        <div className="text-xs bg-muted p-2 rounded">
          <div>Cargas novas: <b>{preview.newLoads}</b> • Atualizadas: <b>{preview.updatedLoads}</b> • Documentos: <b>{preview.newDocuments}</b> • Duplicados: <b>{preview.duplicated}</b> • Pendências: <b>{preview.pending}</b> • Erros: <b>{preview.errors.length}</b></div>
          {preview.errors.slice(0, 5).map((error, index) => <div key={index} className="text-destructive">• {error.message}</div>)}
        </div>
      )}
    </CardContent></Card>
  );
}

function UnloadingTab() {
  const { data: charges = [], isLoading } = useUnloadingCharges();
  return (
    <Card><CardContent className="p-0 overflow-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Fornecedor</TableHead>
          <TableHead>Cidade</TableHead><TableHead>Data</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead>Carga</TableHead><TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading ? <TableRow><TableCell colSpan={8}>Carregando…</TableCell></TableRow> :
            charges.length === 0 ? <TableRow><TableCell colSpan={8}>Nenhuma descarga registrada.</TableCell></TableRow> :
            charges.map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.invoice_number || '—'}</TableCell>
                <TableCell>{c.client_name || '—'}</TableCell>
                <TableCell>{c.supplier_name || '—'}</TableCell>
                <TableCell>{c.city || '—'}</TableCell>
                <TableCell>{dt(c.service_date)}</TableCell>
                <TableCell className="text-right">{brl(c.amount)}</TableCell>
                <TableCell>{c.load?.external_load_number || c.load?.load_number || '—'}</TableCell>
                <TableCell><Badge variant="outline">{c.status}</Badge></TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function PendingPanel({ rows }: { rows: LoadControlRow[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const pending = rows.filter(r =>
    (r.expected_payment_date && r.expected_payment_date < today && r.payment_status !== 'paid') ||
    !r.expected_payment_date || r.invoice_count === 0
  ).slice(0, 200);
  return (
    <Card><CardContent className="p-0 overflow-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Tipo</TableHead><TableHead>Carga</TableHead><TableHead>Mensagem</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {pending.length === 0 ? <TableRow><TableCell colSpan={3}>Nenhuma pendência detectada.</TableCell></TableRow> :
            pending.map(r => (
              <TableRow key={r.id}>
                <TableCell>{!r.expected_payment_date ? 'Sem previsão' : r.invoice_count === 0 ? 'Sem NF' : 'Vencida'}</TableCell>
                <TableCell>{r.external_load_number || r.load_number}</TableCell>
                <TableCell className="text-xs">{r.legacy_status_text || '—'}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}

function LoadDetailPanel({ row }: { row: LoadControlRow }) {
  const { data: docs = [] } = useLoadDocuments(row.id);
  const { data: charges = [] } = useUnloadingCharges({ loadId: row.id });
  return (
    <div className="space-y-3">
      <SheetHeader><SheetTitle>Carga {row.external_load_number || row.load_number}</SheetTitle></SheetHeader>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><b>Data carga:</b> {dt(row.load_date)}</div>
        <div><b>Chegada:</b> {dt(row.arrival_date)}</div>
        <div><b>Faturado:</b> {brl(row.gross_cargo_value)}</div>
        <div><b>Frete:</b> {brl(row.freight_amount)}</div>
        <div><b>Recebido:</b> {brl(row.received_amount)}</div>
        <div><b>Saldo:</b> {brl(Number(row.freight_amount || 0) - Number(row.received_amount || 0))}</div>
        <div><b>Prev. pagto:</b> {dt(row.expected_payment_date)}</div>
        <div><b>Data pagto:</b> {dt(row.payment_date)}</div>
        <div className="col-span-2 text-xs text-muted-foreground"><b>Legado:</b> {row.legacy_status_text || '—'}</div>
      </div>
      <div>
        <div className="font-medium text-sm mt-2 mb-1">Documentos ({docs.length})</div>
        <div className="max-h-52 overflow-auto border rounded">
          <Table>
            <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Número</TableHead><TableHead>Emitente</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.document_type}</TableCell>
                  <TableCell>{d.document_number}</TableCell>
                  <TableCell className="text-xs">{d.issuer_name}</TableCell>
                  <TableCell className="text-right">{brl(d.cargo_value)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <div>
        <div className="font-medium text-sm mt-2 mb-1">Descargas ({charges.length})</div>
        <div className="max-h-52 overflow-auto border rounded">
          <Table>
            <TableHeader><TableRow><TableHead>NF</TableHead><TableHead>Cliente</TableHead><TableHead>Cidade</TableHead><TableHead className="text-right">Valor</TableHead></TableRow></TableHeader>
            <TableBody>
              {charges.map(c => (
                <TableRow key={c.id}>
                  <TableCell>{c.invoice_number}</TableCell>
                  <TableCell className="text-xs">{c.client_name}</TableCell>
                  <TableCell>{c.city}</TableCell>
                  <TableCell className="text-right">{brl(c.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
