import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, AlertTriangle, XCircle, CheckCircle, ChevronRight, Package, Hash, Calendar, Building2, FileText } from 'lucide-react';
import { ValidatedDocument, ValidatedOrder } from '@/lib/ingestionValidator';

interface IngestionPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docs: ValidatedDocument[];
  orders?: ValidatedOrder[];
  onConfirm: () => void;
  confirming?: boolean;
  confirmLabel?: string;
  title?: string;
  description?: string;
}

/**
 * Read-only preview of every document and item that will be persisted.
 * Acts as a safety gate between validation and DB writes — the user can
 * inspect extracted XML fields, validation issues, and per-item totals
 * before confirming. Documents with errors or duplicates are listed
 * but flagged as "não será persistido".
 */
export default function IngestionPreviewDialog({
  open, onOpenChange, docs, orders = [], onConfirm, confirming, confirmLabel, title, description,
}: IngestionPreviewDialogProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'persist' | 'skipped' | 'issues'>('all');

  const persistable = useMemo(() => docs.filter(d => !d.hasErrors && !d.isDuplicate), [docs]);
  const skipped = useMemo(() => docs.filter(d => d.hasErrors || d.isDuplicate), [docs]);
  const withIssues = useMemo(() => docs.filter(d => d.hasErrors || d.hasWarnings || d.isDuplicate), [docs]);

  const totals = useMemo(() => ({
    docs: persistable.length,
    items: persistable.reduce((s, d) => s + (d.source.items?.length || 0), 0),
    weight: persistable.reduce((s, d) => s + (d.source.totalWeight || 0), 0),
    value: persistable.reduce((s, d) => s + (d.source.totalValue || 0), 0),
    pallets: persistable.reduce((s, d) => s + (d.source.estimatedPallets || 0), 0),
    orders: orders.filter(o => !o.hasErrors).length,
  }), [persistable, orders]);

  const visibleDocs = useMemo(() => {
    if (filter === 'persist') return persistable;
    if (filter === 'skipped') return skipped;
    if (filter === 'issues') return withIssues;
    return docs;
  }, [filter, docs, persistable, skipped, withIssues]);

  const toggle = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const fmtMoney = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" /> {title || 'Pré-visualização antes de persistir'}
          </DialogTitle>
          <DialogDescription>
            {description || 'Revise os campos extraídos do XML, eventuais erros e os itens de cada nota. Nada será gravado no banco até você confirmar.'}
          </DialogDescription>
        </DialogHeader>

        {/* KPIs do que será persistido */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 px-1">
          <KPI label="A persistir" value={String(totals.docs)} tone="success" icon={<CheckCircle className="h-3.5 w-3.5" />} />
          <KPI label="Itens" value={String(totals.items)} icon={<Package className="h-3.5 w-3.5" />} />
          <KPI label="Peso (kg)" value={fmtNum(totals.weight)} />
          <KPI label="Valor" value={fmtMoney(totals.value)} />
          <KPI label="Paletes est." value={String(totals.pallets)} />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 px-1">
          {([
            { mode: 'all' as const, label: `Todos (${docs.length})` },
            { mode: 'persist' as const, label: `A persistir (${persistable.length})`, tone: 'success' as const },
            { mode: 'issues' as const, label: `Com avisos/erros (${withIssues.length})`, tone: 'warning' as const },
            { mode: 'skipped' as const, label: `Não serão gravados (${skipped.length})`, tone: 'destructive' as const },
          ]).map(f => (
            <button
              key={f.mode}
              onClick={() => setFilter(f.mode)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filter === f.mode
                  ? 'border-primary bg-primary/10 text-primary'
                  : f.tone === 'success' ? 'border-success/30 text-success bg-success/5'
                  : f.tone === 'warning' ? 'border-warning/30 text-warning bg-warning/5'
                  : f.tone === 'destructive' ? 'border-destructive/30 text-destructive bg-destructive/5'
                  : 'border-border text-muted-foreground bg-card'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Lista de documentos */}
        <ScrollArea className="flex-1 -mx-1 px-1 max-h-[50vh]">
          <div className="space-y-2">
            {visibleDocs.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8 border rounded-md">
                Nenhum documento neste filtro.
              </div>
            )}
            {visibleDocs.map((d) => {
              const idx = docs.indexOf(d);
              const skip = d.hasErrors || d.isDuplicate;
              const isOpen = expanded.has(idx);
              return (
                <div
                  key={`${d.fileName}-${idx}`}
                  className={`border rounded-md ${skip ? 'border-destructive/30 bg-destructive/5' : d.hasWarnings ? 'border-warning/30 bg-warning/5' : 'border-border'}`}
                >
                  <button
                    onClick={() => toggle(idx)}
                    className="w-full text-left px-3 py-2 flex items-center gap-3"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        <span className="font-medium">NF {d.source.invoiceNumber || '—'}</span>
                        <span className="text-muted-foreground text-xs truncate">{d.fileName}</span>
                        {d.isDuplicate && <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">Duplicada</Badge>}
                        {d.hasErrors && !d.isDuplicate && <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive"><XCircle className="h-2.5 w-2.5 mr-1" />Erro</Badge>}
                        {d.hasWarnings && !d.hasErrors && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning"><AlertTriangle className="h-2.5 w-2.5 mr-1" />Aviso</Badge>}
                        {!d.hasErrors && !d.hasWarnings && !d.isDuplicate && <Badge variant="outline" className="text-[10px] border-success/40 text-success"><CheckCircle className="h-2.5 w-2.5 mr-1" />OK</Badge>}
                        {skip && <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground ml-auto">Não será persistida</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
                        <span><Building2 className="h-3 w-3 inline mr-0.5" />{d.source.recipientName || '—'}</span>
                        {d.source.recipientCnpj && <span>CNPJ {d.source.recipientCnpj}</span>}
                        {d.source.issueDate && <span><Calendar className="h-3 w-3 inline mr-0.5" />{d.source.issueDate}</span>}
                        <span>{(d.source.items?.length || 0)} itens · {fmtNum(d.source.totalWeight || 0)} kg · {fmtMoney(d.source.totalValue || 0)}</span>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t px-3 py-2.5 space-y-3 bg-background/40">
                      {/* Campos extraídos */}
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                          <FileText className="h-3 w-3" /> Campos extraídos do XML
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[11px]">
                          <Field label="Chave NF-e" value={d.source.accessKey} mono />
                          <Field label="Série" value={(d.source as any).series} />
                          <Field label="Emissão" value={d.source.issueDate} />
                          <Field label="Emitente" value={d.source.emitterName} />
                          <Field label="CNPJ Emitente" value={(d.source as any).emitterCnpj} />
                          <Field label="Destinatário" value={d.source.recipientName} />
                          <Field label="CNPJ Destinatário" value={d.source.recipientCnpj} />
                          <Field label="Cliente vinculado" value={d.matchedClientName || '— (sem match)'} tone={d.matchedClientName ? 'success' : 'warning'} />
                          <Field label="Carga do cliente" value={d.source.clientLoadNumber || '—'} />
                          <Field label="Valor total" value={fmtMoney(d.source.totalValue || 0)} />
                          <Field label="Peso bruto" value={`${fmtNum(d.source.totalWeight || 0)} kg`} />
                          <Field label="Paletes est." value={String(d.source.estimatedPallets || 0)} />
                        </div>
                      </div>

                      {/* Validações */}
                      {d.validations.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Validações</div>
                          <ul className="space-y-0.5">
                            {d.validations.map((v, vi) => (
                              <li
                                key={vi}
                                className={`text-[11px] flex items-start gap-1.5 ${
                                  v.severity === 'error' ? 'text-destructive' : v.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                                }`}
                              >
                                {v.severity === 'error' ? <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                  : v.severity === 'warning' ? <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                  : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />}
                                <span><strong className="font-medium">{v.field}:</strong> {v.message}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Itens */}
                      {d.source.items && d.source.items.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                            <Package className="h-3 w-3" /> Itens ({d.source.items.length})
                          </div>
                          <div className="border rounded overflow-hidden">
                            <table className="w-full text-[11px]">
                              <thead className="bg-muted/50">
                                <tr className="text-left">
                                  <th className="px-2 py-1 font-medium">#</th>
                                  <th className="px-2 py-1 font-medium">Descrição</th>
                                  <th className="px-2 py-1 font-medium text-right">Qtd</th>
                                  <th className="px-2 py-1 font-medium text-right">Un.</th>
                                  <th className="px-2 py-1 font-medium text-right">Valor unit.</th>
                                  <th className="px-2 py-1 font-medium text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.source.items.slice(0, 50).map((it: any, ii: number) => (
                                  <tr key={ii} className="border-t">
                                    <td className="px-2 py-1 text-muted-foreground">{ii + 1}</td>
                                    <td className="px-2 py-1">{it.description || it.productCode || '—'}</td>
                                    <td className="px-2 py-1 text-right">{fmtNum(it.quantity || 0)}</td>
                                    <td className="px-2 py-1 text-right">{it.unit || '—'}</td>
                                    <td className="px-2 py-1 text-right">{it.unitPrice != null ? fmtMoney(it.unitPrice) : '—'}</td>
                                    <td className="px-2 py-1 text-right">{it.totalPrice != null ? fmtMoney(it.totalPrice) : '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {d.source.items.length > 50 && (
                              <div className="px-2 py-1 text-[10px] text-muted-foreground bg-muted/30 text-center">
                                + {d.source.items.length - 50} itens não exibidos
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Rodapé com confirmação */}
        <div className="border-t pt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            {totals.docs > 0 ? (
              <>
                Serão persistidas <strong className="text-foreground">{totals.docs} nota(s)</strong> com{' '}
                <strong className="text-foreground">{totals.items} item(ns)</strong>. {skipped.length > 0 && (
                  <span className="text-destructive">{skipped.length} ignorada(s) por erro/duplicidade.</span>
                )}
              </>
            ) : (
              <span className="text-destructive">Nenhuma nota válida para persistir.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={confirming}>
              Voltar para corrigir
            </Button>
            <Button size="sm" onClick={onConfirm} disabled={totals.docs === 0 || confirming}>
              {confirming ? 'Persistindo...' : (confirmLabel || 'Confirmar e persistir')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KPI({ label, value, tone, icon }: { label: string; value: string; tone?: 'success'; icon?: React.ReactNode }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone === 'success' ? 'border-success/30 bg-success/5' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-base font-bold ${tone === 'success' ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}

function Field({ label, value, mono, tone }: { label: string; value?: string | null; mono?: boolean; tone?: 'success' | 'warning' }) {
  const v = value && String(value).trim() ? String(value) : '—';
  const empty = v === '—';
  return (
    <div className="flex gap-1 min-w-0">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className={`truncate ${mono ? 'font-mono text-[10px]' : ''} ${tone === 'success' ? 'text-success font-medium' : tone === 'warning' ? 'text-warning' : empty ? 'text-muted-foreground italic' : ''}`} title={v}>
        {v}
      </span>
    </div>
  );
}
