import { useState, useMemo, useCallback } from 'react';
import {
  useOperationalEvents, useCreateOperationalEvent, useUpdateOperationalEvent,
  useOperationalEventsFiltered,
  EVENT_TYPES, EVENT_TYPE_LABELS, SEVERITY_LABELS, OperationalEvent,
} from '@/hooks/useOperationalEvents';
import type { OperationalEventsFilters } from '@/hooks/useOperationalEvents';
import { useLoads } from '@/hooks/useLoads';
import { useClients } from '@/hooks/useClients';
import { useDrivers } from '@/hooks/useDrivers';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, AlertOctagon, CheckCircle, MessageSquare, Truck, User, Building2, Package, Wifi, ListOrdered, X, CalendarIcon, Loader2, Inbox, AlertTriangle, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ArrowUpToLine, Bookmark, BookmarkPlus, Trash2, Star, Download, ExternalLink, MapPinned } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { formatDistanceToNow, format, startOfMonth, subMonths, isAfter, startOfDay, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useEffect, useRef } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, PieChart, Pie, Cell, BarChart, Bar, LabelList } from 'recharts';
import { DriverConversation, EventConversation } from '@/components/driver/DriverConversation';

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
import { useAuth } from '@/hooks/useAuth';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatOccurrenceReport } from '@/lib/occurrenceTemplate';
import { Copy } from 'lucide-react';
import type { Json } from '@/integrations/supabase/types';
import type { JsonObject } from '@/lib/jsonTypes';

const TYPE_COLORS: Record<string, string> = {
  missing_goods: '#ec4899',
  wrong_quantity: '#f59e0b',
  client_refused: '#ef4444',
  no_order: '#6366f1',
  expired_goods: '#8b5cf6',
  near_expiration: '#a855f7',
  damaged: '#0ea5e9',
  wrong_address: '#10b981',
  partial_delivery: '#14b8a6',
  return: '#f97316',
  other: '#64748b',
};

// Mapa de responsabilidade por tipo de ocorrência (Depósito vs Transporte).
// Baseado no padrão do mercado: erros de separação/produto = Depósito;
// erros operacionais de entrega = Transporte.
const RESPONSIBILITY_MAP: Record<string, 'deposito' | 'transporte'> = {
  missing_goods: 'deposito',
  missing_goods_fractional: 'deposito',
  wrong_quantity: 'deposito',
  wrong_product: 'deposito',
  expired_goods: 'deposito',
  near_expiration: 'deposito',
  damaged: 'transporte',
  wrong_address: 'transporte',
  client_refused: 'transporte',
  no_order: 'transporte',
  partial_delivery: 'transporte',
  return: 'transporte',
  delivery_delay: 'transporte',
  boleto_extension: 'transporte',
  other: 'transporte',
};

const RESP_COLORS = { transporte: 'hsl(var(--primary))', deposito: 'hsl(var(--destructive))' };
const SEPARATION_LINES = ['PESADO', 'LEVEZA', 'FRACIONADO', 'MIUDEZA'] as const;
type SeparationLine = typeof SEPARATION_LINES[number];
type ResponsibilityFilter = 'all' | 'deposito' | 'transporte';

function getErrorMessage(error: unknown, fallback = 'Erro desconhecido.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function jsonRecord(value: Json | null | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function reportDetail(event: OperationalEvent, ...keys: string[]): Json | undefined {
  const details = jsonRecord(event.report_details);
  for (const key of keys) {
    if (details?.[key] !== undefined) return details[key];
  }
  return undefined;
}

function isSeparationLine(value: string): value is SeparationLine {
  return SEPARATION_LINES.some((line) => line === value);
}

// Cores para o painel "Ocorrências por Motorista" (estilo TudoEntregue)
const DRIVER_BAR_COLORS = {
  critical: 'hsl(var(--destructive))',
  high: '#f97316',     // laranja
  medium: '#f59e0b',   // amarelo/âmbar
  low: 'hsl(var(--success, 142 71% 45%))',
};

export default function OperationalEvents() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const {
    data: events = [],
    error: eventsError,
    isPending: isEventsPending,
    isError: isEventsError,
    refetch: refetchEvents,
  } = useOperationalEvents();

  // Scroll callback para o botão da torre
  const scrollToDetail = useCallback(() => {
    document.getElementById('detalhamento-ocorrencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 400);
  }, []);
  const { data: loads = [] } = useLoads();
  const { data: clients = [] } = useClients();
  const createEvent = useCreateOperationalEvent();
  const updateEvent = useUpdateOperationalEvent();
  const pendingCommand = createEvent.pendingCommand || updateEvent.pendingCommand;
  const commandRecoveryError = createEvent.recoveryError || updateEvent.recoveryError;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NonNullable<OperationalEventsFilters['status']>>('open');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [vehicleFilter, setVehicleFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [loadFilter, setLoadFilter] = useState<string>('all');
  const [impactMin, setImpactMin] = useState<string>('');
  const [impactMax, setImpactMax] = useState<string>('');
  const [hasImpactOnly, setHasImpactOnly] = useState(false);
  const [respFilter, setRespFilter] = useState<ResponsibilityFilter>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [driverPanelSearch, setDriverPanelSearch] = useState('');
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [chatDriver, setChatDriver] = useState<{ id: string; name: string } | null>(null);
  type DriverSort = 'total' | 'critical' | 'severity' | 'name';
  const [driverSort, setDriverSort] = useState<DriverSort>('total');
  const debouncedSearch = useDebouncedValue(search, 300);
  // Filtros aplicados no servidor (Supabase) — performance para frotas grandes
  const {
    data: tableEvents = [],
    isLoading: isTableLoading,
    isError: isTableError,
    error: tableError,
    isFetching: isTableFetching,
    refetch: refetchTable,
  } = useOperationalEventsFiltered({
    status: statusFilter,
    type: typeFilter,
    severity: severityFilter,
    vehicleId: vehicleFilter,
    dateFrom,
    dateTo,
    driverId: driverFilter,
    clientId: clientFilter,
    loadId: loadFilter,
    impactMin: impactMin === '' ? null : Number(impactMin),
    impactMax: impactMax === '' ? null : Number(impactMax),
    hasImpact: hasImpactOnly,
    search: debouncedSearch,
    responsibility: respFilter,
  });
  type SortKey = 'created_at' | 'event_type' | 'severity' | 'load_number' | 'client' | 'driver' | 'financial_impact';
  const SORT_STORAGE_KEY = 'opEvents.sort.v1';
  const PAGE_SIZE_STORAGE_KEY = 'opEvents.pageSize.v1';
  const loadSort = (): { key: SortKey; dir: 'asc' | 'desc' } => {
    if (typeof window === 'undefined') return { key: 'created_at', dir: 'desc' };
    try {
      const raw = localStorage.getItem(SORT_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.key && p?.dir) return { key: p.key as SortKey, dir: p.dir };
      }
    } catch {
      // Reverte para a ordenação padrão quando a preferência local é inválida.
    }
    return { key: 'created_at', dir: 'desc' };
  };
  const initialSort = loadSort();
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort.dir);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === 'undefined') return 25;
    const raw = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return [10, 25, 50, 100].includes(raw) ? raw : 25;
  });

  // Persistir escolha do usuário
  useEffect(() => {
    try { localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir })); } catch {
      // A ordenação continua ativa na sessão mesmo sem storage local.
    }
  }, [sortKey, sortDir]);
  useEffect(() => {
    try { localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize)); } catch {
      // A paginação continua ativa na sessão mesmo sem storage local.
    }
  }, [pageSize]);

  // ====== Presets de filtros (por usuário) ======
  type PresetFilters = {
    search?: string; status?: string; type?: string; severity?: string; vehicleId?: string;
    dateFromISO?: string | null; dateToISO?: string | null;
  };
  type Preset = { id: string; name: string; filters: PresetFilters; builtin?: boolean };
  const PRESETS_KEY = `opEvents.presets.v1.${user?.id || 'anon'}`;
  const todayISO = () => startOfDay(new Date()).toISOString();
  const BUILTIN_PRESETS: Preset[] = [
    { id: 'builtin:critical-today', name: 'Críticas hoje', builtin: true,
      filters: { status: 'open', severity: 'critical', dateFromISO: todayISO() } },
    { id: 'builtin:high-open', name: 'Alta severidade abertas', builtin: true,
      filters: { status: 'open', severity: 'high' } },
    { id: 'builtin:open-7d', name: 'Abertas últimos 7 dias', builtin: true,
      filters: { status: 'open', dateFromISO: subDays(startOfDay(new Date()), 7).toISOString() } },
    { id: 'builtin:resolved-7d', name: 'Resolvidas últimos 7 dias', builtin: true,
      filters: { status: 'resolved', dateFromISO: subDays(startOfDay(new Date()), 7).toISOString() } },
  ];
  const [customPresets, setCustomPresets] = useState<Preset[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      setCustomPresets(raw ? JSON.parse(raw) : []);
    } catch { setCustomPresets([]); }
  }, [PRESETS_KEY]);
  const persistPresets = (next: Preset[]) => {
    setCustomPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {
      // Preserva o preset em memória quando a persistência local falha.
    }
  };
  const applyPreset = (p: Preset) => {
    const f = p.filters;
    setSearch(f.search ?? '');
    const nextStatus = f.status ?? 'all';
    setStatusFilter(nextStatus === 'open' || nextStatus === 'resolved' ? nextStatus : 'all');
    setTypeFilter(f.type ?? 'all');
    setSeverityFilter(f.severity ?? 'all');
    setVehicleFilter(f.vehicleId ?? 'all');
    setDateFrom(f.dateFromISO ? new Date(f.dateFromISO) : undefined);
    setDateTo(f.dateToISO ? new Date(f.dateToISO) : undefined);
    toast({ title: 'Preset aplicado', description: p.name });
  };
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const saveCurrentAsPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const preset: Preset = {
      id: `custom:${Date.now()}`,
      name,
      filters: {
        search, status: statusFilter, type: typeFilter, severity: severityFilter,
        vehicleId: vehicleFilter,
        dateFromISO: dateFrom ? dateFrom.toISOString() : null,
        dateToISO: dateTo ? dateTo.toISOString() : null,
      },
    };
    persistPresets([preset, ...customPresets]);
    setNewPresetName('');
    setSavePresetOpen(false);
    toast({ title: 'Preset salvo', description: name });
  };
  const deletePreset = (id: string) => {
    persistPresets(customPresets.filter(p => p.id !== id));
  };

  // ====== Exportar relatório (XLSX no formato modelo) ======
  const [exporting, setExporting] = useState(false);
  const exportReport = async (opts: { driverName?: string; format?: 'xlsx' | 'csv' } = {}) => {
    const fmt = opts.format || 'xlsx';
    // Aplica filtro por motorista (sobre a lista JÁ ordenada/filtrada)
    const baseRows = opts.driverName
      ? sorted.filter(e => (e.drivers?.name?.trim() || 'Sem motorista') === opts.driverName)
      : sorted;
    if (!baseRows.length) {
      toast({ title: 'Nada para exportar', description: 'Ajuste os filtros para gerar resultados.' });
      return;
    }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');

      // ---------- Aba 1: Detalhe (lista plana, ordem atual) ----------
      const detailHeaders = [
        'Quando', 'Tipo', 'Severidade', 'Status', 'Carga', 'Cliente', 'Motorista',
        'Veículo', 'Impacto (R$)', 'Descrição', 'Resolvido em',
      ];
      const detailRows = baseRows.map((e) => [
        format(new Date(e.created_at), 'dd/MM/yyyy HH:mm'),
        EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] || e.event_type || '',
        SEVERITY_LABELS[e.severity] || e.severity || '',
        e.resolved_at ? 'Resolvida' : 'Aberta',
        e.loads?.load_number || '',
        e.clients?.company_name || '',
        e.drivers?.name || '',
        e.vehicles?.plate || '',
        e.financial_impact != null ? Number(e.financial_impact) : '',
        (e.description || '').replace(/\s+/g, ' ').trim(),
        e.resolved_at ? format(new Date(e.resolved_at), 'dd/MM/yyyy HH:mm') : '',
      ]);

      // ---------- Saída CSV (apenas Detalhe, com BOM e ; como separador) ----------
      const baseName = opts.driverName
        ? `ocorrencias_${opts.driverName.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${format(new Date(), 'yyyyMMdd_HHmm')}`
        : `ocorrencias_${format(new Date(), 'yyyyMMdd_HHmm')}`;
      if (fmt === 'csv') {
        const escape = (v: unknown) => {
          const s = v == null ? '' : String(v);
          return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [detailHeaders, ...detailRows]
          .map(r => r.map(escape).join(';'))
          .join('\r\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: 'CSV exportado', description: `${baseRows.length} ocorrência(s)${opts.driverName ? ` — ${opts.driverName}` : ''}.` });
        setExporting(false);
        return;
      }

      // ---------- Aba 2: Resumo por motorista (modelo da planilha) ----------
      // Buscar cargas no período para entregas/notas/valor por motorista
      const periodFrom = dateFrom || (baseRows.length
        ? new Date(Math.min(...baseRows.map((e) => +new Date(e.created_at))))
        : startOfMonth(new Date()));
      const periodTo = dateTo || new Date();
      const loadsByDriver: Record<string, { entregas: number; notas: number; valor: number }> = {};
      if (currentTenant) {
        let lq = supabase
          .from('loads')
          .select('driver_id, merchandise_value, status, created_at')
          .eq('tenant_id', currentTenant.id)
          .gte('created_at', periodFrom.toISOString())
          .lte('created_at', periodTo.toISOString())
          .limit(5000);
        // Restringe por motorista quando exportando individual
        if (opts.driverName) {
          const driverIds = Array.from(new Set(baseRows.map((e) => e.driver_id).filter((id): id is string => Boolean(id))));
          if (driverIds.length) lq = lq.in('driver_id', driverIds as string[]);
        }
        const { data: loadsRows } = await lq;
        for (const l of (loadsRows || [])) {
          if (!l.driver_id) continue;
          const k = l.driver_id;
          loadsByDriver[k] = loadsByDriver[k] || { entregas: 0, notas: 0, valor: 0 };
          loadsByDriver[k].entregas += 1;
          loadsByDriver[k].notas += 1;
          loadsByDriver[k].valor += Number(l.merchandise_value || 0);
        }
      }

      // Agrupa ocorrências por motorista
      type Acc = {
        name: string;
        nao_efetuada_motorista: number;
        nao_efetuada: number;
        baixa_nao_efetuada: number;
        comprovantes_nao_entregues: number;
        devolucoes: number;
        danif_qtd: number; danif_valor: number;
        falta_qtd: number; falta_valor: number;
        observacao: string;
      };
      const driverMap = new Map<string, Acc>();
      const keyFor = (e: OperationalEvent) => e.driver_id || `__sem__:${e.drivers?.name || 'Sem motorista'}`;
      for (const e of baseRows) {
        const k = keyFor(e);
        const cur: Acc = driverMap.get(k) || {
          name: e.drivers?.name || 'Sem motorista',
          nao_efetuada_motorista: 0, nao_efetuada: 0, baixa_nao_efetuada: 0,
          comprovantes_nao_entregues: 0, devolucoes: 0,
          danif_qtd: 0, danif_valor: 0, falta_qtd: 0, falta_valor: 0, observacao: '',
        };
        const v = Number(e.financial_impact || 0);
        switch (e.event_type) {
          case 'client_refused':
          case 'wrong_address':
          case 'no_order':
            cur.nao_efetuada += 1; break;
          case 'partial_delivery':
            cur.nao_efetuada_motorista += 1; break;
          case 'return':
            cur.devolucoes += 1; break;
          case 'damaged':
            cur.danif_qtd += 1; cur.danif_valor += v; break;
          case 'missing_goods':
          case 'wrong_quantity':
          case 'expired_goods':
          case 'near_expiration':
            cur.falta_qtd += 1; cur.falta_valor += v; break;
          default:
            cur.observacao = (cur.observacao ? cur.observacao + ' | ' : '') + (EVENT_TYPE_LABELS[e.event_type] || e.event_type);
        }
        driverMap.set(k, cur);
      }

      const drivers = Array.from(driverMap.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'));
      const periodLabel = `${format(periodFrom, 'dd/MM/yyyy')} a ${format(periodTo, 'dd/MM/yyyy')}`;

      // Cabeçalho mesclado em 3 linhas (modelo)
      const aoa: unknown[][] = [];
      aoa.push([`RESUMO DIVERGÊNCIAS — ${periodLabel}${opts.driverName ? ` — ${opts.driverName}` : ''}`]);
      aoa.push([]);
      // Linha 3: grupos
      aoa.push([
        'Motorista',
        'Cargas', 'Notas', 'Valor Entregue (R$)',
        'Ocorrências (Qtd)',
        'Não efetuada (Motorista)',
        'Não efetuada (Outros)',
        'Baixa pendente',
        'Canhoto pendente',
        'Devoluções (Qtd)',
        'Avaria (Qtd)', 'Avaria (R$)',
        'Falta (Qtd)', 'Falta (R$)',
        'Km Inicial', 'Km Final',
        'Observação',
      ]);
      // Linha 4: subcabeçalhos
      aoa.push([
        '',
        '', '', '',
        '',
        '',
        '',
        '',
        '',
        '',
        '', '',
        '', '',
        '', '',
        '',
      ]);

      // Linhas dos motoristas
      const totals = {
        entregas: 0, notas: 0, valor: 0, ocorrencias: 0,
        nao_efetuada_motorista: 0, nao_efetuada: 0, baixa: 0, comp: 0, devol: 0,
        dq: 0, dv: 0, fq: 0, fv: 0,
      };
      for (const [id, a] of drivers) {
        const ld = (id && loadsByDriver[id]) || { entregas: 0, notas: 0, valor: 0 };
        const ocorrencias = a.nao_efetuada_motorista + a.nao_efetuada + a.devolucoes + a.danif_qtd + a.falta_qtd;
        aoa.push([
          a.name,
          ld.entregas || 0, ld.notas || 0, ld.valor || 0,
          ocorrencias || 0,
          a.nao_efetuada_motorista || 0,
          a.nao_efetuada || 0,
          a.baixa_nao_efetuada || 0,
          a.comprovantes_nao_entregues || 0,
          a.devolucoes || 0,
          a.danif_qtd || 0, a.danif_valor || 0,
          a.falta_qtd || 0, a.falta_valor || 0,
          '', '', // Km Initial/Final
          a.observacao || '',
        ]);
        totals.entregas += ld.entregas; totals.notas += ld.notas; totals.valor += ld.valor;
        totals.ocorrencias += ocorrencias;
        totals.nao_efetuada_motorista += a.nao_efetuada_motorista;
        totals.nao_efetuada += a.nao_efetuada;
        totals.baixa += a.baixa_nao_efetuada;
        totals.comp += a.comprovantes_nao_entregues;
        totals.devol += a.devolucoes;
        totals.dq += a.danif_qtd; totals.dv += a.danif_valor;
        totals.fq += a.falta_qtd; totals.fv += a.falta_valor;
      }
      aoa.push([]);
      aoa.push([
        'TOTAL',
        totals.entregas, totals.notas, totals.valor,
        totals.ocorrencias,
        totals.nao_efetuada_motorista, totals.nao_efetuada,
        totals.baixa, totals.comp, totals.devol,
        totals.dq, totals.dv, totals.fq, totals.fv,
        '', '', // Km Total placeholders
        '',
      ]);

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      // Merges (linhas em índice 0-based dentro do array `aoa`)
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 15 } }, // título (estendido para 16 colunas)
        { s: { r: 2, c: 1 }, e: { r: 2, c: 2 } }, // Entregas (qtd + notas)
        { s: { r: 2, c: 10 }, e: { r: 2, c: 11 } }, // Produtos danificados
        { s: { r: 2, c: 12 }, e: { r: 2, c: 13 } }, // Falta de produtos
        { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } }, // Motorista
        { s: { r: 2, c: 3 }, e: { r: 3, c: 3 } }, // Valor
        { s: { r: 2, c: 4 }, e: { r: 3, c: 4 } }, // Ocorrências
        { s: { r: 2, c: 5 }, e: { r: 3, c: 5 } },
        { s: { r: 2, c: 6 }, e: { r: 3, c: 6 } },
        { s: { r: 2, c: 7 }, e: { r: 3, c: 7 } },
        { s: { r: 2, c: 8 }, e: { r: 3, c: 8 } },
        { s: { r: 2, c: 9 }, e: { r: 3, c: 9 } },
        { s: { r: 2, c: 14 }, e: { r: 3, c: 14 } },
      ];
      ws['!cols'] = [
        { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
        { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 32 },
      ];

      const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
      wsDetail['!cols'] = [
        { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 10 }, { wch: 14 },
        { wch: 24 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 60 }, { wch: 16 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Resumo por motorista');
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalhe');
      XLSX.writeFile(wb, `${baseName}.xlsx`);

      toast({ title: 'Relatório exportado', description: `${baseRows.length} ocorrência(s)${opts.driverName ? ` — ${opts.driverName}` : ''} em 2 abas.` });
    } catch (err: unknown) {
      toast({ title: 'Falha ao exportar', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<OperationalEvent | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);

  const focusSearch = () => {
    setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 350);
  };

  const { data: drivers = [] } = useDrivers();
  const { data: vehicles = [] } = useVehicles();

  // Realtime sync para sincronização ida/volta com app do motorista
  useEffect(() => {
    if (!currentTenant) return undefined;
    const channel = supabase
      .channel('operational_events_live')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'operational_events', filter: `tenant_id=eq.${currentTenant.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['operational_events'] });
          qc.invalidateQueries({ queryKey: ['operational_events_filtered'] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentTenant, qc]);

  const [form, setForm] = useState({
    event_type: 'missing_goods' as string,
    severity: 'medium',
    load_id: '',
    client_id: '',
    driver_id: '',
    description: '',
    financial_impact: 0,
  });

  // O reader só libera `tableEvents` depois de percorrer o cursor até o fim.
  // Busca e responsabilidade também são vinculadas ao escopo do cursor no servidor.
  const filtered = tableEvents;

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    const cmpStr = (a: string, b: string) => a.localeCompare(b, 'pt-BR') * dir;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'created_at': return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case 'event_type': return cmpStr(EVENT_TYPE_LABELS[a.event_type] || '', EVENT_TYPE_LABELS[b.event_type] || '');
        case 'severity': return ((SEVERITY_ORDER[a.severity] || 0) - (SEVERITY_ORDER[b.severity] || 0)) * dir;
        case 'load_number': return cmpStr(a.loads?.load_number || '', b.loads?.load_number || '');
        case 'client': return cmpStr(a.clients?.company_name || '', b.clients?.company_name || '');
        case 'driver': return cmpStr(a.drivers?.name || '', b.drivers?.name || '');
        case 'financial_impact': return ((Number(a.financial_impact) || 0) - (Number(b.financial_impact) || 0)) * dir;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = useMemo(() => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize), [sorted, currentPage, pageSize]);

  // Reset to first page on filter/sort/pageSize changes
  useEffect(() => { setPage(1); }, [search, statusFilter, typeFilter, severityFilter, vehicleFilter, dateFrom, dateTo, sortKey, sortDir, pageSize, driverFilter, clientFilter, loadFilter, impactMin, impactMax, hasImpactOnly, respFilter]);

  // Scroll para a âncora ao abrir com hash (#detalhamento-ocorrencias)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash === '#detalhamento-ocorrencias') {
      setTimeout(() => {
        document.getElementById('detalhamento-ocorrencias')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        focusSearch();
      }, 100);
    }
  }, []);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'created_at' || k === 'severity' || k === 'financial_impact' ? 'desc' : 'asc'); }
  };
  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={className}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </TableHead>
  );

  const activeFiltersCount = (statusFilter !== 'open' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) +
    (severityFilter !== 'all' ? 1 : 0) + (vehicleFilter !== 'all' ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (search ? 1 : 0) +
    (driverFilter !== 'all' ? 1 : 0) + (clientFilter !== 'all' ? 1 : 0) + (loadFilter !== 'all' ? 1 : 0) +
    (impactMin !== '' ? 1 : 0) + (impactMax !== '' ? 1 : 0) + (hasImpactOnly ? 1 : 0) + (respFilter !== 'all' ? 1 : 0);
  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('open'); setTypeFilter('all'); setSeverityFilter('all');
    setVehicleFilter('all'); setDateFrom(undefined); setDateTo(undefined);
    setDriverFilter('all'); setClientFilter('all'); setLoadFilter('all');
    setImpactMin(''); setImpactMax(''); setHasImpactOnly(false); setRespFilter('all');
  };

  // ===== Chart data: últimos 12 meses, séries por tipo =====
  const { chartData, chartTypes, totals, totalCount } = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = startOfMonth(subMonths(now, i));
      months.push({ key: format(d, 'yyyy-MM'), label: format(d, 'MMM/yy', { locale: ptBR }) });
    }
    const cutoff = subMonths(now, 12);
    const recent = events.filter(e => isAfter(new Date(e.created_at), cutoff));
    const typeSet = new Set<string>();
    const totalsMap: Record<string, number> = {};
    recent.forEach(e => { typeSet.add(e.event_type); totalsMap[e.event_type] = (totalsMap[e.event_type] || 0) + 1; });
    const types = Array.from(typeSet);
    const data = months.map(m => {
      const row: Record<string, string | number> = { month: m.label };
      types.forEach(t => { row[t] = 0; });
      recent.forEach(e => {
        if (format(new Date(e.created_at), 'yyyy-MM') === m.key) row[e.event_type] = Number(row[e.event_type] || 0) + 1;
      });
      return row;
    });
    return { chartData: data, chartTypes: types, totals: totalsMap, totalCount: recent.length };
  }, [events]);

  // ===== Responsabilidade (Depósito vs Transporte) e Linhas de Separação =====
  // Usa o conjunto JÁ FILTRADO (tableEvents) para refletir período/filtros ativos.
  const { responsibilityData, separationData, respTotal, sepTotal, periodLabel } = useMemo(() => {
    const src = tableEvents || [];
    const resp = { transporte: 0, deposito: 0 };
    const sep: Record<string, number> = { PESADO: 0, LEVEZA: 0, FRACIONADO: 0, MIUDEZA: 0 };
    let outros = 0;
    src.forEach(e => {
      const r = RESPONSIBILITY_MAP[e.event_type] || 'transporte';
      resp[r]++;
      const rawLine = reportDetail(e, 'separation_line', 'linha_separacao', 'linha')
        || '';
      const norm = String(rawLine).trim().toUpperCase();
      if (isSeparationLine(norm)) sep[norm]++;
      else if (norm) outros++;
    });
    if (outros > 0) sep.OUTROS = outros;
    const respArr = [
      { name: 'TRANSPORTE', value: resp.transporte, key: 'transporte' as const },
      { name: 'DEPÓSITO', value: resp.deposito, key: 'deposito' as const },
    ].filter(d => d.value > 0);
    const sepArr = Object.entries(sep)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: k, value: v }));
    const respT = resp.transporte + resp.deposito;
    const sepT = sepArr.reduce((s, d) => s + d.value, 0);
    let label = 'período selecionado';
    if (dateFrom || dateTo) {
      const f = dateFrom ? format(dateFrom, 'dd/MM/yy') : '...';
      const t = dateTo ? format(dateTo, 'dd/MM/yy') : 'hoje';
      label = `${f} - ${t}`;
    }
    return { responsibilityData: respArr, separationData: sepArr, respTotal: respT, sepTotal: sepT, periodLabel: label };
  }, [tableEvents, dateFrom, dateTo]);

  // ===== Ocorrências por Motorista (estilo TudoEntregue: barra empilhada + total) =====
  const driverStats = useMemo(() => {
    const map = new Map<string, { name: string; critical: number; high: number; medium: number; low: number; resolved: number; total: number }>();
    (tableEvents || []).forEach(e => {
      const name = e.drivers?.name?.trim() || 'Sem motorista';
      const cur = map.get(name) || { name, critical: 0, high: 0, medium: 0, low: 0, resolved: 0, total: 0 };
      const sev = (e.severity || 'medium') as 'critical' | 'high' | 'medium' | 'low';
      if (e.resolved_at) {
        cur.resolved++;
      } else if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') {
        cur[sev]++;
      } else {
        cur.medium++;
      }
      cur.total++;
      map.set(name, cur);
    });
    const arr = Array.from(map.values());
    const max = arr.reduce((m, r) => Math.max(m, r.total), 0);
    return { rows: arr, max };
  }, [tableEvents]);

  const filteredDriverRows = useMemo(() => {
    const q = driverPanelSearch.trim().toLowerCase();
    const base = q ? driverStats.rows.filter(r => r.name.toLowerCase().includes(q)) : driverStats.rows.slice();
    // Score de "severidade mais alta" (peso por severidade — só não resolvidas)
    const sevScore = (r: typeof base[number]) =>
      r.critical * 1000 + r.high * 100 + r.medium * 10 + r.low;
    switch (driverSort) {
      case 'critical':
        base.sort((a, b) => (b.critical - a.critical) || (b.high - a.high) || (b.total - a.total));
        break;
      case 'severity':
        base.sort((a, b) => (sevScore(b) - sevScore(a)) || (b.total - a.total));
        break;
      case 'name':
        base.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        break;
      case 'total':
      default:
        base.sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'pt-BR'));
    }
    return base;
  }, [driverStats.rows, driverPanelSearch, driverSort]);

  // Eventos agrupados por motorista (mesma fonte/ordem de tableEvents)
  const eventsByDriver = useMemo(() => {
    const m = new Map<string, OperationalEvent[]>();
    (tableEvents || []).forEach(e => {
      const name = e.drivers?.name?.trim() || 'Sem motorista';
      const arr = m.get(name) || [];
      arr.push(e);
      m.set(name, arr);
    });
    return m;
  }, [tableEvents]);

  const handleCreate = async () => {
    try {
      await createEvent.mutateAsync({
        ...form,
        load_id: form.load_id || null,
        client_id: form.client_id || null,
        driver_id: form.driver_id || null,
      });
      toast({ title: 'Ocorrência registrada' });
      setDialogOpen(false);
      setForm({ event_type: 'missing_goods', severity: 'medium', load_id: '', client_id: '', driver_id: '', description: '', financial_impact: 0 });
    } catch (e: unknown) {
      toast({ title: 'Erro', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const handleResolve = async (evt: OperationalEvent) => {
    try {
      await updateEvent.mutateAsync({ id: evt.id, resolution: 'Resolvido pela operação' });
      toast({ title: 'Ocorrência resolvida' });
    } catch (e: unknown) {
      toast({ title: 'Erro', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const handleRecoverCommand = async () => {
    try {
      const result = await createEvent.recoverAsync();
      toast({ title: result.action === 'resolve' ? 'Resolução recuperada e confirmada' : 'Ocorrência recuperada e confirmada' });
      if (result.action === 'create') {
        setDialogOpen(false);
        setForm({ event_type: 'missing_goods', severity: 'medium', load_id: '', client_id: '', driver_id: '', description: '', financial_impact: 0 });
      }
    } catch (error) {
      toast({ title: 'Recuperação pendente', description: getErrorMessage(error), variant: 'destructive' });
    }
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return 'bg-destructive/10 text-destructive';
    if (s === 'high') return 'bg-orange-500/10 text-orange-500';
    if (s === 'medium') return 'bg-warning/10 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  const openCount = events.filter(e => !e.resolved_at).length;
  const criticalCount = events.filter(e => !e.resolved_at && (e.severity === 'high' || e.severity === 'critical')).length;
  const last24hCount = events.filter(e => Date.now() - new Date(e.created_at).getTime() < 24 * 3600 * 1000).length;
  const totalImpact = events.reduce((s, e) => s + (Number(e.financial_impact) || 0), 0);
  const totalsUnavailable = isEventsPending || isEventsError;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-destructive" /> Ocorrências
            <Badge
              variant="outline"
              className={cn(
                'ml-2 gap-1 text-[10px] font-normal',
                isEventsError ? 'border-destructive/30 text-destructive' : 'border-success/30 text-success',
              )}
            >
              {isEventsPending
                ? <><Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> consultando</>
                : isEventsError
                  ? <><AlertTriangle aria-hidden="true" className="h-3 w-3" /> indisponível</>
                  : <><Wifi aria-hidden="true" className="h-3 w-3" /> sincronizado</>}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEventsPending
              ? 'Consultando o histórico integrado com o app do motorista…'
              : isEventsError
                ? 'Totais indisponíveis. A falha não foi interpretada como ausência de ocorrências.'
                : `${openCount} abertas · ${events.length} total · sincronia em tempo real com o app do motorista`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={scrollToDetail}>
            <ListOrdered className="h-4 w-4 mr-1.5" /> Ir para Detalhamento
          </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button disabled={!!pendingCommand}><Plus className="h-4 w-4 mr-2" /> Nova Ocorrência</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Registrar Ocorrência</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severidade</Label>
                  <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Carga</Label>
                  <Select value={form.load_id} onValueChange={v => setForm(f => ({ ...f, load_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{loads.map(l => <SelectItem key={l.id} value={l.id}>{l.load_number}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Motorista</Label>
                  <Select value={form.driver_id} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><Label>Impacto Financeiro (R$)</Label><Input type="number" value={form.financial_impact} onChange={e => setForm(f => ({ ...f, financial_impact: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={createEvent.isPending}>Registrar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {(pendingCommand || commandRecoveryError) && (
        <Card role="alert" className="border-warning/30 bg-warning/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span>{commandRecoveryError || `Existe uma ${pendingCommand?.action === 'resolve' ? 'resolução' : 'ocorrência'} sem confirmação. Recupere o mesmo pedido antes de continuar.`}</span>
            {pendingCommand && <Button size="sm" variant="outline" onClick={handleRecoverCommand} disabled={createEvent.isPending || updateEvent.isPending}>Recuperar solicitação</Button>}
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Abertas" value={totalsUnavailable ? '—' : openCount} accent="bg-destructive/10 text-destructive" />
        <KpiCard label="Críticas / Altas" value={totalsUnavailable ? '—' : criticalCount} accent="bg-orange-500/10 text-orange-500" />
        <KpiCard label="Últimas 24h" value={totalsUnavailable ? '—' : last24hCount} accent="bg-primary/10 text-primary" />
        <KpiCard label="Impacto financeiro" value={totalsUnavailable ? '—' : `R$ ${totalImpact.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} accent="bg-warning/10 text-warning" />
      </div>

      {/* Filtros Avançados (recolhível) */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors rounded-t-lg">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Filtros avançados</span>
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {activeFiltersCount} ativo(s)
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activeFiltersCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); clearAllFilters(); }}
                  >
                    <X className="h-3 w-3 mr-1" /> Limpar
                  </Button>
                )}
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', advancedOpen && 'rotate-180')} />
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4 pt-1 space-y-3 border-t">
              {/* Linha 1: Busca + Status + Severidade + Responsabilidade */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">
                <div className="lg:col-span-2 relative">
                  <Label className="text-xs text-muted-foreground">Busca livre</Label>
                  <Search className="absolute left-2.5 top-[30px] h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    placeholder="Descrição, carga, motorista, cliente..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select value={statusFilter} onValueChange={(value) => {
                    if (value === 'all' || value === 'open' || value === 'resolved') setStatusFilter(value);
                  }}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="open">Abertas</SelectItem>
                      <SelectItem value="resolved">Resolvidas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Severidade</Label>
                  <Select value={severityFilter} onValueChange={setSeverityFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Linha 2: Tipo + Responsabilidade + Veículo + Motorista */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Tipo de ocorrência</Label>
                  <Select value={typeFilter} onValueChange={setTypeFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Responsabilidade</Label>
                  <Select value={respFilter} onValueChange={(v) => {
                    if (v === 'all' || v === 'deposito' || v === 'transporte') setRespFilter(v);
                  }}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="transporte">Transporte</SelectItem>
                      <SelectItem value="deposito">Depósito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Veículo</Label>
                  <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Motorista</Label>
                  <Select value={driverFilter} onValueChange={setDriverFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="all">Todos</SelectItem>
                      {drivers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Linha 3: Cliente + Carga + Datas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Cliente</Label>
                  <Select value={clientFilter} onValueChange={setClientFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="all">Todos</SelectItem>
                      {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Carga</Label>
                  <Select value={loadFilter} onValueChange={setLoadFilter}>
                    <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="all">Todas</SelectItem>
                      {loads.map((l) => <SelectItem key={l.id} value={l.id}>{l.load_number}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">De</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('h-9 mt-1 w-full justify-start text-left font-normal', !dateFrom && 'text-muted-foreground')}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateFrom ? format(dateFrom, 'dd/MM/yyyy') : 'Início'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn('p-3 pointer-events-auto')} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Até</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('h-9 mt-1 w-full justify-start text-left font-normal', !dateTo && 'text-muted-foreground')}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateTo ? format(dateTo, 'dd/MM/yyyy') : 'Fim'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn('p-3 pointer-events-auto')} />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              {/* Linha 4: Impacto financeiro */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">Impacto mínimo (R$)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={impactMin}
                    onChange={e => setImpactMin(e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Impacto máximo (R$)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="∞"
                    value={impactMax}
                    onChange={e => setImpactMax(e.target.value)}
                    className="h-9 mt-1"
                  />
                </div>
                <div className="flex items-center gap-2 h-9">
                  <Switch id="has-impact" checked={hasImpactOnly} onCheckedChange={setHasImpactOnly} />
                  <Label htmlFor="has-impact" className="text-xs cursor-pointer">Apenas com impacto financeiro</Label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" className="h-9" onClick={clearAllFilters} disabled={activeFiltersCount === 0}>
                    <X className="h-3.5 w-3.5 mr-1" /> Limpar tudo
                  </Button>
                </div>
              </div>

              <div id="detalhamento-ocorrencias" className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <span className="text-[11px] text-muted-foreground uppercase tracking-wide">Período rápido:</span>
                {[
                  { label: 'Hoje', from: startOfDay(new Date()) },
                  { label: '7 dias', from: subDays(startOfDay(new Date()), 7) },
                  { label: '30 dias', from: subDays(startOfDay(new Date()), 30) },
                  { label: '90 dias', from: subDays(startOfDay(new Date()), 90) },
                ].map(p => (
                  <Button
                    key={p.label}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => { setDateFrom(p.from); setDateTo(undefined); }}
                  >
                    {p.label}
                  </Button>
                ))}
                {(dateFrom || dateTo) && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                    <X className="h-3 w-3 mr-1" /> período
                  </Button>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* CHART em cima */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Total de Ocorrências</CardTitle>
              <CardDescription>Últimos 12 meses por tipo</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isEventsPending ? (
            <div role="status" className="h-64 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Carregando histórico de ocorrências…
            </div>
          ) : isEventsError ? (
            <div role="alert" className="h-64 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-destructive">Histórico indisponível. Nenhum gráfico vazio foi presumido.</p>
              <p className="text-xs text-muted-foreground">{getErrorMessage(eventsError, 'Verifique sua conexão.')}</p>
              <Button size="sm" variant="outline" onClick={() => { void refetchEvents(); }}>
                <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 mr-2" /> Tentar novamente
              </Button>
            </div>
          ) : chartTypes.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              Sem dados nos últimos 12 meses
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value, name) => [value, EVENT_TYPE_LABELS[name as keyof typeof EVENT_TYPE_LABELS] || name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => EVENT_TYPE_LABELS[v as keyof typeof EVENT_TYPE_LABELS] || v} />
                  {chartTypes.map(t => (
                    <Line key={t} type="monotone" dataKey={t} stroke={TYPE_COLORS[t] || '#64748b'} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Type chips com totais (estilo TudoEntregue) */}
          {chartTypes.length > 0 && (
            <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => setTypeFilter('all')}
                className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${typeFilter === 'all' ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-muted'}`}
              >
                Total <span className="font-semibold ml-1">{totalCount}</span>
              </button>
              {chartTypes
                .sort((a, b) => (totals[b] || 0) - (totals[a] || 0))
                .map(t => {
                  const c = totals[t] || 0;
                  const pct = totalCount ? ((c / totalCount) * 100).toFixed(1) : '0';
                  const color = TYPE_COLORS[t] || '#64748b';
                  const active = typeFilter === t;
                  return (
                    <button
                      key={t}
                      onClick={() => { setTypeFilter(active ? 'all' : t); scrollToDetail(); }}
                      className={`text-xs rounded-full pl-2 pr-3 py-1.5 border flex items-center gap-2 transition-all ${active ? 'border-foreground shadow-sm' : 'hover:bg-muted'}`}
                      style={{ borderColor: active ? color : undefined }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                      <span>{EVENT_TYPE_LABELS[t as keyof typeof EVENT_TYPE_LABELS] || t}</span>
                      <span className="font-semibold">{c}</span>
                      <span className="text-muted-foreground">{pct}%</span>
                    </button>
                  );
                })}
            </div>

            {/* Cards grandes por categoria (estilo TudoEntregue) */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-3">
              {chartTypes
                .sort((a, b) => (totals[b] || 0) - (totals[a] || 0))
                .map(t => {
                  const c = totals[t] || 0;
                  const pct = totalCount ? ((c / totalCount) * 100).toFixed(2).replace('.', ',') : '0,00';
                  const color = TYPE_COLORS[t] || '#64748b';
                  const active = typeFilter === t;
                  return (
                    <button
                      key={`card-${t}`}
                      onClick={() => { setTypeFilter(active ? 'all' : t); scrollToDetail(); }}
                      className={`group relative rounded-lg border-2 bg-card p-3 text-left transition-all hover:shadow-md ${active ? 'shadow-md ring-2 ring-offset-1' : ''}`}
                      style={{ borderColor: color, ...(active ? { '--tw-ring-color': color } : {}) } as React.CSSProperties}
                      title={`Filtrar por ${EVENT_TYPE_LABELS[t as keyof typeof EVENT_TYPE_LABELS] || t}`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-foreground">{c}</span>
                        <span className="text-muted-foreground">|</span>
                        <span className="text-base font-semibold" style={{ color }}>{pct}%</span>
                      </div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground leading-tight line-clamp-2">
                        {EVENT_TYPE_LABELS[t as keyof typeof EVENT_TYPE_LABELS] || t}
                      </div>
                    </button>
                  );
                })}
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Responsabilidade + Linhas de Separação (estilo relatório AGV) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-wide text-center">
              Responsabilidade das Ocorrências{periodLabel !== 'período selecionado' ? ` ${periodLabel}` : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isTableLoading ? (
              <div role="status" className="h-64 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Carregando responsabilidade…
              </div>
            ) : isTableError ? (
              <div className="h-64 flex items-center justify-center px-6 text-center text-sm text-destructive">
                Responsabilidade indisponível enquanto a consulta não puder ser confirmada.
              </div>
            ) : respTotal === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Sem dados no período
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={responsibilityData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) =>
                        `${name}\n${(percent * 100).toFixed(1)}%`
                      }
                      labelLine={true}
                    >
                      {responsibilityData.map(d => (
                        <Cell key={d.key} fill={RESP_COLORS[d.key]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(value, name) => [`${value} (${((Number(value) / respTotal) * 100).toFixed(1)}%)`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 flex justify-center gap-4 text-xs">
              {responsibilityData.map(d => (
                <div key={d.key} className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: RESP_COLORS[d.key] }} />
                  <span className="font-semibold">{d.name}</span>
                  <span className="text-muted-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold uppercase tracking-wide text-center">
              Ocorrências por Linhas de Separação{periodLabel !== 'período selecionado' ? ` ${periodLabel}` : ''}
            </CardTitle>
            <CardDescription className="text-center text-[11px]">
              Origem: campo "linha de separação" da ocorrência
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isTableLoading ? (
              <div role="status" className="h-64 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Carregando linhas de separação…
              </div>
            ) : isTableError ? (
              <div className="h-64 flex items-center justify-center px-6 text-center text-sm text-destructive">
                Linhas de separação indisponíveis enquanto a consulta não puder ser confirmada.
              </div>
            ) : sepTotal === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-sm text-muted-foreground gap-1">
                <span>Sem dados de linha de separação no período</span>
                <span className="text-xs">Drivers/operadores devem informar a linha ao registrar a ocorrência.</span>
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={separationData} margin={{ top: 16, right: 16, left: 0, bottom: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                      formatter={(value) => [`${value} ocorrência(s)`, 'Total']}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {separationData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={d.name === 'MIUDEZA' ? 'hsl(var(--warning))' : 'hsl(var(--destructive))'}
                        />
                      ))}
                      <LabelList dataKey="value" position="center" fill="#fff" style={{ fontSize: 12, fontWeight: 700 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="text-center text-[11px] text-muted-foreground mt-1">
              Contagem de LINHA DE SEPARAÇÃO
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ocorrências por Motorista (estilo TudoEntregue: barra empilhada + total) */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-sm font-bold uppercase tracking-wide">
              Ocorrências por Motorista{periodLabel !== 'período selecionado' ? ` ${periodLabel}` : ''}
            </CardTitle>
            <CardDescription className="text-[11px]">
              Total de motoristas: {isTableLoading || isTableError ? '—' : driverStats.rows.length}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={driverSort} onValueChange={(v) => setDriverSort(v as DriverSort)}>
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <ArrowUpDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Mais ocorrências</SelectItem>
                <SelectItem value="critical">Mais críticas</SelectItem>
                <SelectItem value="severity">Severidade mais alta</SelectItem>
                <SelectItem value="name">Nome (A→Z)</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Digite o nome do motorista"
                value={driverPanelSearch}
                onChange={(e) => setDriverPanelSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isTableLoading ? (
            <div role="status" className="h-32 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Carregando ocorrências por motorista…
            </div>
          ) : isTableError ? (
            <div className="h-32 flex items-center justify-center px-6 text-center text-sm text-destructive">
              Ocorrências por motorista indisponíveis enquanto a consulta não puder ser confirmada.
            </div>
          ) : filteredDriverRows.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
              {driverStats.rows.length === 0 ? 'Sem ocorrências no período' : 'Nenhum motorista corresponde à busca'}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto] items-center text-[10px] uppercase tracking-wide text-muted-foreground pb-2 border-b border-border/60 px-1">
                <span>Motorista</span>
                <span className="pr-1">Total</span>
              </div>
              <div className="divide-y divide-border/60 max-h-[460px] overflow-y-auto">
                {filteredDriverRows.map((r, idx) => {
                  const widthPct = driverStats.max > 0 ? Math.max(8, (r.total / driverStats.max) * 100) : 0;
                  const seg = (n: number) => (r.total > 0 ? (n / r.total) * 100 : 0);
                  // Avatar color por índice (paleta suave) — emula foto de perfil
                  const palette = ['#fde68a', '#bfdbfe', '#fecaca', '#bbf7d0', '#ddd6fe', '#fcd5b5', '#a5f3fc', '#fbcfe8'];
                  const bg = palette[idx % palette.length];
                  const initials = r.name.split(' ').filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '—';
                  // "rating" derivado: 5 - peso da severidade média (apenas visual)
                  const weight = (r.critical * 4 + r.high * 3 + r.medium * 2 + r.low * 1 + r.resolved * 0) / Math.max(1, r.total);
                  const rating = Math.max(1, Math.min(5, 5 - weight));
                  const isExpanded = expandedDriver === r.name;
                  const driverEvents = eventsByDriver.get(r.name) || [];
                  return (
                    <div key={r.name}>
                    <button
                      type="button"
                       onClick={() => {
                         const next = isExpanded ? null : r.name;
                         setExpandedDriver(next);
                         setSearch(next ?? '');
                         setPage(1);
                         if (next) scrollToDetail();
                       }}
                      className={cn(
                        'w-full grid grid-cols-[1fr_auto] items-center gap-3 py-3 px-1 text-left hover:bg-muted/40 transition-colors rounded-sm',
                        isExpanded && 'bg-muted/40'
                      )}
                      aria-expanded={isExpanded}
                      title={isExpanded ? 'Recolher ocorrências' : 'Expandir ocorrências'}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform shrink-0', !isExpanded && '-rotate-90')} />
                        {/* Avatar */}
                        <div
                          className="h-9 w-9 rounded-full flex items-center justify-center text-[11px] font-bold text-foreground/80 shrink-0 ring-2 ring-background shadow-sm"
                          style={{ backgroundColor: bg }}
                        >
                          {initials}
                        </div>
                        {/* Nome + estrelas + barra */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold truncate" title={r.name}>{r.name}</span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              {[1, 2, 3, 4, 5].map(i => (
                                <Star
                                  key={i}
                                  className={cn(
                                    'h-3 w-3',
                                    i <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
                                  )}
                                />
                              ))}
                              <span className="text-[10px] text-muted-foreground ml-1 tabular-nums">{rating.toFixed(2)}</span>
                            </div>
                          </div>
                          {/* Barra horizontal — width relativa ao maior total */}
                          <div
                            className="mt-1.5 h-5 rounded-sm bg-muted/40 overflow-hidden flex"
                            style={{ width: `${widthPct}%` }}
                          >
                            {r.resolved > 0 && (
                              <div
                                className="h-full flex items-center justify-center text-[11px] font-bold text-white"
                                style={{ width: `${seg(r.resolved)}%`, backgroundColor: DRIVER_BAR_COLORS.low }}
                                title={`Resolvidas: ${r.resolved}`}
                              >
                                {seg(r.resolved) >= 7 ? r.resolved : ''}
                              </div>
                            )}
                            {r.low > 0 && (
                              <div
                                className="h-full flex items-center justify-center text-[11px] font-bold text-white"
                                style={{ width: `${seg(r.low)}%`, backgroundColor: DRIVER_BAR_COLORS.medium }}
                                title={`Baixas: ${r.low}`}
                              >
                                {seg(r.low) >= 7 ? r.low : ''}
                              </div>
                            )}
                            {r.medium > 0 && (
                              <div
                                className="h-full flex items-center justify-center text-[11px] font-bold text-white"
                                style={{ width: `${seg(r.medium)}%`, backgroundColor: DRIVER_BAR_COLORS.high }}
                                title={`Médias: ${r.medium}`}
                              >
                                {seg(r.medium) >= 7 ? r.medium : ''}
                              </div>
                            )}
                            {(r.high + r.critical) > 0 && (
                              <div
                                className="h-full flex items-center justify-center text-[11px] font-bold text-white"
                                style={{ width: `${seg(r.high + r.critical)}%`, backgroundColor: DRIVER_BAR_COLORS.critical }}
                                title={`Altas/Críticas: ${r.high + r.critical}`}
                              >
                                {seg(r.high + r.critical) >= 7 ? r.high + r.critical : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <span className="w-10 text-right text-base font-bold tabular-nums">{r.total}</span>
                    </button>
                    {isExpanded && (
                      <div className="bg-muted/20 border-l-2 border-primary/40 ml-2 mb-2 rounded-r-md">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40">
                          <span className="text-[11px] text-muted-foreground">
                            {driverEvents.length} ocorrência(s) — respeita filtros e ordenação atuais
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="default"
                              size="sm"
                              className="h-7 px-2 gap-1 text-[11px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                const drvId = driverEvents[0]?.driver_id || driverEvents[0]?.drivers?.id;
                                if (drvId) setChatDriver({ id: drvId, name: r.name });
                              }}
                              disabled={!(driverEvents[0]?.driver_id || driverEvents[0]?.drivers?.id)}
                              title="Abrir chat direto com o motorista (tempo real)"
                            >
                              <MessageSquare className="h-3 w-3" /> Chat
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 gap-1 text-[11px]"
                              disabled={exporting || driverEvents.length === 0}
                              onClick={(e) => { e.stopPropagation(); exportReport({ driverName: r.name, format: 'xlsx' }); }}
                              title="Exportar XLSX (apenas este motorista)"
                            >
                              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} XLSX
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 gap-1 text-[11px]"
                              disabled={exporting || driverEvents.length === 0}
                              onClick={(e) => { e.stopPropagation(); exportReport({ driverName: r.name, format: 'csv' }); }}
                              title="Exportar CSV (apenas este motorista)"
                            >
                              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} CSV
                            </Button>
                          </div>
                        </div>
                        {driverEvents.length === 0 ? (
                          <div className="px-4 py-3 text-xs text-muted-foreground">Nenhuma ocorrência neste período.</div>
                        ) : (
                          <ul className="divide-y divide-border/40">
                            {driverEvents.map(ev => (
                              <li key={ev.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                                <span
                                  className={cn(
                                    'h-2 w-2 rounded-full shrink-0',
                                    ev.resolved_at ? 'bg-emerald-500'
                                      : ev.severity === 'critical' ? 'bg-destructive'
                                      : ev.severity === 'high' ? 'bg-orange-500'
                                      : ev.severity === 'medium' ? 'bg-amber-500'
                                      : 'bg-yellow-500'
                                  )}
                                />
                                <span className="font-medium truncate flex-1" title={ev.description || ''}>
                                  {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                                  {ev.loads?.load_number && (
                                    <span className="text-muted-foreground font-normal"> · Carga {ev.loads.load_number}</span>
                                  )}
                                  {ev.clients?.company_name && (
                                    <span className="text-muted-foreground font-normal"> · {ev.clients.company_name}</span>
                                  )}
                                </span>
                                <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                                  {SEVERITY_LABELS[ev.severity] || ev.severity}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                                  {format(new Date(ev.created_at), 'dd/MM HH:mm')}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 gap-1 text-[10px]"
                                  onClick={(e) => { e.stopPropagation(); setSelectedEvent(ev); }}
                                  title="Abrir ocorrência"
                                >
                                  Abrir <ExternalLink className="h-3 w-3" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: DRIVER_BAR_COLORS.low }} />
                  <span className="text-muted-foreground">Resolvidas</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: DRIVER_BAR_COLORS.medium }} />
                  <span className="text-muted-foreground">Baixas</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: DRIVER_BAR_COLORS.high }} />
                  <span className="text-muted-foreground">Médias</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: DRIVER_BAR_COLORS.critical }} />
                  <span className="text-muted-foreground">Altas / Críticas</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Filtros + Tabela detalhada */}
      <div id="detalhamento-ocorrencias" className="flex gap-2 items-center flex-wrap scroll-mt-4">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input ref={searchRef} placeholder="Buscar (descrição, carga, motorista, cliente)..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <Bookmark className="h-4 w-4" /> Presets
              {customPresets.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{customPresets.length}</Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs">Sugeridos</DropdownMenuLabel>
            {BUILTIN_PRESETS.map(p => (
              <DropdownMenuItem key={p.id} onClick={() => applyPreset(p)} className="cursor-pointer">
                <Star className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Meus presets</DropdownMenuLabel>
            {customPresets.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum preset salvo.</div>
            ) : customPresets.map(p => (
              <DropdownMenuItem key={p.id} onClick={() => applyPreset(p)} className="cursor-pointer group">
                <Bookmark className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span className="flex-1 truncate">{p.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); deletePreset(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive ml-2"
                  aria-label="Excluir preset"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={(e) => { e.preventDefault(); setSavePresetOpen(true); }} className="cursor-pointer">
              <BookmarkPlus className="h-3.5 w-3.5 mr-2" />
              Salvar filtros atuais...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Salvar preset de filtros</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Label htmlFor="preset-name">Nome</Label>
              <Input
                id="preset-name"
                placeholder="Ex.: Críticas frota refrigerada"
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCurrentAsPreset(); }}
                autoFocus
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setSavePresetOpen(false)}>Cancelar</Button>
                <Button size="sm" onClick={saveCurrentAsPreset} disabled={!newPresetName.trim()}>Salvar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        <Select value={statusFilter} onValueChange={(value) => {
          if (value === 'all' || value === 'open' || value === 'resolved') setStatusFilter(value);
        }}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="open">Abertas</SelectItem>
            <SelectItem value="resolved">Resolvidas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Severidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda severidade</SelectItem>
            {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={vehicleFilter} onValueChange={setVehicleFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Veículo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os veículos</SelectItem>
            {vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.plate}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select
          value={`${sortKey}:${sortDir}`}
          onValueChange={(v) => {
            const [k, d] = v.split(':') as [SortKey, 'asc' | 'desc'];
            setSortKey(k); setSortDir(d);
          }}
        >
          <SelectTrigger className="w-52"><SelectValue placeholder="Ordenar por" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at:desc">Mais recentes primeiro</SelectItem>
            <SelectItem value="created_at:asc">Mais antigas primeiro</SelectItem>
            <SelectItem value="severity:desc">Severidade (maior → menor)</SelectItem>
            <SelectItem value="severity:asc">Severidade (menor → maior)</SelectItem>
            <SelectItem value="financial_impact:desc">Impacto (maior → menor)</SelectItem>
            <SelectItem value="financial_impact:asc">Impacto (menor → maior)</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-9 justify-start text-left font-normal', !dateFrom && 'text-muted-foreground')}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {dateFrom ? format(dateFrom, 'dd/MM/yy') : 'De'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn('h-9 justify-start text-left font-normal', !dateTo && 'text-muted-foreground')}>
              <CalendarIcon className="h-4 w-4 mr-2" />
              {dateTo ? format(dateTo, 'dd/MM/yy') : 'Até'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus className={cn('p-3 pointer-events-auto')} />
          </PopoverContent>
        </Popover>
        {activeFiltersCount > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-9 text-muted-foreground">
            <X className="h-4 w-4 mr-1" /> Limpar ({activeFiltersCount})
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => exportReport()} className="h-9" disabled={!sorted.length || exporting} title="Exportar relatório XLSX (resumo por motorista + detalhe)">
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Exportar XLSX
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportReport({ format: 'csv' })} className="h-9" disabled={!sorted.length || exporting} title="Exportar CSV (lista detalhada)">
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          CSV
        </Button>
        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-2">
          {(isTableFetching && !isTableLoading) && <Loader2 className="h-3 w-3 animate-spin" />}
          {isTableError
            ? 'Resultados indisponíveis'
            : isTableLoading
              ? 'Consultando todas as páginas…'
              : `${sorted.length} resultado(s) · fim da consulta confirmado`}
        </span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento das ocorrências</CardTitle>
          <CardDescription>Clique numa linha para abrir o detalhe e o chat com o motorista.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead k="event_type" label="Tipo" />
                <SortHead k="severity" label="Severidade" />
                <SortHead k="load_number" label="Carga" />
                <TableHead>Parada</TableHead>
                <SortHead k="client" label="Cliente" />
                <SortHead k="driver" label="Motorista" />
                <SortHead k="financial_impact" label="Impacto" />
                <SortHead k="created_at" label="Quando" />
                <TableHead className="w-28 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isTableLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><div className="h-4 bg-muted/60 rounded animate-pulse" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isTableError ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                        <AlertTriangle className="h-6 w-6 text-destructive" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">Não foi possível carregar as ocorrências</p>
                        <p className="text-xs text-muted-foreground mt-1">{getErrorMessage(tableError, 'Erro desconhecido. Verifique sua conexão.')}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => refetchTable()}>
                        <RefreshCw className="h-3.5 w-3.5 mr-2" /> Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Inbox className="h-6 w-6 text-muted-foreground" />
                      </div>
                      {!isEventsPending && !isEventsError && events.length === 0 ? (
                        <>
                          <div>
                            <p className="text-sm font-medium text-foreground">Nenhuma ocorrência registrada</p>
                            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                              Quando o motorista reportar uma avaria, recusa ou outra ocorrência pelo app, ela aparece aqui em tempo real.
                            </p>
                          </div>
                          <Button size="sm" onClick={() => setDialogOpen(true)}>
                            <Plus className="h-3.5 w-3.5 mr-2" /> Registrar manualmente
                          </Button>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-sm font-medium text-foreground">Nenhum resultado para os filtros aplicados</p>
                            {!isEventsPending && !isEventsError ? (
                              <p className="text-xs text-muted-foreground mt-1">
                                Existem {events.length} ocorrência(s) no total. Ajuste os filtros para visualizá-las.
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-1">
                                A consulta filtrada foi concluída, mas o total geral ainda não está disponível.
                              </p>
                            )}
                          </div>
                          {activeFiltersCount > 0 && (
                            <Button size="sm" variant="outline" onClick={clearAllFilters}>
                              <X className="h-3.5 w-3.5 mr-2" /> Limpar filtros
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : paged.map(e => (
                <TableRow key={e.id} className={`cursor-pointer hover:bg-muted/50 ${e.resolved_at ? 'opacity-60' : ''}`} onClick={() => setSelectedEvent(e)}>
                  <TableCell className="text-sm font-medium">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[e.event_type] || '#64748b' }} />
                      {EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] || e.event_type}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline" className={severityColor(e.severity)}>{SEVERITY_LABELS[e.severity] || e.severity}</Badge></TableCell>
                  <TableCell className="text-sm">{e.loads?.load_number || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {reportDetail(e, 'stop_order') ? `Parada ${String(reportDetail(e, 'stop_order'))}` : '—'}
                  </TableCell>
                  <TableCell className="text-sm">{e.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.drivers?.name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.financial_impact ? `R$ ${e.financial_impact.toLocaleString('pt-BR')}` : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}</TableCell>
                  <TableCell className="text-right" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedEvent(e)} title="Abrir chat">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </Button>
                      {!e.resolved_at && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleResolve(e)} title="Resolver" disabled={updateEvent.isPending || !!pendingCommand}>
                          <CheckCircle className="h-4 w-4 text-success" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
        {sorted.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border flex-wrap">
            <div className="text-xs text-muted-foreground">
              Mostrando {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} de {sorted.length}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Por página</span>
              <Select value={String(pageSize)} onValueChange={v => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[72px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 ml-2">
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setPage(1)}><ChevronsLeft className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft className="h-4 w-4" /></Button>
                <span className="text-xs text-muted-foreground px-2">{currentPage} / {totalPages}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><ChevronRight className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}><ChevronsRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="flex justify-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            if (window.location.hash) {
              window.history.pushState(null, '', window.location.pathname + window.location.search);
            }
          }}
        >
          <ArrowUpToLine className="h-4 w-4 mr-2" /> Voltar ao topo
        </Button>
      </div>

      <EventDetailDrawer
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
        onResolve={handleResolve}
        isResolving={updateEvent.isPending || !!pendingCommand}
      />

      <DriverChatDrawer
        driver={chatDriver}
        onClose={() => setChatDriver(null)}
      />
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className={`mt-1 inline-flex items-center text-xl font-bold rounded-md px-2 py-0.5 ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function EventDetailDrawer({ event, onClose, onResolve, isResolving }: { event: OperationalEvent | null; onClose: () => void; onResolve: (e: OperationalEvent) => void; isResolving: boolean }) {
  const isOpen = !!event;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {event && (
          <>
            <SheetHeader className="p-5 border-b">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[event.event_type] || '#64748b' }} />
                    {EVENT_TYPE_LABELS[event.event_type as keyof typeof EVENT_TYPE_LABELS] || event.event_type}
                  </SheetTitle>
                  <SheetDescription>
                    {format(new Date(event.created_at), "dd 'de' MMM 'às' HH:mm", { locale: ptBR })}
                    {' · '}
                    {SEVERITY_LABELS[event.severity] || event.severity}
                  </SheetDescription>
                </div>
                {!event.resolved_at && (
                  <Button size="sm" variant="outline" onClick={() => onResolve(event)} disabled={isResolving}>
                    <CheckCircle className="h-4 w-4 mr-1 text-success" /> {isResolving ? 'Resolvendo…' : 'Resolver'}
                  </Button>
                )}
              </div>
            </SheetHeader>

            <div className="p-5 space-y-3 border-b bg-muted/20">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <InfoRow icon={<Package className="h-3.5 w-3.5" />} label="Carga" value={event.loads?.load_number || '—'} />
                <InfoRow 
                  icon={<MapPinned className="h-3.5 w-3.5" />} 
                  label="Parada" 
                  value={reportDetail(event, 'stop_order') ? `Parada ${String(reportDetail(event, 'stop_order'))}` : '—'}
                />
                <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="Cliente" value={event.clients?.company_name || '—'} />
                <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Motorista" value={event.drivers?.name || '—'} />
                <InfoRow icon={<Truck className="h-3.5 w-3.5" />} label="Impacto" value={event.financial_impact ? `R$ ${Number(event.financial_impact).toLocaleString('pt-BR')}` : '—'} />
              </div>
              <SupplierTextBlock event={event} />
              {event.description && (
                <div className="text-sm bg-background rounded-md border p-3">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Descrição</div>
                  <pre className="whitespace-pre-wrap font-sans text-sm">{event.description}</pre>
                </div>
              )}
              {event.resolution && (
                <div className="text-sm bg-success/5 border border-success/20 rounded-md p-3">
                  <div className="text-[10px] uppercase tracking-wide text-success mb-1">Resolução</div>
                  {event.resolution}
                </div>
              )}
            </div>

            <EventChat eventId={event.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate">{value}</div>
      </div>
    </div>
  );
}

function SupplierTextBlock({ event }: { event: OperationalEvent }) {
  const { toast } = useToast();
  const text = formatOccurrenceReport(event.event_type, jsonRecord(event.report_details));
  if (!text) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Texto copiado', description: 'Pronto para enviar ao fornecedor.' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };
  return (
    <div className="text-sm bg-background rounded-md border p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Texto para fornecedor</div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={copy}>
          <Copy className="h-3 w-3 mr-1" /> Copiar
        </Button>
      </div>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{text}</pre>
    </div>
  );
}

function EventChat({ eventId }: { eventId: string }) {
  return <EventConversation eventId={eventId}/>;
}

function DriverChatDrawer({ driver, onClose }: { driver: { id: string; name: string } | null; onClose: () => void }) {
  const isOpen = !!driver;
  return (
    <Sheet open={isOpen} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0">
        {driver && (
          <>
            <SheetHeader className="p-5 border-b">
              <SheetTitle className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Chat direto — {driver.name}
              </SheetTitle>
              <SheetDescription>
                Conversa em tempo real com o motorista (independente de uma ocorrência específica).
              </SheetDescription>
            </SheetHeader>
            <DriverChat driverId={driver.id} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DriverChat({ driverId }: { driverId: string }) {
  return <DriverConversation driverId={driverId} />;
}
