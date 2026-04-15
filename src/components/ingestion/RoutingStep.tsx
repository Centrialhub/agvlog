import { useState, useMemo, useCallback } from 'react';
import { ValidatedDocument, ValidatedOrder, OperationalRouteRef, findRouteForCity } from '@/lib/ingestionValidator';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, ArrowRight, MapPin, Plus, X, Route, AlertTriangle, FileText, ArrowDownToLine } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface RouteGroup {
  routeId: string | null;
  routeName: string;
  cities: string[];
  documents: ValidatedDocument[];
  orders: ValidatedOrder[];
  totalPallets: number;
  totalWeight: number;
  totalValue: number;
}

interface RoutingStepProps {
  docs: ValidatedDocument[];
  orders: ValidatedOrder[];
  routes: OperationalRouteRef[];
  onBack: () => void;
  onNext: (groups: RouteGroup[]) => void;
}

function normalizeCity(city: string): string {
  return city.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').trim();
}

interface MatchableDoc {
  doc: ValidatedDocument;
  fromGroupIdx: number;
}

interface MatchableOrder {
  order: ValidatedOrder;
  fromGroupIdx: number;
}

export default function RoutingStep({ docs, orders, routes, onBack, onNext }: RoutingStepProps) {
  const validDocs = useMemo(() => docs.filter(d => !d.hasErrors && !d.isDuplicate), [docs]);
  const validOrders = useMemo(() => orders.filter(o => !o.hasErrors), [orders]);

  const initialGroups = useMemo(() => {
    const map = new Map<string, RouteGroup>();

    const getOrCreate = (key: string, routeId: string | null, routeName: string): RouteGroup => {
      if (!map.has(key)) {
        map.set(key, { routeId, routeName, cities: [], documents: [], orders: [], totalPallets: 0, totalWeight: 0, totalValue: 0 });
      }
      return map.get(key)!;
    };

    for (const doc of validDocs) {
      const city = doc.source.recipientCity || '';
      const matched = city ? findRouteForCity(city, routes) : null;
      const key = matched ? matched.id : `unmatched-${doc.source.recipientState || 'unknown'}-${city}`;
      const name = matched ? matched.name : [doc.source.recipientState, city].filter(Boolean).join(' - ') || 'Sem região';
      const group = getOrCreate(key, matched?.id || null, name);
      group.documents.push(doc);
      group.totalPallets += doc.source.estimatedPallets;
      group.totalWeight += doc.source.totalWeight;
      group.totalValue += doc.source.totalValue;
      if (city && !group.cities.some(c => normalizeCity(c) === normalizeCity(city))) {
        group.cities.push(city);
      }
    }

    for (const order of validOrders) {
      const dest = order.source.destination || '';
      const matched = dest ? findRouteForCity(dest, routes) : null;
      const key = matched ? matched.id : `unmatched-order-${dest}`;
      const name = matched ? matched.name : dest || 'Sem região';
      const group = getOrCreate(key, matched?.id || null, name);
      group.orders.push(order);
      group.totalPallets += order.source.palletCount || Math.ceil(order.source.quantity / 50);
      group.totalWeight += order.source.weightKg;
      if (dest && !group.cities.some(c => normalizeCity(c) === normalizeCity(dest))) {
        group.cities.push(dest);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.totalPallets - a.totalPallets);
  }, [validDocs, validOrders, routes]);

  const [groups, setGroups] = useState<RouteGroup[]>(initialGroups);
  const [newCityInputs, setNewCityInputs] = useState<Record<number, string>>({});
  const [pullDialog, setPullDialog] = useState<{ targetGroupIdx: number; city: string } | null>(null);
  const [selectedPullDocs, setSelectedPullDocs] = useState<Set<string>>(new Set());
  const [selectedPullOrders, setSelectedPullOrders] = useState<Set<number>>(new Set());

  const unmatchedCount = groups.filter(g => !g.routeId).length;

  // Find docs/orders from OTHER groups that match a city
  const findMatchingDocsInOtherGroups = useCallback((city: string, excludeGroupIdx: number) => {
    const norm = normalizeCity(city);
    const matchDocs: MatchableDoc[] = [];
    const matchOrders: MatchableOrder[] = [];

    groups.forEach((g, gi) => {
      if (gi === excludeGroupIdx) return;
      g.documents.forEach(doc => {
        const docCity = normalizeCity(doc.source.recipientCity || '');
        if (docCity && docCity === norm) {
          matchDocs.push({ doc, fromGroupIdx: gi });
        }
      });
      g.orders.forEach(order => {
        const orderCity = normalizeCity(order.source.destination || '');
        if (orderCity && orderCity === norm) {
          matchOrders.push({ order, fromGroupIdx: gi });
        }
      });
    });

    return { matchDocs, matchOrders };
  }, [groups]);

  const removeCity = (groupIdx: number, cityIdx: number) => {
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      const newCities = g.cities.filter((_, ci) => ci !== cityIdx);
      return { ...g, cities: newCities };
    }));
  };

  const addCity = (groupIdx: number) => {
    const city = (newCityInputs[groupIdx] || '').trim();
    if (!city) return;

    // Check if there are matching docs in other groups
    const { matchDocs, matchOrders } = findMatchingDocsInOtherGroups(city, groupIdx);

    // Always add city
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      if (g.cities.some(c => normalizeCity(c) === normalizeCity(city))) return g;
      return { ...g, cities: [...g.cities, city] };
    }));
    setNewCityInputs(prev => ({ ...prev, [groupIdx]: '' }));

    // If there are matching docs, open pull dialog
    if (matchDocs.length > 0 || matchOrders.length > 0) {
      setPullDialog({ targetGroupIdx: groupIdx, city });
      // Pre-select all
      setSelectedPullDocs(new Set(matchDocs.map(m => m.doc.source.accessKey || m.doc.fileName)));
      setSelectedPullOrders(new Set(matchOrders.map(m => m.order.rowIndex)));
    }
  };

  const executePull = () => {
    if (!pullDialog) return;
    const { targetGroupIdx, city } = pullDialog;
    const { matchDocs, matchOrders } = findMatchingDocsInOtherGroups(city, targetGroupIdx);

    const docsToMove = matchDocs.filter(m => selectedPullDocs.has(m.doc.source.accessKey || m.doc.fileName));
    const ordersToMove = matchOrders.filter(m => selectedPullOrders.has(m.order.rowIndex));

    if (docsToMove.length === 0 && ordersToMove.length === 0) {
      setPullDialog(null);
      return;
    }

    setGroups(prev => {
      const next = prev.map((g, i) => ({ ...g, documents: [...g.documents], orders: [...g.orders], cities: [...g.cities] }));

      // Remove from source groups
      const docKeys = new Set(docsToMove.map(m => m.doc.source.accessKey || m.doc.fileName));
      const orderIdxs = new Set(ordersToMove.map(m => m.order.rowIndex));

      docsToMove.forEach(m => {
        next[m.fromGroupIdx].documents = next[m.fromGroupIdx].documents.filter(
          d => (d.source.accessKey || d.fileName) !== (m.doc.source.accessKey || m.doc.fileName)
        );
      });
      ordersToMove.forEach(m => {
        next[m.fromGroupIdx].orders = next[m.fromGroupIdx].orders.filter(o => o.rowIndex !== m.order.rowIndex);
      });

      // Add to target group
      const target = next[targetGroupIdx];
      docsToMove.forEach(m => {
        target.documents.push(m.doc);
      });
      ordersToMove.forEach(m => {
        target.orders.push(m.order);
      });

      // Recalc totals for all affected groups
      const affectedIdxs = new Set([targetGroupIdx, ...docsToMove.map(m => m.fromGroupIdx), ...ordersToMove.map(m => m.fromGroupIdx)]);
      affectedIdxs.forEach(idx => {
        const g = next[idx];
        g.totalPallets = g.documents.reduce((s, d) => s + d.source.estimatedPallets, 0) +
          g.orders.reduce((s, o) => s + (o.source.palletCount || Math.ceil(o.source.quantity / 50)), 0);
        g.totalWeight = g.documents.reduce((s, d) => s + d.source.totalWeight, 0) +
          g.orders.reduce((s, o) => s + o.source.weightKg, 0);
        g.totalValue = g.documents.reduce((s, d) => s + d.source.totalValue, 0);
      });

      // Remove empty groups (but keep the target)
      return next.filter((g, i) => i === targetGroupIdx || g.documents.length > 0 || g.orders.length > 0);
    });

    setPullDialog(null);
    setSelectedPullDocs(new Set());
    setSelectedPullOrders(new Set());
  };

  const removeGroup = (groupIdx: number) => {
    setGroups(prev => prev.filter((_, i) => i !== groupIdx));
  };

  // For the pull dialog
  const pullMatches = pullDialog ? findMatchingDocsInOtherGroups(pullDialog.city, pullDialog.targetGroupIdx) : { matchDocs: [], matchOrders: [] };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            Roteirização — {groups.length} rotas identificadas
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revise as rotas, adicione ou remova cidades, e confirme antes de atribuir veículos.
          </p>
        </div>
        {unmatchedCount > 0 && (
          <Badge variant="outline" className="text-warning border-warning/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            {unmatchedCount} sem rota cadastrada
          </Badge>
        )}
      </div>

      {groups.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum documento válido para roteirizar</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g, gi) => (
            <Card key={gi} className={!g.routeId ? 'border-warning/30' : ''}>
              <CardContent className="py-3 px-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    {g.routeId ? (
                      <Badge className="bg-primary/10 text-primary border-primary/20 gap-1">
                        <MapPin className="h-3 w-3" />
                        {g.routeName}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-warning border-warning/30">
                        <MapPin className="h-3 w-3" />
                        {g.routeName}
                        <span className="text-[9px] ml-1">(sem rota)</span>
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {g.documents.length} NF-e{g.orders.length > 0 ? ` · ${g.orders.length} pedidos` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{g.totalPallets} paletes</span>
                      {g.totalWeight > 0 && <span>{g.totalWeight.toLocaleString('pt-BR')} kg</span>}
                      {g.totalValue > 0 && <span>R$ {g.totalValue.toLocaleString('pt-BR')}</span>}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeGroup(gi)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Cities */}
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-[10px] text-muted-foreground font-medium mr-1">Cidades:</span>
                  {g.cities.map((city, ci) => (
                    <Badge key={ci} variant="secondary" className="text-[10px] gap-1 pr-1">
                      {city}
                      <button onClick={() => removeCity(gi, ci)} className="ml-0.5 hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  <div className="flex items-center gap-1 ml-1">
                    <Input
                      className="h-6 w-28 text-[10px] px-2"
                      placeholder="+ cidade"
                      value={newCityInputs[gi] || ''}
                      onChange={e => setNewCityInputs(prev => ({ ...prev, [gi]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addCity(gi)}
                    />
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => addCity(gi)} title="Adicionar cidade (puxa notas correspondentes)">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* NF-e details */}
                {g.documents.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {g.documents.map((doc, di) => (
                      <span key={di} className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        NF {doc.source.invoiceNumber} → {doc.source.recipientName || doc.source.recipientCity || '?'}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex gap-3 justify-between">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
        </Button>
        <Button onClick={() => onNext(groups)} disabled={groups.length === 0}>
          Atribuir Veículos <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>

      {/* Pull documents dialog */}
      <Dialog open={!!pullDialog} onOpenChange={open => !open && setPullDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ArrowDownToLine className="h-4 w-4 text-primary" />
              Puxar notas para esta rota?
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Encontramos notas da cidade <strong>{pullDialog?.city}</strong> em outras rotas. Selecione quais deseja mover:
          </p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {pullMatches.matchDocs.map((m, i) => {
              const key = m.doc.source.accessKey || m.doc.fileName;
              const checked = selectedPullDocs.has(key);
              return (
                <label key={`doc-${i}`} className="flex items-start gap-2 p-2 rounded border bg-muted/30 cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={v => {
                      setSelectedPullDocs(prev => {
                        const next = new Set(prev);
                        v ? next.add(key) : next.delete(key);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-medium truncate">NF {m.doc.source.invoiceNumber}</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground block truncate">
                      {m.doc.source.recipientName} · {m.doc.source.recipientCity}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Rota atual: <strong>{groups[m.fromGroupIdx]?.routeName}</strong>
                    </span>
                  </div>
                  <div className="text-right text-[10px] text-muted-foreground shrink-0">
                    <div>{m.doc.source.estimatedPallets} pal</div>
                    <div>{m.doc.source.totalWeight.toLocaleString('pt-BR')} kg</div>
                  </div>
                </label>
              );
            })}
            {pullMatches.matchOrders.map((m, i) => {
              const checked = selectedPullOrders.has(m.order.rowIndex);
              return (
                <label key={`order-${i}`} className="flex items-start gap-2 p-2 rounded border bg-muted/30 cursor-pointer hover:bg-muted/50">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={v => {
                      setSelectedPullOrders(prev => {
                        const next = new Set(prev);
                        v ? next.add(m.order.rowIndex) : next.delete(m.order.rowIndex);
                        return next;
                      });
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium">Pedido {m.order.source.orderNumber}</span>
                    <span className="text-[10px] text-muted-foreground block">
                      {m.order.source.clientName} · {m.order.source.destination}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Rota atual: <strong>{groups[m.fromGroupIdx]?.routeName}</strong>
                    </span>
                  </div>
                </label>
              );
            })}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setPullDialog(null)}>
              Não puxar
            </Button>
            <Button size="sm" onClick={executePull} disabled={selectedPullDocs.size === 0 && selectedPullOrders.size === 0}>
              <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
              Puxar {selectedPullDocs.size + selectedPullOrders.size} nota(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { RouteGroup };
