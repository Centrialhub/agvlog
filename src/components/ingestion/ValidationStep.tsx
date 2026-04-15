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
  Weight, DollarSign, Boxes, LayoutGrid,
} from 'lucide-react';
import { Client } from '@/hooks/useClients';

interface ValidationStepProps {
  docs: ValidatedDocument[];
  orders: ValidatedOrder[];
  clients: Client[];
  onBack: () => void;
  onNext: () => void;
  onUpdateDoc: (index: number, updates: Partial<ValidatedDocument>) => void;
  onUpdateOrder: (index: number, updates: Partial<ValidatedOrder>) => void;
  onRemoveDoc: (index: number) => void;
  onRemoveOrder: (index: number) => void;
}

type FilterMode = 'all' | 'errors' | 'warnings' | 'valid';

export default function ValidationStep({
  docs, orders, clients, onBack, onNext,
  onUpdateDoc, onUpdateOrder, onRemoveDoc, onRemoveOrder,
}: ValidationStepProps) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [editingDocIdx, setEditingDocIdx] = useState<number | null>(null);
  const [editingOrderIdx, setEditingOrderIdx] = useState<number | null>(null);

  const validDocs = docs.filter(d => !d.hasErrors && !d.isDuplicate);

  const totalErrors = docs.filter(d => d.hasErrors).length + orders.filter(o => o.hasErrors).length;
  const totalWarnings = docs.filter(d => d.hasWarnings && !d.hasErrors).length + orders.filter(o => o.hasWarnings && !o.hasErrors).length;
  const totalValid = docs.filter(d => !d.hasErrors).length + orders.filter(o => !o.hasErrors).length;
  const totalBlocked = docs.filter(d => d.isDuplicate).length;

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
        {totalBlocked > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-medium border border-destructive/30 bg-destructive/5 text-destructive">
            {totalBlocked} duplicadas (bloqueadas)
          </span>
        )}
      </div>

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
              <Card key={i} className={doc.hasErrors ? 'border-destructive/30' : doc.isDuplicate ? 'border-destructive/20 opacity-60' : doc.hasWarnings ? 'border-warning/30' : ''}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">NF {doc.source.invoiceNumber || '—'}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{doc.fileName}</span>
                        {doc.isDuplicate && <Badge variant="outline" className="bg-destructive/10 text-destructive text-[10px]">Duplicada</Badge>}
                        {doc.hasErrors && !doc.isDuplicate && <Badge variant="outline" className="bg-destructive/10 text-destructive text-[10px]">Erro</Badge>}
                        {doc.hasWarnings && !doc.hasErrors && <Badge variant="outline" className="bg-warning/10 text-warning text-[10px]">Aviso</Badge>}
                        {!doc.hasErrors && !doc.hasWarnings && <Badge variant="outline" className="bg-success/10 text-success text-[10px]">OK</Badge>}
                      </div>

                      <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-xs">
                        <div>
                          <span className="text-muted-foreground">Destinatário: </span>
                          {doc.matchedClientName ? (
                            <span className="text-success font-medium">{doc.matchedClientName}</span>
                          ) : (
                            <span className="text-warning">{doc.source.recipientName || '—'}</span>
                          )}
                        </div>
                        <div><span className="text-muted-foreground">Destino: </span>{doc.source.recipientCity || '—'}, {doc.source.recipientState || ''}</div>
                        <div><span className="text-muted-foreground">Paletes: </span>{doc.source.estimatedPallets}</div>
                        <div><span className="text-muted-foreground">Peso: </span>{doc.source.totalWeight ? `${doc.source.totalWeight} kg` : '—'}</div>
                      </div>

                      {/* Client matching for unmatched */}
                      {!doc.matchedClientId && !doc.isDuplicate && !doc.hasErrors && (
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

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Recomeçar</Button>
        <Button onClick={onNext} disabled={totalValid === 0}>
          Gerar Sugestões de Carga <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
