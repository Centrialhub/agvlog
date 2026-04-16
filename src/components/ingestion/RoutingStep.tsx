import { useState, useMemo, useEffect, useRef } from 'react';
import { ValidatedDocument, ValidatedOrder, OperationalRouteRef, findRouteForCity } from '@/lib/ingestionValidator';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, ArrowRight, MapPin, Plus, X, Route, AlertTriangle, FileText, ArrowDownToLine, Search } from 'lucide-react';
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
  onLearnCity?: (routeId: string, cityName: string) => void;
}

function normalizeCity(city: string): string {
  return city.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, '').trim();
}

function recalcGroupTotals(g: RouteGroup): RouteGroup {
  return {
    ...g,
    totalPallets: g.documents.reduce((s, d) => s + d.source.estimatedPallets, 0) +
      g.orders.reduce((s, o) => s + (o.source.palletCount || Math.ceil(o.source.quantity / 50)), 0),
    totalWeight: g.documents.reduce((s, d) => s + d.source.totalWeight, 0) +
      g.orders.reduce((s, o) => s + o.source.weightKg, 0),
    totalValue: g.documents.reduce((s, d) => s + d.source.totalValue, 0),
  };
}

/** Unique key for a doc */
function docKey(doc: ValidatedDocument): string {
  return doc.source.accessKey || `${doc.fileName}::${doc.source.invoiceNumber}`;
}

export default function RoutingStep({ docs, orders, routes, onBack, onNext, onLearnCity }: RoutingStepProps) {
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
  const userTouched = useRef(false);

  // Re-sync groups when initialGroups change (e.g. routes loaded after mount),
  // but only if the user hasn't manually edited yet.
  useEffect(() => {
    if (!userTouched.current) {
      setGroups(initialGroups);
    }
  }, [initialGroups]);

  // Pull modal state
  const [pullTargetIdx, setPullTargetIdx] = useState<number | null>(null);
  const [pullSearch, setPullSearch] = useState('');
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());

  const unmatchedCount = groups.filter(g => !g.routeId).length;

  const removeCity = (groupIdx: number, cityIdx: number) => {
    userTouched.current = true;
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      return { ...g, cities: g.cities.filter((_, ci) => ci !== cityIdx) };
    }));
  };

  const addCity = (groupIdx: number) => {
    const city = (newCityInputs[groupIdx] || '').trim();
    if (!city) return;
    userTouched.current = true;
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      if (g.cities.some(c => normalizeCity(c) === normalizeCity(city))) return g;
      return { ...g, cities: [...g.cities, city] };
    }));
    setNewCityInputs(prev => ({ ...prev, [groupIdx]: '' }));
  };

  const removeGroup = (groupIdx: number) => {
    userTouched.current = true;
    setGroups(prev => prev.filter((_, i) => i !== groupIdx));
  };

  // Open pull modal
  const openPullModal = (groupIdx: number) => {
    setPullTargetIdx(groupIdx);
    setPullSearch('');
    setSelectedDocs(new Set());
    setSelectedOrders(new Set());
  };

  // Items available to pull (from all OTHER groups)
  const pullableItems = useMemo(() => {
    if (pullTargetIdx === null) return { docs: [] as { doc: ValidatedDocument; groupIdx: number; groupName: string }[], orders: [] as { order: ValidatedOrder; groupIdx: number; groupName: string }[] };
    
    const ds: { doc: ValidatedDocument; groupIdx: number; groupName: string }[] = [];
    const os: { order: ValidatedOrder; groupIdx: number; groupName: string }[] = [];

    groups.forEach((g, gi) => {
      if (gi === pullTargetIdx) return;
      g.documents.forEach(doc => ds.push({ doc, groupIdx: gi, groupName: g.routeName }));
      g.orders.forEach(order => os.push({ order, groupIdx: gi, groupName: g.routeName }));
    });

    return { docs: ds, orders: os };
  }, [groups, pullTargetIdx]);

  // Filtered by search
  const filteredPullable = useMemo(() => {
    const q = pullSearch.toLowerCase().trim();
    if (!q) return pullableItems;
    return {
      docs: pullableItems.docs.filter(m =>
        (m.doc.source.invoiceNumber || '').toLowerCase().includes(q) ||
        (m.doc.source.recipientName || '').toLowerCase().includes(q) ||
        (m.doc.source.recipientCity || '').toLowerCase().includes(q) ||
        m.groupName.toLowerCase().includes(q)
      ),
      orders: pullableItems.orders.filter(m =>
        (m.order.source.orderNumber || '').toLowerCase().includes(q) ||
        (m.order.source.clientName || '').toLowerCase().includes(q) ||
        (m.order.source.destination || '').toLowerCase().includes(q) ||
        m.groupName.toLowerCase().includes(q)
      ),
    };
  }, [pullableItems, pullSearch]);

  const toggleAllFiltered = () => {
    const allDocKeys = filteredPullable.docs.map(m => docKey(m.doc));
    const allOrderKeys = filteredPullable.orders.map(m => m.order.rowIndex);
    const allSelected = allDocKeys.every(k => selectedDocs.has(k)) && allOrderKeys.every(k => selectedOrders.has(k));

    if (allSelected) {
      setSelectedDocs(prev => { const n = new Set(prev); allDocKeys.forEach(k => n.delete(k)); return n; });
      setSelectedOrders(prev => { const n = new Set(prev); allOrderKeys.forEach(k => n.delete(k)); return n; });
    } else {
      setSelectedDocs(prev => { const n = new Set(prev); allDocKeys.forEach(k => n.add(k)); return n; });
      setSelectedOrders(prev => { const n = new Set(prev); allOrderKeys.forEach(k => n.add(k)); return n; });
    }
  };

  const executePull = () => {
    if (pullTargetIdx === null || (selectedDocs.size === 0 && selectedOrders.size === 0)) return;

    const learnedCities: string[] = [];

    setGroups(prev => {
      const next = prev.map(g => ({
        ...g,
        documents: [...g.documents],
        orders: [...g.orders],
        cities: [...g.cities],
      }));

      const target = next[pullTargetIdx];

      // Move selected docs
      selectedDocs.forEach(key => {
        for (let gi = 0; gi < next.length; gi++) {
          if (gi === pullTargetIdx) continue;
          const idx = next[gi].documents.findIndex(d => docKey(d) === key);
          if (idx !== -1) {
            const [doc] = next[gi].documents.splice(idx, 1);
            target.documents.push(doc);
            const city = doc.source.recipientCity;
            if (city && !target.cities.some(c => normalizeCity(c) === normalizeCity(city))) {
              target.cities.push(city);
              learnedCities.push(city);
            }
            break;
          }
        }
      });

      // Move selected orders
      selectedOrders.forEach(rowIdx => {
        for (let gi = 0; gi < next.length; gi++) {
          if (gi === pullTargetIdx) continue;
          const idx = next[gi].orders.findIndex(o => o.rowIndex === rowIdx);
          if (idx !== -1) {
            const [order] = next[gi].orders.splice(idx, 1);
            target.orders.push(order);
            const dest = order.source.destination;
            if (dest && !target.cities.some(c => normalizeCity(c) === normalizeCity(dest))) {
              target.cities.push(dest);
              learnedCities.push(dest);
            }
            break;
          }
        }
      });

      // Learn: persist new cities to the operational route
      if (target.routeId && learnedCities.length > 0 && onLearnCity) {
        learnedCities.forEach(city => onLearnCity(target.routeId!, city));
      }

      // Recalc totals & remove empty groups
      return next
        .map(recalcGroupTotals)
        .filter((g, i) => i === pullTargetIdx || g.documents.length > 0 || g.orders.length > 0);
    });

    setPullTargetIdx(null);
  };

  const totalSelected = selectedDocs.size + selectedOrders.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Route className="h-4 w-4 text-primary" />
            Roteirização — {groups.length} rotas identificadas
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Revise as rotas, adicione cidades ou puxe notas de outras rotas clicando em <ArrowDownToLine className="h-3 w-3 inline" />.
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
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{g.totalPallets} paletes</span>
                      {g.totalWeight > 0 && <span>{g.totalWeight.toLocaleString('pt-BR')} kg</span>}
                      {g.totalValue > 0 && <span>R$ {g.totalValue.toLocaleString('pt-BR')}</span>}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-6 w-6 text-primary border-primary/30 hover:bg-primary/10"
                      onClick={() => openPullModal(gi)}
                      title="Puxar notas de outras rotas"
                    >
                      <ArrowDownToLine className="h-3 w-3" />
                    </Button>
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
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => addCity(gi)}>
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

      {/* Pull documents modal */}
      <Dialog open={pullTargetIdx !== null} onOpenChange={open => !open && setPullTargetIdx(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ArrowDownToLine className="h-4 w-4 text-primary" />
              Puxar notas para: {pullTargetIdx !== null ? groups[pullTargetIdx]?.routeName : ''}
            </DialogTitle>
          </DialogHeader>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Pesquisar por NF, destinatário, cidade ou rota..."
              value={pullSearch}
              onChange={e => setPullSearch(e.target.value)}
              autoFocus
            />
          </div>

          {/* Select all */}
          {(filteredPullable.docs.length > 0 || filteredPullable.orders.length > 0) && (
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={
                    filteredPullable.docs.length + filteredPullable.orders.length > 0 &&
                    filteredPullable.docs.every(m => selectedDocs.has(docKey(m.doc))) &&
                    filteredPullable.orders.every(m => selectedOrders.has(m.order.rowIndex))
                  }
                  onCheckedChange={toggleAllFiltered}
                />
                Selecionar todos ({filteredPullable.docs.length + filteredPullable.orders.length})
              </label>
              {totalSelected > 0 && (
                <span className="text-primary font-medium">{totalSelected} selecionado(s)</span>
              )}
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0 pr-1">
            {filteredPullable.docs.length === 0 && filteredPullable.orders.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                {pullSearch ? 'Nenhuma nota encontrada para esta pesquisa' : 'Não há notas em outras rotas para puxar'}
              </div>
            ) : (
              <>
                {filteredPullable.docs.map((m, i) => {
                  const key = docKey(m.doc);
                  const checked = selectedDocs.has(key);
                  return (
                    <label
                      key={`doc-${i}`}
                      className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${checked ? 'bg-primary/5 border-primary/30' : 'bg-muted/20 border-border hover:bg-muted/40'}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={v => {
                          setSelectedDocs(prev => {
                            const n = new Set(prev);
                            v ? n.add(key) : n.delete(key);
                            return n;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs font-medium">NF {m.doc.source.invoiceNumber}</span>
                          <span className="text-[10px] text-muted-foreground">· {m.doc.source.recipientCity}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground block truncate">
                          {m.doc.source.recipientName}
                        </span>
                        <Badge variant="outline" className="text-[9px] mt-0.5 h-4 px-1.5">
                          Rota atual: {m.groupName}
                        </Badge>
                      </div>
                      <div className="text-right text-[10px] text-muted-foreground shrink-0 space-y-0.5">
                        <div>{m.doc.source.estimatedPallets} pal</div>
                        <div>{m.doc.source.totalWeight.toLocaleString('pt-BR')} kg</div>
                        {m.doc.source.totalValue > 0 && <div>R$ {m.doc.source.totalValue.toLocaleString('pt-BR')}</div>}
                      </div>
                    </label>
                  );
                })}
                {filteredPullable.orders.map((m, i) => {
                  const checked = selectedOrders.has(m.order.rowIndex);
                  return (
                    <label
                      key={`order-${i}`}
                      className={`flex items-start gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${checked ? 'bg-primary/5 border-primary/30' : 'bg-muted/20 border-border hover:bg-muted/40'}`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={v => {
                          setSelectedOrders(prev => {
                            const n = new Set(prev);
                            v ? n.add(m.order.rowIndex) : n.delete(m.order.rowIndex);
                            return n;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium">Pedido {m.order.source.orderNumber}</span>
                        <span className="text-[10px] text-muted-foreground block">{m.order.source.clientName} · {m.order.source.destination}</span>
                        <Badge variant="outline" className="text-[9px] mt-0.5 h-4 px-1.5">
                          Rota atual: {m.groupName}
                        </Badge>
                      </div>
                    </label>
                  );
                })}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={() => setPullTargetIdx(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={executePull} disabled={totalSelected === 0}>
              <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
              Puxar {totalSelected} nota(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export type { RouteGroup };
