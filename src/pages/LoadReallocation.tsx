import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLoads, Load } from '@/hooks/useLoads';
import { useLoadItems, LoadItem, useUpdateLoadItem } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useUpdateLoad, useDeleteLoad } from '@/hooks/useLoads';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from '@/components/ui/select';
import { ArrowRightLeft, Truck, Package, AlertTriangle, CheckCircle, ChevronRight, History, X, ExternalLink, Route as RouteIcon, Search, CheckSquare, Square } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { normalizeCity } from '@/lib/utils/normalizeCity';

type FilterField = 'all' | 'remitter' | 'recipient' | 'city' | 'invoice';

// Merge destination strings preserving uniqueness, e.g.
// "PAI PEDRO" + "PIRAPORA - JAIBA" -> "PAI PEDRO - PIRAPORA - JAIBA"
export function mergeDestinations(target?: string | null, source?: string | null): string | null {
  const split = (s?: string | null) =>
    (s || '')
      .split(/[-,/|]+/)
      .map(t => t.trim())
      .filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const t of [...split(target), ...split(source)]) {
    const key = normalizeCity(t);
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(t);
    }
  }
  return tokens.length ? tokens.join(' - ') : (target || null);
}

function LoadColumn({ load, items, isLoading, vehicles, selectedItems, onToggleItem, onSelectMany, isTarget }: {
  load: Load;
  items: LoadItem[];
  isLoading: boolean;
  vehicles: any[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
  onSelectMany?: (ids: string[], checked: boolean) => void;
  isTarget?: boolean;
}) {
  const vehicle = vehicles.find(v => v.id === load.vehicle_id);
  const maxPallets = vehicle?.max_pallets || 0;
  const maxWeight = vehicle?.max_weight_kg || 0;
  const currentPallets = items.reduce((s, i) => s + (i.pallet_count || 0), 0);
  const currentWeight = items.reduce((s, i) => s + (i.weight_kg || 0), 0);
  const palletPct = maxPallets > 0 ? Math.round((currentPallets / maxPallets) * 100) : 0;
  const weightPct = maxWeight > 0 ? Math.round((currentWeight / maxWeight) * 100) : 0;
  const isOverPallet = palletPct > 100;
  const isOverWeight = weightPct > 100;

  const [search, setSearch] = useState('');
  const [field, setField] = useState<FilterField>('all');

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => {
      const fd: any = Array.isArray(i.fiscal_documents) ? i.fiscal_documents[0] : (i.fiscal_documents || {});
      const desc = (i.item_description || '').toLowerCase();
      const remitter = (fd?.remitter || '').toLowerCase();
      const recipient = (fd?.recipient || '').toLowerCase();
      const city = (fd?.recipient_city || '').toLowerCase();
      const invoice = (fd?.invoice_number || '').toLowerCase();
      switch (field) {
        case 'remitter': return remitter.includes(q);
        case 'recipient': return recipient.includes(q);
        case 'city': return city.includes(q);
        case 'invoice': return invoice.includes(q);
        default:
          return desc.includes(q) || remitter.includes(q) || recipient.includes(q) || city.includes(q) || invoice.includes(q);
      }
    });
  }, [items, search, field]);

  const filteredIds = useMemo(() => filteredItems.map(i => i.id), [filteredItems]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selectedItems.has(id));
  const canSelect = !isTarget && !!onSelectMany;

  // Aggregate recipients (client) and cities present in this load so the operator
  // can quickly identify who the load is for — the load_number alone is not enough.
  const recipientsSummary = useMemo(() => {
    // Agrega por chave normalizada (case/acento invariante), mas mantém o rótulo original mais frequente.
    const bump = (m: Map<string, { label: string; count: number }>, label: string) => {
      const key = normalizeCity(label);
      if (!key) return;
      const cur = m.get(key);
      if (cur) cur.count += 1;
      else m.set(key, { label: label.trim(), count: 1 });
    };
    const recipients = new Map<string, { label: string; count: number }>();
    const cities = new Map<string, { label: string; count: number }>();
    const remitters = new Map<string, { label: string; count: number }>();
    for (const i of items) {
      const fd: any = Array.isArray(i.fiscal_documents) ? i.fiscal_documents[0] : (i.fiscal_documents || {});
      const rec = (fd?.recipient || '').trim();
      const city = (fd?.recipient_city || '').trim();
      const state = (fd?.recipient_state || '').trim();
      const rem = (fd?.remitter || '').trim();
      if (rec) bump(recipients, rec);
      if (city) bump(cities, state ? `${city}/${state}` : city);
      if (rem) bump(remitters, rem);
    }
    const sortDesc = (m: Map<string, { label: string; count: number }>): Array<[string, number]> =>
      Array.from(m.values())
        .sort((a, b) => b.count - a.count)
        .map(v => [v.label, v.count] as [string, number]);
    return { recipients: sortDesc(recipients), cities: sortDesc(cities), remitters: sortDesc(remitters) };
  }, [items]);

  return (
    <Card className={`flex flex-col h-full min-w-0 ${isTarget ? 'ring-2 ring-primary/30' : ''}`}>
      <CardHeader className="pb-3 space-y-2 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-bold truncate flex items-center gap-2">
              <Package className="h-4 w-4 text-primary shrink-0" />
              Carga {load.load_number}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px] bg-background/50 border-primary/20">{load.destination || 'Sem destino'}</Badge>
            <Link to={`/loads/${load.id}`}>
              <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-[10px]" title="Abrir carga para fechar/emitir CT-e">
                <ExternalLink className="h-3 w-3" />
                Abrir
              </Button>
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Truck className="h-3 w-3" />
          {vehicle ? (
            <span>{vehicle.plate} ({maxPallets}p / {maxWeight}kg)</span>
          ) : (
            <span className="text-warning">Sem veículo</span>
          )}
        </div>
        {(recipientsSummary.recipients.length > 0 || recipientsSummary.cities.length > 0) && (
          <div className="space-y-1 rounded-md bg-muted/40 border border-border/60 p-1.5">
            {recipientsSummary.recipients.length > 0 && (
              <div className="flex flex-col gap-1">
                <div className="flex items-start gap-1.5 min-w-0 overflow-hidden">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                    Rem.
                  </span>
                  <div className="flex flex-wrap gap-1 items-center min-w-0 overflow-hidden">
                    {recipientsSummary.remitters.slice(0, 3).map(([name, n]) => {
                      const clientName = items.find(i => i.fiscal_documents?.remitter === name)?.orders?.clients?.company_name;
                      return (
                        <Badge
                          key={name}
                          variant="outline"
                          className="text-[9px] font-normal border-primary/20 bg-primary/5 text-primary max-w-[90px] py-0 h-4"
                          title={clientName ? `${clientName} (${name})` : name}
                        >
                          <span className="truncate">{clientName || name}</span>
                          <span className="ml-0.5 opacity-70 shrink-0 text-[8px]">·{n}</span>
                        </Badge>
                      );
                    })}
                    {recipientsSummary.remitters.length > 3 && (
                      <Badge variant="outline" className="text-[9px] font-normal shrink-0 py-0 h-4">
                        +{recipientsSummary.remitters.length - 3}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-1.5 min-w-0 overflow-hidden">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                    Dest.
                  </span>
                  <div className="flex flex-wrap gap-1 items-center min-w-0 overflow-hidden">
                    {recipientsSummary.recipients.slice(0, 4).map(([name, n]) => (
                      <Badge
                        key={name}
                        variant="secondary"
                        className="text-[9px] font-normal max-w-[90px] py-0 h-4"
                        title={name}
                      >
                        <span className="truncate">{name}</span>
                        <span className="ml-0.5 text-muted-foreground shrink-0 text-[8px]">·{n}</span>
                      </Badge>
                    ))}
                    {recipientsSummary.recipients.length > 4 && (
                      <Badge variant="outline" className="text-[9px] font-normal shrink-0 py-0 h-4">
                        +{recipientsSummary.recipients.length - 4}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            )}
            {recipientsSummary.cities.length > 0 && (
              <div className="flex items-start gap-1.5 min-w-0 overflow-hidden">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">
                  Cid.
                </span>
                <div className="flex flex-wrap gap-1 min-w-0 overflow-hidden">
                  {recipientsSummary.cities.slice(0, 5).map(([label, n]) => (
                    <Badge key={label} variant="outline" className="text-[9px] font-normal max-w-[80px] py-0 h-4">
                      <span className="truncate">{label}</span>
                      <span className="ml-0.5 text-muted-foreground shrink-0 text-[8px]">·{n}</span>
                    </Badge>
                  ))}
                  {recipientsSummary.cities.length > 5 && (
                    <Badge variant="outline" className="text-[9px] font-normal shrink-0 py-0 h-4">
                      +{recipientsSummary.cities.length - 5}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {maxPallets > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] w-12">Paletes</span>
              <Progress value={Math.min(palletPct, 100)} className={`h-1.5 flex-1 ${isOverPallet ? '[&>div]:bg-destructive' : ''}`} />
              <span className={`text-[10px] font-medium w-10 text-right ${isOverPallet ? 'text-destructive' : ''}`}>
                {currentPallets}/{maxPallets}
              </span>
            </div>
            {maxWeight > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] w-12">Peso</span>
                <Progress value={Math.min(weightPct, 100)} className={`h-1.5 flex-1 ${isOverWeight ? '[&>div]:bg-destructive' : ''}`} />
                <span className={`text-[10px] font-medium w-10 text-right ${isOverWeight ? 'text-destructive' : ''}`}>
                  {currentWeight.toLocaleString('pt-BR')}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Search + filter */}
        <div className="flex gap-1.5 pt-1">
          <Select value={field} onValueChange={(v) => setField(v as FilterField)}>
            <SelectTrigger className="h-7 w-[110px] text-[10px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Tudo</SelectItem>
              <SelectItem value="remitter" className="text-xs">Remetente</SelectItem>
              <SelectItem value="recipient" className="text-xs">Destinatário</SelectItem>
              <SelectItem value="city" className="text-xs">Cidade</SelectItem>
              <SelectItem value="invoice" className="text-xs">Nº NF</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="h-7 pl-7 text-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {canSelect && (
          <div className="flex items-center justify-between text-[10px] pt-0.5">
            <button
              onClick={() => onSelectMany!(filteredIds, !allFilteredSelected)}
              disabled={filteredIds.length === 0}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              {allFilteredSelected
                ? <CheckSquare className="h-3.5 w-3.5 text-primary" />
                : <Square className="h-3.5 w-3.5" />}
              {allFilteredSelected ? 'Desmarcar' : 'Marcar'} {search ? `filtrados (${filteredIds.length})` : `todos (${filteredIds.length})`}
            </button>
            <span className="text-muted-foreground">
              {filteredItems.length} de {items.length}
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-2 space-y-2 flex-1 overflow-y-auto min-h-0 bg-muted/5">
        {isLoading ? (
          <div className="py-8 text-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto mb-2" />
            <p className="text-[10px] text-muted-foreground">Carregando itens...</p>
          </div>
        ) : (items && items.length === 0) ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Nenhum item nesta carga
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            Nenhum item encontrado no filtro
          </p>
        ) : (
          (() => {
            // Agrupar por nota fiscal (invoice_number)
            const grouped = filteredItems.reduce((acc, item) => {
              const fd: any = Array.isArray(item.fiscal_documents) ? item.fiscal_documents[0] : (item.fiscal_documents || {});
              const invoice = fd?.invoice_number;
              const orderNum = item.orders?.order_number;
              const key = invoice ? `INV-${invoice}` : (orderNum ? `ORD-${orderNum}` : `ID-${item.id}`);
              
              if (!acc[key]) acc[key] = { items: [], totalValue: 0, invoice: invoice };
              acc[key].items.push(item);
              acc[key].totalValue += (fd?.value || 0);
              return acc;
            }, {} as Record<string, { items: LoadItem[], totalValue: number, invoice: string | null }>);

            return Object.entries(grouped).map(([key, group]: [string, any]) => {
              const allSelected = group.items.every(i => selectedItems.has(i.id));

              return (
                <div key={key} className="space-y-1 border rounded-md p-1.5 bg-muted/20">
                  <div className="flex items-center justify-between px-1 mb-1">
                    <div className="flex items-center gap-2">
                      {canSelect && (
                        <button 
                          onClick={() => onSelectMany?.(group.items.map(i => i.id), !allSelected)}
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          {allSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <span className="text-[9px] font-bold uppercase text-muted-foreground truncate flex-1 min-w-0">
                        {group.invoice ? `NF ${group.invoice}` : group.items[0]?.orders?.order_number ? `PED ${group.items[0].orders.order_number}` : 'Itens sem Doc'}
                      </span>
                    </div>
                    {group.totalValue > 0 && (
                      <span className="text-[9px] font-semibold text-primary bg-primary/5 px-1 py-0.5 rounded border border-primary/10 shrink-0">
                        R$ {group.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {group.items.map(item => {
                      const selected = selectedItems.has(item.id);
                      const fd: any = Array.isArray(item.fiscal_documents) ? item.fiscal_documents[0] : (item.fiscal_documents || {});
                      return (
                        <button
                          key={item.id}
                          onClick={() => onToggleItem(item.id)}
                          className={`w-full text-left rounded border p-2 text-xs transition-all ${
                            selected
                              ? 'bg-primary/10 border-primary/30 ring-1 ring-primary/20 shadow-sm'
                              : 'bg-card border-border/60 hover:bg-muted/50 hover:border-primary/20'
                          }`}
                        >
                        <div className="flex items-center gap-2">
                          <Package className={`h-3 w-3 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-primary truncate">
                                {item.item_description || 'Item sem descrição'}
                              </span>
                              {fd?.remitter && (
                                <Badge variant="outline" className="text-[9px] h-4 px-1 bg-muted/30 border-primary/20 text-primary/80 shrink-0">
                                  {fd.remitter.split(' ')[0]}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {selected && <CheckCircle className="h-3 w-3 text-primary shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground pl-5">
                          <span>Qtd: {item.quantity}</span>
                          {item.pallet_count > 0 && <span>• {item.pallet_count} PLT</span>}
                          {item.weight_kg > 0 && <span>• {item.weight_kg.toLocaleString('pt-BR')} kg</span>}
                          {fd?.recipient_city && (
                            <span className="truncate border-l border-muted-foreground/30 pl-2 ml-1">
                              {fd.recipient_city}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                    })}
                  </div>
                </div>
              );
            });
          })()
        )}
      </CardContent>
    </Card>
  );
}

export default function LoadReallocation() {
  const { data: loads = [], isLoading } = useLoads();
  const { data: vehicles = [] } = useVehicles();
  const updateLoad = useUpdateLoad();
  const deleteLoad = useDeleteLoad();
  const qc = useQueryClient();

  const [sourceLoadId, setSourceLoadId] = useState<string>('');
  const [targetLoadId, setTargetLoadId] = useState<string>('');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [history, setHistory] = useState<Array<{
    id: string; at: Date; kind: 'move' | 'swap';
    fromLabel: string; toLabel: string;
    items?: Array<{ desc: string; pallets: number; weight: number }>;
    vehicleSwap?: { fromPlate: string; toPlate: string };
    success: boolean; errorCount?: number;
  }>>([]);
  const [lastResult, setLastResult] = useState<{ moved: number; errors: number; targetLabel: string } | null>(null);

  // Only show active loads (not delivered)
  const activeLoads = useMemo(() =>
    loads.filter(l => !['delivered'].includes(l.status)),
    [loads]
  );

  const { data: sourceItems = [], isLoading: loadingSource } = useLoadItems(sourceLoadId || undefined);
  const { data: targetItems = [], isLoading: loadingTarget } = useLoadItems(targetLoadId || undefined);

  // Fetch aggregate metadata (client/city) for all active loads to allow
  // hierarchical grouping in the selectors: Client → City → Route → Load.
  const activeLoadIds = useMemo(() => activeLoads.map(l => l.id), [activeLoads]);
  const { data: allActiveItems = [] } = useQuery({
    queryKey: ['reallocation_load_meta', activeLoadIds.join(',')],
    enabled: activeLoadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('load_items')
        .select('load_id, order_id, orders(order_number), fiscal_documents(remitter, recipient, recipient_city, recipient_state, invoice_number)')
        .in('load_id', activeLoadIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const norm = (v?: string | null) => normalizeCity(v);

  // Predominant client / city per load id
  const loadMeta = useMemo(() => {
    const byLoad = new Map<string, { remitters: Map<string, number>; clients: Map<string, number>; cities: Map<string, number> }>();
    for (const row of allActiveItems) {
      const fd = Array.isArray(row.fiscal_documents) ? row.fiscal_documents[0] : (row.fiscal_documents || {});
      const rem = fd?.remitter as string | null;
      const rec = fd?.recipient as string | null;
      const city = fd?.recipient_city as string | null;
      const state = fd?.recipient_state as string | null;
      const bucket = byLoad.get(row.load_id) || { remitters: new Map(), clients: new Map(), cities: new Map() };
      if (rem) bucket.remitters.set(rem, (bucket.remitters.get(rem) || 0) + 1);
      if (rec) bucket.clients.set(rec, (bucket.clients.get(rec) || 0) + 1);
      if (city) {
        const label = state ? `${city}/${state}` : city;
        bucket.cities.set(label, (bucket.cities.get(label) || 0) + 1);
      }
      byLoad.set(row.load_id, bucket);
    }
    const pick = (m: Map<string, number>) => {
      let best: string | null = null; let bestN = 0;
      m.forEach((n, k) => { if (n > bestN) { bestN = n; best = k; } });
      return best;
    };
    const out = new Map<string, { remitter: string | null; client: string | null; city: string | null }>();
    byLoad.forEach((b, id) => out.set(id, { remitter: pick(b.remitters), client: pick(b.clients), city: pick(b.cities) }));
    return out;
  }, [allActiveItems]);

  // Hierarchical tree: Client → City → Route (destination) → loads
  type GroupNode = { label: string; loads: Load[] };
  const groupedLoads = useMemo(() => {
    const tree = new Map<string, Map<string, Map<string, Load[]>>>();
    for (const l of activeLoads) {
      const meta = loadMeta.get(l.id);
      const remitter = meta?.remitter ? `[FORN: ${meta.remitter}] ` : '';
      const client = meta?.client || 'Sem cliente identificado';
      const city = meta?.city || 'Sem cidade';
      const route = l.destination || 'Sem rota';
      const cKey = remitter + client;
      const cityKey = city;
      const rKey = route;
      let byCity = tree.get(cKey);
      if (!byCity) { byCity = new Map(); tree.set(cKey, byCity); }
      let byRoute = byCity.get(cityKey);
      if (!byRoute) { byRoute = new Map(); byCity.set(cityKey, byRoute); }
      let arr = byRoute.get(rKey);
      if (!arr) { arr = []; byRoute.set(rKey, arr); }
      arr.push(l);
    }
    // Flatten to ordered SelectGroup structure: [{ header, loads }]
    const groups: Array<{ header: string; loads: Load[] }> = [];
    const clients = Array.from(tree.keys()).sort((a, b) => norm(a).localeCompare(norm(b)));
    for (const c of clients) {
      const byCity = tree.get(c)!;
      const cities = Array.from(byCity.keys()).sort((a, b) => norm(a).localeCompare(norm(b)));
      for (const city of cities) {
        const byRoute = byCity.get(city)!;
        const routes = Array.from(byRoute.keys()).sort((a, b) => norm(a).localeCompare(norm(b)));
        for (const r of routes) {
          const ls = byRoute.get(r)!.slice().sort((a, b) => norm(a.load_number).localeCompare(norm(b.load_number)));
          
          // Extrai o nome do fornecedor da chave cKey ([FORN: Nome] Cliente) para não poluir o cabeçalho excessivamente
          const remitterMatch = c.match(/\[FORN: (.*?)\]/);
          const remitterName = remitterMatch ? remitterMatch[1] : null;
          const clientName = c.replace(/\[FORN: .*?\]\s*/, '');
          
          // Abrevia nomes muito longos no cabeçalho para evitar quebra de layout
          const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max) + '...' : s;
          const displayClient = truncate(clientName, 30);
          const displayRemitter = remitterName ? truncate(remitterName, 20) : null;

          const header = `${displayRemitter ? `${displayRemitter} → ` : ''}${displayClient} · ${city}${r && r !== city ? ` · ${r}` : ''}`;
          groups.push({ header, loads: ls });
        }
      }
    }
    return groups;
  }, [activeLoads, loadMeta]);

  const sourceLoad = activeLoads.find(l => l.id === sourceLoadId);
  const targetLoad = activeLoads.find(l => l.id === targetLoadId);

  const toggleItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMoveItems = async () => {
    if (!targetLoadId || selectedItems.size === 0) return;
    setMoving(true);
    let moved = 0;
    let errors = 0;
    const movedItems: Array<{ desc: string; pallets: number; weight: number }> = [];

    const itemIds = Array.from(selectedItems);
    for (const id of itemIds) {
      const item = sourceItems.find(i => i.id === id);
      if (item) movedItems.push({ desc: item.item_description, pallets: item.pallet_count || 0, weight: item.weight_kg || 0 });
    }
    try {
      const tenantId = (sourceLoad as any)?.tenant_id || (targetLoad as any)?.tenant_id;
      if (!tenantId) throw new Error('Tenant ID não encontrado');
      const { data, error } = await (supabase as any).rpc('move_load_items_between_loads', {
        _tenant_id: tenantId,
        _source_load_id: sourceLoadId,
        _target_load_id: targetLoadId,
        _item_ids: itemIds,
      });
      if (error) throw error;
      moved = (data && (data as any).moved) ?? itemIds.length;
    } catch (e: any) {
      errors = itemIds.length;
      toast.error(e?.message || 'Falha ao mover itens');
    }

    qc.invalidateQueries({ queryKey: ['load_items'] });
    qc.invalidateQueries({ queryKey: ['loads'] });
    qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    qc.invalidateQueries({ queryKey: ['reallocation_load_meta'] });

    const fromLabel = sourceLoad?.load_number || '—';
    const toLabel = targetLoad?.load_number || '—';

    // If all items were moved out of the source load, remove the empty load so it
    // doesn't keep showing in /loads with the same content.
    let sourceRemoved = false;
    if (errors === 0 && sourceLoadId) {
      try {
        const { count } = await (supabase as any)
          .from('load_items')
          .select('id', { count: 'exact', head: true })
          .eq('load_id', sourceLoadId);
        if ((count ?? 0) === 0) {
          await deleteLoad.mutateAsync(sourceLoadId);
          sourceRemoved = true;
          setSourceLoadId('');
        }
      } catch {
        // non-critical; load just stays empty
      }
    }

    // Merge source destination tokens into target so the consolidated load
    // shows the combined route (e.g. "PAI PEDRO - PIRAPORA - JAIBA").
    if (moved > 0 && targetLoad && sourceLoad) {
      const merged = mergeDestinations(targetLoad.destination, sourceLoad.destination);
      if (merged && merged !== targetLoad.destination) {
        try {
          await updateLoad.mutateAsync({ id: targetLoad.id, destination: merged } as any);
        } catch {
          // non-critical
        }
      }
    }

    setHistory(prev => [{
      id: crypto.randomUUID(),
      at: new Date(),
      kind: 'move' as const,
      fromLabel,
      toLabel,
      items: movedItems,
      success: errors === 0,
      errorCount: errors,
    }, ...prev].slice(0, 20));

    setLastResult({ moved, errors, targetLabel: toLabel });
    setSelectedItems(new Set());
    setMoving(false);

    if (errors > 0) {
      toast.error(`${moved} movidos, ${errors} erros`);
    } else {
      toast.success(
        sourceRemoved
          ? `${moved} item(ns) realocado(s) para ${toLabel}. Carga ${fromLabel} ficou vazia e foi removida.`
          : `${moved} item(ns) realocado(s) para ${toLabel}`,
      );
    }
  };

  const handleSwapVehicles = async () => {
    if (!sourceLoad || !targetLoad) return;
    try {
      const srcVehicle = sourceLoad.vehicle_id;
      const tgtVehicle = targetLoad.vehicle_id;
      const srcDriver = sourceLoad.driver_id;
      const tgtDriver = targetLoad.driver_id;
      const srcPlate = (vehicles as any[]).find(v => v.id === srcVehicle)?.plate || '—';
      const tgtPlate = (vehicles as any[]).find(v => v.id === tgtVehicle)?.plate || '—';

      await updateLoad.mutateAsync({ id: sourceLoad.id, vehicle_id: tgtVehicle, driver_id: tgtDriver } as any);
      await updateLoad.mutateAsync({ id: targetLoad.id, vehicle_id: srcVehicle, driver_id: srcDriver } as any);

      setHistory(prev => [{
        id: crypto.randomUUID(),
        at: new Date(),
        kind: 'swap' as const,
        fromLabel: sourceLoad.load_number,
        toLabel: targetLoad.load_number,
        vehicleSwap: { fromPlate: srcPlate, toPlate: tgtPlate },
        success: true,
      }, ...prev].slice(0, 20));

      toast.success('Veículos trocados entre as cargas');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const selectedCount = selectedItems.size;
  const selectedPallets = sourceItems.filter(i => selectedItems.has(i.id)).reduce((s, i) => s + (i.pallet_count || 0), 0);
  const selectedWeight = sourceItems.filter(i => selectedItems.has(i.id)).reduce((s, i) => s + (i.weight_kg || 0), 0);

  return (
    <div className="animate-fade-in space-y-5 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" /> Mover Cargas entre Veículos
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Transfira NF-es e itens de uma carga para outra (e assim mude qual veículo as transporta).
          </p>
        </div>
        <Link to="/route-planning">
          <Button variant="outline" size="sm" className="gap-2">
            <RouteIcon className="h-3.5 w-3.5" />
            Voltar para Roteirização
          </Button>
        </Link>
      </div>

      {/* Load selectors */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-end gap-2 md:gap-4 max-w-full">
        <div className="min-w-0">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Carga Origem</label>
          <Select value={sourceLoadId} onValueChange={v => { setSourceLoadId(v); setSelectedItems(new Set()); }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione a carga de origem..." />
            </SelectTrigger>
            <SelectContent className="max-h-[420px] w-[var(--radix-select-trigger-width)] md:w-[450px]">
              {groupedLoads.map((g, idx) => (
                <SelectGroup key={`src-${idx}`}>
                  <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 py-1.5 px-2 mb-1 sticky top-0 z-10">
                    {g.header}
                  </SelectLabel>
                  {g.loads.map(l => (
                    <SelectItem key={l.id} value={l.id} disabled={l.id === targetLoadId} className="pl-6 py-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-primary">
                            {l.load_number}
                          </span>
                          {l.vehicles && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 border-primary/20 bg-primary/5">
                              {l.vehicles.plate}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground leading-tight truncate">
                          {g.header}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden md:flex items-center justify-center mb-2">
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Carga Destino</label>
          <Select value={targetLoadId} onValueChange={setTargetLoadId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione a carga de destino..." />
            </SelectTrigger>
            <SelectContent className="max-h-[420px] w-[var(--radix-select-trigger-width)] md:w-[450px]">
              {groupedLoads.map((g, idx) => (
                <SelectGroup key={`tgt-${idx}`}>
                  <SelectLabel className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 py-1.5 px-2 mb-1 sticky top-0 z-10">
                    {g.header}
                  </SelectLabel>
                  {g.loads.map(l => (
                    <SelectItem key={l.id} value={l.id} disabled={l.id === sourceLoadId} className="pl-6 py-2">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-primary">
                            {l.load_number}
                          </span>
                          {l.vehicles && (
                            <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 border-primary/20 bg-primary/5">
                              {l.vehicles.plate}
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground leading-tight truncate">
                          {g.header}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Confirmation banner */}
      {lastResult && (
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${
          lastResult.errors > 0 ? 'bg-warning/10 border-warning/30' : 'bg-success/10 border-success/30'
        }`}>
          <CheckCircle className={`h-5 w-5 shrink-0 mt-0.5 ${lastResult.errors > 0 ? 'text-warning' : 'text-success'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {lastResult.errors > 0
                ? `${lastResult.moved} item(ns) movido(s), ${lastResult.errors} com erro`
                : `${lastResult.moved} item(ns) movido(s) com sucesso para ${lastResult.targetLabel}`}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              As capacidades das cargas e os totais foram atualizados. Veja o histórico abaixo para conferir.
            </p>
          </div>
          <button onClick={() => setLastResult(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Action bar — sempre visível */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border flex-wrap">
        {!sourceLoadId || !targetLoadId ? (
          <>
            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
            <span className="text-xs text-muted-foreground">
              Passo 1 — Selecione a <b>carga de origem</b> e a <b>carga de destino</b> nos campos acima.
            </span>
          </>
        ) : selectedCount === 0 ? (
          <>
            <Package className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">
              Passo 2 — Clique nos itens (NF-es) da carga origem que quer mover para <b>{targetLoad?.load_number}</b>.
            </span>
            <div className="flex-1" />
            <Button size="sm" disabled>
              <ArrowRightLeft className="h-3.5 w-3.5 mr-2" /> Mover (selecione itens)
            </Button>
          </>
        ) : (
          <>
            <Badge className="bg-primary/10 text-primary">{selectedCount} selecionado(s)</Badge>
            <span className="text-xs text-muted-foreground">
              {selectedPallets} pal · {selectedWeight.toLocaleString('pt-BR')} kg
            </span>
            <div className="flex-1" />
            <Button size="sm" onClick={handleMoveItems} disabled={moving}>
              {moving ? 'Movendo...' : `Mover para ${targetLoad?.load_number}`}
              <ArrowRightLeft className="h-3.5 w-3.5 ml-2" />
            </Button>
          </>
        )}
      </div>

      {/* Side by side loads */}
      {sourceLoadId && targetLoadId ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-[700px]">
          {sourceLoad && (
            loadingSource ? (
              <Card className="h-full">
                <CardContent className="py-16 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Carregando itens da origem...</p>
                </CardContent>
              </Card>
            ) : (
              <LoadColumn
                load={sourceLoad}
                items={sourceItems}
                isLoading={loadingSource}
                vehicles={vehicles as any[]}
                selectedItems={selectedItems}
                onToggleItem={toggleItem}
                onSelectMany={(ids, checked) => {
                  setSelectedItems(prev => {
                    const next = new Set(prev);
                    if (checked) ids.forEach(id => next.add(id));
                    else ids.forEach(id => next.delete(id));
                    return next;
                  });
                }}
              />
            )
          )}
          {targetLoad && (
            loadingTarget ? (
              <Card className="h-full">
                <CardContent className="py-16 text-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Carregando itens do destino...</p>
                </CardContent>
              </Card>
            ) : (
              <LoadColumn
                load={targetLoad}
                items={targetItems}
                isLoading={loadingTarget}
                vehicles={vehicles as any[]}
                selectedItems={new Set()}
                onToggleItem={() => {}}
                isTarget
              />
            )
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="py-16 text-center">
            <ArrowRightLeft className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Selecione uma carga de origem e destino para começar a realocar itens</p>
          </CardContent>
        </Card>
      )}

      {/* History panel */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Histórico desta sessão ({history.length})
            </CardTitle>
            <p className="text-[11px] text-muted-foreground">Movimentações feitas agora — confira se está tudo certo antes de sair</p>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
            {history.map(h => (
              <div key={h.id} className={`p-2.5 rounded-md border text-xs ${
                h.success ? 'bg-success/5 border-success/20' : 'bg-warning/5 border-warning/30'
              }`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <CheckCircle className={`h-3.5 w-3.5 shrink-0 ${h.success ? 'text-success' : 'text-warning'}`} />
                  {h.kind === 'move' ? (
                    <>
                      <Badge variant="outline" className="text-[10px]">{h.fromLabel}</Badge>
                      <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">{h.toLabel}</Badge>
                      <span className="text-muted-foreground">
                        {h.items?.length || 0} item(ns)
                        {h.errorCount && h.errorCount > 0 ? ` · ${h.errorCount} erro(s)` : ''}
                      </span>
                    </>
                  ) : (
                    <>
                      <Truck className="h-3.5 w-3.5 text-primary" />
                      <span className="font-medium">Troca de veículos:</span>
                      <Badge variant="outline" className="text-[10px]">{h.fromLabel} ↔ {h.toLabel}</Badge>
                      {h.vehicleSwap && (
                        <span className="text-muted-foreground">
                          {h.vehicleSwap.fromPlate} ↔ {h.vehicleSwap.toPlate}
                        </span>
                      )}
                    </>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {h.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                {h.kind === 'move' && h.items && h.items.length > 0 && (
                  <div className="mt-1.5 pl-5 space-y-0.5">
                    {h.items.slice(0, 5).map((it, i) => (
                      <div key={i} className="flex gap-3 text-[10px] text-muted-foreground">
                        <span className="truncate flex-1">{it.desc}</span>
                        {it.pallets > 0 && <span>{it.pallets} pal</span>}
                        {it.weight > 0 && <span>{it.weight.toLocaleString('pt-BR')} kg</span>}
                      </div>
                    ))}
                    {h.items.length > 5 && (
                      <div className="text-[10px] text-muted-foreground">+ {h.items.length - 5} mais</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
