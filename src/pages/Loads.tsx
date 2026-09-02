import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLoadsPage, useDeleteLoad, useDeleteLoads, LOAD_STATUS_LABELS, Load } from '@/hooks/useLoads';
import { useHoldLoad, useUnholdLoad } from '@/hooks/useLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { useDrivers } from '@/hooks/useDrivers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Search, PackageCheck, Truck, MapPin, ArrowRight, FileStack, Trash2, MoreVertical, X, CheckSquare, Printer, Route as RouteIcon, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, FileSpreadsheet, FileText, LayoutGrid, List, PauseCircle, PlayCircle, AlertCircle, RefreshCcw } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import LoadsKanban from '@/components/loads/LoadsKanban';
import { printRomaneioRoutes, RomaneioDoc } from '@/lib/romaneioPrint';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { Json } from '@/integrations/supabase/types';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';
import NewLoadDialog from '@/components/loads/NewLoadDialog';
import BatchReimportDialog from '@/components/loads/BatchReimportDialog';
import LoadAdvancedFilters from '@/components/loads/LoadAdvancedFilters';
import AppliedFiltersChips from '@/components/loads/AppliedFiltersChips';
import LoadAggregateRecoveryAlert from '@/components/loads/LoadAggregateRecoveryAlert';
import {
  buildAppliedLoadFilterChips,
  EMPTY_LOAD_ADVANCED_FILTERS,
  type LoadAdvancedFiltersValue,
  type LoadDatePreset,
} from '@/lib/loads/loadAdvancedFilters';
import { exportLoadsCSV, exportLoadsPDF } from '@/lib/loadsExport';
import { getErrorMessage } from '@/lib/errors';

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

const datePresetLabels: Record<LoadDatePreset, string> = {
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

const isLoadDatePreset = (value: string | null): value is LoadDatePreset =>
  value !== null && ['all', 'today', '7', '14', '30', 'custom'].includes(value);

function parseAdvancedFilters(value: string | null): LoadAdvancedFiltersValue {
  if (!value) return EMPTY_LOAD_ADVANCED_FILTERS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_LOAD_ADVANCED_FILTERS;
    const record = parsed as Record<string, unknown>;
    return {
      ...EMPTY_LOAD_ADVANCED_FILTERS,
      ...record,
      romexpTypes: Array.isArray(record.romexpTypes) ? record.romexpTypes.filter(item => typeof item === 'string') : [],
      statuses: Array.isArray(record.statuses) ? record.statuses.filter(item => typeof item === 'string') : [],
      romaneioTypes: Array.isArray(record.romaneioTypes) ? record.romaneioTypes.filter(item => typeof item === 'string') : [],
    } as LoadAdvancedFiltersValue;
  } catch {
    return EMPTY_LOAD_ADVANCED_FILTERS;
  }
}

export default function Loads() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const { data: vehicles = [] } = useVehicles();
  const deleteOne = useDeleteLoad();
  const deleteBulk = useDeleteLoads();
  const holdMut = useHoldLoad();
  const unholdMut = useUnholdLoad();

  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all');
  const initialDatePreset = searchParams.get('period');
  const [datePreset, setDatePreset] = useState<LoadDatePreset>(isLoadDatePreset(initialDatePreset) ? initialDatePreset : '30');
  const [customStart, setCustomStart] = useState(searchParams.get('from') || '');
  const [customEnd, setCustomEnd] = useState(searchParams.get('to') || '');
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [advFilters, setAdvFilters] = useState<LoadAdvancedFiltersValue>(() => parseAdvancedFilters(searchParams.get('af')));

  // Pagination
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const initialPageSize = Number(searchParams.get('pageSize'));
  const [pageSize, setPageSize] = useState([10, 25, 50, 100, 200].includes(initialPageSize) ? initialPageSize : 25);
  const mountedFilters = useRef(false);

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

  const debouncedSearch = useDebouncedValue(search, 300);
  const createdRange = useMemo(() => {
    const now = new Date();
    const start = datePreset === 'today'
      ? startOfDay(now)
      : ['7', '14', '30'].includes(datePreset)
        ? startOfDay(new Date(now.getTime() - (Number(datePreset) - 1) * 24 * 60 * 60 * 1000))
        : datePreset === 'custom' && customStart
          ? startOfDay(new Date(`${customStart}T12:00:00`))
          : null;
    const end = datePreset === 'all'
      ? null
      : datePreset === 'custom' && customEnd
        ? endOfDay(new Date(`${customEnd}T12:00:00`))
        : endOfDay(now);
    return {
      createdFrom: start?.toISOString() || '',
      createdTo: end?.toISOString() || '',
    };
  }, [customEnd, customStart, datePreset]);
  const pageFilters = useMemo<Record<string, Json>>(() => ({
    search: debouncedSearch,
    statusFilter,
    ...createdRange,
    ...advFilters,
  }), [advFilters, createdRange, debouncedSearch, statusFilter]);
  const {
    data: loadPage,
    isLoading,
    isError,
    refetch,
  } = useLoadsPage({ page, pageSize, filters: pageFilters });
  const loads = loadPage?.rows || [];
  const totalCount = loadPage?.totalCount || 0;
  const statusCounts = loadPage?.statusCounts || {};

  const { data: pendingCount = 0, isError: pendingCountFailed, refetch: refetchPendingCount } = useQuery({
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
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  const { data: drivers = [] } = useDrivers();

  // Reset to first page whenever filters change result set or page size shrinks
  useEffect(() => {
    if (!mountedFilters.current) {
      mountedFilters.current = true;
      return;
    }
    setPage(1);
  }, [debouncedSearch, statusFilter, datePreset, customStart, customEnd, advFilters, pageSize]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, totalCount);
  const filtered = loads;
  const paginated = loads;

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (datePreset !== '30') next.set('period', datePreset);
    if (customStart) next.set('from', customStart);
    if (customEnd) next.set('to', customEnd);
    const advanced = JSON.stringify(advFilters);
    if (advanced !== JSON.stringify(EMPTY_LOAD_ADVANCED_FILTERS)) next.set('af', advanced);
    if (page > 1) next.set('page', String(page));
    if (pageSize !== 25) next.set('pageSize', String(pageSize));
    setSearchParams(next, { replace: true });
  }, [advFilters, customEnd, customStart, datePreset, debouncedSearch, page, pageSize, setSearchParams, statusFilter]);

  const groupedByDay = useMemo(() => {
    return paginated.reduce((groups, load) => {
      const label = new Date(load.created_at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
      groups[label] = groups[label] || [];
      groups[label].push(load);
      return groups;
    }, {} as Record<string, Load[]>);
  }, [paginated]);

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
    const target = loads.find(load => load.id === confirmDeleteId);
    if (!target) {
      toast({ title: 'Carga desatualizada', description: 'Atualize a lista antes de excluir.', variant: 'destructive' });
      return;
    }
    try {
      await deleteOne.mutateAsync({ id: target.id, expectedVersion: target.version });
      toast({ title: 'Carga excluída' });
      setSelected(prev => { const n = new Set(prev); n.delete(confirmDeleteId); return n; });
    } catch (error: unknown) {
      toast({ title: 'Erro ao excluir', description: getErrorMessage(error), variant: 'destructive' });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const targets = ids.map(id => loads.find(load => load.id === id)).filter((load): load is Load => !!load);
    if (targets.length !== ids.length) {
      toast({ title: 'Seleção desatualizada', description: 'Atualize a lista antes de excluir.', variant: 'destructive' });
      return;
    }
    try {
      await deleteBulk.mutateAsync(targets.map(load => ({ id: load.id, expectedVersion: load.version })));
      toast({ title: `${ids.length} carga(s) excluída(s)` });
      exitSelectionMode();
    } catch (error: unknown) {
      toast({ title: 'Erro ao excluir', description: getErrorMessage(error), variant: 'destructive' });
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

      const veh = load.vehicles;
      const drv = load.drivers;

      const fmtEmissao = (raw: string | null): string => {
        if (!raw) return '';
        const s = String(raw).substring(0, 10);
        const d = new Date(s + 'T12:00:00');
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
      };

      const docs: RomaneioDoc[] = (items || []).map((it) => {
        const fd = it.fiscal_documents;
        const emissao = fmtEmissao(fd?.issue_date || null);
        return {
          city: fd?.recipient_city || 'SEM CIDADE',
          state: fd?.recipient_state || '',
          remetente: fd?.remitter || '—',
          destinatario: fd?.recipient || '—',
          bairro: fd?.recipient_neighborhood || '—',
          nfNumber: fd?.invoice_number || '—',
          emissao,
          valor: Number(fd?.value) || 0,
          peso: Number(it.weight_kg) || Number(fd?.weight_kg) || 0,
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
    } catch (error: unknown) {
      toast({ title: 'Erro ao gerar romaneio', description: getErrorMessage(error), variant: 'destructive' });
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

      const fmtEmissao = (raw: string | null): string => {
        if (!raw) return '';
        const s = String(raw).substring(0, 10);
        const d = new Date(s + 'T12:00:00');
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
      };

      const itemsByLoad = new Map<string, NonNullable<typeof items>>();
      (items || []).forEach((item) => {
        const current = itemsByLoad.get(item.load_id) || [];
        current.push(item);
        itemsByLoad.set(item.load_id, current);
      });

      const loadsById = new Map((fullLoads || []).map((load) => [load.id, load]));
      const routes = loadIds.map(id => loadsById.get(id)).filter((load): load is NonNullable<typeof load> => Boolean(load)).map((load) => {
        const veh = load.vehicles;
        const drv = load.drivers;
        const docs: RomaneioDoc[] = (itemsByLoad.get(load.id) || []).map((it) => {
          const fd = it.fiscal_documents;
          return {
            city: fd?.recipient_city || 'SEM CIDADE',
            state: fd?.recipient_state || '',
            remetente: fd?.remitter || '—',
            destinatario: fd?.recipient || '—',
            bairro: fd?.recipient_neighborhood || '—',
            nfNumber: fd?.invoice_number || '—',
            emissao: fmtEmissao(fd?.issue_date || null),
            valor: Number(fd?.value) || 0,
            peso: Number(it.weight_kg) || Number(fd?.weight_kg) || 0,
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
    } catch (error: unknown) {
      toast({ title: 'Erro ao gerar romaneios', description: getErrorMessage(error), variant: 'destructive' });
    }
  }, [currentTenant, filtered, toast]);

  const selectedCount = selected.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every(l => selected.has(l.id));

  const submitHold = async () => {
    if (!holdTarget) return;
    if (holdReason.trim().length < 5) {
      toast({ title: 'Informe o motivo', description: 'Use pelo menos 5 caracteres.', variant: 'destructive' });
      return;
    }
    try {
      await holdMut.mutateAsync({ id: holdTarget.id, expectedVersion: holdTarget.version, reason: holdReason.trim() });
      toast({ title: 'Carga colocada em espera' });
      setHoldTarget(null);
      setHoldReason('');
    } catch (error: unknown) {
      toast({ title: 'Erro ao pausar', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const doUnhold = async (load: Load) => {
    try {
      await unholdMut.mutateAsync({ id: load.id, expectedVersion: load.version });
      toast({ title: 'Carga retomada' });
    } catch (error: unknown) {
      toast({ title: 'Erro ao retomar', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      <LoadAggregateRecoveryAlert />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PackageCheck className="h-5 w-5 text-primary" /> Cargas
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalCount} cargas correspondem aos filtros
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
            <Printer className="h-4 w-4 mr-1" /> Reimprimir página
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
                  exportLoadsCSV(filtered, `cargas_${ts}.csv`);
                  toast({ title: `CSV exportado (${filtered.length} cargas)` });
                }}
              >
                <FileSpreadsheet className="h-4 w-4 mr-2" /> Exportar página em CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const ts = new Date().toISOString().slice(0, 10);
                  exportLoadsPDF(filtered, `cargas_${ts}.pdf`, 'Cargas / Romaneios');
                  toast({ title: `PDF exportado (${filtered.length} cargas)` });
                }}
              >
                <FileText className="h-4 w-4 mr-2" /> Exportar página em PDF
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
          {pendingCountFailed && (
            <Button size="sm" variant="outline" onClick={() => void refetchPendingCount()}>
              <AlertCircle className="h-4 w-4 mr-1 text-destructive" /> Falha ao contar NF-es
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
          {(Object.keys(datePresetLabels) as LoadDatePreset[]).map(preset => (
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
        drivers={drivers}
        vehicles={vehicles}
        trailerPlateSuggestions={Array.from(new Set(loads.map(load => load.trailer_plate || '').filter(Boolean)))}
      />

      <AppliedFiltersChips
        chips={buildAppliedLoadFilterChips({
          search, setSearch,
          statusFilter, setStatusFilter,
          datePreset, setDatePreset,
          customStart, customEnd, setCustomStart, setCustomEnd,
          adv: advFilters, setAdv: setAdvFilters,
          drivers,
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
      ) : isError ? (
        <Card role="alert" className="border-destructive/40">
          <CardContent className="py-12 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-destructive mx-auto" />
            <p className="font-medium">Não foi possível carregar as cargas</p>
            <p className="text-sm text-muted-foreground">A falha não foi convertida em uma lista vazia.</p>
            <Button type="button" variant="outline" onClick={() => void refetch()}>
              <RefreshCcw className="h-4 w-4 mr-2" /> Tentar novamente
            </Button>
          </CardContent>
        </Card>
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
            const veh = vehicles.find(vehicle => vehicle.id === l.vehicle_id);
            const maxP = veh?.max_pallets;
            const occ = maxP ? Math.round(((l.total_pallet_count || 0) / maxP) * 100) : null;
            const isSelected = selected.has(l.id);

            return (
              <Card
                key={l.id}
                className={`border-l-4 ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''}`}
                style={{ borderLeftColor: l.status === 'divergent' ? 'hsl(var(--destructive))' : l.status === 'delivered' ? 'hsl(var(--success))' : ['in_transit', 'loaded'].includes(l.status) ? 'hsl(var(--info))' : 'hsl(var(--border))' }}
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
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto p-0 text-sm font-semibold"
                          onClick={() => navigate(`/loads/${l.id}`)}
                        >
                          {l.load_number}
                        </Button>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[l.status] || ''}`}>
                          {LOAD_STATUS_LABELS[l.status] || l.status}
                        </Badge>
                        {l.on_hold && (
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
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações da carga ${l.load_number}`}>
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
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
                            {l.on_hold ? (
                              <DropdownMenuItem onClick={e => { e.stopPropagation(); doUnhold(l); }}>
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

                      {!selectionMode && <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
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
                <SelectTrigger className="h-8 w-20 text-xs" aria-label="Cargas por página"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 200].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 ml-2">
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Primeira página" disabled={safePage <= 1} onClick={() => setPage(1)}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Página anterior" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Página <span className="font-medium text-foreground">{safePage}</span> de {totalPages}
                </span>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Próxima página" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Última página" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)}>
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
            <label className="text-xs text-muted-foreground">Motivo</label>
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
