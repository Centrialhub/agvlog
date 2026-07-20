import { useState, useCallback, useMemo } from 'react';
import { ValidatedDocument, ValidatedOrder } from '@/lib/ingestionValidator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileText, CheckCircle, AlertTriangle, XCircle, ArrowRight, ArrowLeft, Package, Info, Trash2, Pencil,
  Weight, DollarSign, Boxes, LayoutGrid, Link2, Settings2, Eye,
} from 'lucide-react';
import { Client } from '@/hooks/useClients';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import IngestionPreviewDialog from './IngestionPreviewDialog';

interface LoadOption {
  id: string;
  load_number: string;
  destination: string | null;
  status: string;
}

interface ValidationStepProps {
  docs: ValidatedDocument[];
  orders: ValidatedOrder[];
  clients: Client[];
  loads?: LoadOption[];
  onBack: () => void;
  onNext: () => void;
  onSaveDocsOnly?: (loadId?: string | null) => void;
  savingDocs?: boolean;
  onUpdateDoc: (index: number, updates: Partial<ValidatedDocument>) => void;
  onUpdateOrder: (index: number, updates: Partial<ValidatedOrder>) => void;
  onRemoveDoc: (index: number) => void;
  onRemoveOrder: (index: number) => void;
}

type FilterMode = 'all' | 'errors' | 'warnings' | 'valid';

export default function ValidationStep({
  docs, orders, clients, loads = [], onBack, onNext, onSaveDocsOnly, savingDocs,
  onUpdateDoc, onUpdateOrder, onRemoveDoc, onRemoveOrder,
}: ValidationStepProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [editingDocIdx, setEditingDocIdx] = useState<number | null>(null);
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);
  const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Missing client-load alert (configurable threshold) ──
  const MISSING_THRESHOLD_KEY = 'ingestion.missingLoadThresholdPct';
  const [missingThreshold, setMissingThreshold] = useState<number>(() => {
    if (typeof window === 'undefined') return 20;
    const raw = window.localStorage.getItem(MISSING_THRESHOLD_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 20;
  });
  const updateThreshold = (v: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(v)));
    setMissingThreshold(clamped);
    try { window.localStorage.setItem(MISSING_THRESHOLD_KEY, String(clamped)); } catch {}
  };

  const missingStats = useMemo(() => {
    const considered = docs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable));
    const total = considered.length;
    const missing = considered.filter(d => !d.source.clientLoadNumber);
    const missingCount = missing.length;
    const ratePct = total > 0 ? (missingCount / total) * 100 : 0;

    const byDate = new Map<string, { total: number; missing: number }>();
    const byCarrier = new Map<string, { total: number; missing: number }>();
    for (const d of considered) {
      const dateKey = (d.source.issueDate || '—').slice(0, 10);
      const carrierKey = (d.source.emitterName || '—').trim() || '—';
      const dateBucket = byDate.get(dateKey) || { total: 0, missing: 0 };
      dateBucket.total += 1;
      if (!d.source.clientLoadNumber) dateBucket.missing += 1;
      byDate.set(dateKey, dateBucket);
      const carrierBucket = byCarrier.get(carrierKey) || { total: 0, missing: 0 };
      carrierBucket.total += 1;
      if (!d.source.clientLoadNumber) carrierBucket.missing += 1;
      byCarrier.set(carrierKey, carrierBucket);
    }
    const toRanked = (m: Map<string, { total: number; missing: number }>) =>
      Array.from(m.entries())
        .filter(([, v]) => v.missing > 0)
        .map(([key, v]) => ({ key, ...v, pct: v.total ? (v.missing / v.total) * 100 : 0 }))
        .sort((a, b) => b.missing - a.missing || b.pct - a.pct)
        .slice(0, 5);
    return {
      total,
      missingCount,
      ratePct,
      byDate: toRanked(byDate),
      byCarrier: toRanked(byCarrier),
    };
  }, [docs]);

  const missingExceeds = missingStats.total > 0 && missingStats.ratePct >= missingThreshold;

  const validDocs = docs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable));

  const totalErrors = docs.filter(d => d.hasErrors).length + orders.filter(o => o.hasErrors).length;
  const totalWarnings = docs.filter(d => d.hasWarnings && !d.hasErrors).length + orders.filter(o => o.hasWarnings && !o.hasErrors).length;
  const totalValid = docs.filter(d => !d.hasErrors && (!d.isDuplicate || d.isOrphanReusable)).length + orders.filter(o => !o.hasErrors).length;
  const totalReusable = docs.filter(d => d.isDuplicate && d.isOrphanReusable).length;
  const totalBlocked = docs.filter(d => d.isDuplicate && !d.isOrphanReusable).length;

  const summaryStats = useMemo(() => {
    const weight = validDocs.reduce((s, d) => s + (d.source.totalWeight || 0), 0);
    const value = validDocs.reduce((s, d) => s + (d.source.totalValue || 0), 0);
    const pallets = validDocs.reduce((s, d) => s + (d.source.estimatedPallets || 0), 0);
    const volumes = validDocs.reduce((s, d) => s + (d.source.items?.length || 0), 0);
    return { weight, value, pallets, volumes };
  }, [validDocs]);

  const filterDocs = (list: ValidatedDocument[]) => {
    if (filter === 'errors') return list.filter(d => d.hasErrors);
    if (filter === 'warnings') return list.filter(d => d.hasWarnings && !d.hasErrors);
    if (filter === 'valid') return list.filter(d => !d.hasErrors && !d.hasWarnings);
    return list;
  };

  const filterOrders = (list: ValidatedOrder[]) => {
    if (filter === 'errors') return list.filter(o => o.hasErrors);
    if (filter === 'warnings') return list.filter(o => o.hasWarnings && !o.hasErrors);
    if (filter === 'valid') return list.filter(o => !o.hasErrors && !o.hasWarnings);
    return list;
  };

  const handleClientMatch = (docIndex: number, clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    onUpdateDoc(docIndex, {
      matchedClientId: clientId,
      matchedClientName: client?.company_name || null,
    });
  };

  const handleOrderClientMatch = (orderIndex: number, clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    onUpdateOrder(orderIndex, {
      matchedClientId: clientId,
      matchedClientName: client?.company_name || null,
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex gap-2 flex-wrap">
        {[
          { mode: 'all' as FilterMode, label: `Todos (${docs.length + orders.length})`, color: '' },
          { mode: 'valid' as FilterMode, label: `Válidos (${totalValid})`, color: 'text-success' },
          { mode: 'warnings' as FilterMode, label: `Avisos (${totalWarnings})`, color: 'text-warning' },
          { mode: 'errors' as FilterMode, label: `Erros (${totalErrors})`, color: 'text-destructive' },
        ].map(f => (
          <button
            key={f.mode}
            onClick={() => setFilter(f.mode)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              filter === f.mode ? 'border-primary bg-primary/10 text-primary' : `border-border bg-card ${f.color || 'text-muted-foreground'}`
            }`}
          >
            {f.label}
          </button>
        ))}
        {totalReusable > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-success/30 bg-success/5 text-success">
            {totalReusable} reaproveitáveis
          </span>
        )}
        {totalBlocked > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-destructive/30 bg-destructive/5 text-destructive">
            {totalBlocked} duplicadas (bloqueadas)
          </span>
        )}
      </div>

      {/* Missing client-load alert */}
      {missingStats.total > 0 && (
        <Card
          className={
            missingExceeds
              ? 'border-destructive/40 bg-destructive/5'
              : missingStats.missingCount > 0
                ? 'border-warning/30 bg-warning/5'
                : 'border-success/30 bg-success/5'
          }
        >
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-start gap-3 flex-wrap">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  missingExceeds ? 'bg-destructive/15' : missingStats.missingCount > 0 ? 'bg-warning/15' : 'bg-success/15'
                }`}
              >
                <AlertTriangle
                  className={`h-4 w-4 ${
                    missingExceeds ? 'text-destructive' : missingStats.missingCount > 0 ? 'text-warning' : 'text-success'
                  }`}
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-semibold text-foreground">
                  {missingExceeds
                    ? 'Taxa de NFs sem número de carga acima do limite'
                    : missingStats.missingCount > 0
                      ? 'Algumas NFs estão sem número de carga'
                      : 'Todas as NFs deste lote possuem número de carga'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {missingStats.missingCount} de {missingStats.total} NFs sem carga ({missingStats.ratePct.toFixed(1)}%) · limite atual {missingThreshold}%
                </div>
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <Settings2 className="h-3.5 w-3.5 mr-1" /> Limite
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64" align="end">
                  <div className="space-y-2">
                    <Label htmlFor="missing-threshold" className="text-xs">
                      Alerta quando % sem carga ≥
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="missing-threshold"
                        type="number"
                        min={0}
                        max={100}
                        value={missingThreshold}
                        onChange={e => updateThreshold(Number(e.target.value))}
                        className="h-8 text-xs"
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Configuração salva localmente neste navegador.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {missingStats.missingCount > 0 && (missingStats.byDate.length > 0 || missingStats.byCarrier.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {missingStats.byDate.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Dias mais afetados
                    </div>
                    <div className="space-y-1">
                      {missingStats.byDate.map(b => (
                        <div key={`d-${b.key}`} className="flex items-center justify-between text-xs">
                          <span className="font-mono">{b.key}</span>
                          <span className="text-muted-foreground">
                            {b.missing}/{b.total}{' '}
                            <Badge
                              variant="outline"
                              className={`ml-1 text-[10px] ${
                                b.pct >= missingThreshold
                                  ? 'bg-destructive/10 text-destructive border-destructive/30'
                                  : 'bg-warning/10 text-warning border-warning/30'
                              }`}
                            >
                              {b.pct.toFixed(0)}%
                            </Badge>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {missingStats.byCarrier.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                      Emissores/Transportadoras mais afetados
                    </div>
                    <div className="space-y-1">
                      {missingStats.byCarrier.map(b => (
                        <div key={`c-${b.key}`} className="flex items-center justify-between text-xs gap-2">
                          <span className="truncate" title={b.key}>{b.key}</span>
                          <span className="text-muted-foreground shrink-0">
                            {b.missing}/{b.total}{' '}
                            <Badge
                              variant="outline"
                              className={`ml-1 text-[10px] ${
                                b.pct >= missingThreshold
                                  ? 'bg-destructive/10 text-destructive border-destructive/30'
                                  : 'bg-warning/10 text-warning border-warning/30'
                              }`}
                            >
                              {b.pct.toFixed(0)}%
                            </Badge>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Summary KPI cards */}
      {validDocs.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Weight className="h-4 w-4 text-primary" />
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">
                  {summaryStats.weight.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg
                </div>
                <div className="text-[10px] text-muted-foreground">Peso Total</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <DollarSign className="h-4 w-4 text-success" />
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">
                  R$ {summaryStats.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-[10px] text-muted-foreground">Valor Total</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-info/10">
                <Boxes className="h-4 w-4 text-info" />
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">{summaryStats.volumes}</div>
                <div className="text-[10px] text-muted-foreground">Volumes (itens)</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <LayoutGrid className="h-4 w-4 text-warning" />
              </div>
              <div>
                <div className="text-lg font-bold text-foreground">{summaryStats.pallets}</div>
                <div className="text-[10px] text-muted-foreground">Paletes Estimados</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="docs" className="space-y-3">
        <TabsList>
          <TabsTrigger value="docs" className="text-xs">
            <FileText className="h-3 w-3 mr-1" /> Notas Fiscais ({docs.length})
          </TabsTrigger>
          <TabsTrigger value="orders" className="text-xs">
            <Package className="h-3 w-3 mr-1" /> Pedidos ({orders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="docs" className="space-y-2">
          {filterDocs(docs).length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Nenhum documento neste filtro</CardContent></Card>
          ) : filterDocs(docs).map((doc, rawIdx) => {
            const i = docs.indexOf(doc);
            const isEditing = editingDocIdx === i;
            return (
              <Card key={i} className={doc.hasErrors ? 'border-destructive/30' : doc.isDuplicate && !doc.isOrphanReusable ? 'border-destructive/20 opacity-60' : doc.isOrphanReusable ? 'border-success/30' : doc.hasWarnings ? 'border-warning/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">NF {doc.source.invoiceNumber || '—'}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{doc.fileName}</span>
                        {doc.isOrphanReusable && <Badge variant="outline" className="bg-success/10 text-success text-[10px]">Reaproveitável</Badge>}
                        {doc.isDuplicate && !doc.isOrphanReusable && <Badge variant="outline" className="bg-destructive/10 text-destructive text-[10px]">Duplicada</Badge>}
                        {doc.hasErrors && !doc.isDuplicate && <Badge variant="outline" className="bg-destructive/10 text-destructive text-[10px]">Erro</Badge>}
                        {doc.hasWarnings && !doc.hasErrors && <Badge variant="outline" className="bg-warning/10 text-warning text-[10px]">Aviso</Badge>}
                        {!doc.hasErrors && !doc.hasWarnings && <Badge variant="outline" className="bg-success/10 text-success text-[10px]">OK</Badge>}
                      </div>

                      <div className="grid grid-cols-5 gap-x-4 gap-y-1 text-xs">
                        <div>
                          <span className="text-muted-foreground">Destinatário: </span>
                          {doc.matchedClientName ? (
                            <span className="text-success font-medium">{doc.matchedClientName}</span>
                          ) : (
                            <span className="text-warning">{doc.source.recipientName || '—'}</span>
                          )}
                        </div>
                        <div><span className="text-muted-foreground">Destino: </span>{doc.source.recipientCity || '—'}, {doc.source.recipientState || ''}</div>
                        <div><span className="text-muted-foreground">Peso: </span>{doc.source.totalWeight ? `${doc.source.totalWeight.toLocaleString('pt-BR')} kg` : '—'}</div>
                        <div><span className="text-muted-foreground">Valor: </span>{doc.source.totalValue ? `R$ ${doc.source.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</div>
                        <div><span className="text-muted-foreground">Paletes: </span>{doc.source.estimatedPallets} <span className="text-muted-foreground">| Itens: </span>{doc.source.items?.length || 0}</div>
                      </div>

                      {/* Client matching for unmatched */}
                      {!doc.matchedClientId && (!doc.isDuplicate || doc.isOrphanReusable) && !doc.hasErrors && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] text-warning">Cliente não vinculado →</span>
                          <Select onValueChange={v => handleClientMatch(i, v)}>
                            <SelectTrigger className="h-6 w-48 text-[10px]"><SelectValue placeholder="Vincular cliente" /></SelectTrigger>
                            <SelectContent>
                              {clients.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.company_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Validation messages */}
                      {doc.validations.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {doc.validations.map((v, vi) => (
                            <div key={vi} className={`text-[10px] flex items-center gap-1 ${
                              v.severity === 'error' ? 'text-destructive' : v.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                            }`}>
                              {v.severity === 'error' ? <XCircle className="h-2.5 w-2.5 shrink-0" /> :
                               v.severity === 'warning' ? <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> :
                               <Info className="h-2.5 w-2.5 shrink-0" />}
                              {v.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemoveDoc(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="orders" className="space-y-2">
          {filterOrders(orders).length === 0 ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">Nenhum pedido neste filtro</CardContent></Card>
          ) : filterOrders(orders).map((order, rawIdx) => {
            const i = orders.indexOf(order);
            return (
              <Card key={i} className={order.hasErrors ? 'border-destructive/30' : order.hasWarnings ? 'border-warning/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">Pedido {order.source.orderNumber}</span>
                        {order.hasErrors && <Badge variant="outline" className="bg-destructive/10 text-destructive text-[10px]">Erro</Badge>}
                        {order.hasWarnings && !order.hasErrors && <Badge variant="outline" className="bg-warning/10 text-warning text-[10px]">Aviso</Badge>}
                        {!order.hasErrors && !order.hasWarnings && <Badge variant="outline" className="bg-success/10 text-success text-[10px]">OK</Badge>}
                      </div>

                      <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-xs">
                        <div>
                          <span className="text-muted-foreground">Cliente: </span>
                          {order.matchedClientName ? (
                            <span className="text-success font-medium">{order.matchedClientName}</span>
                          ) : (
                            <span className="text-warning">{order.source.clientName || '—'}</span>
                          )}
                        </div>
                        <div><span className="text-muted-foreground">Destino: </span>{order.source.destination || '—'}</div>
                        <div><span className="text-muted-foreground">Paletes: </span>{order.source.palletCount || '—'}</div>
                        <div><span className="text-muted-foreground">Peso: </span>{order.source.weightKg ? `${order.source.weightKg} kg` : '—'}</div>
                      </div>

                      {/* Client matching */}
                      {!order.matchedClientId && !order.hasErrors && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-[10px] text-warning">Cliente não vinculado →</span>
                          <Select onValueChange={v => handleOrderClientMatch(i, v)}>
                            <SelectTrigger className="h-6 w-48 text-[10px]"><SelectValue placeholder="Vincular cliente" /></SelectTrigger>
                            <SelectContent>
                              {clients.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.company_name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {order.validations.length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {order.validations.map((v, vi) => (
                            <div key={vi} className={`text-[10px] flex items-center gap-1 ${
                              v.severity === 'error' ? 'text-destructive' : v.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'
                            }`}>{v.message}</div>
                          ))}
                        </div>
                      )}
                    </div>

                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onRemoveOrder(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>

      <div className="flex gap-3 justify-between items-end">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        <div className="flex flex-col items-end gap-2">
          {onSaveDocsOnly && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={selectedLoadId || '__none__'} onValueChange={v => setSelectedLoadId(v === '__none__' ? null : v)}>
                  <SelectTrigger className="h-8 w-[220px] text-xs">
                    <SelectValue placeholder="Vincular a carga existente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem vínculo (avulsa)</SelectItem>
                    {loads.filter(l => l.status !== 'delivered').map(l => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">
                        {l.load_number} {l.destination ? `→ ${l.destination}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(true)}
                disabled={totalValid === 0 || savingDocs}
                title="Pré-visualizar campos extraídos antes de gravar no banco"
              >
                <Eye className="h-4 w-4 mr-1.5" /> Pré-visualizar
              </Button>
              <Button variant="secondary" onClick={() => setPreviewOpen(true)} disabled={totalValid === 0 || savingDocs}>
                {savingDocs ? 'Salvando...' : selectedLoadId ? 'Salvar e Vincular' : 'Salvar NF-es apenas'}
              </Button>
            </div>
          )}
          <Button onClick={onNext} disabled={totalValid === 0}>
            Agrupar em Cargas <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>

      <IngestionPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        docs={docs}
        orders={orders}
        confirming={savingDocs}
        confirmLabel={selectedLoadId ? 'Confirmar e vincular à carga' : 'Confirmar e persistir NF-es'}
        onConfirm={() => {
          onSaveDocsOnly?.(selectedLoadId);
          setPreviewOpen(false);
        }}
      />
    </div>
  );
}
