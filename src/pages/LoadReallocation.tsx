import { useState, useMemo } from 'react';
import { useLoads, Load } from '@/hooks/useLoads';
import { useLoadItems, LoadItem, useUpdateLoadItem } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useUpdateLoad, useDeleteLoad } from '@/hooks/useLoads';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRightLeft, Truck, Package, AlertTriangle, CheckCircle, ChevronRight, History, X, ExternalLink, Route as RouteIcon, Search, CheckSquare, Square } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

type FilterField = 'all' | 'remitter' | 'recipient' | 'city' | 'invoice';

function LoadColumn({ load, items, vehicles, selectedItems, onToggleItem, onSelectMany, isTarget }: {
  load: Load;
  items: LoadItem[];
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
      const fd: any = i.fiscal_documents || {};
      const desc = (i.item_description || '').toLowerCase();
      const remitter = (fd.remitter || '').toLowerCase();
      const recipient = (fd.recipient || '').toLowerCase();
      const city = (fd.recipient_city || '').toLowerCase();
      const invoice = (fd.invoice_number || '').toLowerCase();
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

  return (
    <Card className={`flex-1 min-w-0 ${isTarget ? 'ring-2 ring-primary/30' : ''}`}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold truncate">{load.load_number}</CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className="text-[10px]">{load.destination || 'Sem destino'}</Badge>
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
      <CardContent className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
        {filteredItems.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {items.length === 0 ? 'Nenhum item nesta carga' : 'Nenhum item encontrado'}
          </p>
        ) : filteredItems.map(item => {
          const selected = selectedItems.has(item.id);
          const fd: any = item.fiscal_documents || {};
          return (
            <button
              key={item.id}
              onClick={() => onToggleItem(item.id)}
              className={`w-full text-left rounded-md border p-2 text-xs transition-colors ${
                selected
                  ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/20'
                  : 'bg-card border-border hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Package className={`h-3 w-3 shrink-0 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className="flex-1 truncate font-medium">{item.item_description}</span>
                {selected && <CheckCircle className="h-3 w-3 text-primary shrink-0" />}
              </div>
              <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground pl-5 flex-wrap">
                {item.pallet_count > 0 && <span>{item.pallet_count} pal</span>}
                {item.weight_kg > 0 && <span>{item.weight_kg.toLocaleString('pt-BR')} kg</span>}
                {item.quantity > 0 && <span>{item.quantity} un</span>}
                {fd.invoice_number && <span>NF {fd.invoice_number}</span>}
                {fd.recipient_city && <span>{fd.recipient_city}{fd.recipient_state ? `/${fd.recipient_state}` : ''}</span>}
              </div>
            </button>
          );
        })}
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

  const { data: sourceItems = [] } = useLoadItems(sourceLoadId || undefined);
  const { data: targetItems = [] } = useLoadItems(targetLoadId || undefined);

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

    for (const itemId of selectedItems) {
      const item = sourceItems.find(i => i.id === itemId);
      try {
        const { error } = await (supabase as any)
          .from('load_items')
          .update({ load_id: targetLoadId, updated_at: new Date().toISOString() })
          .eq('id', itemId);
        if (error) throw error;
        moved++;
        if (item) movedItems.push({ desc: item.item_description, pallets: item.pallet_count || 0, weight: item.weight_kg || 0 });
      } catch {
        errors++;
      }
    }

    qc.invalidateQueries({ queryKey: ['load_items'] });
    qc.invalidateQueries({ queryKey: ['loads'] });

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
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Carga Origem</label>
          <Select value={sourceLoadId} onValueChange={v => { setSourceLoadId(v); setSelectedItems(new Set()); }}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a carga de origem..." />
            </SelectTrigger>
            <SelectContent>
              {activeLoads.map(l => (
                <SelectItem key={l.id} value={l.id} disabled={l.id === targetLoadId}>
                  {l.load_number} — {l.destination || 'Sem destino'}
                  {l.vehicles ? ` (${l.vehicles.plate})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ChevronRight className="h-5 w-5 text-muted-foreground mb-2" />

        <div className="flex-1">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Carga Destino</label>
          <Select value={targetLoadId} onValueChange={setTargetLoadId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione a carga de destino..." />
            </SelectTrigger>
            <SelectContent>
              {activeLoads.map(l => (
                <SelectItem key={l.id} value={l.id} disabled={l.id === sourceLoadId}>
                  {l.load_number} — {l.destination || 'Sem destino'}
                  {l.vehicles ? ` (${l.vehicles.plate})` : ''}
                </SelectItem>
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
        <div className="flex gap-4">
          {sourceLoad && (
            <LoadColumn
              load={sourceLoad}
              items={sourceItems}
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
          )}
          {targetLoad && (
            <LoadColumn
              load={targetLoad}
              items={targetItems}
              vehicles={vehicles as any[]}
              selectedItems={new Set()}
              onToggleItem={() => {}}
              isTarget
            />
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
