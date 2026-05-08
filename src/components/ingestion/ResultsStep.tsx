import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Upload, ArrowRight, UserPlus, AlertTriangle, ListChecks, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';

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
                <div className="text-[11px] text-muted-foreground">marcados needsReview</div>
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
