import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { localDayBoundary } from '@/lib/listFilters';
import { useListFilters } from '@/hooks/useListFilters';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { FileSearch, Download, AlertTriangle, ListChecks, RefreshCw, FileText } from 'lucide-react';
import { format } from 'date-fns';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface FieldCoverage {
  key: string;
  label: string;
  filled: number;
  total: number;
}

interface ReviewItem {
  invoiceNumber: string | null;
  recipientName: string | null;
  reasons: string[];
}

type IngestionReportRow = Omit<Tables<'ingestion_reports'>, 'field_coverage' | 'review_items'> & {
  field_coverage: FieldCoverage[];
  review_items: ReviewItem[];
};

type PdfWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function fieldCoverage(value: unknown): FieldCoverage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = objectValue(entry);
    if (!row) return [];
    return [{
      key: String(row.key ?? ''),
      label: String(row.label ?? row.key ?? ''),
      filled: Number(row.filled ?? 0),
      total: Number(row.total ?? 0),
    }];
  });
}

function reviewItems(value: unknown): ReviewItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = objectValue(entry);
    if (!row) return [];
    return [{
      invoiceNumber: row.invoiceNumber == null ? null : String(row.invoiceNumber),
      recipientName: row.recipientName == null ? null : String(row.recipientName),
      reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
    }];
  });
}

export default function IngestionReports() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const { filters: { from, to, batch }, setFilter, resetFilters, activeCount } = useListFilters({ from: '', to: '', batch: '' });
  const [selected, setSelected] = useState<IngestionReportRow | null>(null);

  const { data: reports = [], isLoading, refetch, isError } = useQuery({
    queryKey: ['ingestion_reports', currentTenant?.id, from, to, batch],
    enabled: !!currentTenant,
    queryFn: async () => {
      let q = supabase
        .from('ingestion_reports')
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (from) q = q.gte('created_at', localDayBoundary(from));
      if (to) {
        q = q.lt('created_at', localDayBoundary(to, true));
      }
      if (batch) q = q.ilike('batch_id', `%${batch}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((row) => ({
        ...row,
        field_coverage: fieldCoverage(row.field_coverage),
        review_items: reviewItems(row.review_items),
      }));
    },
  });

  const totals = useMemo(() => {
    return reports.reduce((acc, r) => ({
      docs: acc.docs + r.total_docs,
      saved: acc.saved + r.saved_docs,
      review: acc.review + r.needs_review_docs,
      created: acc.created + r.clients_auto_created,
    }), { docs: 0, saved: 0, review: 0, created: 0 });
  }, [reports]);

  return (
    <div className="animate-fade-in space-y-5 max-w-6xl">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-primary" /> Histórico de Importações
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">Relatórios de qualidade salvos por lote.</p>
      </div>

      <ListFilterBar fields={[
        { key: 'batch', label: 'Lote', type: 'search', value: batch, onChange: value => setFilter('batch', value), placeholder: 'Identificador do lote' },
        { key: 'from', label: 'Importado de', type: 'date', value: from, max: to || undefined, onChange: value => setFilter('from', value) },
        { key: 'to', label: 'Importado até', type: 'date', value: to, min: from || undefined, onChange: value => setFilter('to', value) },
      ]} onReset={resetFilters} activeCount={activeCount} resultCount={isError ? undefined : reports.length} loading={isLoading} description="Até 500 relatórios por consulta. Os indicadores acompanham os filtros." />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Lotes</div><div className="text-2xl font-bold">{reports.length}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Documentos</div><div className="text-2xl font-bold">{totals.docs}</div><div className="text-[11px] text-muted-foreground">{totals.saved} salvos</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">needsReview</div><div className="text-2xl font-bold text-warning">{totals.review}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Clientes criados</div><div className="text-2xl font-bold">{totals.created}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isError ? <div role="alert" className="p-6 text-sm">Não foi possível carregar os relatórios. <Button variant="link" onClick={() => refetch()}>Tentar novamente</Button></div> : isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
          ) : reports.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nenhum relatório encontrado.</div>
          ) : (
            <div className="divide-y">
              {reports.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/40 transition-colors flex flex-wrap items-center gap-3"
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="text-sm font-medium">
                      {format(new Date(r.created_at), 'dd/MM/yyyy HH:mm')}
                      <span className="ml-2 text-xs text-muted-foreground font-normal">{r.batch_id}</span>
                    </div>
                    {r.source_label && <div className="text-[11px] text-muted-foreground">{r.source_label}</div>}
                  </div>
                  <Badge variant="outline">{r.total_docs} docs</Badge>
                  <Badge variant="outline" className="text-success border-success/30">{r.saved_docs} ok</Badge>
                  {r.error_docs > 0 && <Badge variant="outline" className="text-destructive border-destructive/30">{r.error_docs} erro</Badge>}
                  {r.needs_review_docs > 0 && (
                    <Badge variant="outline" className="text-warning border-warning/30">
                      <AlertTriangle className="h-3 w-3 mr-1" />{r.needs_review_docs} revisar
                    </Badge>
                  )}
                  <Badge variant="outline">{r.clients_auto_created} clientes novos</Badge>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-4 w-4" /> Lote {selected?.batch_id}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {format(new Date(selected.created_at), 'dd/MM/yyyy HH:mm')}
                {selected.source_label && ` · ${selected.source_label}`}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat label="Total" value={selected.total_docs} />
                <Stat label="Salvos" value={selected.saved_docs} />
                <Stat label="Erros" value={selected.error_docs} tone="destructive" />
                <Stat label="Revisar" value={selected.needs_review_docs} tone="warning" />
                <Stat label="Cli. criados" value={selected.clients_auto_created} />
                <Stat label="Cli. vinculados" value={selected.clients_matched} />
                <Stat label="Cli. sem match" value={selected.clients_unresolved} />
              </div>

              {Array.isArray(selected.field_coverage) && selected.field_coverage.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Cobertura de campos</div>
                  <div className="space-y-2">
                    {selected.field_coverage.map((f) => {
                      const pct = f.total > 0 ? Math.round((f.filled / f.total) * 100) : 0;
                      return (
                        <div key={f.key} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>{f.label}</span>
                            <span className="text-muted-foreground">{f.filled}/{f.total} ({pct}%)</span>
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {Array.isArray(selected.review_items) && selected.review_items.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-2">Documentos para revisão</div>
                  <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                    {selected.review_items.map((ri, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <div className="font-medium">NF {ri.invoiceNumber}{ri.recipientName && ` · ${ri.recipientName}`}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(ri.reasons || []).map((r: string, j: number) => (
                            <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30">{r}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadReportCsv(selected)}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadReportPdf(selected)}>
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Exportar PDF (Auditoria)
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/ingestion?reprocess=${encodeURIComponent(selected.batch_id)}`)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reprocessar lote
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                O reprocessamento abre o fluxo de ingestão pré-configurado. Reenvie os mesmos arquivos:
                documentos já cadastrados (mesma chave NF-e ou número) são detectados e ignorados,
                evitando duplicação. Apenas registros novos são criados e um novo relatório é gerado
                com a origem "Reprocessamento de {selected.batch_id}".
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'destructive' | 'warning' }) {
  const cls = tone === 'destructive' ? 'text-destructive' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="rounded-md border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold ${cls}`}>{value}</div>
    </div>
  );
}

function downloadReportCsv(r: IngestionReportRow) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');
  const lines: string[] = [];
  lines.push('Seção;Métrica;Valor;Total;Percentual');
  lines.push(`Resumo;Documentos;${r.total_docs};${r.total_docs};100.0`);
  lines.push(`Resumo;Salvos;${r.saved_docs};${r.total_docs};${pct(r.saved_docs, r.total_docs)}`);
  lines.push(`Resumo;Erros;${r.error_docs};${r.total_docs};${pct(r.error_docs, r.total_docs)}`);
  lines.push(`Resumo;needsReview;${r.needs_review_docs};${r.total_docs};${pct(r.needs_review_docs, r.total_docs)}`);
  lines.push(`Clientes;Criados;${r.clients_auto_created};${r.total_docs};${pct(r.clients_auto_created, r.total_docs)}`);
  lines.push(`Clientes;Vinculados;${r.clients_matched};${r.total_docs};${pct(r.clients_matched, r.total_docs)}`);
  lines.push(`Clientes;Não resolvidos;${r.clients_unresolved};${r.total_docs};${pct(r.clients_unresolved, r.total_docs)}`);
  for (const f of (r.field_coverage || [])) {
    lines.push(`Cobertura;${esc(f.label)};${f.filled};${f.total};${pct(f.filled, f.total)}`);
  }
  if (Array.isArray(r.review_items) && r.review_items.length) {
    lines.push('');
    lines.push('Revisão;NF;Destinatário;Motivos');
    for (const ri of r.review_items) {
      lines.push(['Revisão', esc(ri.invoiceNumber), esc(ri.recipientName || ''), esc((ri.reasons || []).join(' | '))].join(';'));
    }
    const divg = aggregateDivergences(r.review_items);
    if (divg.length) {
      lines.push('');
      lines.push('Divergências;Motivo;Ocorrências;% sobre revisões');
      for (const d of divg) {
        lines.push(['Divergências', esc(d.reason), String(d.count), pct(d.count, r.review_items.length)].join(';'));
      }
    }
  }
  const csv = '\uFEFF' + lines.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ingestao-${r.batch_id}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function aggregateDivergences(items: ReviewItem[]): { reason: string; count: number }[] {
  const map = new Map<string, number>();
  for (const ri of items || []) {
    for (const r of (ri.reasons || [])) {
      map.set(r, (map.get(r) || 0) + 1);
    }
  }
  return Array.from(map.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function downloadReportPdf(r: IngestionReportRow) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : '0.0%');

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Qualidade e Auditoria — Ingestão', 40, 40);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(110);
  doc.text(`Lote: ${r.batch_id}`, 40, 58);
  doc.text(`Gerado em: ${format(new Date(r.created_at), 'dd/MM/yyyy HH:mm')}`, 40, 70);
  if (r.source_label) doc.text(`Origem: ${r.source_label}`, 40, 82);
  doc.setTextColor(0);

  let y = 100;

  autoTable(doc, {
    startY: y,
    head: [['Indicador', 'Valor', '% sobre total']],
    body: [
      ['Documentos no lote', String(r.total_docs), '100,0%'],
      ['Salvos com sucesso', String(r.saved_docs), pct(r.saved_docs, r.total_docs)],
      ['Com erro', String(r.error_docs), pct(r.error_docs, r.total_docs)],
      ['Necessitam revisão', String(r.needs_review_docs), pct(r.needs_review_docs, r.total_docs)],
      ['Clientes criados', String(r.clients_auto_created), pct(r.clients_auto_created, r.total_docs)],
      ['Clientes vinculados', String(r.clients_matched), pct(r.clients_matched, r.total_docs)],
      ['Clientes sem match', String(r.clients_unresolved), pct(r.clients_unresolved, r.total_docs)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 40, 40] },
    margin: { left: 40, right: 40 },
  });
  y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;

  if (Array.isArray(r.field_coverage) && r.field_coverage.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Cobertura de campos', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['Campo', 'Preenchidos', 'Total', 'Cobertura']],
      body: r.field_coverage.map((f) => [
        f.label, String(f.filled), String(f.total), pct(f.filled, f.total),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 40, 40] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;
  }

  const divg = aggregateDivergences(Array.isArray(r.review_items) ? r.review_items : []);
  if (divg.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Divergências detectadas', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['Motivo', 'Ocorrências', '% sobre revisões']],
      body: divg.map(d => [d.reason, String(d.count), pct(d.count, (r.review_items || []).length)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [180, 110, 0] },
      margin: { left: 40, right: 40 },
    });
    y = (doc as PdfWithAutoTable).lastAutoTable.finalY + 16;
  }

  if (Array.isArray(r.review_items) && r.review_items.length) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Documentos para revisão', 40, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      head: [['NF', 'Destinatário', 'Motivos']],
      body: r.review_items.map((ri) => [
        String(ri.invoiceNumber ?? ''),
        String(ri.recipientName ?? ''),
        (ri.reasons || []).join(' • '),
      ]),
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [40, 40, 40] },
      columnStyles: { 2: { cellWidth: 'auto' } },
      margin: { left: 40, right: 40 },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text(`Lote ${r.batch_id} · página ${i}/${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: 'right' });
  }

  doc.save(`auditoria-ingestao-${r.batch_id}.pdf`);
}
