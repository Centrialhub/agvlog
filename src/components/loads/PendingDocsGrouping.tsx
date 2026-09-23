import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useVehicles } from '@/hooks/useVehicles';
import { useDrivers } from '@/hooks/useDrivers';
import { useOperationalRoutes } from '@/hooks/useOperationalRoutes';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { FileStack, MapPin, Truck, CheckCircle, Loader2, User, UserX } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { getErrorMessage } from '@/lib/errors';
import { matchOperationalRoute } from '@/lib/routes/matchOperationalRoute';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import type { LoadHeaderChanges } from '@/lib/loads/loadAggregateCommands';
import { useLoadCreation } from '@/hooks/useLoadCreation';
import { suggestGroupDrivers, suggestGroupVehicles } from '@/lib/loads/groupAssignments';

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
  ambiguousCities?: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}

export default function PendingDocsGrouping({ open, onOpenChange, onCreated }: Props) {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { data: vehicles = [] } = useVehicles();
  const { data: operationalRoutes = [] } = useOperationalRoutes();
  const queryClient = useQueryClient();
  const creation = useLoadCreation('grouped');
  const manualDrivers = useRef(new Set<string>());

  const [executing, setExecuting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [vehicleAssignments, setVehicleAssignments] = useState<Map<string, string>>(new Map());
  const [driverAssignments, setDriverAssignments] = useState<Map<string, string>>(new Map());
  const initialSelectionApplied = useRef(false);

  const { data: drivers = [] } = useDrivers({ enabled: open });

  const { data: pendingDocs = [], isLoading } = useQuery({
    queryKey: ['pending_fiscal_docs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages((from, to) => supabase.from('fiscal_documents')
        .select('id, invoice_number, recipient, recipient_city, recipient_state, pallet_count, weight_kg, value, created_at, clients!fiscal_documents_client_id_fkey(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'confirmed')
        .eq('document_type', 'inbound')
        .is('load_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }).order('id')
        .range(from, to)) as Promise<PendingDoc[]>;
    },
    enabled: !!currentTenant && open,
  });

  // Group docs by operational route
  const groups = useMemo(() => {
    const routeRefs = operationalRoutes.map(r => ({
      id: r.id,
      name: r.name,
      destinations: Array.isArray(r.destinations)
        ? r.destinations.map(destination => ({ name: typeof destination === 'string' ? destination : destination.name || '' }))
        : [],
    }));

    const groupMap = new Map<string, RouteGroup>();

    for (const doc of pendingDocs) {
      const city = doc.recipient_city || '';
      const { matched: matchedRoute, ambiguous } = matchOperationalRoute(city, routeRefs);

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
          ambiguousCities: [],
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
      if (ambiguous && city && !group.ambiguousCities!.includes(city)) {
        group.ambiguousCities!.push(city);
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.totalPallets - a.totalPallets);
  }, [pendingDocs, operationalRoutes]);

  useEffect(() => {
    setVehicleAssignments(new Map()); setDriverAssignments(new Map()); manualDrivers.current.clear();
    initialSelectionApplied.current = false; setSelectedGroups(new Set());
  }, [currentTenant?.id]);

  // Auto-select only once per dialog opening; an explicit empty selection is preserved.
  useEffect(() => {
    if (!open) {
      initialSelectionApplied.current = false;
      setSelectedGroups(new Set());
    } else if (!initialSelectionApplied.current && groups.length > 0) {
      setSelectedGroups(new Set(groups.map(g => g.routeName)));
      initialSelectionApplied.current = true;
    }
  }, [groups, open]);

  // Suggestions fill untouched choices only; explicit empty selections survive.
  useEffect(() => {
    setVehicleAssignments(previous => suggestGroupVehicles(groups, vehicles, previous));
  }, [vehicles, groups]);

  // Auto-suggest driver based on vehicle assignment
  useEffect(() => {
    setDriverAssignments(previous => suggestGroupDrivers(groups, vehicles, drivers, vehicleAssignments, previous, manualDrivers.current));
  }, [vehicleAssignments, drivers, groups, vehicles]);

  const refreshLoads = () => {
    for (const key of ['loads', 'fiscal_documents', 'pending_fiscal_docs', 'load_items', 'pending_docs_count', 'new_load_available_fiscal_docs']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    onCreated();
  };
  const handleRecover = async (scope: string) => {
    try {
      const result = await creation.recover(scope);
      toast.success(`Carga ${result.load.load_number} confirmada (${result.document_count} notas).`);
    } catch (error) { toast.error(getErrorMessage(error, 'Não foi possível confirmar a carga.')); }
    finally { refreshLoads(); }
  };

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
    const overCapacity = selected.find(group => {
      const vehicle = vehicles.find(candidate => candidate.id === vehicleAssignments.get(group.routeName));
      return vehicle?.max_pallets != null && vehicle.max_pallets > 0 && group.totalPallets > vehicle.max_pallets;
    });
    if (overCapacity) {
      toast.error(`${overCapacity.routeName} excede a capacidade de paletes do veículo selecionado.`);
      return;
    }

    setExecuting(true);
    let created = 0;
    let errors = 0;

    try {
      const errorMessages: string[] = [];

      for (const group of selected) {
        try {
          const vehicleId = vehicleAssignments.get(group.routeName) || null;
          const driverId = driverAssignments.get(group.routeName) || null;
          const docIds = group.docs.map(d => d.id);
          await creation.submit(group.routeName, {
              changes: {
                destination: group.routeName,
                vehicle_id: vehicleId,
                driver_id: driverId,
              } satisfies LoadHeaderChanges,
              document_ids: docIds,
          });

          created++;
        } catch (error: unknown) {
          errors++;
          errorMessages.push(`${group.routeName}: ${getErrorMessage(error, 'falha ao criar carga')}`);
        }
      }

      refreshLoads();

      if (errors > 0) {
        toast.error(`${created} carga(s) criada(s), ${errors} erro(s)`, {
          description: errorMessages.slice(0, 2).join(' | '),
        });
      } else {
        toast.success(`${created} carga(s) criada(s)`);
        onOpenChange(false);
      }
    } finally {
      setExecuting(false);
    }
  };

  const getOccupancy = (group: RouteGroup) => {
    const vId = vehicleAssignments.get(group.routeName);
    const vehicle = vId ? vehicles.find(candidate => candidate.id === vId) : null;
    if (!vehicle || !vehicle.max_pallets) return null;
    const pct = Math.round((group.totalPallets / vehicle.max_pallets) * 100);
    return { pct, vehicle };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        {creation.error && <p role="alert" className="text-sm text-destructive">{creation.error}</p>}
        {creation.pending.map(pending => <div key={pending.scope} className="flex items-center justify-between gap-3 rounded border p-3 text-sm">
          <span>{pending.scope}: criação sem confirmação.</span>
          <Button disabled={creation.isPending || executing} onClick={() => void handleRecover(pending.scope)}>Recuperar criação</Button>
        </div>)}
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
                        disabled={executing || creation.isPending}
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
                          {g.ambiguousCities && g.ambiguousCities.length > 0 && (
                            <Badge variant="outline" className="text-[10px] border-warning/40 text-warning" title={`Cidades cobertas por >1 rota ativa: ${g.ambiguousCities.join(', ')}. Revise antes de confirmar.`}>
                              Rota ambígua ({g.ambiguousCities.length})
                            </Badge>
                          )}
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
                          disabled={executing || creation.isPending}
                          value={vehicleAssignments.get(g.routeName) || '__none__'}
                          onValueChange={v => setVehicleAssignments(prev => {
                            const next = new Map(prev);
                            next.set(g.routeName, v === '__none__' ? '' : v);
                            return next;
                          })}
                        >
                          <SelectTrigger className="w-[140px] h-8 text-xs">
                            <SelectValue placeholder="Veículo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {vehicles.map(vehicle => (
                              <SelectItem key={vehicle.id} value={vehicle.id}>
                                <div className="flex items-center gap-1">
                                  <Truck className="h-3 w-3 shrink-0" />
                                  <span>{vehicle.plate}</span>
                                  {vehicle.max_pallets && <span className="text-muted-foreground">({vehicle.max_pallets}p)</span>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Select
                          disabled={executing || creation.isPending}
                          value={driverAssignments.get(g.routeName) || '__none__'}
                          onValueChange={v => { manualDrivers.current.add(g.routeName); setDriverAssignments(prev => {
                            const next = new Map(prev);
                            next.set(g.routeName, v === '__none__' ? '' : v);
                            return next;
                          }); }}
                        >
                          <SelectTrigger className="w-[160px] h-8 text-xs">
                            <SelectValue placeholder="Motorista" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem motorista</SelectItem>
                            {drivers.map(driver => (
                              <SelectItem key={driver.id} value={driver.id}>
                                <div className="flex items-center gap-1">
                                  {driver.user_id ? <User className="h-3 w-3 shrink-0" /> : <UserX className="h-3 w-3 shrink-0 text-warning" />}
                                  <span>{driver.name}</span>
                                  {!driver.user_id && <span className="text-warning text-[9px]">(sem app)</span>}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {occ ? (
                          <div className="w-20 text-center">
                            <Progress aria-label="Ocupação do agrupamento" aria-valuetext={`${occ.pct}%`} value={Math.min(occ.pct, 100)} className={`h-1.5 ${occ.pct > 100 ? '[&>div]:bg-destructive' : occ.pct < 50 ? '[&>div]:bg-warning' : ''}`} />
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
              <Button onClick={handleExecute} disabled={executing || creation.isPending || !!creation.error || creation.pending.length > 0 || selectedGroups.size === 0 || groups.some(group => {
                if (!selectedGroups.has(group.routeName)) return false;
                const vehicle = vehicles.find(candidate => candidate.id === vehicleAssignments.get(group.routeName));
                return vehicle?.max_pallets != null && vehicle.max_pallets > 0 && group.totalPallets > vehicle.max_pallets;
              })}>
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
