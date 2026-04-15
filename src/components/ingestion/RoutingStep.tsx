import { useState, useMemo } from 'react';
import { ValidatedDocument, ValidatedOrder, OperationalRouteRef } from '@/lib/ingestionValidator';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, MapPin, Plus, X, Route, AlertTriangle } from 'lucide-react';

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

function matchRoute(city: string, routes: OperationalRouteRef[]): OperationalRouteRef | null {
  const norm = normalizeCity(city);
  for (const r of routes) {
    for (const d of r.destinations) {
      const nd = normalizeCity(d.name);
      if (nd === norm || norm.includes(nd) || nd.includes(norm)) return r;
    }
  }
  return null;
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
      const matched = city ? matchRoute(city, routes) : null;
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
      const matched = dest ? matchRoute(dest, routes) : null;
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

  const unmatchedCount = groups.filter(g => !g.routeId).length;

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
    setGroups(prev => prev.map((g, i) => {
      if (i !== groupIdx) return g;
      if (g.cities.some(c => normalizeCity(c) === normalizeCity(city))) return g;
      return { ...g, cities: [...g.cities, city] };
    }));
    setNewCityInputs(prev => ({ ...prev, [groupIdx]: '' }));
  };

  const removeGroup = (groupIdx: number) => {
    setGroups(prev => prev.filter((_, i) => i !== groupIdx));
  };

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
    </div>
  );
}

export type { RouteGroup };
