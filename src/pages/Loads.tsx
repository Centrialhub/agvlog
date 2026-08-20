import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLoads, useDeleteLoad, useDeleteLoads, LOAD_STATUSES, LOAD_STATUS_LABELS, Load } from '@/hooks/useLoads';
import { useHoldLoad, useUnholdLoad } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Search, PackageCheck, Truck, MapPin, ArrowRight, FileStack, Trash2, MoreVertical, X, CheckSquare, Printer, Route as RouteIcon, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FileSpreadsheet, FileText, LayoutGrid, List, PauseCircle, PlayCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import LoadsKanban from '@/components/loads/LoadsKanban';
import { printRomaneioRoutes, RomaneioDoc } from '@/lib/romaneioPrint';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';
import NewLoadDialog from '@/components/loads/NewLoadDialog';
import BatchReimportDialog from '@/components/loads/BatchReimportDialog';
import LoadAdvancedFilters, { EMPTY_LOAD_ADVANCED_FILTERS, LoadAdvancedFiltersValue } from '@/components/loads/LoadAdvancedFilters';
import AppliedFiltersChips, { buildAppliedChips } from '@/components/loads/AppliedFiltersChips';
import { exportLoadsCSV, exportLoadsPDF } from '@/lib/loadsExport';

const STATUS_COLORS: Record<string, string> = {
  delivered: 'bg-success/10 text-success',
  in_transit: 'bg-info/10 text-info',
  loaded: 'bg-info/10 text-info',
  divergent: 'bg-destructive/10 text-destructive',
  ready: 'bg-primary/10 text-primary',
  loading: 'bg-primary/10 text-primary',
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-warning/10 text-warning',
};

type DatePreset = 'all' | 'today' | '7' | '14' | '30' | 'custom';

const datePresetLabels: Record<DatePreset, string> = {
  all: 'Todas',
  today: 'Hoje',
  '7': '7 dias',
  '14': '14 dias',
  '30': '30 dias',
  custom: 'Personalizado',
};

const startOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const endOfDay = (date: Date) => {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
};

export default function Loads() {
  const navigate = useNavigate();
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('30');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [advFilters, setAdvFilters] = useState<LoadAdvancedFiltersValue>(EMPTY_LOAD_ADVANCED_FILTERS);

  const { data: loadsData, isLoading, refetch } = useLoads({ 
    search, 
    status: statusFilter === 'all' ? undefined : [statusFilter as any] 
  });
  const loads = loadsData?.items ?? [];
  const totalCountServer = loadsData?.total_count ?? 0;

  const { data: vehicles = [] } = useVehicles();
  const deleteOne = useDeleteLoad();
  const deleteBulk = useDeleteLoads();
  const holdMut = useHoldLoad();
  const unholdMut = useUnholdLoad();
  const [groupingOpen, setGroupingOpen] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  // Confirm dialogs
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // View mode
  const [viewMode, setViewMode] = useState<'table' | 'kanban'>('table');

  // Hold dialog
  const [holdTarget, setHoldTarget] = useState<Load | null>(null);
  const [holdReason, setHoldReason] = useState('');

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['pending_docs_count', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase
        .from('fiscal_documents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'confirmed')
        .eq('document_type', 'inbound')
        .is('load_id', null);
      if (error) return 0;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name, user_id').eq('tenant_id', currentTenant.id).eq('active', true).order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const now = new Date();
    const start = datePreset === 'today'
      ? startOfDay(now)
      : ['7', '14', '30'].includes(datePreset)
        ? startOfDay(new Date(now.getTime() - (Number(datePreset) - 1) * 24 * 60 * 60 * 1000))
        : datePreset === 'custom' && customStart
          ? startOfDay(new Date(`${customStart}T12:00:00`))
          : null;
    const end = datePreset === 'custom' && customEnd ? endOfDay(new Date(`${customEnd}T12:00:00`)) : endOfDay(now);
    const f = advFilters;
    const dateInRange = (raw: string | null | undefined, from: string, to: string) => {
      if (!from && !to) return true;
      if (!raw) return false;
      const d = new Date(raw).getTime();
      if (from && d < startOfDay(new Date(`${from}T12:00:00`)).getTime()) return false;
      if (to && d > endOfDay(new Date(`${to}T12:00:00`)).getTime()) return false;
      return true;
    };
    const opNorm = (s: string | null | undefined) =>
      String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return loads.filter(l => {
      if (q && !l.load_number.toLowerCase().includes(q) && !(l.vehicles?.plate || '').toLowerCase().includes(q) && !(l.destination || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      const createdAt = new Date(l.created_at);
      if (datePreset !== 'all' && start && createdAt < start) return false;
      if (datePreset !== 'all' && createdAt > end) return false;
      if (f.loadNumber && !l.load_number.toLowerCase().includes(f.loadNumber.toLowerCase())) return false;
      if (f.plate && !(l.vehicles?.plate || '').toLowerCase().includes(f.plate.toLowerCase())) return false;
      if (f.trailerPlate && !((l as any).trailer_plate || '').toLowerCase().includes(f.trailerPlate.toLowerCase())) return false;
      if (f.driverId && f.driverId !== 'all' && l.driver_id !== f.driverId) return false;
      if (f.statuses.length && !f.statuses.includes(l.status)) return false;
      if (f.cargoType && l.operation_type !== f.cargoType) return false;
      if (f.romexpTypes.length && !f.romexpTypes.some(t => opNorm(l.operation_type).includes(opNorm(t)))) return false;
      if (f.romaneioTypes.length && !f.romaneioTypes.some(t => opNorm(l.operation_type).includes(opNorm(t)))) return false;
      const hasManifest = !!(l.supplier_manifest || l.distribution_manifest || l.shipment_manifest || l.origin_manifest);
      if (f.manifest === 'yes' && !hasManifest) return false;
      if (f.manifest === 'no' && hasManifest) return false;
      const monitored = !!(l as any).monitored;
      if (f.monitored === 'yes' && !monitored) return false;
      if (f.monitored === 'no' && monitored) return false;
      const dedicated = !!(l as any).dedicated_vehicle;
      if (f.dedicated === 'yes' && !dedicated) return false;
      if (f.dedicated === 'no' && dedicated) return false;
      const ciotVal = String((l as any).ciot || '').trim();
      if (f.ciot === 'yes' && !ciotVal) return false;
      if (f.ciot === 'no' && ciotVal) return false;
      if (f.monitorResponsible && !opNorm((l as any).monitor_responsible).includes(opNorm(f.monitorResponsible))) return false;
      if (f.driverType && !opNorm((l as any).driver_type).includes(opNorm(f.driverType))) return false;
      if (f.smManager && !opNorm((l as any).sm_manager).includes(opNorm(f.smManager))) return false;
      if (f.smRelease && !opNorm((l as any).sm_release).includes(opNorm(f.smRelease))) return false;
      const mv = (l as any).merchandise_value;
      const mvNum = mv == null ? null : Number(mv);
      if (f.valueMin) { if (mvNum == null || mvNum < Number(f.valueMin)) return false; }
      if (f.valueMax) { if (mvNum == null || mvNum > Number(f.valueMax)) return false; }
      if (!dateInRange(l.created_at, f.emissionFrom, f.emissionTo)) return false;
      if (!dateInRange(l.actual_load_at, f.loadingFrom, f.loadingTo)) return false;
      if (!dateInRange((l as any).estimated_arrival_at, f.arrivalEstFrom, f.arrivalEstTo)) return false;
      if (!dateInRange((l as any).gate_departure_at, f.departureFrom, f.departureTo)) return false;
      if (!dateInRange((l as any).arrival_at, f.arrivalFrom, f.arrivalTo)) return false;
      if (f.remitter && !opNorm(l.origin).includes(opNorm(f.remitter))) return false;
      if (f.client && !opNorm(l.destination).includes(opNorm(f.client))) return false;
      if (f.city && !opNorm(l.destination).includes(opNorm(f.city))) return false;
      if (f.supplier && !opNorm(l.supplier_manifest).includes(opNorm(f.supplier))) return false;
      return true;
    });
  }, [customEnd, customStart, datePreset, loads, search, statusFilter, advFilters]);

  // Reset to first page whenever filters change result set or page size shrinks
  useEffect(() => { setPage(1); }, [search, statusFilter, datePreset, customStart, customEnd, advFilters, pageSize]);

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalCount);
  const paginated = useMemo(() => filtered.slice(pageStart, pageEnd), [filtered, pageStart, pageEnd]);

  const groupedByDay = useMemo(() => {
    return paginated.reduce((groups, load) => {
      const label = new Date(load.created_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
      groups[label] = groups[label] || [];
      groups[label].push(load);
      return groups;
    }, {} as Record<string, Load[]>);
  }, [paginated]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    loads.forEach(l => { counts[l.status] = (counts[l.status] || 0) + 1; });
    return counts;
  }, [loads]);

  const activeStatuses = ['planned', 'assembling', 'ready', 'loading', 'loaded', 'in_transit'] as const;

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(filtered.map(l => l.id)));
  }, [filtered]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelected(new Set());
  }, []);

  // Delete handlers
  const handleDeleteOne = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteOne.mutateAsync(confirmDeleteId);
      toast({ title: 'Carga excluída' });
      setSelected(prev => { const n = new Set(prev); n.delete(confirmDeleteId); return n; });
    } catch (e: any) {
      toast({ title: 'Erro ao excluir', description: e.message, variant: 'destructive' });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await deleteBulk.mutateAsync(ids);
      toast({ title: `${ids.length} carga(s) excluída(s)` });
      exitSelectionMode();
    } catch (e: any) {
      toast({ title: 'Erro ao excluir', description: e.message, variant: 'destructive' });
    } finally {
      setConfirmBulkDelete(false);
    }
  };

  const printRomaneio = useCallback(async (loadId: string) => {
    if (!currentTenant) return;
    try {
      const { data: load } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname, max_pallets), drivers(name)')
        .eq('id', loadId)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (!load) throw new Error('Carga não encontrada');

      const { data: items } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, value, weight_kg, issue_date, product_summary)')
        .eq('load_id', loadId)
        .order('created_at');

      const veh: any = (load as any).vehicles;
      const drv: any = (load as any).drivers;

      const fmtEmissao = (raw: any): string => {
        if (!raw) return '';
        const s = String(raw).substring(0, 10);
        const d = new Date(s + 'T12:00:00');
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
      };

      const docs: RomaneioDoc[] = (items || []).map((it: any) => {
        const fd = it.fiscal_documents || {};
        const emissao = fmtEmissao(fd.issue_date);
        return {
          city: fd.recipient_city || 'SEM CIDADE',
          state: fd.recipient_state || '',
          remetente: fd.remitter || '—',
          destinatario: fd.recipient || '—',
          bairro: fd.recipient_neighborhood || '—',
          nfNumber: fd.invoice_number || '—',
          emissao,
          valor: Number(fd.value) || 0,
          peso: Number(it.weight_kg) || Number(fd.weight_kg) || 0,
          volumes: Number(it.pallet_count) || 0,
        };
      });

      printRomaneioRoutes([{
        routeName: load.destination || load.load_number,
        vehicleInfo: veh ? `Veículo: ${veh.plate}${veh.nickname ? ` (${veh.nickname})` : ''}${veh.max_pallets ? ` - ${veh.max_pallets}p` : ''}` : undefined,
        driverInfo: drv ? `Motorista: ${drv.name}` : undefined,
        docs,
      }], `Romaneio ${load.load_number}`);

      toast({ title: 'Romaneio aberto para impressão' });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar romaneio', description: e.message, variant: 'destructive' });
    }
  }, [currentTenant, toast]);

  const printAllRomaneios = useCallback(async () => {
    if (!currentTenant || filtered.length === 0) return;
    try {
      const loadIds = filtered.map(l => l.id);
      const { data: fullLoads, error: loadsError } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname, max_pallets), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .in('id', loadIds);
      if (loadsError) throw loadsError;

      const { data: items, error: itemsError } = await supabase
        .from('load_items')
        .select('*, fiscal_documents(invoice_number, remitter, recipient, recipient_city, recipient_state, recipient_neighborhood, value, weight_kg, issue_date, product_summary)')
        .in('load_id', loadIds)
        .order('created_at');
      if (itemsError) throw itemsError;

      const fmtEmissao = (raw: any): string => {
        if (!raw) return '';
        const s = String(raw).substring(0, 10);
        const d = new Date(s + 'T12:00:00');
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
      };

      const itemsByLoad = new Map<string, any[]>();
      (items || []).forEach((item: any) => {
        const current = itemsByLoad.get(item.load_id) || [];
        current.push(item);
        itemsByLoad.set(item.load_id, current);
      });

      const loadsById = new Map((fullLoads || []).map((load: any) => [load.id, load]));
      const routes = loadIds.map(id => loadsById.get(id)).filter(Boolean).map((load: any) => {
        const veh: any = load.vehicles;
        const drv: any = load.drivers;
        const docs: RomaneioDoc[] = (itemsByLoad.get(load.id) || []).map((it: any) => {
          const fd = it.fiscal_documents || {};
          return {
            city: fd.recipient_city || 'SEM CIDADE',
            state: fd.recipient_state || '',
            remetente: fd.remitter || '—',
            destinatario: fd.recipient || '—',
            bairro: fd.recipient_neighborhood || '—',
            nfNumber: fd.invoice_number || '—',
            emissao: fmtEmissao(fd.issue_date),
            valor: Number(fd.value) || 0,
            peso: Number(it.weight_kg) || Number(fd.weight_kg) || 0,
            volumes: Number(it.pallet_count) || 0,
          };
        });

        return {
          routeName: load.destination || load.load_number,
          vehicleInfo: veh ? `Veículo: ${veh.plate}${veh.nickname ? ` (${veh.nickname})` : ''}${veh.max_pallets ? ` - ${veh.max_pallets}p` : ''}` : undefined,
          driverInfo: drv ? `Motorista: ${drv.name}` : undefined,
          docs,
        };
      });

      printRomaneioRoutes(routes, 'Romaneios de Cargas');
      toast({ title: 'Romaneios abertos para impressão' });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar romaneios', description: e.message, variant: 'destructive' });
    }
  }, [currentTenant, filtered, toast]);

  const selectedCount = selected.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));

  const submitHold = async () => {
    if (!holdTarget) return;
    try {
      await holdMut.mutateAsync({ id: holdTarget.id, reason: holdReason.trim() || undefined });
      toast({ title: 'Carga colocada em espera' });
      setHoldTarget(null);
      setHoldReason('');
    } catch (e: any) {
      toast({ title: 'Erro ao pausar', description: e.message, variant: 'destructive' });
    }
  };

  const doUnhold = async (id: string) => {
    try {
      await unholdMut.mutateAsync(id);
      toast({ title: 'Carga retomada' });
    } catch (e: any) {
      toast({ title: 'Erro ao retomar', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" /> Cargas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalCount === loads.length
              ? `${loads.length} cargas no total`
              : `${totalCount} de ${loads.length} cargas (filtros ativos)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            <Button
              size="sm"
              variant={viewMode === 'table' ? 'default' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setViewMode('table')}
            >
              <List className="h-4 w-4 mr-1" /> Tabela
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'kanban' ? 'default' : 'ghost'}
              className="h-7 px-2"
              onClick={() => setViewMode('kanban')}
            >
              <LayoutGrid className="h-4 w-4 mr-1" /> Kanban
            </Button>
          </div>
          {!selectionMode && (
            <Button size="sm" variant="outline" onClick={() => setSelectionMode(true)}>
              <CheckSquare className="h-4 w-4 mr-1" /> Selecionar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={printAllRomaneios} disabled={isLoading || filtered.length === 0}>
            <Printer className="h-4 w-4 mr-1" /> Reimprimir todas
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={isLoading || filtered.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  const ts = new Date().toISOString().slice(0, 10);
                  exportLoadsCSV(filtered as any, `cargas_${ts}.csv`);
                  toast({ title: `CSV exportado (${filtered.length} cargas)` });
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const ts = new Date().toISOString().slice(0, 10);
                  exportLoadsPDF(filtered as any, `cargas_${ts}.pdf`, 'Cargas / Romaneios');
                  toast({ title: `PDF exportado (${filtered.length} cargas)` });
                }}
              >
                <FileText className="h-4 w-4 mr-2" /> Exportar PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <BatchReimportDialog />
          {pendingCount > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setGroupingOpen(true)}>
              <FileStack className="h-4 w-4 mr-1" /> Agrupar NF-es
              <Badge className="ml-1.5 bg-primary text-primary-foreground text-[10px] px-1.5">{pendingCount}</Badge>
            </Button>
          )}
          <NewLoadDialog vehicles={vehicles} drivers={drivers} onCreated={refetch} />
        </div>
      </div>

      {/* Bulk action bar */}
      {selectionMode && (
        <div className="flex items-center gap-3 bg-muted/50 border border-border rounded-lg px-4 py-2">
          <Checkbox
            checked={allFilteredSelected}
            onCheckedChange={c => c ? selectAll() : deselectAll()}
          />
          <span className="text-sm text-muted-foreground">
            {selectedCount > 0 ? `${selectedCount} selecionada(s)` : 'Nenhuma selecionada'}
          </span>
          <div className="flex-1" />
          {selectedCount > 0 && (
            <Button size="sm" variant="destructive" onClick={() => setConfirmBulkDelete(true)} disabled={deleteBulk.isPending}>
              <Trash2 className="h-4 w-4 mr-1" /> Excluir {selectedCount}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={exitSelectionMode}>
            <X className="h-4 w-4 mr-1" /> Cancelar
          </Button>
        </div>
      )}

      {/* Status summary */}
      <div className="flex gap-2 flex-wrap">
        {activeStatuses.map(s => {
          const count = statusCounts[s] || 0;
          if (count === 0 && s !== 'planned') return null;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
                statusFilter === s ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s]?.split(' ')[0] || 'bg-muted'}`} />
              {LOAD_STATUS_LABELS[s]} <span className="font-bold">{count}</span>
            </button>
          );
        })}
        {(statusCounts['delivered'] || 0) > 0 && (
          <button
            onClick={() => setStatusFilter(statusFilter === 'delivered' ? 'all' : 'delivered')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border ${
              statusFilter === 'delivered' ? 'border-success bg-success/10 text-success' : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success" /> Entregues <span className="font-bold">{statusCounts['delivered']}</span>
          </button>
        )}
      </div>

      {/* Advanced filters */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <CalendarDays className="h-4 w-4" /> Filtros avançados por período
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(datePresetLabels) as DatePreset[]).map(preset => (
            <Button key={preset} type="button" size="sm" variant={datePreset === preset ? 'default' : 'outline'} className="h-8" onClick={() => setDatePreset(preset)}>
              {datePresetLabels[preset]}
            </Button>
          ))}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <Input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="h-8 w-36" />
              <span className="text-xs text-muted-foreground">até</span>
              <Input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="h-8 w-36" />
            </div>
          )}
        </div>
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar carga, placa ou destino..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
      </div>

      <LoadAdvancedFilters
        value={advFilters}
        onChange={setAdvFilters}
        drivers={drivers as any}
        vehicles={vehicles as any}
        trailerPlateSuggestions={Array.from(new Set(loads.map(l => (l as any).trailer_plate || '').filter(Boolean)))}
      />

      <AppliedFiltersChips
        chips={buildAppliedChips({
          search, setSearch,
          statusFilter, setStatusFilter,
          datePreset, setDatePreset,
          customStart, customEnd, setCustomStart, setCustomEnd,
          adv: advFilters, setAdv: setAdvFilters,
          drivers: drivers as any,
        })}
        onClearAll={() => {
          setSearch('');
          setStatusFilter('all');
          setDatePreset('all');
          setCustomStart('');
          setCustomEnd('');
          setAdvFilters(EMPTY_LOAD_ADVANCED_FILTERS);
        }}
      />

      {/* Load cards */}
      {isLoading ? (
        <div className="text-center text-muted-foreground py-12">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">Nenhuma carga encontrada</div>
      ) : viewMode === 'kanban' ? (
        <LoadsKanban loads={filtered} />
      ) : (
        <div className="space-y-5">
          {Object.entries(groupedByDay).map(([day, dayLoads]) => (
            <div key={day} className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> {day} <Badge variant="outline" className="text-[10px]">{dayLoads.length}</Badge>
              </div>
              <div className="grid gap-3">
          {dayLoads.map(l => {
            const veh = vehicles.find((v: any) => v.id === l.vehicle_id) as any;
            const maxP = veh?.max_pallets;
            const occ = maxP ? Math.round(((l.total_pallet_count || 0) / maxP) * 100) : null;
            const isSelected = selected.has(l.id);

            return (
              <Card
                key={l.id}
                className={`cursor-pointer hover:shadow-md transition-shadow border-l-4 ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
                style={{ borderLeftColor: l.status === 'divergent' ? 'hsl(var(--destructive))' : l.status === 'delivered' ? 'hsl(var(--success))' : ['in_transit', 'loaded'].includes(l.status) ? 'hsl(var(--info))' : 'hsl(var(--border))' }}
                onClick={() => selectionMode ? toggleSelect(l.id) : navigate(`/loads/${l.id}`)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    {selectionMode && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(l.id)}
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{l.load_number}</span>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[l.status] || ''}`}>
                          {LOAD_STATUS_LABELS[l.status] || l.status}
                        </Badge>
                        {(l as any).on_hold && (
                          <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning border-warning/30">
                            <PauseCircle className="h-3 w-3 mr-1" /> Em espera
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {l.vehicles && <span className="flex items-center gap-1"><Truck className="h-3 w-3" /> {l.vehicles.plate}</span>}
                        {l.drivers && <span>{l.drivers.name}</span>}
                        {l.destination && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {l.destination}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Paletes</div>
                        <div className="text-sm font-medium">{l.total_pallet_count || 0}{maxP ? <span className="text-muted-foreground font-normal">/{maxP}</span> : ''}</div>
                      </div>
                      {occ !== null && (
                        <div className="w-16">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${occ > 100 ? 'bg-destructive' : occ > 80 ? 'bg-warning' : 'bg-success'}`}
                              style={{ width: `${Math.min(occ, 100)}%` }}
                            />
                          </div>
                          <div className={`text-[10px] text-center mt-0.5 ${occ > 100 ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                            {occ}%
                          </div>
                        </div>
                      )}

                      {/* Individual actions menu */}
                      {!selectionMode && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={e => e.stopPropagation()}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate(`/loads/${l.id}`); }}>
                              Abrir detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); printRomaneio(l.id); }}>
                              <Printer className="h-4 w-4 mr-2" /> Reimprimir romaneio
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={e => { e.stopPropagation(); navigate('/route-planning'); }}>
                              <RouteIcon className="h-4 w-4 mr-2" /> Reanalisar na Roteirização
                            </DropdownMenuItem>
                            {(l as any).on_hold ? (
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); doUnhold(l.id); }}>
                                <PlayCircle className="h-4 w-4 mr-2" /> Retomar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); setHoldTarget(l); setHoldReason(''); }}>
                                <PauseCircle className="h-4 w-4 mr-2" /> Colocar em espera
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={e => { e.stopPropagation(); setConfirmDeleteId(l.id); }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Excluir
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}

                      {!selectionMode && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
              </div>
            </div>
          ))}

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground">
              {totalCount === 0 ? 'Nenhum resultado' : `Mostrando ${pageStart + 1}–${pageEnd} de ${totalCount}`}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Por página</span>
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 200].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 ml-2">
                <Button size="icon" variant="outline" className="h-8 w-8" disabled={safePage <= 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-8 w-8" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Página <span className="font-medium text-foreground">{safePage}</span> de {totalPages}
                </span>
                <Button size="icon" variant="outline" className="h-8 w-8" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-8 w-8" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PendingDocsGrouping
        open={groupingOpen}
        onOpenChange={setGroupingOpen}
        onCreated={() => { refetch(); }}
      />

      {/* Confirm single delete */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={o => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir carga?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A carga e seus vínculos serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteOne} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm bulk delete */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedCount} carga(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todas as cargas selecionadas serão removidas permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir {selectedCount} carga(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hold dialog */}
      <Dialog open={!!holdTarget} onOpenChange={o => { if (!o) { setHoldTarget(null); setHoldReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Colocar carga em espera</DialogTitle>
            <DialogDescription>
              A carga <strong>{holdTarget?.load_number}</strong> ficará fora do fluxo de despacho
              (não aparece em roteirização nem no app do motorista) até ser retomada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Motivo (opcional)</label>
            <Textarea
              value={holdReason}
              onChange={e => setHoldReason(e.target.value)}
              placeholder="Ex.: aguardando confirmação do cliente, veículo indisponível..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHoldTarget(null)}>Cancelar</Button>
            <Button onClick={submitHold} disabled={holdMut.isPending}>
              <PauseCircle className="h-4 w-4 mr-1" /> Colocar em espera
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
