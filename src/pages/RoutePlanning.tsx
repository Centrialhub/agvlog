import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useVehicles } from '@/hooks/useVehicles';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import {
  Route, Plus, Wand2, Trash2,
  PackageCheck, Truck, ChevronDown, ChevronUp,
  FileText, Send, Download, ListOrdered, Sparkles, Bot, Rocket, Printer,
  RefreshCw,
} from 'lucide-react';
import { format } from 'date-fns';
import { printRomaneioRoutes, RomaneioDoc } from '@/lib/romaneioPrint';
import StopDraftTable from '@/components/route-planning/StopDraftTable';
import RouteValidationPanel from '@/components/route-planning/RouteValidationPanel';
import { consolidateLoadsIntoStops } from '@/lib/route-planning/stopConsolidation';
import { applySmartSequence, applyOriginalOrder, autoSequenceStops } from '@/lib/route-planning/simpleStopSequencing';
import { simulateStopTimeline } from '@/lib/route-planning/timelineSimulation';
import { generateAutomaticRoutePlans, defaultPlannedStartAt } from '@/lib/route-planning/autoRoutePlanner';
import { useOperationalRoutes } from '@/hooks/useOperationalRoutes';
import { useCustomerDeliveryWindowsForRouting } from '@/hooks/route-planning/useCustomerDeliveryWindowsForRouting';
import { useDispatchRoutePlan } from '@/hooks/route-planning/useDispatchRoutePlan';
import type { RouteStopDraft, RoutePlanValidationIssue, RouteStopSortMode } from '@/lib/route-planning/routePlanningTypes';

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
}

/* ────────────── main component ────────────── */
export default function RoutePlanning() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { data: vehicles = [] } = useVehicles();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dispatchPlan = useDispatchRoutePlan();
  const { data: operationalRoutes = [] } = useOperationalRoutes();

  const revertXmlsMutation = useMutation({
    mutationFn: async () => {
      if (!currentTenant) throw new Error('Sem tenant');
      const { data, error } = await supabase.rpc('revert_xml_loads_to_available', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return data as Record<string, any>;
    },
    onSuccess: (result) => {
      toast.success(result?.message || 'XMLs revertidos com sucesso');
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
      qc.invalidateQueries({ queryKey: ['route_planning_drafts'] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Erro ao reverter XMLs');
    },
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_routing', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [] as any[];
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
      const { data: loads, error } = await supabase
        .from('loads')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'planned')
        .is('trip_id', null)
        .order('destination', { ascending: true });
      if (error) throw error;
      if (!loads || loads.length === 0) return [];

      // Buscar items com NF-es para cada carga
      const loadIds = loads.map((l: any) => l.id);
      const { data: items, error: itemsErr } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, value, weight_kg, issue_date)')
        .in('load_id', loadIds)
        .order('created_at', { ascending: true });
      if (itemsErr) throw itemsErr;

      const itemsByLoad: Record<string, LoadItem[]> = {};
      (items || []).forEach((item: any) => {
        if (!itemsByLoad[item.load_id]) itemsByLoad[item.load_id] = [];
        itemsByLoad[item.load_id].push(item);
      });

      return loads.map((l: any) => ({
        ...l,
        items: itemsByLoad[l.id] || [],
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

  const availableLoads = useMemo(() => {
    return pendingLoads.filter(l => !assignedLoadIds.has(l.id));
  }, [pendingLoads, assignedLoadIds]);

  const filteredLoads = useMemo(() => {
    const loads = filterDest === 'all'
      ? availableLoads
      : availableLoads.filter(l => (l.destination || '').toUpperCase().includes(filterDest));
    return [...loads].sort((a, b) => {
      const recipientA = a.items[0]?.fiscal_documents?.recipient || a.destination || '';
      const recipientB = b.items[0]?.fiscal_documents?.recipient || b.destination || '';
      return recipientCollator.compare(recipientA, recipientB) || recipientCollator.compare(a.load_number, b.load_number);
    });
  }, [availableLoads, filterDest]);

  const destinations = useMemo(() => {
    const set = new Set(availableLoads.map(l => (l.destination || 'Sem destino').trim().toUpperCase()));
    return Array.from(set).sort();
  }, [availableLoads]);

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
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, loads: sortLoadsByRecipient([...r.loads, ...selected]) } : r
    ));
    setSelectedLoads(new Set());
  };

  const createRouteFromSelected = () => {
    const selected = availableLoads.filter(l => selectedLoads.has(l.id));
    if (selected.length === 0) return;
    const dest = selected[0].destination || 'Rota';
    const name = newRouteName || `${dest} - ${format(new Date(), 'dd/MM')}`;
    setRoutes(prev => [...prev, {
      id: crypto.randomUUID(),
      name,
      loads: sortLoadsByRecipient(selected),
    }]);
    setSelectedLoads(new Set());
    setNewRouteName('');
    setDialogOpen(false);
  };

  const autoSuggest = () => {
    // Agrupamento simples por destination textual (legado, opcional).
    const groups: Record<string, PendingLoad[]> = {};
    availableLoads.forEach(l => {
      const key = (l.destination || 'Sem destino').trim().toUpperCase();
      (groups[key] ||= []).push(l);
    });
    const suggested: RoutePlan[] = Object.entries(groups).map(([dest, loads]) => ({
      id: crypto.randomUUID(),
      name: `${dest} - ${format(new Date(), 'dd/MM')}`,
      loads: sortLoadsByRecipient(loads),
    }));
    setRoutes(prev => [...prev, ...suggested]);
    setSelectedLoads(new Set());
    toast.success(`${suggested.length} rotas sugeridas criadas`);
  };

  /** Planejamento automático completo: agrupamento + paradas + sequência + veículo + motorista. */
  const generateAutoPlan = () => {
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
      loads: scoped as any,
      vehicles: vehicles as any,
      drivers: drivers as any,
      operationalRoutes: operationalRoutes as any,
      customerWindows: customerWindows as any,
      plannedStartAt: globalStartAt,
    });
    if (plans.length === 0) {
      toast.info('Nenhum plano gerado.');
      return;
    }
    const newRoutes: RoutePlan[] = plans.map(p => ({
      id: p.id,
      name: p.name,
      loads: p.loads as any,
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
    setRoutes(prev => prev.map(r =>
      r.id === routeId ? { ...r, loads: r.loads.filter(l => l.id !== loadId) } : r
    ));
  };

  const removeRoute = (routeId: string) => {
    setRoutes(prev => prev.filter(r => r.id !== routeId));
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
      return { ...r, loads };
    }));
  };

  // Vincular veículo às cargas e criar dispatch_trip
  const dispatchRouteMutation = useMutation({
    mutationFn: async (route: RoutePlan) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      if (!route.vehicle_id) throw new Error('Selecione um veículo para despachar');
      if (!route.driver_id) throw new Error('Selecione um motorista para despachar');
      if (!route.planned_start_at) throw new Error('Informe horário previsto de saída');
      const stops = route.stops && route.stops.length > 0
        ? route.stops
        : consolidateLoadsIntoStops(route.loads as any);
      if (stops.length === 0) throw new Error('Rota sem paradas consolidadas');

      const tripId = await dispatchPlan.mutateAsync({
        vehicle_id: route.vehicle_id,
        driver_id: route.driver_id,
        planned_start_at: route.planned_start_at,
        route_name: route.name,
        load_ids: route.loads.map(l => l.id),
        stops,
      });
      return { id: tripId } as { id: string };
    },
    onSuccess: (_, route) => {
      removeRoute(route.id);
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
      qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
      toast.success('Rota despachada! Redirecionando para a carga...');
      // Redirecionar para o detalhe da primeira carga para faturamento/CT-e
      const firstLoadId = route.loads[0]?.id;
      if (firstLoadId) {
        navigate(`/loads/${firstLoadId}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
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
      const stops = consolidateLoadsIntoStops(r.loads as any).map((s, i) => ({ ...s, manual_order: i + 1 }));
      return { ...r, stops, sortMode: 'original' as const };
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
      const ordered = [...r.stops].sort((a, b) => (a.manual_order || 0) - (b.manual_order || 0));
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
      const ordered = [...next].sort((a, b) => (a.manual_order || 0) - (b.manual_order || 0));
      const sim = simulateStopTimeline(ordered, r.planned_start_at || globalStartAt, {
        initialTransitMinutes: r.initial_transit_minutes ?? 30,
      });
      return { ...r, stops: sim };
    }));
  };

  const validateRoute = (r: RoutePlan): RoutePlanValidationIssue[] => {
    const issues: RoutePlanValidationIssue[] = [];
    if (!r.vehicle_id) issues.push({ level: 'error', message: 'Selecione um veículo.' });
    if (!r.driver_id) issues.push({ level: 'error', message: 'Selecione um motorista (obrigatório para o app do motorista).' });
    if (!r.planned_start_at) issues.push({ level: 'error', message: 'Informe horário previsto de saída.' });
    if (r.loads.length === 0) issues.push({ level: 'error', message: 'Sem cargas vinculadas.' });
    if (!r.stops || r.stops.length === 0) issues.push({ level: 'error', message: 'Sem paradas consolidadas.' });
    (r.stops || []).forEach((s, i) => {
      if (!s.destination?.trim() || !s.recipient_name?.trim())
        issues.push({ level: 'error', message: `Parada ${i + 1} sem destino/destinatário.` });
      if (s.fiscal_document_ids.length === 0)
        issues.push({ level: 'warning', message: `Parada ${i + 1} sem documentos fiscais.` });
      if (!s.city) issues.push({ level: 'warning', message: `Parada ${i + 1} sem cidade cadastrada.` });
      if (s.risk_level === 'critical') issues.push({ level: 'warning', message: `Parada ${i + 1}: ${s.risk_reason || 'risco crítico de janela'}.` });
      if (s.risk_level === 'warning' && s.risk_reason && !s.risk_reason.startsWith('Cliente sem janela'))
        issues.push({ level: 'warning', message: `Parada ${i + 1}: ${s.risk_reason}.` });
    });
    const v: any = vehicles.find((vv: any) => vv.id === r.vehicle_id);
    if (v) {
      const totals = r.loads.reduce((acc, l) => ({
        pallets: acc.pallets + (Number(l.total_pallet_count) || 0),
        weight: acc.weight + (Number(l.total_weight_kg) || 0),
        volume: acc.volume + (Number(l.total_volume_m3) || 0),
      }), { pallets: 0, weight: 0, volume: 0 });
      if (v.max_pallets && totals.pallets > v.max_pallets)
        issues.push({ level: 'warning', message: `Paletes (${totals.pallets}) excedem capacidade (${v.max_pallets}).` });
      if (v.max_weight_kg && totals.weight > v.max_weight_kg)
        issues.push({ level: 'warning', message: `Peso (${totals.weight.toFixed(0)}kg) excede capacidade (${v.max_weight_kg}kg).` });
      if (v.max_volume_m3 && totals.volume > v.max_volume_m3)
        issues.push({ level: 'warning', message: `Volume (${totals.volume.toFixed(2)}m³) excede capacidade (${v.max_volume_m3}m³).` });
    }
    // Motorista duplicado
    if (r.driver_id) {
      const dup = routes.find(other => other.id !== r.id && other.driver_id === r.driver_id);
      if (dup) issues.push({ level: 'warning', message: `Motorista também alocado em "${dup.name}".` });
    }
    return issues;
  };

  const routeStatus = (r: RoutePlan): 'ready' | 'review' | 'blocked' => {
    const issues = validateRoute(r);
    if (issues.some(i => i.level === 'error')) return 'blocked';
    if (issues.some(i => i.level === 'warning')) return 'review';
    return 'ready';
  };

  const dispatchAllValid = async () => {
    const dispatchable = routes.filter(r => routeStatus(r) !== 'blocked');
    if (dispatchable.length === 0) {
      toast.info('Nenhuma rota válida para despacho em lote.');
      return;
    }
    let ok = 0, fail = 0;
    for (const r of dispatchable) {
      try {
        await dispatchRouteMutation.mutateAsync(r);
        ok++;
      } catch (e) {
        fail++;
      }
    }
    toast[fail === 0 ? 'success' : 'warning'](`Despachadas ${ok} rota(s)${fail ? ` · ${fail} falharam` : ''}`);
  };

  const buildRouteRomaneio = (route: RoutePlan) => {
    const vehicle = vehicles.find((v: any) => v.id === route.vehicle_id) as any;
    const driver = drivers.find((d: any) => d.id === route.driver_id) as any;
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
              type="datetime-local"
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
          <Button variant="default" onClick={dispatchAllValid} disabled={routes.length === 0 || dispatchRouteMutation.isPending}>
            <Rocket className="h-4 w-4 mr-2" /> Despachar rotas válidas
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm('Isso vai reverter TODOS os loads criados de XMLs de volta para "carga disponível", removendo trips, stops e eventos associados. Continuar?')) {
                revertXmlsMutation.mutate();
              }
            }}
            disabled={revertXmlsMutation.isPending}
            title="Reverter todos os loads de XML para o status inicial"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {revertXmlsMutation.isPending ? 'Revertendo...' : 'Reverter XMLs'}
          </Button>
        </div>
      </div>

      {/* ──── Cargas Disponíveis ──── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <PackageCheck className="h-4 w-4" /> Cargas Disponíveis
            <Badge variant="secondary" className="ml-2">{availableLoads.length}</Badge>
          </CardTitle>
          <div className="flex gap-2 flex-wrap pt-2">
            <Select value={filterDest} onValueChange={setFilterDest}>
              <SelectTrigger className="w-48"><SelectValue placeholder="Destino" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os destinos</SelectItem>
                {destinations.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedLoads.size > 0 && routes.length > 0 && (
              <Select onValueChange={addToRoute}>
                <SelectTrigger className="w-56"><SelectValue placeholder={`Adicionar ${selectedLoads.size} a rota...`} /></SelectTrigger>
                <SelectContent>
                  {routes.map(r => <SelectItem key={r.id} value={r.id}>{r.name} ({r.loads.length})</SelectItem>)}
                </SelectContent>
              </Select>
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
                    <Checkbox checked={selectedLoads.size === filteredLoads.length && filteredLoads.length > 0} onCheckedChange={selectAll} />
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
                      <TableCell><Checkbox checked={selectedLoads.has(l.id)} onCheckedChange={() => toggleLoad(l.id)} /></TableCell>
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
                        const map = {
                          ready: { label: 'Pronta', cls: 'bg-green-100 text-green-700 border-green-300' },
                          review: { label: 'Revisão', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
                          blocked: { label: 'Bloqueada', cls: 'bg-destructive/10 text-destructive border-destructive/30' },
                        } as const;
                        const m = map[st];
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
                        <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Veículo" /></SelectTrigger>
                        <SelectContent>
                          {vehicles.filter((v: any) => v.active).map((v: any) => (
                            <SelectItem key={v.id} value={v.id}>{v.plate} {v.nickname ? `(${v.nickname})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={route.driver_id || ''} onValueChange={v => setRoutes(prev => prev.map(r => r.id === route.id ? { ...r, driver_id: v } : r))}>
                        <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Motorista" /></SelectTrigger>
                        <SelectContent>
                          {drivers.map((d: any) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="datetime-local"
                        value={route.planned_start_at || ''}
                        onChange={(e) => setRoutes(prev => prev.map(r => {
                          if (r.id !== route.id) return r;
                          const stops = r.stops
                            ? simulateStopTimeline(
                                [...r.stops].sort((a, b) => (a.manual_order || 0) - (b.manual_order || 0)),
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
                                    [...r.stops].sort((a, b) => (a.manual_order || 0) - (b.manual_order || 0)),
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
                      <Button size="sm" variant="default" onClick={() => dispatchRouteMutation.mutate(route)} disabled={dispatchRouteMutation.isPending}>
                        <Send className="h-3 w-3 mr-1" /> Despachar
                      </Button>
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
                        stops={(route.stops || []).slice().sort((a,b) => (a.manual_order||0) - (b.manual_order||0))}
                        onMove={(id, dir) => moveStop(route.id, id, dir)}
                        onUpdate={(id, patch) => updateStop(route.id, id, patch)}
                      />
                      <RouteValidationPanel issues={validateRoute(route)} />
                    </div>

                    {sortLoadsByRecipient(route.loads).map((load, loadIdx) => (
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
