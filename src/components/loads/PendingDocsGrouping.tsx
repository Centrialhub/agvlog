import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useVehicles } from '@/hooks/useVehicles';
import { useOperationalRoutes } from '@/hooks/useOperationalRoutes';
import { useCreateLoad } from '@/hooks/useLoads';
import { useCreateLoadItem } from '@/hooks/useLoadItems';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { FileStack, MapPin, Truck, CheckCircle, Loader2, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';

interface PendingDoc {
  id: string;
  invoice_number: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  created_at: string;
  clients?: { company_name: string } | null;
}

interface RouteGroup {
  routeId: string | null;
  routeName: string;
  docs: PendingDoc[];
  totalPallets: number;
  totalWeight: number;
  totalValue: number;
  cities: string[];
}

function normalizeCity(city: string): string {
  return city
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .trim();
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

export default function PendingDocsGrouping({ open, onOpenChange, onCreated }: Props) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const { data: operationalRoutes = [] } = useOperationalRoutes();
  const createLoad = useCreateLoad();
  const createLoadItem = useCreateLoadItem();
  const queryClient = useQueryClient();

  const [executing, setExecuting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [vehicleAssignments, setVehicleAssignments] = useState<Map<string, string>>(new Map());

  const { data: pendingDocs = [], isLoading } = useQuery({
    queryKey: ['pending_fiscal_docs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, recipient, recipient_city, recipient_state, pallet_count, weight_kg, value, created_at, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'confirmed')
        .eq('document_type', 'inbound')
        .is('load_id', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as PendingDoc[];
    },
    enabled: !!currentTenant && open,
  });

  // Group docs by operational route
  const groups = useMemo(() => {
    const routeRefs = operationalRoutes.map(r => ({
      id: r.id,
      name: r.name,
      destinations: Array.isArray(r.destinations)
        ? r.destinations.map((d: any) => ({ name: typeof d === 'string' ? d : d.name || '' }))
        : [],
    }));

    const groupMap = new Map<string, RouteGroup>();

    for (const doc of pendingDocs) {
      const city = doc.recipient_city || '';
      const normalized = normalizeCity(city);

      let matchedRoute: typeof routeRefs[0] | null = null;
      for (const route of routeRefs) {
        for (const dest of route.destinations) {
          const nd = normalizeCity(dest.name);
          if (nd === normalized || normalized.includes(nd) || nd.includes(normalized)) {
            matchedRoute = route;
            break;
          }
        }
        if (matchedRoute) break;
      }

      const key = matchedRoute ? matchedRoute.name : (city ? `${doc.recipient_state || ''} - ${city}` : 'Sem região');
      
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          routeId: matchedRoute?.id || null,
          routeName: key,
          docs: [],
          totalPallets: 0,
          totalWeight: 0,
          totalValue: 0,
          cities: [],
        });
      }

      const group = groupMap.get(key)!;
      group.docs.push(doc);
      group.totalPallets += doc.pallet_count || 0;
      group.totalWeight += Number(doc.weight_kg) || 0;
      group.totalValue += Number(doc.value) || 0;
      if (city && !group.cities.includes(city)) {
        group.cities.push(city);
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.totalPallets - a.totalPallets);
  }, [pendingDocs, operationalRoutes]);

  // Auto-select all groups on load
  useEffect(() => {
    if (groups.length > 0 && selectedGroups.size === 0) {
      setSelectedGroups(new Set(groups.map(g => g.routeName)));
    }
  }, [groups]);

  // Auto-suggest vehicles
  const vehiclesWithCapacity = useMemo(() => vehicles.filter((v: any) => (v.max_pallets || 0) > 0), [vehicles]);

  useEffect(() => {
    if (vehiclesWithCapacity.length === 0 || groups.length === 0) return;
    const newMap = new Map<string, string>();
    const used = new Set<string>();
    const sorted = [...groups].sort((a, b) => b.totalPallets - a.totalPallets);
    for (const g of sorted) {
      const best = vehiclesWithCapacity
        .filter((v: any) => !used.has(v.id))
        .filter((v: any) => (v.max_pallets || 0) >= g.totalPallets)
        .sort((a: any, b: any) => (a.max_pallets || 0) - (b.max_pallets || 0))[0] as any;
      if (best) {
        used.add(best.id);
        newMap.set(g.routeName, best.id);
      }
    }
    setVehicleAssignments(newMap);
  }, [vehiclesWithCapacity, groups]);

  const toggleGroup = (name: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleExecute = async () => {
    const selected = groups.filter(g => selectedGroups.has(g.routeName));
    if (selected.length === 0) return;

    setExecuting(true);
    let created = 0;
    let errors = 0;

    try {
      for (const group of selected) {
        try {
          const loadNumber = `CG-${Date.now().toString(36).toUpperCase()}-${group.routeName.substring(0, 8).toUpperCase().replace(/\s/g, '')}`;
          const vehicleId = vehicleAssignments.get(group.routeName) || null;

          const createdLoad = await createLoad.mutateAsync({
            load_number: loadNumber,
            destination: group.routeName,
            vehicle_id: vehicleId,
            status: 'planned',
          } as any);

          // Create load_items for each doc
          for (const doc of group.docs) {
            await createLoadItem.mutateAsync({
              load_id: createdLoad.id,
              fiscal_document_id: doc.id,
              item_description: `NF ${doc.invoice_number || '—'} - ${doc.recipient || 'Sem dest.'}`,
              quantity: 1,
              pallet_count: doc.pallet_count || 0,
              weight_kg: Number(doc.weight_kg) || 0,
            } as any);

            // Link doc to load
            await supabase.from('fiscal_documents')
              .update({ load_id: createdLoad.id } as any)
              .eq('id', doc.id);
          }

          created++;
        } catch {
          errors++;
        }
      }

      queryClient.invalidateQueries({ queryKey: ['loads'] });
      queryClient.invalidateQueries({ queryKey: ['fiscal_documents'] });
      queryClient.invalidateQueries({ queryKey: ['pending_fiscal_docs'] });
      queryClient.invalidateQueries({ queryKey: ['load_items'] });

      toast.success(`${created} carga(s) criada(s)${errors > 0 ? `, ${errors} erro(s)` : ''}`);
      onCreated();
      onOpenChange(false);
    } finally {
      setExecuting(false);
    }
  };

  const getOccupancy = (group: RouteGroup) => {
    const vId = vehicleAssignments.get(group.routeName);
    const vehicle = vId ? (vehicles as any[]).find(v => v.id === vId) : null;
    if (!vehicle || !vehicle.max_pallets) return null;
    const pct = Math.round((group.totalPallets / vehicle.max_pallets) * 100);
    return { pct, vehicle };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileStack className="h-5 w-5 text-primary" />
            Agrupar NF-es Pendentes em Cargas
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando NF-es pendentes...</div>
        ) : pendingDocs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nenhuma NF-e pendente (sem carga vinculada).
            <br />
            <span className="text-xs">Importe XMLs pela página de Importação usando "Salvar NF-es apenas".</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline">{pendingDocs.length} NF-es pendentes</Badge>
              <Badge variant="outline">{groups.length} rotas identificadas</Badge>
              <Badge variant="outline">{selectedGroups.size} selecionadas</Badge>
            </div>

            {groups.map(g => {
              const selected = selectedGroups.has(g.routeName);
              const occ = getOccupancy(g);
              const isOver = occ && occ.pct > 100;

              return (
                <Card key={g.routeName} className={`transition-all ${selected ? '' : 'opacity-50'} ${isOver ? 'border-destructive/30' : ''}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleGroup(g.routeName)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className={g.routeId ? 'bg-primary/10 text-primary border-primary/20 gap-1' : 'bg-warning/10 text-warning border-warning/20 gap-1'}>
                            <MapPin className="h-3 w-3" />
                            {g.routeName}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">{g.docs.length} NF-es</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {g.cities.map((city, ci) => (
                            <span key={ci} className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{city}</span>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{g.totalPallets} paletes</span>
                          {g.totalWeight > 0 && <span>{g.totalWeight.toLocaleString('pt-BR')} kg</span>}
                          {g.totalValue > 0 && <span>R$ {g.totalValue.toLocaleString('pt-BR')}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <Select
                          value={vehicleAssignments.get(g.routeName) || '__none__'}
                          onValueChange={v => setVehicleAssignments(prev => {
                            const next = new Map(prev);
                            if (v === '__none__') next.delete(g.routeName);
                            else next.set(g.routeName, v);
                            return next;
                          })}
                        >
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue placeholder="Veículo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {(vehicles as any[]).map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                <div className="flex items-center gap-1">
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span>{v.plate}</span>
                                  {v.max_pallets && <span className="text-muted-foreground">({v.max_pallets}p)</span>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {occ ? (
                          <div className="w-20 text-center">
                            <Progress value={Math.min(occ.pct, 100)} className={`h-1.5 ${occ.pct > 100 ? '[&>div]:bg-destructive' : occ.pct < 50 ? '[&>div]:bg-warning' : ''}`} />
                            <span className={`text-[9px] ${occ.pct > 100 ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                              {occ.pct}%
                            </span>
                          </div>
                        ) : (
                          <div className="w-20 text-center text-[10px] text-muted-foreground">—</div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleExecute} disabled={executing || selectedGroups.size === 0}>
                {executing ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando...</>
                ) : (
                  <><CheckCircle className="h-4 w-4 mr-2" /> Criar {selectedGroups.size} Carga(s)</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
