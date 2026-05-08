import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { FileSearch, Download, AlertTriangle, ListChecks, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface IngestionReportRow {
  id: string;
  tenant_id: string;
  batch_id: string;
  source_label: string | null;
  total_docs: number;
  saved_docs: number;
  error_docs: number;
  needs_review_docs: number;
  clients_auto_created: number;
  clients_matched: number;
  clients_unresolved: number;
  field_coverage: any;
  review_items: any;
  report: any;
  created_at: string;
  created_by: string | null;
}

export default function IngestionReports() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [batch, setBatch] = useState('');
  const [selected, setSelected] = useState<IngestionReportRow | null>(null);

  const { data: reports = [], isLoading, refetch } = useQuery({
    queryKey: ['ingestion_reports', currentTenant?.id, from, to, batch],
    enabled: !!currentTenant,
    queryFn: async () => {
      let q = supabase
        .from('ingestion_reports' as any)
        .select('*')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (from) q = q.gte('created_at', new Date(from).toISOString());
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        q = q.lte('created_at', end.toISOString());
      }
      if (batch) q = q.ilike('batch_id', `%${batch}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as IngestionReportRow[];
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

      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-40" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs text-muted-foreground">Lote</label>
            <Input placeholder="Filtrar por batch_id" value={batch} onChange={e => setBatch(e.target.value)} className="h-8" />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Aplicar</Button>
          <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); setBatch(''); }}>Limpar</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Lotes</div><div className="text-2xl font-bold">{reports.length}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Documentos</div><div className="text-2xl font-bold">{totals.docs}</div><div className="text-[11px] text-muted-foreground">{totals.saved} salvos</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">needsReview</div><div className="text-2xl font-bold text-warning">{totals.review}</div></CardContent></Card>
        <Card><CardContent className="py-3"><div className="text-xs text-muted-foreground">Clientes criados</div><div className="text-2xl font-bold">{totals.created}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
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
                    {selected.field_coverage.map((f: any) => {
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
                    {selected.review_items.map((ri: any, i: number) => (
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