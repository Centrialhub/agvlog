import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import {
  Route, Plus, Wand2, Trash2,
  PackageCheck, ChevronDown, ChevronUp,
  Send, Download, ListOrdered, Sparkles, Bot, Rocket, Printer,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { printRomaneioRoutes, RomaneioDoc } from '@/lib/romaneioPrint';
import StopDraftTable from '@/components/route-planning/StopDraftTable';
import DispatchRecoveryPanel from '@/components/route-planning/DispatchRecoveryPanel';
import RouteValidationPanel from '@/components/route-planning/RouteValidationPanel';
import { consolidateLoadsIntoStops } from '@/lib/route-planning/stopConsolidation';
import { routeStopOrder } from '@/lib/route-planning/routeStopOrder';
import { applySmartSequence, applyOriginalOrder, autoSequenceStops } from '@/lib/route-planning/simpleStopSequencing';
import { simulateStopTimeline } from '@/lib/route-planning/timelineSimulation';
import { regenerateStopsPreservingEdits } from '@/lib/route-planning/regenerateStops';
import { generateAutomaticRoutePlans, defaultPlannedStartAt } from '@/lib/route-planning/autoRoutePlanner';
import { useOperationalRoutes } from '@/hooks/useOperationalRoutes';
import { useCustomerDeliveryWindowsForRouting } from '@/hooks/route-planning/useCustomerDeliveryWindowsForRouting';
import { useDispatchRoutePlan } from '@/hooks/route-planning/useDispatchRoutePlan';
import { useRoutePlanAutosave } from '@/hooks/route-planning/useRoutePlanAutosave';
import { validateRouteConsistency } from '@/lib/route-planning/routeConsistency';
import { computeRouteStatus, STATUS_VISUALS, type RoutePlanStatusExt } from '@/lib/route-planning/routeStatus';
import { useRoutePlanningDrafts, useSavePlanSnapshot, useDeleteDraft, type RoutePlanSnapshot } from '@/hooks/useRoutePlanningDrafts';
import type { RouteStopDraft, RoutePlanValidationIssue, RouteStopSortMode } from '@/lib/route-planning/routePlanningTypes';
import { normalizeCity } from '@/lib/utils/normalizeCity';
import type { Json } from '@/integrations/supabase/types';
import { getErrorMessage } from '@/lib/errors';

/* ────────────── types ────────────── */
const recipientCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });

const getLoadRecipient = (load: PendingLoad) => load.items[0]?.fiscal_documents?.recipient || load.destination || load.load_number || '';

const sortLoadsByRecipient = (loads: PendingLoad[]) => [...loads].sort((a, b) =>
  recipientCollator.compare(getLoadRecipient(a), getLoadRecipient(b)) ||
  recipientCollator.compare(a.load_number, b.load_number)
);

const sortItemsByRecipient = (items: LoadItem[]) => [...items].sort((a, b) =>
  recipientCollator.compare(a.fiscal_documents?.recipient || '—', b.fiscal_documents?.recipient || '—') ||
  recipientCollator.compare(a.fiscal_documents?.invoice_number || '—', b.fiscal_documents?.invoice_number || '—')
);

interface LoadItem {
  id: string;
  load_id: string;
  item_description: string;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  fiscal_document_id: string | null;
  fiscal_documents?: {
    invoice_number: string | null;
    remitter: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    recipient_neighborhood: string | null;
    client_id?: string | null;
    value: number | null;
    weight_kg: number | null;
    issue_date: string | null;
  } | null;
}

interface PendingLoad {
  id: string;
  load_number: string;
  destination: string | null;
  total_weight_kg: number | null;
  total_volume_m3: number | null;
  total_pallet_count: number | null;
  status: string;
  created_at: string;
  notes: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  items: LoadItem[];
}

interface RoutePlan {
  id: string;
  name: string;
  loads: PendingLoad[];
  vehicle_id?: string;
  driver_id?: string;
  planned_start_at?: string;
  notes?: string;
  collapsed?: boolean;
  stops?: RouteStopDraft[];
  sortMode?: RouteStopSortMode;
  /** Minutos de deslocamento do depósito/origem até a 1ª parada (heurística). */
  initial_transit_minutes?: number;
  /** Marca rota cujas cargas mudaram após a geração de paradas — bloqueia despacho até recalcular. */
  dirty?: boolean;
  /** Estado transitório de despacho. */
  dispatching?: boolean;
  /** Última tentativa de despacho falhou (mensagem). */
  lastDispatchError?: string;
}

const routeSnapshot = (value: Json | null): RoutePlanSnapshot =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as unknown as RoutePlanSnapshot
    : {};

/* ────────────── main component ────────────── */
/** If all selected loads share the same vehicle_id / driver_id, inherit those
 *  into the newly-created route plan. Empty when loads disagree — the user
 *  still gets to pick manually. */
function inheritAssignmentFromLoads(loads: Array<{ vehicle_id?: string | null; driver_id?: string | null }>) {
  const vehicleIds = new Set(loads.map(l => l.vehicle_id || undefined).filter(Boolean) as string[]);
  const driverIds = new Set(loads.map(l => l.driver_id || undefined).filter(Boolean) as string[]);
  return {
    vehicle_id: vehicleIds.size === 1 ? Array.from(vehicleIds)[0] : undefined,
    driver_id: driverIds.size === 1 ? Array.from(driverIds)[0] : undefined,
  };
}

export default function RoutePlanning() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { data: vehicles = [] } = useVehicles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dispatchPlan = useDispatchRoutePlan();
  const { data: operationalRoutes = [] } = useOperationalRoutes();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_routing', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('drivers')
        .select('id, name, active, current_vehicle_id')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Cargas pendentes (planned, sem trip vinculada)
  const { data: pendingLoads = [], isLoading } = useQuery({
    queryKey: ['pending_loads_for_routing', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data: loads, error } = await supabase.from('loads')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'planned')
        .is('trip_id', null)
        .eq('on_hold', false)
        .order('destination', { ascending: true });
      if (error) throw error;
      if (!loads || loads.length === 0) return [];

      // Buscar items com NF-es para cada carga
      const loadIds = loads.map(load => load.id);
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, client_id, value, weight_kg, issue_date)')
        .in('load_id', loadIds)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const itemsByLoad: Record<string, LoadItem[]> = {};
      (items || []).forEach((item) => {
        if (!itemsByLoad[item.load_id]) itemsByLoad[item.load_id] = [];
        itemsByLoad[item.load_id].push({
          ...item,
          pallet_count: item.pallet_count ?? 0,
          weight_kg: item.weight_kg ?? 0,
          volume_m3: item.volume_m3 ?? 0,
        });
      });

      return loads.map((load) => ({
        ...load,
        items: itemsByLoad[load.id] || [],
      })) as PendingLoad[];
    },
    enabled: !!currentTenant,
  });

  const [routes, setRoutes] = useState<RoutePlan[]>([]);
  const [selectedLoads, setSelectedLoads] = useState<Set<string>>(new Set());
  const [filterDest, setFilterDest] = useState('all');
  const [newRouteName, setNewRouteName] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [globalStartAt, setGlobalStartAt] = useState<string>(() => defaultPlannedStartAt());
  const { data: persistedDrafts = [] } = useRoutePlanningDrafts();
  const savePlanSnapshot = useSavePlanSnapshot();
  const deleteDraft = useDeleteDraft();
  const draftsHydratedRef = useRef(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  // Carrega janelas dos clientes presentes nas paradas
  const clientIdsInRoutes = useMemo(() => {
    const ids = new Set<string>();
    routes.forEach(r => (r.stops || []).forEach(s => { if (s.client_id) ids.add(s.client_id); }));
    return Array.from(ids);
  }, [routes]);
  const { data: customerWindows = [] } = useCustomerDeliveryWindowsForRouting(clientIdsInRoutes);

  const assignedLoadIds = useMemo(
    () => new Set(routes.flatMap(r => r.loads.map(l => l.id))),
    [routes]
  );

  // ──── Hidratar drafts persistidos (uma vez quando pendingLoads chega) ────
  useEffect(() => {
    if (draftsHydratedRef.current) return;
    if (!pendingLoads || pendingLoads.length === 0) return;
    if (persistedDrafts.length === 0) { draftsHydratedRef.current = true; return; }
    const loadById = new Map(pendingLoads.map(l => [l.id, l] as const));
    const hydrated: RoutePlan[] = persistedDrafts.map((d) => {
      // Semeia versão conhecida para guarda otimista de concorrência.
      savePlanSnapshot.seedVersion(d.id, d.updated_at);
      const cfg = routeSnapshot(d.route_config);
      const ids: string[] = Array.isArray(d.load_ids) ? d.load_ids : (Array.isArray(cfg.load_ids) ? cfg.load_ids : []);
      const loads = ids.map(id => loadById.get(id)).filter((load): load is PendingLoad => Boolean(load));
      const missingCount = ids.length - loads.length;
      return {
        id: d.id,
        name: d.name,
        loads,
        stops: Array.isArray(cfg.stops) ? cfg.stops : undefined,
        vehicle_id: d.vehicle_id || cfg.vehicle_id || undefined,
        driver_id: d.driver_id || cfg.driver_id || undefined,
        planned_start_at: d.planned_start_at || cfg.planned_start_at || undefined,
        sortMode: cfg.sortMode,
        initial_transit_minutes: cfg.initial_transit_minutes,
        notes: d.notes || cfg.notes,
        dirty: missingCount > 0 || (Array.isArray(cfg.stops) && cfg.stops.length > 0 && loads.length === 0),
      } as RoutePlan;
    }).filter(r => r.loads.length > 0);
    if (hydrated.length > 0) {
      setRoutes(hydrated);
      setRestoredFromDraft(true);
    }
    draftsHydratedRef.current = true;
  }, [pendingLoads, persistedDrafts, savePlanSnapshot]);

  useRoutePlanAutosave(routes,dispatchPlan.pendingDispatches,draftsHydratedRef,savePlanSnapshot,()=>{
    toast.error('Rascunho alterado em outra sessão. Recarregando última versão.');
    void qc.invalidateQueries({queryKey:['route_planning_drafts']});draftsHydratedRef.current=false;
  });

  const availableLoads = useMemo(() => {
    return pendingLoads.filter(l => !assignedLoadIds.has(l.id));
  }, [pendingLoads, assignedLoadIds]);

  const filteredLoads = useMemo(() => {
    const loads = filterDest === 'all'
      ? availableLoads
      : availableLoads.filter(l => normalizeCity(l.destination).includes(filterDest));
    return [...loads].sort((a, b) => {
      const recipientA = a.items[0]?.fiscal_documents?.recipient || a.destination || '';
      const recipientB = b.items[0]?.fiscal_documents?.recipient || b.destination || '';
      return recipientCollator.compare(recipientA, recipientB) || recipientCollator.compare(a.load_number, b.load_number);
    });
  }, [availableLoads, filterDest]);

  const destinations = useMemo(() => {
    const set = new Set(availableLoads.map(l => normalizeCity(l.destination || 'Sem destino')));
    return Array.from(set).sort();
  }, [availableLoads]);

  /** Cargas selecionadas que NÃO estão no filtro atual (risco de inclusão silenciosa). */
  const hiddenSelectedLoads = useMemo(() => {
    const visibleIds = new Set(filteredLoads.map(l => l.id));
    return availableLoads.filter(l => selectedLoads.has(l.id) && !visibleIds.has(l.id));
  }, [filteredLoads, availableLoads, selectedLoads]);

  const confirmIfHidden = useCallback(async (proceed: () => void) => {
    if (hiddenSelectedLoads.length === 0) { proceed(); return; }
    const names = hiddenSelectedLoads.slice(0, 5).map(l => l.load_number).join(', ');
    const extra = hiddenSelectedLoads.length > 5 ? ` e mais ${hiddenSelectedLoads.length - 5}` : '';
    if (await confirmAction(
      `Existem ${hiddenSelectedLoads.length} carga(s) selecionada(s) fora do filtro atual (${names}${extra}). Deseja incluí-las mesmo assim?`,
    )) proceed();
  }, [confirmAction, hiddenSelectedLoads]);

  /* ──── actions ──── */
  const toggleLoad = (id: string) => {
    setSelectedLoads(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedLoads.size === filteredLoads.length) {
      setSelectedLoads(new Set());
    } else {
      setSelectedLoads(new Set(filteredLoads.map(l => l.id)));
    }
  };

  const addToRoute = (routeId: string) => {
    const selected = availableLoads.filter(l => selectedLoads.has(l.id));
    if (selected.length === 0) return;
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const loads = [...r.loads, ...selected];
      if (!r.stops || r.stops.length === 0) return { ...r, loads };
      const stops = regenerateStopsPreservingEdits(
        loads, r.stops, r.sortMode,
        r.planned_start_at || globalStartAt, r.initial_transit_minutes ?? 30,
      );
      return { ...r, loads, stops, dirty: false };
    }));
    setSelectedLoads(new Set());
  };

  const createRouteFromSelected = () => confirmIfHidden(() => _createRouteFromSelected());
  const _createRouteFromSelected = () => {
    const selected = availableLoads.filter(l => selectedLoads.has(l.id));
    if (selected.length === 0) return;
    const dest = selected[0].destination || 'Rota';
    const name = newRouteName || `${dest} - ${format(new Date(), 'dd/MM')}`;
    setRoutes(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      loads: selected,
      ...inheritAssignmentFromLoads(selected),
    }]);
    setSelectedLoads(new Set());
    setNewRouteName('');
    setDialogOpen(false);
  };

  const autoSuggest = () => {
    // Agrupamento simples por destination textual (legado, opcional).
    const groups: Record<string, PendingLoad[]> = {};
    availableLoads.forEach(l => {
      const key = normalizeCity(l.destination || 'Sem destino');
      (groups[key] ||= []).push(l);
    });
    const suggested: RoutePlan[] = Object.entries(groups).map(([dest, loads]) => ({
      id: crypto.randomUUID(),
      name: `${dest} - ${format(new Date(), 'dd/MM')}`,
      loads: sortLoadsByRecipient(loads),
      ...inheritAssignmentFromLoads(loads),
    }));
    setRoutes(prev => [...prev, ...suggested]);
    setSelectedLoads(new Set());
    toast.success(`${suggested.length} rotas sugeridas criadas`);
  };

  /** Planejamento automático completo: agrupamento + paradas + sequência + veículo + motorista. */
  const generateAutoPlan = () => confirmIfHidden(() => _generateAutoPlan());
  const _generateAutoPlan = () => {
    if (selectedLoads.size === 0) {
      toast.info('Selecione ao menos uma carga para gerar o planejamento.');
      return;
    }
    const scoped = availableLoads.filter(l => selectedLoads.has(l.id));
    if (scoped.length === 0) {
      toast.info('As cargas selecionadas não estão mais disponíveis.');
      return;
    }
    const plans = generateAutomaticRoutePlans({
      loads: scoped,
      vehicles,
      drivers,
      operationalRoutes,
      customerWindows,
      plannedStartAt: globalStartAt,
    });
    if (plans.length === 0) {
      toast.info('Nenhum plano gerado.');
      return;
    }
    const newRoutes: RoutePlan[] = plans.map(p => ({
      id: p.id,
      name: p.name,
      loads: p.loads.map(load => scoped.find(candidate => candidate.id === load.id)).filter((load): load is PendingLoad => Boolean(load)),
      stops: p.stops,
      vehicle_id: p.vehicle_id,
      driver_id: p.driver_id,
      planned_start_at: p.planned_start_at,
      sortMode: 'auto',
      notes: p.automation_warnings.join(' · '),
    }));
    setRoutes(prev => [...prev, ...newRoutes]);
    setSelectedLoads(new Set());
    const review = newRoutes.filter((_, i) => plans[i].requires_review).length;
    toast.success(`${newRoutes.length} rotas planejadas automaticamente${review ? ` · ${review} para revisão` : ''}`);
  };

  const removeLoadFromRoute = (routeId: string, loadId: string) => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const loads = r.loads.filter(l => l.id !== loadId);
      if (!r.stops || r.stops.length === 0) return { ...r, loads };
      const stops = regenerateStopsPreservingEdits(
        loads, r.stops, r.sortMode,
        r.planned_start_at || globalStartAt, r.initial_transit_minutes ?? 30,
      );
      return { ...r, loads, stops, dirty: false };
    }));
  };

  const removeRoute = (routeId: string) => {
    setRoutes(prev => prev.filter(r => r.id !== routeId));
    // Best-effort: remove draft persistido. Erros silenciosos.
    savePlanSnapshot.forgetVersion(routeId);
    deleteDraft.mutate(routeId, { onError: () => {/* draft pode não existir ainda */} });
  };

  const toggleRouteCollapse = (routeId: string) => {
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, collapsed: !r.collapsed } : r
    ));
  };

  const moveLoad = (routeId: string, loadId: string, direction: 'up' | 'down') => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const idx = r.loads.findIndex(l => l.id === loadId);
      if (idx < 0) return r;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= r.loads.length) return r;
      const loads = [...r.loads];
      [loads[idx], loads[newIdx]] = [loads[newIdx], loads[idx]];
      if (!r.stops || r.stops.length === 0 || r.sortMode === 'manual' || r.sortMode === 'smart') {
        return { ...r, loads };
      }
      // sortMode 'original' ou 'auto': reflete a nova ordem das cargas nas paradas.
      const stops = regenerateStopsPreservingEdits(
        loads, r.stops, r.sortMode,
        r.planned_start_at || globalStartAt, r.initial_transit_minutes ?? 30,
      );
      return { ...r, loads, stops, dirty: false };
    }));
  };

  // Vincular veículo às cargas e criar dispatch_trip
  const dispatchRouteMutation = useMutation({
    onMutate:(route:RoutePlan)=>setRoutes(previous=>previous.map(item=>item.id===route.id?{...item,dispatching:true}:item)),
    onSettled:(_data,_error,route)=>setRoutes(previous=>previous.map(item=>item.id===route.id?{...item,dispatching:false}:item)),
    mutationFn: async (route: RoutePlan) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const c = validateRouteConsistency(route, {
        vehicles,
        otherRoutes: routes.map(o => ({ id: o.id, vehicle_id: o.vehicle_id, driver_id: o.driver_id, name: o.name })),
        routeId: route.id,
      });
      if (!c.valid) {
        throw new Error(c.blockingErrors.join(' · '));
      }
      if (!route.planned_start_at) throw new Error('Data/hora planejada é obrigatória para despachar a rota');
      const stops = route.stops!;
      // Flush and retain the stable draft before the transactional conversion.
      await savePlanSnapshot.mutateAsync({routeId:route.id,name:route.name,snapshot:{
        loads:route.loads.map(l=>({id:l.id})),stops,vehicle_id:route.vehicle_id,driver_id:route.driver_id,
        planned_start_at:route.planned_start_at,sortMode:route.sortMode,notes:route.notes,
      }});
      const tripId = await dispatchPlan.dispatchRoute({
        attempt_scope: route.id,
        planning_draft_id: route.id,
        vehicle_id: route.vehicle_id!,
        driver_id: route.driver_id!,
        planned_start_at: route.planned_start_at,
        route_name: route.name,
        load_ids: route.loads.map(l => l.id),
        stops,
      });
      return { id: tripId } as { id: string };
    },
    onSuccess: (_, route) => {
      removeRoute(route.id);
      dispatchPlan.invalidateAll();
      toast.success('Rota despachada! Redirecionando para a carga...');
      // Redirecionar para o detalhe da primeira carga para faturamento/CT-e
      const firstLoadId = route.loads[0]?.id;
      if (firstLoadId) {
        navigate(`/loads/${firstLoadId}`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const routeTotals = (route: RoutePlan) => {
    const allItems = route.loads.flatMap(l => l.items);
    return {
      loads: route.loads.length,
      nfes: allItems.length,
      weight: route.loads.reduce((s, l) => s + (Number(l.total_weight_kg) || 0), 0),
      pallets: route.loads.reduce((s, l) => s + (Number(l.total_pallet_count) || 0), 0),
      value: allItems.reduce((s, i) => s + (Number(i.fiscal_documents?.value) || 0), 0),
    };
  };

  const generateStops = (routeId: string) => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId) return r;
      const stops = consolidateLoadsIntoStops(r.loads).map((s, i) => ({ ...s, manual_order: i + 1 }));
      return { ...r, stops, sortMode: 'original' as const, dirty: false };
    }));
  };

  const setStopSort = (routeId: string, mode: RouteStopSortMode) => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId || !r.stops) return r;
      if (mode === 'smart') return { ...r, sortMode: mode, stops: applySmartSequence(r.stops) };
      if (mode === 'original') return { ...r, sortMode: mode, stops: applyOriginalOrder(r.stops) };
      if (mode === 'auto') {
        const seq = autoSequenceStops(r.stops);
        const sim = simulateStopTimeline(seq, r.planned_start_at || globalStartAt, {
          initialTransitMinutes: r.initial_transit_minutes ?? 30,
        });
        return { ...r, sortMode: mode, stops: sim };
      }
      return { ...r, sortMode: mode };
    }));
  };

  const moveStop = (routeId: string, stopId: string, dir: 'up' | 'down') => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId || !r.stops) return r;
      const ordered = [...r.stops].sort((a, b) => routeStopOrder(a) - routeStopOrder(b));
      const idx = ordered.findIndex(s => s.id === stopId);
      const ni = dir === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || ni < 0 || ni >= ordered.length) return r;
      [ordered[idx], ordered[ni]] = [ordered[ni], ordered[idx]];
      const reseq = ordered.map((s, i) => ({ ...s, manual_order: i + 1 }));
      const stops = simulateStopTimeline(reseq, r.planned_start_at || globalStartAt, {
        initialTransitMinutes: r.initial_transit_minutes ?? 30,
      });
      return { ...r, stops, sortMode: 'manual' as const };
    }));
  };

  const updateStop = (routeId: string, stopId: string, patch: Partial<RouteStopDraft>) => {
    setRoutes(prev => prev.map(r => {
      if (r.id !== routeId || !r.stops) return r;
      const next = r.stops.map(s => s.id === stopId ? { ...s, ...patch } : s);
      const ordered = [...next].sort((a, b) => routeStopOrder(a) - routeStopOrder(b));
      const sim = simulateStopTimeline(ordered, r.planned_start_at || globalStartAt, {
        initialTransitMinutes: r.initial_transit_minutes ?? 30,
      });
      return { ...r, stops: sim };
    }));
  };

  const routeConsistency = useCallback((r: RoutePlan) => validateRouteConsistency(
    r,
    {
      vehicles,
      otherRoutes: routes.map(o => ({ id: o.id, vehicle_id: o.vehicle_id, driver_id: o.driver_id, name: o.name })),
      routeId: r.id,
    },
  ), [vehicles, routes]);

  const routeStatus = useCallback((r: RoutePlan): RoutePlanStatusExt => computeRouteStatus({
    dirty: r.dirty,
    dispatching: r.dispatching,
    failed: !!r.lastDispatchError,
    consistency: routeConsistency(r),
  }), [routeConsistency]);

  const validateRoute = useCallback((r: RoutePlan): RoutePlanValidationIssue[] => {
    const c = routeConsistency(r);
    return [
      ...c.blockingErrors.map(m => ({ level: 'error' as const, message: m })),
      ...c.warnings.map(m => ({ level: 'warning' as const, message: m })),
    ];
  }, [routeConsistency]);

  /** Despacho em lote: só rotas com status 'ready' por padrão. */
  const [batchSummary, setBatchSummary] = useState<{ ok: number; fail: number; skipped: number; errors: string[] } | null>(null);
  const dispatchAllValid = async (allowReview = false) => {
    const ready = routes.filter(r => {
      const st = routeStatus(r);
      return st === 'ready' || (allowReview && st === 'review');
    });
    if (ready.length === 0) {
      toast.info(allowReview ? 'Nenhuma rota elegível.' : 'Nenhuma rota pronta para despacho em lote.');
      return;
    }
    const skipped = routes.length - ready.length;
    let ok = 0, fail = 0;
    const errors: string[] = [];
    for (const r of ready) {
      setRoutes(prev => prev.map(x => x.id === r.id ? { ...x, dispatching: true, lastDispatchError: undefined } : x));
      try {
        await savePlanSnapshot.mutateAsync({routeId:r.id,name:r.name,snapshot:{
          loads:r.loads.map(l=>({id:l.id})),stops:r.stops,vehicle_id:r.vehicle_id,driver_id:r.driver_id,
          planned_start_at:r.planned_start_at,sortMode:r.sortMode,notes:r.notes,
        }});
        await dispatchPlan.dispatchRoute({
          attempt_scope: r.id,
          planning_draft_id: r.id,
          vehicle_id: r.vehicle_id!,
          driver_id: r.driver_id!,
          planned_start_at: r.planned_start_at!,
          route_name: r.name,
          load_ids: r.loads.map(l => l.id),
          stops: r.stops!,
        });
        ok++;
        // remove on success
        setRoutes(prev => prev.filter(x => x.id !== r.id));
        savePlanSnapshot.forgetVersion(r.id);
        deleteDraft.mutate(r.id, { onError: () => {} });
      } catch (error: unknown) {
        fail++;
        const msg = getErrorMessage(error);
        errors.push(`${r.name}: ${msg}`);
        setRoutes(prev => prev.map(x => x.id === r.id ? { ...x, dispatching: false, lastDispatchError: msg } : x));
      }
    }
    dispatchPlan.invalidateAll();
    setBatchSummary({ ok, fail, skipped, errors });
    if (ok > 0) toast.success(`${ok} rota(s) despachada(s)`);
    if (fail > 0) toast.error(`${fail} rota(s) falharam`);
  };

  const buildRouteRomaneio = (route: RoutePlan) => {
    const vehicle = vehicles.find(candidate => candidate.id === route.vehicle_id);
    const driver = drivers.find(candidate => candidate.id === route.driver_id);
    const docs: RomaneioDoc[] = sortLoadsByRecipient(route.loads).flatMap(load =>
      sortItemsByRecipient(load.items).map(item => {
        const fd = item.fiscal_documents;
        const raw = fd?.issue_date;
        const s = raw ? String(raw).substring(0, 10) : '';
        const d = s ? new Date(s + 'T12:00:00') : null;
        const emissao = d && !isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR') : '';
        return {
          city: fd?.recipient_city || 'SEM CIDADE',
          state: fd?.recipient_state || '',
          remetente: fd?.remitter || '—',
          destinatario: fd?.recipient || '—',
          bairro: fd?.recipient_neighborhood || '—',
          nfNumber: fd?.invoice_number || '—',
          emissao,
          valor: Number(fd?.value) || 0,
          peso: Number(item.weight_kg) || Number(fd?.weight_kg) || 0,
          volumes: Number(item.pallet_count) || 0,
        };
      })
    );
    return {
      routeName: route.name,
      vehicleInfo: vehicle ? `Veículo: ${vehicle.plate}${vehicle.nickname ? ` (${vehicle.nickname})` : ''}${vehicle.max_pallets ? ` - ${vehicle.max_pallets}p` : ''}` : undefined,
      driverInfo: driver ? `Motorista: ${driver.name}` : undefined,
      docs,
    };
  };

  const exportRoutePdf = (route: RoutePlan) => {
    printRomaneioRoutes([buildRouteRomaneio(route)], `Romaneio ${route.name}`);
    toast.success('Romaneio aberto para impressão!');
  };

  const printAllRoutes = () => {
    if (routes.length === 0) {
      toast.info('Nenhuma rota para imprimir.');
      return;
    }
    const pages = routes.map(buildRouteRomaneio).filter(p => p.docs.length > 0);
    if (pages.length === 0) {
      toast.info('Rotas sem documentos fiscais para imprimir.');
      return;
    }
    printRomaneioRoutes(pages, `Romaneios — ${pages.length} rota(s)`);
    toast.success(`${pages.length} romaneio(s) abertos para impressão!`);
  };

  return (
    <div className="animate-fade-in space-y-6">
      {restoredFromDraft && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="flex items-center gap-2"><AlertTriangle className="h-3 w-3" /> Existem rotas planejadas não despachadas restauradas do rascunho.</span>
          <Button size="sm" variant="ghost" onClick={() => setRestoredFromDraft(false)}>OK</Button>
        </div>
      )}
      <Dialog open={!!batchSummary} onOpenChange={(o) => !o && setBatchSummary(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Resumo do despacho em lote</DialogTitle></DialogHeader>
          {batchSummary && (
            <div className="space-y-2 text-sm">
              <p><strong>{batchSummary.ok}</strong> rota(s) despachada(s) com sucesso.</p>
              {batchSummary.fail > 0 && <p className="text-destructive"><strong>{batchSummary.fail}</strong> rota(s) falharam.</p>}
              {batchSummary.skipped > 0 && <p className="text-muted-foreground"><strong>{batchSummary.skipped}</strong> rota(s) ignorada(s) por não estarem prontas.</p>}
              {batchSummary.errors.length > 0 && (
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto border rounded p-2 bg-muted/30">
                  {batchSummary.errors.map((e, i) => <li key={i}>• {e}</li>)}
                </ul>
              )}
              <div className="flex justify-end pt-2">
                <Button onClick={() => setBatchSummary(null)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Route className="h-6 w-6 text-primary" /> Planejamento de Rotas
          </h1>
          <p className="text-sm text-muted-foreground">
            O sistema propõe a melhor sequência. Você revisa apenas as exceções e despacha. Previsão operacional aproximada, sem cálculo geográfico.
          </p>
        </div>
        <div className="flex gap-2 items-end flex-wrap justify-end">
          <div className="flex flex-col">
            <Label className="text-[10px] text-muted-foreground">Saída padrão</Label>
            <Input
              type="datetime-local" aria-label="Saída padrão do planejamento"
              value={globalStartAt}
              onChange={e => setGlobalStartAt(e.target.value)}
              className="h-9 w-48 text-xs"
            />
          </div>
          <div className="flex flex-col items-start gap-0.5">
            <Button
              onClick={generateAutoPlan}
              disabled={selectedLoads.size === 0}
              title={selectedLoads.size === 0
                ? 'Selecione as cargas que deseja planejar (use o checkbox do cabeçalho para marcar todas).'
                : `Gerar planejamento das ${selectedLoads.size} carga(s) selecionada(s)`}
            >
              <Bot className="h-4 w-4 mr-2" />
              Gerar planejamento automático{selectedLoads.size > 0 ? ` (${selectedLoads.size})` : ''}
            </Button>
            <span className="text-[10px] text-muted-foreground pl-1">
              {selectedLoads.size === 0
                ? 'Selecione as cargas desejadas — marque o checkbox do topo para incluir todas.'
                : `${selectedLoads.size} carga(s) selecionada(s) entrarão no planejamento.`}
            </span>
          </div>
          <Button variant="default" onClick={() => dispatchAllValid(false)} disabled={routes.length === 0 || dispatchRouteMutation.isPending}>
            <Rocket className="h-4 w-4 mr-2" /> Despachar rotas prontas
          </Button>
          <Button variant="outline" onClick={printAllRoutes} disabled={routes.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir todas as rotas
          </Button>
          <Button variant="outline" onClick={() => { if (selectedLoads.size > 0) setDialogOpen(true); else toast.info('Selecione cargas primeiro'); }}>
            <Plus className="h-4 w-4 mr-2" /> Criar rota manual
          </Button>
          <Button variant="ghost" size="sm" onClick={autoSuggest} disabled={availableLoads.length === 0} title="Agrupamento simples por destino textual">
            <Wand2 className="h-3 w-3 mr-1" /> Sugerir por destino
          </Button>
        </div>
      </div>

      <DispatchRecoveryPanel onConfirmed={(item)=>{
        setRoutes(previous=>previous.filter(route=>route.id!==item.scope));
        savePlanSnapshot.forgetVersion(item.scope);
        toast.success('Despacho confirmado. Cargas e viagem atualizadas.');
      }}/>
      {/* ──── Cargas Disponíveis ──── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Cargas Disponíveis
            <Badge variant="secondary" className="ml-2">{availableLoads.length}</Badge>
          </CardTitle>
          <div className="flex gap-2 flex-wrap pt-2">
            <Select value={filterDest} onValueChange={setFilterDest}>
              <SelectTrigger className="w-48" aria-label="Filtrar cargas por destino"><SelectValue placeholder="Destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os destinos</SelectItem>
                {destinations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedLoads.size > 0 && routes.length > 0 && (
              <Select onValueChange={addToRoute}>
                <SelectTrigger className="w-56" aria-label="Adicionar cargas selecionadas a uma rota"><SelectValue placeholder={`Adicionar ${selectedLoads.size} a rota...`} /></SelectTrigger>
                <SelectContent>
                  {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.loads.length})</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {selectedLoads.size > 0 && (
              <Badge
                variant="outline"
                className={hiddenSelectedLoads.length > 0 ? 'bg-amber-50 text-amber-700 border-amber-300' : ''}
                title={hiddenSelectedLoads.length > 0
                  ? `${hiddenSelectedLoads.length} carga(s) selecionada(s) estão fora do filtro atual.`
                  : 'Todas as selecionadas estão visíveis no filtro.'}
              >
                {selectedLoads.size} selecionada(s)
                {hiddenSelectedLoads.length > 0 && ` · ${hiddenSelectedLoads.length} fora do filtro`}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Carregando...</p>
          ) : availableLoads.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhuma carga pendente para roteirização. Importe NF-es na tela de Ingestão.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox aria-label="Selecionar todas as cargas visíveis" checked={selectedLoads.size === filteredLoads.length && filteredLoads.length > 0} onCheckedChange={selectAll} />
                  </TableHead>
                  <TableHead>Carga</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">NF-es</TableHead>
                  <TableHead className="text-right">Peso (kg)</TableHead>
                  <TableHead className="text-right">Volumes</TableHead>
                  <TableHead className="text-right">Valor Total</TableHead>
                  <TableHead>Criada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLoads.map(l => {
                  const totalValue = l.items.reduce((s, i) => s + (Number(i.fiscal_documents?.value) || 0), 0);
                  return (
                    <TableRow key={l.id} className={selectedLoads.has(l.id) ? 'bg-primary/5' : ''}>
                      <TableCell><Checkbox aria-label={`Selecionar carga ${l.load_number}`} checked={selectedLoads.has(l.id)} onCheckedChange={() => toggleLoad(l.id)} /></TableCell>
                      <TableCell className="font-medium text-sm">{l.load_number}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{l.destination || '—'}</Badge></TableCell>
                      <TableCell className="text-sm text-right">{l.items.length}</TableCell>
                      <TableCell className="text-sm text-right">{(Number(l.total_weight_kg) || 0).toFixed(0)}</TableCell>
                      <TableCell className="text-sm text-right">{l.total_pallet_count || 0}</TableCell>
                      <TableCell className="text-sm text-right font-medium">
                        {totalValue > 0 ? `R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(l.created_at), 'dd/MM HH:mm')}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ──── Rotas Planejadas ──── */}
      {routes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Rotas Planejadas ({routes.length})</h2>
          {routes.map(route => {
            const totals = routeTotals(route);
            return (
              <Card key={route.id} className="border-primary/20">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleRouteCollapse(route.id)}>
                      {route.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                      <CardTitle className="text-base">{route.name}</CardTitle>
                      {(() => {
                        const st = routeStatus(route);
                        const m = STATUS_VISUALS[st];
                        return <Badge variant="outline" className={`text-[10px] ${m.cls}`}>{m.label}</Badge>;
                      })()}
                      {route.sortMode && (
                        <Badge variant="outline" className="text-[10px]">{route.sortMode === 'auto' ? 'auto' : route.sortMode}</Badge>
                      )}
                      <Badge variant="secondary">{totals.loads} cargas</Badge>
                      <Badge variant="outline">{totals.nfes} NF-es</Badge>
                      <span className="text-xs text-muted-foreground">{totals.weight.toFixed(0)} kg • {totals.pallets} vol</span>
                      {totals.value > 0 && (
                        <span className="text-xs font-medium text-primary">R$ {totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={route.vehicle_id || ''} onValueChange={v => setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, vehicle_id: v } : r))}>
                        <SelectTrigger className="w-40 h-8 text-xs" aria-label={`Veículo da rota ${route.name}`}><SelectValue placeholder="Veículo" /></SelectTrigger>
                        <SelectContent>
                          {vehicles.filter(vehicleOption => vehicleOption.active).map((vehicleOption) => (
                            <SelectItem key={vehicleOption.id} value={vehicleOption.id}>{vehicleOption.plate} {vehicleOption.nickname ? `(${vehicleOption.nickname})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={route.driver_id || ''} onValueChange={v => setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, driver_id: v } : r))}>
                        <SelectTrigger className="w-40 h-8 text-xs" aria-label={`Motorista da rota ${route.name}`}><SelectValue placeholder="Motorista" /></SelectTrigger>
                        <SelectContent>
                          {drivers.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="datetime-local" aria-label={`Saída planejada da rota ${route.name}`}
                        value={route.planned_start_at || ''}
                        onChange={(e) => setRoutes(prev => prev.map(r => {
                          if (r.id !== route.id) return r;
                          const stops = r.stops
                            ? simulateStopTimeline(
                                [...r.stops].sort((a, b) => routeStopOrder(a) - routeStopOrder(b)),
                                e.target.value,
                                { initialTransitMinutes: r.initial_transit_minutes ?? 30 },
                              )
                            : r.stops;
                          return { ...r, planned_start_at: e.target.value, stops };
                        }))}
                        className="w-52 h-8 text-xs"
                        title="Horário previsto de saída do depósito/origem"
                      />
                      <div className="flex items-center gap-1" title="Minutos de deslocamento do depósito até a 1ª parada (usado para estimar a 1ª chegada)">
                        <Label className="text-[11px] text-muted-foreground whitespace-nowrap">→ 1ª parada</Label>
                        <Input
                          type="number"
                          min={0}
                          value={route.initial_transit_minutes ?? 30}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0);
                            setRoutes(prev => prev.map(r => {
                              if (r.id !== route.id) return r;
                              const stops = r.stops
                                ? simulateStopTimeline(
                                    [...r.stops].sort((a, b) => routeStopOrder(a) - routeStopOrder(b)),
                                    r.planned_start_at || globalStartAt,
                                    { initialTransitMinutes: v },
                                  )
                                : r.stops;
                              return { ...r, initial_transit_minutes: v, stops };
                            }));
                          }}
                          className="w-16 h-8 text-xs text-right"
                        />
                        <span className="text-[11px] text-muted-foreground">min</span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => exportRoutePdf(route)}>
                        <Download className="h-3 w-3 mr-1" /> PDF
                      </Button>
                      {(() => {
                        const st = routeStatus(route);
                        const v = STATUS_VISUALS[st];
                        const c = routeConsistency(route);
                        return (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => {
                              if (route.dispatching || dispatchRouteMutation.isPending) return;
                              setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, dispatching: true } : r));
                              dispatchRouteMutation.mutate(route, {
                                onSettled: () => {
                                  setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, dispatching: false } : r));
                                }
                              });
                            }}
                            disabled={v.blocksDispatch || dispatchRouteMutation.isPending || route.dispatching}
                            title={v.blocksDispatch ? (c.blockingErrors.join(' · ') || v.label) : 'Despachar rota'}
                          >
                            <Send className="h-3 w-3 mr-1" /> Despachar
                          </Button>
                        );
                      })()}
                      <Button size="sm" variant="ghost" onClick={() => removeRoute(route.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {!route.collapsed && (
                  <CardContent className="pt-0 space-y-3">
                    {/* Sequência operacional de paradas */}
                    <div className="border rounded-md p-3 bg-muted/20 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ListOrdered className="h-4 w-4" /> Paradas consolidadas
                          {route.stops && <Badge variant="secondary">{route.stops.length}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" onClick={() => setStopSort(route.id, 'auto')} disabled={!route.stops?.length}>
                            <Bot className="h-3 w-3 mr-1" /> Recalcular sequência
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => generateStops(route.id)}>
                            <Wand2 className="h-3 w-3 mr-1" /> Regenerar paradas
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStopSort(route.id, 'smart')} disabled={!route.stops?.length}>
                            <Sparkles className="h-3 w-3 mr-1" /> Ordem simples
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStopSort(route.id, 'original')} disabled={!route.stops?.length}>
                            Original
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Previsão operacional aproximada — sem rota geográfica nem trânsito em tempo real.
                      </p>
                      {route.notes && (
                        <p className="text-[11px] text-amber-700">{route.notes}</p>
                      )}
                      <StopDraftTable
                        stops={(route.stops || []).slice().sort((a,b) => routeStopOrder(a) - routeStopOrder(b))}
                        onMove={(id, dir) => moveStop(route.id, id, dir)}
                        onUpdate={(id, patch) => updateStop(route.id, id, patch)}
                      />
                      <RouteValidationPanel issues={validateRoute(route)} />
                    </div>

                    {/* Opção A: preserva ordem manual definida pelo usuário (não re-ordena no render). */}
                    {route.loads.map((load, loadIdx) => (
                      <div key={load.id} className="border rounded-md overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-muted-foreground">{loadIdx + 1}</span>
                            <span className="font-medium text-sm">{load.destination || '—'}</span>
                            <Badge variant="secondary" className="text-xs">{load.items.length} NF-es</Badge>
                            <span className="text-xs text-muted-foreground">
                              {(Number(load.total_weight_kg) || 0).toFixed(0)} kg • {load.total_pallet_count || 0} vol
                            </span>
                          </div>
                          <div className="flex gap-0.5">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveLoad(route.id, load.id, 'up')} disabled={loadIdx === 0}>
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => moveLoad(route.id, load.id, 'down')} disabled={loadIdx === route.loads.length - 1}>
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeLoadFromRoute(route.id, load.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Nº NF</TableHead>
                              <TableHead className="text-xs">Remetente</TableHead>
                              <TableHead className="text-xs">Destinatário</TableHead>
                              <TableHead className="text-xs">Cidade</TableHead>
                              <TableHead className="text-xs text-right">Peso</TableHead>
                              <TableHead className="text-xs text-right">Vol.</TableHead>
                              <TableHead className="text-xs text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortItemsByRecipient(load.items).map(item => {
                              const fd = item.fiscal_documents;
                              return (
                                <TableRow key={item.id}>
                                  <TableCell className="text-xs font-medium">{fd?.invoice_number || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.remitter || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.recipient || '—'}</TableCell>
                                  <TableCell className="text-xs">{fd?.recipient_city || '—'}</TableCell>
                                  <TableCell className="text-xs text-right">{fd?.weight_kg ? Number(fd.weight_kg).toFixed(1) : '—'}</TableCell>
                                  <TableCell className="text-xs text-right">{item.pallet_count || 0}</TableCell>
                                  <TableCell className="text-xs text-right">{fd?.value ? `R$ ${Number(fd.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ──── Create Route Dialog ──── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Rota</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome da Rota</Label>
              <Input value={newRouteName} onChange={e => setNewRouteName(e.target.value)} placeholder={`Ex: NORTE MG - ${format(new Date(), 'dd/MM')}`} />
            </div>
            <p className="text-sm text-muted-foreground">{selectedLoads.size} cargas selecionadas serão incluídas</p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={createRouteFromSelected}>Criar Rota</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
