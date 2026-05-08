import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Upload, ArrowRight, UserPlus, AlertTriangle, ListChecks, Download, FileSearch, ExternalLink, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';

export interface IngestionReport {
  totalDocs: number;
  savedDocs: number;
  errorDocs: number;
  needsReviewDocs: number;
  clientsAutoCreated: number;
  clientsMatched: number;
  clientsUnresolved: number;
  fieldCoverage: {
    label: string;
    key: string;
    filled: number;
    total: number;
  }[];
  reviewItems?: ReviewItem[];
  reviewThreshold?: number;
  auditMeta?: {
    tenantId?: string | null;
    tenantName?: string | null;
    batchId?: string | null;
    sourceLabel?: string | null;
    generatedAt?: string | null;
    periodFrom?: string | null;
    periodTo?: string | null;
    generatedByUserId?: string | null;
  };
}

export interface ReviewItem {
  invoiceNumber: string;
  fileName?: string;
  recipientName?: string;
  confidence?: number;
  reasons: string[]; // e.g. "Baixa confiança (62%)", "Campos UNKNOWN: IE, CEP", "OCR ilegível"
}

interface ResultsStepProps {
  results: string[];
  onReset: () => void;
  report?: IngestionReport | null;
}

export default function ResultsStep({ results, onReset, report }: ResultsStepProps) {
  const navigate = useNavigate();
  const successes = results.filter(r => r.startsWith('✅'));
  const errors = results.filter(r => r.startsWith('❌'));

  const clientCreationRate = report && report.totalDocs > 0
    ? Math.round((report.clientsAutoCreated / report.totalDocs) * 100)
    : 0;

  const handleExportCsv = () => {
    if (!report) return;
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');
    const lines: string[] = [];
    lines.push('Seção;Métrica;Valor;Total;Percentual');
    lines.push(`Resumo;Documentos totais;${report.totalDocs};${report.totalDocs};100.0`);
    lines.push(`Resumo;Documentos salvos;${report.savedDocs};${report.totalDocs};${pct(report.savedDocs, report.totalDocs)}`);
    lines.push(`Resumo;Documentos com erro;${report.errorDocs};${report.totalDocs};${pct(report.errorDocs, report.totalDocs)}`);
    lines.push(`Resumo;Documentos para revisão (needsReview);${report.needsReviewDocs};${report.totalDocs};${pct(report.needsReviewDocs, report.totalDocs)}`);
    lines.push(`Clientes;Criados automaticamente;${report.clientsAutoCreated};${report.totalDocs};${pct(report.clientsAutoCreated, report.totalDocs)}`);
    lines.push(`Clientes;Vinculados ao cadastro;${report.clientsMatched};${report.totalDocs};${pct(report.clientsMatched, report.totalDocs)}`);
    lines.push(`Clientes;Não resolvidos;${report.clientsUnresolved};${report.totalDocs};${pct(report.clientsUnresolved, report.totalDocs)}`);
    for (const f of report.fieldCoverage) {
      lines.push(`Cobertura;${esc(f.label)};${f.filled};${f.total};${pct(f.filled, f.total)}`);
    }
    if (report.reviewItems && report.reviewItems.length) {
      lines.push('');
      lines.push('Revisão;NF;Arquivo;Destinatário;Confiança;Motivos');
      for (const ri of report.reviewItems) {
        lines.push([
          'Revisão',
          esc(ri.invoiceNumber),
          esc(ri.fileName || ''),
          esc(ri.recipientName || ''),
          ri.confidence != null ? `${Math.round(ri.confidence * 100)}%` : '',
          esc(ri.reasons.join(' | ')),
        ].join(';'));
      }
    }
    lines.push('');
    lines.push('Detalhe;Resultado');
    for (const r of results) lines.push(`Detalhe;${esc(r)}`);

    const csv = '\uFEFF' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `relatorio-ingestao-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    if (!report) return;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const now = new Date();
    const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '0.0');

    // Build a tamper-evident signature: SHA-256 hash of canonical report payload.
    const canonical = JSON.stringify({
      totalDocs: report.totalDocs,
      savedDocs: report.savedDocs,
      errorDocs: report.errorDocs,
      needsReviewDocs: report.needsReviewDocs,
      clientsAutoCreated: report.clientsAutoCreated,
      clientsMatched: report.clientsMatched,
      clientsUnresolved: report.clientsUnresolved,
      reviewThreshold: report.reviewThreshold,
      fieldCoverage: report.fieldCoverage,
      reviewItems: report.reviewItems,
      auditMeta: report.auditMeta,
      generatedAt: now.toISOString(),
    });
    const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hashHex = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const shortHash = hashHex.slice(0, 16).toUpperCase();
    const verificationPayload = JSON.stringify({
      v: 1,
      sig: hashHex,
      ts: now.toISOString(),
      totals: {
        t: report.totalDocs,
        s: report.savedDocs,
        e: report.errorDocs,
        r: report.needsReviewDocs,
      },
    });
    const qrDataUrl = await QRCode.toDataURL(verificationPayload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });

    const meta = report.auditMeta || {};
    const fmtDate = (iso?: string | null) => {
      if (!iso) return '-';
      const d = new Date(iso);
      return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('pt-BR');
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Relatório de qualidade da ingestão', margin, 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.text(`Gerado em ${now.toLocaleString('pt-BR')}`, margin, 66);
    if (report.reviewThreshold != null) {
      doc.text(`Threshold de revisão: < ${Math.round(report.reviewThreshold * 100)}%`, pageWidth - margin, 66, { align: 'right' });
    }
    doc.setTextColor(0);

    // Audit metadata table (tenant, batch, period).
    autoTable(doc, {
      startY: 84,
      head: [['Auditoria', 'Detalhe']],
      body: [
        ['Empresa (tenant)', meta.tenantName || '-'],
        ['ID do tenant', meta.tenantId || '-'],
        ['Lote (batch_id)', meta.batchId || '-'],
        ['Origem do lote', meta.sourceLabel || '-'],
        ['Período de emissão dos documentos', `${fmtDate(meta.periodFrom)} → ${fmtDate(meta.periodTo)}`],
        ['Gerado em', meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('pt-BR') : now.toLocaleString('pt-BR')],
      ],
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 180, textColor: [80, 80, 80] } },
      margin: { left: margin, right: margin },
    });

    autoTable(doc, {
      head: [['Resumo', 'Valor', 'Total', '%']],
      body: [
        ['Documentos totais', String(report.totalDocs), String(report.totalDocs), '100.0%'],
        ['Documentos salvos', String(report.savedDocs), String(report.totalDocs), `${pct(report.savedDocs, report.totalDocs)}%`],
        ['Documentos com erro', String(report.errorDocs), String(report.totalDocs), `${pct(report.errorDocs, report.totalDocs)}%`],
        ['Marcados para revisão', String(report.needsReviewDocs), String(report.totalDocs), `${pct(report.needsReviewDocs, report.totalDocs)}%`],
        ['Clientes criados', String(report.clientsAutoCreated), String(report.totalDocs), `${pct(report.clientsAutoCreated, report.totalDocs)}%`],
        ['Clientes vinculados', String(report.clientsMatched), String(report.totalDocs), `${pct(report.clientsMatched, report.totalDocs)}%`],
        ['Clientes não resolvidos', String(report.clientsUnresolved), String(report.totalDocs), `${pct(report.clientsUnresolved, report.totalDocs)}%`],
      ],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      margin: { left: margin, right: margin },
    });

    autoTable(doc, {
      head: [['Cobertura de campos', 'Preenchidos', 'Total', '%']],
      body: report.fieldCoverage.map(f => [
        f.label,
        String(f.filled),
        String(f.total),
        `${pct(f.filled, f.total)}%`,
      ]),
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [16, 122, 87], textColor: 255 },
      margin: { left: margin, right: margin },
    });

    if (report.reviewItems && report.reviewItems.length > 0) {
      autoTable(doc, {
        head: [['NF', 'Destinatário', 'Confiança', 'Motivos']],
        body: report.reviewItems.map(ri => [
          ri.invoiceNumber || '',
          ri.recipientName || '',
          ri.confidence != null ? `${Math.round(ri.confidence * 100)}%` : '-',
          ri.reasons.join(' • '),
        ]),
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
        headStyles: { fillColor: [202, 138, 4], textColor: 255 },
        columnStyles: {
          0: { cellWidth: 60 },
          2: { cellWidth: 55, halign: 'right' },
          3: { cellWidth: 220 },
        },
        margin: { left: margin, right: margin },
      });
    }

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(
        `Página ${i} de ${pageCount}`,
        pageWidth - margin,
        doc.internal.pageSize.getHeight() - 20,
        { align: 'right' }
      );
      doc.text(
        `Assinatura SHA-256: ${shortHash}…  •  Verifique escaneando o QR na última página`,
        margin,
        doc.internal.pageSize.getHeight() - 20
      );
    }

    // Verification block on a dedicated last page.
    doc.addPage();
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Verificação de autenticidade', margin, 60);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80);
    const intro = doc.splitTextToSize(
      'Este relatório possui uma assinatura digital (SHA-256) gerada a partir do conteúdo original. ' +
      'Para conferir a autenticidade, escaneie o QR code abaixo: ele contém o hash, data/hora e totais. ' +
      'Qualquer alteração no PDF invalida a assinatura.',
      pageWidth - margin * 2
    );
    doc.text(intro, margin, 84);

    const qrSize = 180;
    doc.addImage(qrDataUrl, 'PNG', margin, 140, qrSize, qrSize);

    doc.setFontSize(9);
    doc.setTextColor(40);
    const rightX = margin + qrSize + 24;
    let y = 150;
    const line = (label: string, value: string) => {
      doc.setFont('helvetica', 'bold');
      doc.text(label, rightX, y);
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(value, pageWidth - rightX - margin);
      doc.text(wrapped, rightX, y + 12);
      y += 12 + wrapped.length * 11 + 6;
    };
    line('Hash SHA-256', hashHex);
    line('Gerado em', now.toLocaleString('pt-BR'));
    line('Totais assinados', `${report.totalDocs} docs · ${report.savedDocs} salvos · ${report.errorDocs} erros · ${report.needsReviewDocs} revisão`);
    line('Como conferir', 'Recompute SHA-256 do JSON canônico do relatório (mesmos campos e ordem) e compare com o hash acima ou escaneado pelo QR.');

    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      `Página ${pageCount + 1} de ${pageCount + 1}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 20,
      { align: 'right' }
    );

    const ts = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    doc.save(`relatorio-ingestao-${ts}.pdf`);
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-3">
        <Card className="flex-1">
          <CardContent className="pt-4 pb-3 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-success" />
            <div>
              <div className="text-2xl font-bold text-success">{successes.length}</div>
              <div className="text-xs text-muted-foreground">Sucesso</div>
            </div>
          </CardContent>
        </Card>
        {errors.length > 0 && (
          <Card className="flex-1 border-destructive/30">
            <CardContent className="pt-4 pb-3 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <div>
                <div className="text-2xl font-bold text-destructive">{errors.length}</div>
                <div className="text-xs text-muted-foreground">Erros</div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Quality report */}
      {report && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Relatório de qualidade da ingestão</h3>
              <Button size="sm" variant="outline" className="ml-auto h-7" onClick={handleExportCsv}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Exportar CSV
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={handleExportPdf}>
                <FileDown className="h-3.5 w-3.5 mr-1.5" /> Exportar PDF
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UserPlus className="h-3.5 w-3.5" /> Clientes criados
                </div>
                <div className="mt-1 text-lg font-bold">{report.clientsAutoCreated}</div>
                <div className="text-[11px] text-muted-foreground">{clientCreationRate}% dos documentos</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Clientes vinculados</div>
                <div className="mt-1 text-lg font-bold">{report.clientsMatched}</div>
                <div className="text-[11px] text-muted-foreground">match com cadastro</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">Sem cliente</div>
                <div className="mt-1 text-lg font-bold">{report.clientsUnresolved}</div>
                <div className="text-[11px] text-muted-foreground">não resolvidos</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Revisar
                </div>
                <div className="mt-1 text-lg font-bold">{report.needsReviewDocs}</div>
                <div className="text-[11px] text-muted-foreground">
                  needsReview {report.reviewThreshold != null ? `(< ${Math.round(report.reviewThreshold * 100)}%)` : ''}
                </div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                Cobertura de campos mapeados ({report.totalDocs} doc.)
              </div>
              <div className="space-y-2">
                {report.fieldCoverage.map(f => {
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

            {report.reviewItems && report.reviewItems.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                  <FileSearch className="h-3.5 w-3.5 text-warning" />
                  Documentos para revisão ({report.reviewItems.length})
                </div>
                <div className="border rounded-md divide-y max-h-72 overflow-y-auto">
                  {report.reviewItems.map((ri, i) => (
                    <button
                      key={`${ri.invoiceNumber}-${i}`}
                      type="button"
                      onClick={() => navigate(`/fiscal-documents?q=${encodeURIComponent(ri.invoiceNumber)}`)}
                      className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          NF {ri.invoiceNumber}
                          {ri.recipientName && <span className="text-muted-foreground font-normal"> · {ri.recipientName}</span>}
                        </div>
                        {ri.fileName && (
                          <div className="text-[11px] text-muted-foreground truncate">{ri.fileName}</div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {ri.reasons.map((r, j) => (
                            <span
                              key={j}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/30"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                      {ri.confidence != null && (
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {Math.round(ri.confidence * 100)}%
                        </span>
                      )}
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Detail list */}
      <Card>
        <CardContent className="py-3">
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={`text-sm py-1 px-2 rounded ${r.startsWith('✅') ? 'text-success' : 'text-destructive bg-destructive/5'}`}>
                {r}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-center">
        <Button variant="outline" onClick={onReset}>
          <Upload className="h-4 w-4 mr-2" /> Nova Importação
        </Button>
        <Button onClick={() => navigate('/loads')}>
          Ver Cargas <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
