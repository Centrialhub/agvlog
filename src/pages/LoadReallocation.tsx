import { useState, useMemo } from 'react';
import { useLoads, Load } from '@/hooks/useLoads';
import { useLoadItems, LoadItem, useUpdateLoadItem } from '@/hooks/useLoadItems';
import { useVehicles } from '@/hooks/useVehicles';
import { useUpdateLoad } from '@/hooks/useLoads';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowRightLeft, Truck, Package, AlertTriangle, CheckCircle, ChevronRight, History, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

function LoadColumn({ load, items, vehicles, selectedItems, onToggleItem, isTarget }: {
  load: Load;
  items: LoadItem[];
  vehicles: any[];
  selectedItems: Set<string>;
  onToggleItem: (id: string) => void;
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

  return (
    <Card className={`flex-1 min-w-0 ${isTarget ? 'ring-2 ring-primary/30' : ''}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold truncate">{load.load_number}</CardTitle>
          <Badge variant="outline" className="text-[10px] shrink-0">{load.destination || 'Sem destino'}</Badge>
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
      </CardHeader>
      <CardContent className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">Nenhum item nesta carga</p>
        ) : items.map(item => {
          const selected = selectedItems.has(item.id);
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
              <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground pl-5">
                {item.pallet_count > 0 && <span>{item.pallet_count} pal</span>}
                {item.weight_kg > 0 && <span>{item.weight_kg.toLocaleString('pt-BR')} kg</span>}
                {item.quantity > 0 && <span>{item.quantity} un</span>}
                {item.fiscal_documents?.invoice_number && <span>NF {item.fiscal_documents.invoice_number}</span>}
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
      toast.success(`${moved} item(ns) realocado(s) para ${toLabel}`);
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
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" /> Realocação de Cargas
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Mova NF-es e itens entre cargas. Troque veículos quando necessário.
        </p>
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

      {sourceLoadId && targetLoadId && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border">
          {selectedCount > 0 ? (
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
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">Clique nos itens da carga origem para selecionar e mover</span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={handleSwapVehicles}>
                <Truck className="h-3.5 w-3.5 mr-2" /> Trocar Veículos
              </Button>
            </>
          )}
        </div>
      )}

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
    </div>
  );
}
