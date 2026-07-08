import { useMemo, useState } from 'react';
import { useNavigate as useNavigateRR } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import {
  useOccurrences,
  useReportExports,
  useImportBatches,
  useCreateExport,
  useMarkExportSent,
  useImportLegacyBatch,
} from '@/hooks/useOccurrenceReports';
import {
  aggregateOccurrences,
  reportTypeLabels,
  resolutionTypeLabels,
  type ReportType,
} from '@/lib/occurrenceReports/occurrenceReportBuilder';
import { parseLegacyOccurrenceSpreadsheet } from '@/lib/occurrenceReports/legacyOccurrenceImport';
import { returnedNotesCsv, unservedNotesCsv } from '@/lib/occurrenceReports/occurrenceReportCsv';
import { generateReturnedNotesPdf } from '@/lib/occurrenceReports/returnedNotesReportPdf';
import { generateUnservedNotesPdf } from '@/lib/occurrenceReports/unservedNotesReportPdf';
import { buildOccurrenceReportExcel } from '@/lib/occurrenceReports/occurrenceReportExcel';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function OccurrenceReports() {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [customer, setCustomer] = useState('');
  const [supplier, setSupplier] = useState('');
  const [city, setCity] = useState('');
  const [resolutionType, setResolutionType] = useState<string>('');
  const [rural, setRural] = useState<'all' | 'only' | 'exclude'>('all');
  const [onlyFinalized, setOnlyFinalized] = useState(true);

  const filters = {
    periodStart: periodStart || undefined,
    periodEnd: periodEnd || undefined,
    customer: customer || undefined,
    supplier: supplier || undefined,
    city: city || undefined,
    resolutionType: resolutionType || undefined,
    onlyFinalized,
  };

  const { data: occurrences = [], isLoading } = useOccurrences(filters);
  const { data: exportsRows = [] } = useReportExports();
  const { data: batches = [] } = useImportBatches();
  const createExport = useCreateExport();
  const markSent = useMarkExportSent();
  const importBatch = useImportLegacyBatch();

  const agg = useMemo(() => aggregateOccurrences(occurrences), [occurrences]);

  const returnedRows = occurrences.filter((o) =>
    ['returned_total', 'returned_partial', 'partial_return'].includes(o.resolution_type ?? ''),
  );
  const unservedRows = occurrences.filter((o) => o.resolution_type === 'no_dispatch_week');
  const shortageSurplusRows = occurrences.filter((o) =>
    ['shortage_found', 'surplus_found'].includes(o.resolution_type ?? ''),
  );

  const generateReturnedReport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!returnedRows.length) {
      toast({ title: 'Sem linhas', description: 'Nenhuma devolução no período/filtro.', variant: 'destructive' });
      return;
    }
    const rows = returnedRows.map((o) => ({
      section: 'returns' as const,
      customer_name: o.customer_name,
      city: o.city,
      occurrence_number: o.occurrence_number,
      invoice_number: o.invoice_number,
      return_type: (o.resolution_type ?? '').includes('total') ? 'TOTAL' : 'PARCIAL',
      invoice_value: 0,
      reason: o.occurrence_reason ?? o.resolution_notes ?? '',
      quantity_text: '',
      product_description: o.occurrence_description ?? '',
      password_or_authorization: o.password_or_authorization ?? '',
    }));
    const title = `PROTOCOLO DE DEVOLUÇÃO${customer ? ' - ' + customer : ''}`;
    if (format === 'pdf') {
      const pdf = generateReturnedNotesPdf({ title, clientName: customer || null, supplierName: supplier || null, periodStart, periodEnd, rows });
      pdf.save(`${title}.pdf`);
    } else if (format === 'csv') {
      downloadBlob(returnedNotesCsv(rows), `${title}.csv`);
    } else {
      downloadBlob(
        buildOccurrenceReportExcel({
          title,
          periodStart, periodEnd, clientName: customer, supplierName: supplier,
          rows,
          headers: ['Cliente', 'Cidade', 'NF', 'Tipo', 'Motivo', 'Descrição'],
          keys: ['customer_name', 'city', 'invoice_number', 'return_type', 'reason', 'product_description'],
        }),
        `${title}.xlsx`,
      );
    }
    try {
      await createExport.mutateAsync({
        report_type: 'returned_notes',
        title,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        filters_snapshot: filters as Record<string, unknown>,
        items: rows.map((r, idx) => ({ sort_order: idx, ...r })),
      });
      toast({ title: 'Relatório registrado', description: 'Snapshot salvo no histórico.' });
    } catch (e) {
      toast({ title: 'Erro ao registrar snapshot', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const generateUnservedReport = async (format: 'pdf' | 'excel' | 'csv') => {
    if (!unservedRows.length) {
      toast({ title: 'Sem linhas', description: 'Nenhuma nota sem saída no período.', variant: 'destructive' });
      return;
    }
    const rows = unservedRows.map((o) => ({
      invoice_number: o.invoice_number,
      customer_name: o.customer_name,
      city: o.city,
      invoice_issue_date: o.occurrence_date,
      invoice_value: 0,
      supplier_name: o.supplier_name,
      notes: o.resolution_notes ?? o.occurrence_reason ?? '',
    }));
    const title = `Notas sem saída - ${periodStart || 'período'} a ${periodEnd || ''}`;
    if (format === 'pdf') {
      const pdf = generateUnservedNotesPdf({ title, periodStart, periodEnd, clientName: customer, supplierName: supplier, rows });
      pdf.save(`${title}.pdf`);
    } else if (format === 'csv') {
      downloadBlob(unservedNotesCsv(rows), `${title}.csv`);
    } else {
      downloadBlob(
        buildOccurrenceReportExcel({
          title, periodStart, periodEnd, clientName: customer, supplierName: supplier,
          rows,
          headers: ['NF', 'Cliente', 'Cidade', 'Data NF', 'Valor', 'Fornecedor', 'Observação'],
          keys: ['invoice_number', 'customer_name', 'city', 'invoice_issue_date', 'invoice_value', 'supplier_name', 'notes'],
        }),
        `${title}.xlsx`,
      );
    }
    try {
      await createExport.mutateAsync({
        report_type: 'unserved_notes_week',
        title,
        period_start: periodStart || null,
        period_end: periodEnd || null,
        filters_snapshot: filters as Record<string, unknown>,
        items: rows.map((r, idx) => ({ sort_order: idx, ...r })),
      });
    } catch (e) {
      toast({ title: 'Erro ao registrar snapshot', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const [sendDialog, setSendDialog] = useState<null | { id: string; title: string }>(null);
  const [sendChannel, setSendChannel] = useState('email');
  const [sendTo, setSendTo] = useState('');
  const [sendNotes, setSendNotes] = useState('');

  const handleMarkSent = async () => {
    if (!sendDialog) return;
    try {
      await markSent.mutateAsync({ id: sendDialog.id, sent_channel: sendChannel, sent_to: sendTo, sent_notes: sendNotes });
      toast({ title: 'Registrado envio' });
      setSendDialog(null); setSendTo(''); setSendNotes('');
    } catch (e) {
      toast({ title: 'Erro', description: (e as Error).message, variant: 'destructive' });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseLegacyOccurrenceSpreadsheet(buf, file.name);
      if (parsed.model === 'unknown') {
        toast({ title: 'Modelo não reconhecido', description: parsed.errors.join(' | '), variant: 'destructive' });
        return;
      }
      const returned = parsed.returned_rows ?? [];
      const unserved = parsed.unserved_rows ?? [];
      const occurrences = [
        ...returned.map((r) => ({
          occurrence_type: r.section === 'collection' ? 'collection' : r.section === 'shortages' ? 'shortage' : r.section === 'surplus' ? 'surplus' : 'return',
          resolution_type:
            r.section === 'collection' ? 'collection_requested'
            : r.section === 'shortages' ? 'shortage_found'
            : r.section === 'surplus' ? 'surplus_found'
            : (r.return_type ?? '').toUpperCase().includes('TOTAL') ? 'returned_total'
            : 'returned_partial',
          invoice_number: r.invoice_number ?? null,
          customer_name: r.customer_name ?? null,
          city: r.city ?? null,
          occurrence_number: r.occurrence_number ?? null,
          occurrence_reason: r.reason ?? null,
          occurrence_description: r.product_description ?? null,
          password_or_authorization: r.password_or_authorization ?? null,
          status: 'resolved',
          metadata: { legacy: r.raw, quantity_text: r.quantity_text ?? null, source: 'legacy_returned' },
        })),
        ...unserved.map((u) => ({
          occurrence_type: 'no_dispatch_week',
          resolution_type: 'no_dispatch_week',
          invoice_number: (u.invoice_numbers ?? []).join('/'),
          customer_name: u.customer_name ?? null,
          city: u.city ?? null,
          supplier_name: u.supplier_name ?? null,
          occurrence_date: u.invoice_issue_date ?? null,
          resolution_notes: u.notes ?? null,
          status: 'resolved',
          metadata: { legacy: u.raw, invoice_value: u.invoice_value ?? null, source: 'legacy_unserved' },
        })),
      ];
      const total = returned.length + unserved.length;
      await importBatch.mutateAsync({
        file_name: file.name,
        detected_model: parsed.model,
        row_count: total,
        imported_count: occurrences.length,
        unmatched_count: 0,
        error_count: parsed.errors.length,
        errors: parsed.errors,
        metadata: { title: parsed.title, supplier: parsed.supplier_name },
        occurrences,
      });
      toast({ title: 'Importação concluída', description: `${occurrences.length} ocorrência(s) importada(s).` });
    } catch (e) {
      toast({ title: 'Erro na importação', description: (e as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Relatórios de Ocorrências</h1>
        <p className="text-sm text-muted-foreground">
          Consulte tratativas finalizadas, gere protocolos de devolução, notas sem saída e faltas/sobras.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filtros globais</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div><Label>Período de ocorrência (início)</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
          <div><Label>Fim</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          <div><Label>Cliente</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Buscar cliente" /></div>
          <div><Label>Fornecedor</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Buscar fornecedor" /></div>
          <div><Label>Cidade</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
          <div>
            <Label>Resultado da tratativa</Label>
            <Select value={resolutionType || '__all__'} onValueChange={(v) => setResolutionType(v === '__all__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {Object.entries(resolutionTypeLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Zona rural</Label>
            <Select value={rural} onValueChange={(v) => setRural(v as typeof rural)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="only">Apenas rural</SelectItem>
                <SelectItem value="exclude">Excluir rural</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant={onlyFinalized ? 'default' : 'outline'} onClick={() => setOnlyFinalized((v) => !v)}>
              {onlyFinalized ? 'Apenas finalizadas' : 'Todas'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="dashboard">
        <TabsList>
          <TabsTrigger value="dashboard">Relatórios</TabsTrigger>
          <TabsTrigger value="returned">Notas Devolvidas</TabsTrigger>
          <TabsTrigger value="unserved">Notas Sem Saída</TabsTrigger>
          <TabsTrigger value="shortage">Faltas e Sobras</TabsTrigger>
          <TabsTrigger value="history">Histórico de Envios</TabsTrigger>
          <TabsTrigger value="import">Importar Legado</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ['Ocorrências finalizadas', agg.totalOccurrences],
              ['Devoluções totais', agg.returnedTotal],
              ['Devoluções parciais', agg.returnedPartial],
              ['Notas sem saída', agg.unservedWeek],
              ['Faltas', agg.shortages],
              ['Sobras', agg.surpluses],
              ['Coletas pendentes', agg.collectionsPending],
              ['Coletas realizadas', agg.collectionsDone],
              ['Clientes afetados', agg.clients],
              ['Fornecedores afetados', agg.suppliers],
              ['Valor total NFs', 'R$ ' + agg.totalInvoiceValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })],
            ].map(([label, value]) => (
              <Card key={label as string}><CardContent className="p-4">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold">{value}</div>
              </CardContent></Card>
            ))}
          </div>
          {isLoading && <div className="text-muted-foreground text-sm">Carregando ocorrências...</div>}
        </TabsContent>

        <TabsContent value="returned" className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => generateReturnedReport('pdf')}>Exportar PDF</Button>
            <Button variant="outline" onClick={() => generateReturnedReport('excel')}>Exportar Excel</Button>
            <Button variant="outline" onClick={() => generateReturnedReport('csv')}>Exportar CSV</Button>
          </div>
          <RowTable rows={returnedRows} emptyLabel="Nenhuma devolução no período." />
        </TabsContent>

        <TabsContent value="unserved" className="space-y-3">
          <div className="flex gap-2">
            <Button onClick={() => generateUnservedReport('pdf')}>Exportar PDF</Button>
            <Button variant="outline" onClick={() => generateUnservedReport('excel')}>Exportar Excel</Button>
            <Button variant="outline" onClick={() => generateUnservedReport('csv')}>Exportar CSV</Button>
          </div>
          <RowTable rows={unservedRows} emptyLabel="Nenhuma nota sem saída." />
        </TabsContent>

        <TabsContent value="shortage" className="space-y-3">
          <RowTable rows={shortageSurplusRows} emptyLabel="Nenhuma falta ou sobra registrada." />
        </TabsContent>

        <TabsContent value="history">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Tipo</TableHead><TableHead>Título</TableHead>
                <TableHead>Linhas</TableHead><TableHead>Status</TableHead><TableHead>Canal</TableHead>
                <TableHead>Destinatário</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {exportsRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{new Date(r.created_at).toLocaleString('pt-BR')}</TableCell>
                    <TableCell>{reportTypeLabels[r.report_type as ReportType] ?? r.report_type}</TableCell>
                    <TableCell>{r.title}</TableCell>
                    <TableCell>{r.row_count}</TableCell>
                    <TableCell><Badge variant={r.status === 'sent' ? 'default' : 'outline'}>{r.status}</Badge></TableCell>
                    <TableCell>{r.sent_channel ?? '—'}</TableCell>
                    <TableCell>{r.sent_to ?? '—'}</TableCell>
                    <TableCell>
                      {r.status !== 'sent' && (
                        <Button size="sm" variant="outline" onClick={() => setSendDialog({ id: r.id, title: r.title })}>
                          Marcar enviado
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!exportsRows.length && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Nenhum relatório gerado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="import" className="space-y-3">
          <Card><CardContent className="p-4 space-y-3">
            <Label>Importar planilha legada (Protocolo de Devolução ou Semana sem saída)</Label>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])} />
          </CardContent></Card>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead><TableHead>Arquivo</TableHead><TableHead>Modelo</TableHead>
                <TableHead>Linhas</TableHead><TableHead>Importadas</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b: Record<string, unknown>) => (
                  <TableRow key={b.id as string}>
                    <TableCell>{new Date(b.created_at as string).toLocaleString('pt-BR')}</TableCell>
                    <TableCell>{b.file_name as string}</TableCell>
                    <TableCell>{b.detected_model as string}</TableCell>
                    <TableCell>{String(b.row_count ?? 0)}</TableCell>
                    <TableCell>{String(b.imported_count ?? 0)}</TableCell>
                    <TableCell><Badge variant="outline">{b.status as string}</Badge></TableCell>
                  </TableRow>
                ))}
                {!batches.length && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem importações.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!sendDialog} onOpenChange={(o) => !o && setSendDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar envio</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Canal</Label>
              <Select value={sendChannel} onValueChange={setSendChannel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="portal">Portal</SelectItem>
                  <SelectItem value="printed">Impresso</SelectItem>
                  <SelectItem value="other">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Destinatário</Label><Input value={sendTo} onChange={(e) => setSendTo(e.target.value)} /></div>
            <div><Label>Observação</Label><Textarea value={sendNotes} onChange={(e) => setSendNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialog(null)}>Cancelar</Button>
            <Button onClick={handleMarkSent}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowTable({ rows, emptyLabel }: { rows: Array<Record<string, any>>; emptyLabel: string }) {
  const navigate = useNavigateRR();
  return (
    <Card><CardContent className="p-0">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Data</TableHead><TableHead>NF</TableHead><TableHead>Cliente</TableHead>
          <TableHead>Cidade</TableHead><TableHead>Fornecedor</TableHead><TableHead>Tipo</TableHead>
          <TableHead>Resolução</TableHead><TableHead>Motivo</TableHead><TableHead>Folha</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((o) => (
            <TableRow key={o.id as string}>
              <TableCell>{(o.occurrence_date as string) ?? '—'}</TableCell>
              <TableCell>{(o.invoice_number as string) ?? '—'}</TableCell>
              <TableCell>{(o.customer_name as string) ?? '—'}</TableCell>
              <TableCell>{(o.city as string) ?? '—'}</TableCell>
              <TableCell>{(o.supplier_name as string) ?? '—'}</TableCell>
              <TableCell>{(o.occurrence_type as string) ?? '—'}</TableCell>
              <TableCell>{resolutionTypeLabels[(o.resolution_type as string) ?? ''] ?? '—'}</TableCell>
              <TableCell className="max-w-[280px] truncate">{(o.occurrence_reason as string) ?? (o.resolution_notes as string) ?? '—'}</TableCell>
              <TableCell>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/occurrences/${o.id}/return-sheet`)}>
                  Folha
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {!rows.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">{emptyLabel}</TableCell></TableRow>}
        </TableBody>
      </Table>
    </CardContent></Card>
  );
}
