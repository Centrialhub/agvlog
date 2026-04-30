import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, ExternalLink, FileSearch, FileText, Hand, History, Lightbulb, MessageSquareText, PackageCheck, Search, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { analyzeObservations, type AnalyzerResult } from '@/lib/observationPatternAnalyzer';
import { CLIENT_LOAD_OBSERVATION_RULES } from '@/lib/documentParsers';

type SiatStatus = 'pending' | 'in_transit' | 'delivered';

type TraceDocument = {
  id: string;
  invoice_number: string | null;
  access_key: string | null;
  document_type: string;
  issue_date: string | null;
  created_at: string | null;
  created_by: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  product_summary: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  status: string;
  load_id: string | null;
  client_id: string | null;
  remitter: string | null;
  order_id: string | null;
  client_load_number: string | null;
  client_load_source: {
    source?: string;
    ruleId?: string | null;
    ruleLabel?: string | null;
    /** Snippet da observação salvo quando NENHUMA regra casou (ingestões pós-fix). */
    observationSnippet?: string | null;
  } | null;
  clients?: { company_name: string | null } | null;
  orders?: { order_number: string | null; payment_plan: string | null } | null;
  loads?: {
    id: string;
    load_number: string;
    status: string;
    origin: string | null;
    destination: string | null;
    trip_id: string | null;
    vehicles?: { plate: string | null; nickname: string | null } | null;
    drivers?: { name: string | null } | null;
  } | null;
};

type OperationalEvent = {
  id: string;
  load_id: string | null;
  event_type: string;
  severity: string;
  description: string | null;
  resolved_at: string | null;
  created_at: string;
  drivers?: { name: string | null } | null;
};

type DispatchTrip = {
  id: string;
  load_id: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  planned_start_at: string | null;
  planned_end_at: string | null;
  status: string;
};

type DispatchStop = {
  id: string;
  dispatch_trip_id: string;
  destination: string | null;
  status: string;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  planned_arrival_at: string | null;
  stop_order: number;
};

type TraceRow = {
  doc: TraceDocument;
  siatStatus: SiatStatus;
  events: OperationalEvent[];
  trip: DispatchTrip | null;
  stops: DispatchStop[];
};

const siatLabels: Record<SiatStatus | 'all', string> = {
  all: 'Todos',
  pending: 'Pendente',
  in_transit: 'Em trânsito',
  delivered: 'Entregue',
};

const sourceLabel = (source?: string | null) => {
  if (source === 'xPed') return 'Campo NF (xPed)';
  if (source === 'observation') return 'Observação (infCpl)';
  if (source === 'manual') return 'Manual';
  return source || '—';
};

const sourceBadgeClass = (source?: string | null) => {
  if (source === 'xPed') return 'bg-success/10 text-success border-success/20';
  if (source === 'observation') return 'bg-warning/10 text-warning border-warning/20';
  return 'bg-muted/40 text-muted-foreground border-border';
};

type ExtractionStatus = 'xPed' | 'observation' | 'manual' | 'missing';

const extractionStatus = (doc: TraceDocument): ExtractionStatus => {
  if (!doc.client_load_number) return 'missing';
  const src = doc.client_load_source?.source;
  if (src === 'xPed' || src === 'observation' || src === 'manual') return src;
  return 'xPed';
};

const extractionLabel: Record<ExtractionStatus, string> = {
  xPed: 'Campo NF (xPed)',
  observation: 'Observação (infCpl)',
  manual: 'Manual',
  missing: 'Não encontrado',
};

const extractionBadgeClass = (status: ExtractionStatus) => {
  if (status === 'xPed') return 'bg-success/10 text-success border-success/20';
  if (status === 'observation') return 'bg-warning/10 text-warning border-warning/20';
  if (status === 'manual') return 'bg-info/10 text-info border-info/20';
  return 'bg-destructive/10 text-destructive border-destructive/30 ring-1 ring-destructive/20';
};

const loadStatusToSiat = (doc: TraceDocument): SiatStatus => {
  const loadStatus = doc.loads?.status;
  if (loadStatus === 'delivered' || doc.status === 'delivered') return 'delivered';
  if (['loaded', 'in_transit'].includes(loadStatus || '')) return 'in_transit';
  return 'pending';
};

const statusBadgeClass = (status: SiatStatus) => {
  if (status === 'delivered') return 'bg-success/10 text-success border-success/20';
  if (status === 'in_transit') return 'bg-info/10 text-info border-info/20';
  return 'bg-warning/10 text-warning border-warning/20';
};

const fmtDate = (value?: string | null) => {
  if (!value) return '—';
  try { return format(parseISO(value.length === 10 ? `${value}T12:00:00` : value), 'dd/MM/yyyy', { locale: ptBR }); }
  catch { return '—'; }
};

const fmtTime = (value?: string | null) => {
  if (!value) return '—';
  try { return format(parseISO(value), 'HH:mm'); }
  catch { return '—'; }
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Calcula o SLA (lead-time) entre a importação da NF (created_at) e a entrega
 * efetiva (última parada com chegada real). Retorna null quando ainda não
 * entregue ou se faltar uma das pontas — assim a coluna sabe distinguir
 * "em aberto" de "entregue sem dado".
 */
const computeSlaHours = (importedAt?: string | null, deliveredAt?: string | null): number | null => {
  if (!importedAt || !deliveredAt) return null;
  const a = new Date(importedAt).getTime();
  const b = new Date(deliveredAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
};

const formatSla = (hours: number): string => {
  if (hours < 1) return `${Math.round(hours * 60)}min`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
};

const SLA_THRESHOLD_KEY = 'traceability.slaThresholdHours';
const DEFAULT_SLA_THRESHOLD_H = 72;

export default function Traceability() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    invoice: '', loadNumber: '', clientRef: '', client: '', supplier: '', plate: '', driver: '', start: '', end: '', deliveryStart: '', deliveryEnd: '', importStart: '', importEnd: '', status: 'all', pod: 'all', canhoto: 'all', occurrence: '', payment: '', importBatch: 'all',
  });
  const [selectedRow, setSelectedRow] = useState<TraceRow | null>(null);
  const [eventForm, setEventForm] = useState({ type: 'other', severity: 'medium', status: 'no_change', description: '' });
  const [slaThresholdH, setSlaThresholdH] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SLA_THRESHOLD_H;
    const raw = window.localStorage.getItem(SLA_THRESHOLD_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SLA_THRESHOLD_H;
  });
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [analyzerResult, setAnalyzerResult] = useState<AnalyzerResult | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['traceability', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return { docs: [], events: [], trips: [], stops: [] };
      const { data: docs, error: docsError } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, access_key, document_type, issue_date, created_at, created_by, recipient, remitter, recipient_city, recipient_state, product_summary, pallet_count, weight_kg, value, freight_value, status, load_id, client_id, order_id, client_load_number, client_load_source, clients(company_name), orders(order_number, payment_plan), loads(id, load_number, status, origin, destination, trip_id, vehicles(plate, nickname), drivers(name))')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (docsError) throw docsError;

      const loadIds = Array.from(new Set((docs || []).map((d: any) => d.load_id).filter(Boolean)));
      if (!loadIds.length) return { docs: (docs || []) as TraceDocument[], events: [], trips: [], stops: [] };

      const [{ data: events, error: eventsError }, { data: trips, error: tripsError }] = await Promise.all([
        (supabase as any).from('operational_events').select('id, load_id, event_type, severity, description, resolved_at, created_at, drivers(name)').eq('tenant_id', currentTenant.id).in('load_id', loadIds).order('created_at', { ascending: false }),
        supabase.from('dispatch_trips').select('id, load_id, actual_start_at, actual_end_at, planned_start_at, planned_end_at, status').eq('tenant_id', currentTenant.id).in('load_id', loadIds),
      ]);
      if (eventsError) throw eventsError;
      if (tripsError) throw tripsError;

      const tripIds = (trips || []).map((t: any) => t.id);
      const { data: stops, error: stopsError } = tripIds.length
        ? await supabase.from('dispatch_stops').select('id, dispatch_trip_id, destination, status, actual_arrival_at, actual_departure_at, planned_arrival_at, stop_order').eq('tenant_id', currentTenant.id).in('dispatch_trip_id', tripIds).order('stop_order')
        : { data: [], error: null };
      if (stopsError) throw stopsError;

      return {
        docs: (docs || []) as TraceDocument[],
        events: (events || []) as OperationalEvent[],
        trips: (trips || []) as DispatchTrip[],
        stops: (stops || []) as DispatchStop[],
      };
    },
    enabled: !!currentTenant,
  });

  const rows = useMemo<TraceRow[]>(() => {
    const events = data?.events || [];
    const trips = data?.trips || [];
    const stops = data?.stops || [];
    return (data?.docs || []).map(doc => {
      const trip = trips.find(t => t.load_id === doc.load_id || t.id === doc.loads?.trip_id) || null;
      return {
        doc,
        siatStatus: loadStatusToSiat(doc),
        events: events.filter(e => e.load_id === doc.load_id),
        trip,
        stops: trip ? stops.filter(s => s.dispatch_trip_id === trip.id) : [],
      };
    });
  }, [data]);

  // Lote de importação derivado: como o schema atual não persiste um batch_id em
  // fiscal_documents, usamos a heurística "mesmo created_by + created_at no mesmo
  // bucket de 60s" — isso reflete bem um upload em massa (lote XML/CSV) que insere
  // várias NFs quase simultaneamente. Ordenamos cronologicamente desc para o select.
  const BATCH_BUCKET_MS = 60_000;
  const batchKeyOf = (doc: TraceDocument): string | null => {
    if (!doc.created_at) return null;
    const t = new Date(doc.created_at).getTime();
    if (!Number.isFinite(t)) return null;
    const bucket = Math.floor(t / BATCH_BUCKET_MS);
    return `${doc.created_by || 'anon'}|${bucket}`;
  };

  const importBatches = useMemo(() => {
    const map = new Map<string, { key: string; firstAt: string; lastAt: string; count: number; createdBy: string | null }>();
    for (const r of rows) {
      const key = batchKeyOf(r.doc);
      if (!key || !r.doc.created_at) continue;
      const cur = map.get(key);
      if (!cur) {
        map.set(key, {
          key,
          firstAt: r.doc.created_at,
          lastAt: r.doc.created_at,
          count: 1,
          createdBy: r.doc.created_by,
        });
      } else {
        cur.count++;
        if (r.doc.created_at < cur.firstAt) cur.firstAt = r.doc.created_at;
        if (r.doc.created_at > cur.lastAt) cur.lastAt = r.doc.created_at;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.firstAt.localeCompare(a.firstAt));
  }, [rows]);

  const batchLabel = (b: { firstAt: string; count: number; createdBy: string | null }) =>
    `${fmtDate(b.firstAt)} ${fmtTime(b.firstAt)} · ${b.count} NF${b.count > 1 ? 's' : ''}${b.createdBy ? ` · ${b.createdBy.slice(0, 8)}` : ''}`;

  const filteredRows = useMemo(() => {
    const q = (value: string | null | undefined, needle: string) => String(value || '').toLowerCase().includes(needle.toLowerCase());
    return rows.filter(row => {
      const doc = row.doc;
      if (filters.invoice && !q(doc.invoice_number, filters.invoice)) return false;
      if (filters.loadNumber && !q(doc.loads?.load_number, filters.loadNumber)) return false;
      if (filters.clientRef && !q(doc.client_load_number, filters.clientRef) && !q(doc.orders?.order_number, filters.clientRef)) return false;
      if (filters.supplier && !q(doc.remitter, filters.supplier)) return false;
      if (filters.payment && !q(doc.orders?.payment_plan, filters.payment)) return false;
      if (filters.client && !q(doc.clients?.company_name || doc.recipient, filters.client)) return false;
      if (filters.plate && !q(doc.loads?.vehicles?.plate, filters.plate)) return false;
      if (filters.driver && !q(doc.loads?.drivers?.name, filters.driver)) return false;
      if (filters.occurrence && !row.events.some(e => q(e.description || e.event_type, filters.occurrence))) return false;
      if (filters.status !== 'all' && row.siatStatus !== filters.status) return false;
      if (filters.pod !== 'all' && (filters.pod === 'yes') !== (row.siatStatus === 'delivered')) return false;
      if (filters.canhoto !== 'all' && (filters.canhoto === 'yes') !== (row.siatStatus === 'delivered')) return false;
      if (filters.start && (!doc.issue_date || doc.issue_date < filters.start)) return false;
      if (filters.end && (!doc.issue_date || doc.issue_date > filters.end)) return false;
      if (filters.importStart || filters.importEnd) {
        const imp = doc.created_at ? doc.created_at.slice(0, 10) : '';
        if (filters.importStart && (!imp || imp < filters.importStart)) return false;
        if (filters.importEnd && (!imp || imp > filters.importEnd)) return false;
      }
      if (filters.importBatch !== 'all' && batchKeyOf(doc) !== filters.importBatch) return false;
      if (filters.deliveryStart || filters.deliveryEnd) {
        const arr = row.stops.at(-1)?.actual_arrival_at;
        const arrDate = arr ? arr.slice(0, 10) : '';
        if (filters.deliveryStart && (!arrDate || arrDate < filters.deliveryStart)) return false;
        if (filters.deliveryEnd && (!arrDate || arrDate > filters.deliveryEnd)) return false;
      }
      return true;
    });
  }, [filters, rows]);

  const counts = useMemo(() => ({
    total: filteredRows.length,
    pending: filteredRows.filter(r => r.siatStatus === 'pending').length,
    inTransit: filteredRows.filter(r => r.siatStatus === 'in_transit').length,
    delivered: filteredRows.filter(r => r.siatStatus === 'delivered').length,
    missingLoad: filteredRows.filter(r => !r.doc.client_load_number).length,
    fromXPed: filteredRows.filter(r => r.doc.client_load_number && r.doc.client_load_source?.source === 'xPed').length,
    fromObservation: filteredRows.filter(r => r.doc.client_load_number && r.doc.client_load_source?.source === 'observation').length,
  }), [filteredRows]);

  /**
   * Métricas por regra de CLIENT_LOAD_OBSERVATION_RULES.
   *
   * - hits   = NFs em que a regra foi a aplicada (source === 'observation' && ruleId === r.id)
   * - xPed/manual/missing são contadas globalmente (não por regra) e mostradas como contexto
   * - "cobertura" de uma regra = hits / (hits + missing) — quanto de potencial ela cobriu
   *   considerando que TODAS as misses são candidatas a serem cobertas por alguma regra.
   *
   * Como `client_load_source` é apenas auditoria do que casou primeiro, regras posteriores
   * que TAMBÉM casariam não aparecem aqui — isso é intencional: queremos saber qual regra
   * está efetivamente disparando em produção.
   */
  type RuleStat = {
    id: string;
    label: string;
    hits: number;
    sharePct: number;       // % das observações resolvidas que foram por esta regra
    coveragePct: number;    // hits / (hits + missing)
    samples: string[];      // até 3 amostras de NF para inspeção rápida
    sampleValues: string[]; // valores capturados (até 3) para sanidade
  };

  const ruleStats = useMemo(() => {
    const byRule = new Map<string, RuleStat>();
    for (const r of CLIENT_LOAD_OBSERVATION_RULES) {
      byRule.set(r.id, {
        id: r.id,
        label: r.label,
        hits: 0,
        sharePct: 0,
        coveragePct: 0,
        samples: [],
        sampleValues: [],
      });
    }
    let unknownRuleHits = 0;
    const unknownRule: RuleStat = { id: '__unknown__', label: 'Regra não identificada (legado)', hits: 0, sharePct: 0, coveragePct: 0, samples: [], sampleValues: [] };

    for (const row of filteredRows) {
      const doc = row.doc;
      if (!doc.client_load_number) continue;
      if (doc.client_load_source?.source !== 'observation') continue;
      const rid = doc.client_load_source?.ruleId || '';
      const stat = byRule.get(rid);
      if (stat) {
        stat.hits++;
        if (stat.samples.length < 3 && doc.invoice_number) stat.samples.push(doc.invoice_number);
        if (stat.sampleValues.length < 3) stat.sampleValues.push(doc.client_load_number);
      } else {
        unknownRule.hits++;
        unknownRuleHits++;
        if (unknownRule.samples.length < 3 && doc.invoice_number) unknownRule.samples.push(doc.invoice_number);
        if (unknownRule.sampleValues.length < 3) unknownRule.sampleValues.push(doc.client_load_number);
      }
    }

    const totalObsResolved = counts.fromObservation || 1;
    const allRules = Array.from(byRule.values());
    if (unknownRuleHits > 0) allRules.push(unknownRule);

    for (const s of allRules) {
      s.sharePct = (s.hits / totalObsResolved) * 100;
      s.coveragePct = s.hits + counts.missingLoad === 0
        ? 0
        : (s.hits / (s.hits + counts.missingLoad)) * 100;
    }

    // Ordena por hits desc; regras zeradas vão para o fim
    allRules.sort((a, b) => b.hits - a.hits);

    const usedRules = allRules.filter(s => s.hits > 0).length;
    const unusedRules = allRules.filter(s => s.hits === 0 && s.id !== '__unknown__').length;

    return {
      rules: allRules,
      usedRules,
      unusedRules,
      hasUnknown: unknownRuleHits > 0,
    };
  }, [filteredRows, counts.fromObservation, counts.missingLoad]);

  const registerEvent = useMutation({
    mutationFn: async () => {
      if (!currentTenant || !selectedRow) return;
      const loadId = selectedRow.doc.load_id;
      if (!eventForm.description.trim()) throw new Error('Informe a descrição da ocorrência');
      await (supabase as any).from('operational_events').insert({
        tenant_id: currentTenant.id,
        load_id: loadId,
        client_id: selectedRow.doc.client_id,
        event_type: eventForm.type,
        severity: eventForm.severity,
        description: eventForm.description,
        created_by: user?.id,
      });
      if (eventForm.status !== 'no_change') {
        if (loadId) await supabase.from('loads').update({ status: eventForm.status, updated_at: new Date().toISOString() } as any).eq('id', loadId).eq('tenant_id', currentTenant.id);
        if (!loadId) await supabase.from('fiscal_documents').update({ status: eventForm.status === 'delivered' ? 'confirmed' : 'pending', updated_at: new Date().toISOString() } as any).eq('id', selectedRow.doc.id).eq('tenant_id', currentTenant.id);
      }
    },
    onSuccess: () => {
      toast({ title: 'Rastreabilidade atualizada' });
      setEventForm({ type: 'other', severity: 'medium', status: 'no_change', description: '' });
      queryClient.invalidateQueries({ queryKey: ['traceability'] });
      queryClient.invalidateQueries({ queryKey: ['operational_events'] });
      queryClient.invalidateQueries({ queryKey: ['loads'] });
    },
    onError: (error: any) => toast({ title: 'Erro', description: error.message, variant: 'destructive' }),
  });

  const exportCsv = () => {
    const headers = [
      'Nº NF', 'Chave de Acesso', 'Tipo Documento', 'Status Documento', 'Data Emissão', 'Importada em', 'Data Entrega', 'Canhoto Recebido', 'Canhoto Recebido em',
      'Nº Carga', 'Status Carga', 'Trip ID', 'Origem', 'Destino Carga',
      'Carga Cliente (NF-e)', 'Status Extração', 'Origem Carga Cliente', 'Regra Aplicada', 'Ref. Cliente (Pedido)', 'Forma Pgto',
      'Cliente', 'Fornecedor / Remetente',
      'Cidade Destino', 'UF Destino',
      'Placa', 'Veículo', 'Motorista',
      'Situação SIAT', 'POD', 'Canhoto',
      'Valor Nota (R$)', 'Valor Frete (R$)', 'Paletes', 'Peso (kg)',
      'Itens / Mercadoria',
      'Início Planejado', 'Início Real', 'Fim Planejado', 'Fim Real',
      'Total Paradas', 'Paradas Concluídas',
      '1ª Chegada Prevista', '1ª Chegada Real', '1ª Saída Real',
      'Última Chegada Prevista', 'Última Chegada Real', 'Última Saída Real',
      'Detalhe Paradas',
      'Total Ocorrências', 'Ocorrências Abertas',
      'Ocorrências (descrição)', 'Tipos Ocorrências', 'Severidades', 'Datas Ocorrências',
      // ─── Detalhe completo (documento) ───
      'Doc ID', 'Doc Emissão (ISO)', 'Doc Importada em (ISO)', 'Doc Order ID', 'Doc Client ID', 'Doc Load ID',
      'Observação Capturada (snippet)', 'Regra ID', 'Origem Diagnóstico (raw)',
      // ─── Detalhe completo (carga) ───
      'Carga ID', 'Carga Status (raw)', 'Carga Origem', 'Carga Destino', 'Trip Status',
      'Trip Início Planejado (ISO)', 'Trip Início Real (ISO)', 'Trip Fim Planejado (ISO)', 'Trip Fim Real (ISO)',
      'Veículo Apelido', 'Veículo Placa', 'Motorista (nome)',
      // ─── Detalhe completo (canhoto / POD) ───
      'Canhoto Status', 'Canhoto Data (ISO)', 'Canhoto Última Parada', 'Canhoto Stop ID',
      'Lead-time Importação→Entrega (h)', 'Lead-time Emissão→Entrega (h)', 'Atraso vs Previsto (h)',
      'SLA Entrega (formatado)', 'SLA Status', `SLA Limite (h)`,
    ];
    const body = filteredRows.map(({ doc, siatStatus, events, trip, stops }) => {
      const firstStop = stops[0];
      const lastStop = stops.at(-1);
      const completedStops = stops.filter(s => s.actual_arrival_at).length;
      const openOccurrences = events.filter(e => !e.resolved_at).length;
      const stopsDetail = stops.map(s =>
        `#${s.stop_order} ${s.destination || 'Parada'} [${s.status}] prev:${fmtDate(s.planned_arrival_at)} ${fmtTime(s.planned_arrival_at)} chegada:${fmtDate(s.actual_arrival_at)} ${fmtTime(s.actual_arrival_at)} saida:${fmtTime(s.actual_departure_at)}`
      ).join(' || ');
      const deliveredAt = siatStatus === 'delivered' ? lastStop?.actual_arrival_at : null;
      const hoursBetween = (a?: string | null, b?: string | null) => {
        if (!a || !b) return '';
        const ms = new Date(b).getTime() - new Date(a).getTime();
        if (!Number.isFinite(ms)) return '';
        return (ms / 3_600_000).toFixed(2);
      };
      const obsSnippet = (doc.client_load_source?.observationSnippet || '').replace(/\s+/g, ' ').slice(0, 600);
      return [
        doc.invoice_number || '',
        doc.access_key || '',
        doc.document_type || '',
        doc.status || '',
        fmtDate(doc.issue_date),
        `${fmtDate(doc.created_at)} ${fmtTime(doc.created_at)}`.trim(),
        `${fmtDate(lastStop?.actual_arrival_at)} ${fmtTime(lastStop?.actual_arrival_at)}`.trim(),
        siatStatus === 'delivered' ? 'Sim' : 'Não',
        siatStatus === 'delivered' ? `${fmtDate(lastStop?.actual_arrival_at)} ${fmtTime(lastStop?.actual_arrival_at)}`.trim() : '',
        doc.loads?.load_number || '',
        doc.loads?.status || '',
        doc.loads?.trip_id || '',
        doc.loads?.origin || '',
        doc.loads?.destination || '',
        doc.client_load_number || '',
        extractionLabel[extractionStatus(doc)],
        doc.client_load_source?.source ? sourceLabel(doc.client_load_source.source) : '',
        doc.client_load_source?.ruleLabel || '',
        doc.orders?.order_number || '',
        doc.orders?.payment_plan || '',
        doc.clients?.company_name || doc.recipient || '',
        doc.remitter || '',
        doc.recipient_city || '',
        doc.recipient_state || '',
        doc.loads?.vehicles?.plate || '',
        doc.loads?.vehicles?.nickname || '',
        doc.loads?.drivers?.name || '',
        siatLabels[siatStatus],
        siatStatus === 'delivered' ? 'Sim' : 'Não',
        siatStatus === 'delivered' ? 'Sim' : 'Não',
        doc.value ?? 0,
        doc.freight_value ?? 0,
        doc.pallet_count ?? 0,
        doc.weight_kg ?? 0,
        doc.product_summary || '',
        `${fmtDate(trip?.planned_start_at)} ${fmtTime(trip?.planned_start_at)}`.trim(),
        `${fmtDate(trip?.actual_start_at)} ${fmtTime(trip?.actual_start_at)}`.trim(),
        `${fmtDate(trip?.planned_end_at)} ${fmtTime(trip?.planned_end_at)}`.trim(),
        `${fmtDate(trip?.actual_end_at)} ${fmtTime(trip?.actual_end_at)}`.trim(),
        stops.length,
        completedStops,
        `${fmtDate(firstStop?.planned_arrival_at)} ${fmtTime(firstStop?.planned_arrival_at)}`.trim(),
        `${fmtDate(firstStop?.actual_arrival_at)} ${fmtTime(firstStop?.actual_arrival_at)}`.trim(),
        fmtTime(firstStop?.actual_departure_at),
        `${fmtDate(lastStop?.planned_arrival_at)} ${fmtTime(lastStop?.planned_arrival_at)}`.trim(),
        `${fmtDate(lastStop?.actual_arrival_at)} ${fmtTime(lastStop?.actual_arrival_at)}`.trim(),
        fmtTime(lastStop?.actual_departure_at),
        stopsDetail,
        events.length,
        openOccurrences,
        events.map(e => e.description || e.event_type).join(' | '),
        events.map(e => e.event_type).join(' | '),
        events.map(e => e.severity).join(' | '),
        events.map(e => `${fmtDate(e.created_at)} ${fmtTime(e.created_at)}${e.resolved_at ? ' (resolvida)' : ' (aberta)'}`).join(' | '),
        // ─── Detalhe completo (documento) ───
        doc.id || '',
        doc.issue_date || '',
        doc.created_at || '',
        doc.order_id || '',
        doc.client_id || '',
        doc.load_id || '',
        obsSnippet,
        doc.client_load_source?.ruleId || '',
        doc.client_load_source?.source || '',
        // ─── Detalhe completo (carga) ───
        doc.loads?.id || '',
        doc.loads?.status || '',
        doc.loads?.origin || '',
        doc.loads?.destination || '',
        trip?.status || '',
        trip?.planned_start_at || '',
        trip?.actual_start_at || '',
        trip?.planned_end_at || '',
        trip?.actual_end_at || '',
        doc.loads?.vehicles?.nickname || '',
        doc.loads?.vehicles?.plate || '',
        doc.loads?.drivers?.name || '',
        // ─── Detalhe completo (canhoto / POD) ───
        siatStatus === 'delivered' ? 'Recebido' : 'Pendente',
        deliveredAt || '',
        lastStop?.destination || '',
        lastStop?.id || '',
        hoursBetween(doc.created_at, deliveredAt),
        hoursBetween(doc.issue_date, deliveredAt),
        hoursBetween(lastStop?.planned_arrival_at, lastStop?.actual_arrival_at),
        // ─── SLA Entrega (Importada → Entrega) ───
        (() => {
          const h = computeSlaHours(doc.created_at, deliveredAt);
          if (h !== null) return formatSla(h);
          if (!doc.created_at) return '';
          const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 3_600_000;
          return Number.isFinite(elapsed) ? formatSla(elapsed) : '';
        })(),
        (() => {
          const h = computeSlaHours(doc.created_at, deliveredAt);
          if (h !== null) return h <= slaThresholdH ? 'No prazo' : 'Vencido';
          if (siatStatus === 'delivered') return 'Sem dados';
          if (!doc.created_at) return 'Sem dados';
          const elapsed = (Date.now() - new Date(doc.created_at).getTime()) / 3_600_000;
          return elapsed > slaThresholdH ? 'Em aberto · vencido' : 'Em aberto';
        })(),
        slaThresholdH,
      ];
    });
    const csv = [headers, ...body].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rastreabilidade-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Diagnostic export: only NFs missing the client load number, with the data the user
  // needs to tune the regex rules in CLIENT_LOAD_OBSERVATION_RULES.
  const exportMissingLoadCsv = () => {
    const missing = filteredRows.filter(r => !r.doc.client_load_number);
    if (!missing.length) {
      toast({ title: 'Nada a exportar', description: 'Todas as NFs filtradas já têm número de carga extraído.' });
      return;
    }
    const headers = [
      'Nº NF', 'Série/Chave', 'Data Emissão',
      'Cliente', 'Fornecedor / Remetente',
      'Cidade Destino', 'UF Destino',
      'Status Extração', 'Origem Tentada', 'Regra Aplicada',
      'Ref. Pedido (orders)', 'Nº Carga (empresa)',
      'Observação registrada (client_load_source)',
    ];
    const body = missing.map(({ doc }) => [
      doc.invoice_number || '',
      doc.access_key || '',
      fmtDate(doc.issue_date),
      doc.clients?.company_name || doc.recipient || '',
      doc.remitter || '',
      doc.recipient_city || '',
      doc.recipient_state || '',
      extractionLabel.missing,
      doc.client_load_source?.source ? sourceLabel(doc.client_load_source.source) : '—',
      doc.client_load_source?.ruleLabel || '',
      doc.orders?.order_number || '',
      doc.loads?.load_number || '',
      doc.client_load_source ? JSON.stringify(doc.client_load_source) : '',
    ]);
    const csv = [headers, ...body].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nfs-sem-carga-cliente-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'CSV exportado', description: `${missing.length} NF(s) sem número da carga do cliente.` });
  };

  /**
   * Coleta as observações das NFs sem carga extraída e roda o analisador de
   * padrões para sugerir novas regras a serem adicionadas em
   * `CLIENT_LOAD_OBSERVATION_RULES` (ver src/lib/documentParsers.ts).
   */
  const runAnalyzer = () => {
    const samples = filteredRows
      .filter(r => !r.doc.client_load_number)
      .map(r => ({
        observation: r.doc.client_load_source?.observationSnippet || '',
        reference: r.doc.invoice_number || r.doc.access_key || r.doc.id,
      }))
      .filter(s => s.observation.trim().length > 0);

    if (!samples.length) {
      toast({
        title: 'Sem amostras para analisar',
        description: 'As NFs sem carga foram ingeridas antes do registro de snippet, ou não têm observação. Reimporte XMLs recentes para popular as amostras.',
        variant: 'destructive',
      });
      return;
    }

    const result = analyzeObservations(samples, { minOccurrences: 2, topKeywords: 12, topSignatures: 8 });
    setAnalyzerResult(result);
    setAnalyzerOpen(true);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copiado', description: 'Cole no array CLIENT_LOAD_OBSERVATION_RULES.' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground"><FileSearch className="h-6 w-6 text-primary" /> Rastreabilidade NF</h1>
          <p className="text-sm text-muted-foreground">Consulta operacional de NF, carga, entrega, POD e ocorrências. Nº de CT-e/ORT é gerado apenas após emissão fiscal.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!filteredRows.length}><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>
          <Button
            variant="outline"
            onClick={exportMissingLoadCsv}
            disabled={!counts.missingLoad}
            className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Exporta apenas as NFs cujo número da carga do cliente não foi extraído (xPed nem observação) — use o CSV para ajustar as regras."
          >
            <AlertCircle className="mr-2 h-4 w-4" /> Exportar NFs sem carga ({counts.missingLoad})
          </Button>
          <Button
            variant="outline"
            onClick={runAnalyzer}
            disabled={!counts.missingLoad}
            className="border-info/30 text-info hover:bg-info/10 hover:text-info"
            title="Agrupa observações similares das NFs sem extração e sugere novas regras de regex."
          >
            <Lightbulb className="mr-2 h-4 w-4" /> Analisar padrões
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total de registros</p><p className="text-xl font-semibold">{counts.total}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Pendente</p><p className="text-xl font-semibold text-warning">{counts.pending}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Em trânsito</p><p className="text-xl font-semibold text-info">{counts.inTransit}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Entregue</p><p className="text-xl font-semibold text-success">{counts.delivered}</p></CardContent></Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Extraído de xPed (NF)</p><p className="text-xl font-semibold text-success">{counts.fromXPed}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Extraído da observação</p><p className="text-xl font-semibold text-warning">{counts.fromObservation}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Carga cliente NÃO encontrada</p><p className="text-xl font-semibold text-destructive">{counts.missingLoad}</p></CardContent></Card>
      </div>

      <Collapsible defaultOpen={counts.missingLoad > 0 || ruleStats.unusedRules > 0}>
        <Card>
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-info" />
                <span className="text-sm font-semibold">Métricas das regras de extração (CLIENT_LOAD_OBSERVATION_RULES)</span>
                <Badge variant="outline" className="text-[10px]">{ruleStats.usedRules} ativas</Badge>
                {ruleStats.unusedRules > 0 && (
                  <Badge variant="outline" className="bg-muted/40 text-[10px]">{ruleStats.unusedRules} sem hits</Badge>
                )}
                {counts.missingLoad > 0 && (
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20 text-[10px]">{counts.missingLoad} falhas</Badge>
                )}
                {ruleStats.hasUnknown && (
                  <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20 text-[10px]">regras legadas</Badge>
                )}
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [&[data-state=open]]:rotate-180" />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3 p-4 pt-0">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Hits</strong> = quantas NFs foram resolvidas por cada regra (a regex que casou primeiro).
                <strong className="text-foreground"> Cobertura</strong> = hits / (hits + falhas) — indica o quanto a regra ajudou frente ao que ainda falta extrair.
                Regras sem hits podem estar com regex incorreta, ordem ruim no array, ou simplesmente não aparecerem nas amostras filtradas.
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regra</TableHead>
                      <TableHead className="text-right">Hits</TableHead>
                      <TableHead className="w-44">% das obs.</TableHead>
                      <TableHead className="w-44">Cobertura</TableHead>
                      <TableHead>Valores capturados</TableHead>
                      <TableHead>NFs (amostra)</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ruleStats.rules.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Nenhuma regra registrada.</TableCell></TableRow>
                    ) : ruleStats.rules.map(s => {
                      const isUnknown = s.id === '__unknown__';
                      const isUnused = !isUnknown && s.hits === 0;
                      return (
                        <TableRow key={s.id} className={isUnused ? 'opacity-70' : ''}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{s.label}</span>
                              <code className="text-[10px] text-muted-foreground">{s.id}</code>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">{s.hits}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={s.sharePct} className="h-1.5" />
                              <span className="w-10 text-right text-xs text-muted-foreground">{s.sharePct.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={s.coveragePct} className="h-1.5" />
                              <span className="w-10 text-right text-xs text-muted-foreground">{s.coveragePct.toFixed(0)}%</span>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {s.sampleValues.length > 0 ? s.sampleValues.map(v => `"${v}"`).join(', ') : '—'}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {s.samples.length > 0 ? s.samples.join(', ') : '—'}
                          </TableCell>
                          <TableCell>
                            {isUnknown && <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Regra legada</Badge>}
                            {!isUnknown && s.hits === 0 && <Badge variant="outline" className="bg-muted/40">Sem hits</Badge>}
                            {!isUnknown && s.hits > 0 && s.coveragePct < 30 && counts.missingLoad > 0 && <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Baixa cobertura</Badge>}
                            {!isUnknown && s.hits > 0 && s.coveragePct >= 30 && <Badge variant="outline" className="bg-success/10 text-success border-success/20">OK</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {ruleStats.hasUnknown && (
                <p className="text-xs text-warning">
                  ⚠ Existem NFs com <code>ruleId</code> que não corresponde a nenhuma regra atual. Isso geralmente significa que uma regra foi renomeada ou removida do código — reimportar essas NFs alinhará o histórico.
                </p>
              )}
              {counts.missingLoad > 0 && (
                <p className="text-xs text-muted-foreground">
                  💡 Use <strong>"Analisar padrões"</strong> acima para gerar sugestões de novas regras a partir das {counts.missingLoad} observação(ões) sem extração.
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-6">
            <div><Label>Nº NF</Label><Input value={filters.invoice} onChange={e => setFilters(f => ({ ...f, invoice: e.target.value }))} /></div>
            <div><Label>Nº Carga (empresa)</Label><Input value={filters.loadNumber} onChange={e => setFilters(f => ({ ...f, loadNumber: e.target.value }))} /></div>
            <div><Label>Carga Cliente / Ref.</Label><Input value={filters.clientRef} onChange={e => setFilters(f => ({ ...f, clientRef: e.target.value }))} placeholder="Carga do cliente (NF-e) ou ref. pedido" /></div>
            <div><Label>Cliente</Label><Input value={filters.client} onChange={e => setFilters(f => ({ ...f, client: e.target.value }))} /></div>
            <div><Label>Fornecedor / Remetente</Label><Input value={filters.supplier} onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))} /></div>
            <div><Label>Forma de pagamento</Label><Input value={filters.payment} onChange={e => setFilters(f => ({ ...f, payment: e.target.value }))} placeholder="Ex: CIF, FOB, à vista" /></div>
            <div><Label>Placa</Label><Input value={filters.plate} onChange={e => setFilters(f => ({ ...f, plate: e.target.value }))} /></div>
            <div><Label>Motorista</Label><Input value={filters.driver} onChange={e => setFilters(f => ({ ...f, driver: e.target.value }))} /></div>
            <div><Label>Ocorrência</Label><Input value={filters.occurrence} onChange={e => setFilters(f => ({ ...f, occurrence: e.target.value }))} /></div>
          </div>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <div><Label>Emissão de</Label><Input type="date" value={filters.start} onChange={e => setFilters(f => ({ ...f, start: e.target.value }))} /></div>
            <div><Label>Emissão até</Label><Input type="date" value={filters.end} onChange={e => setFilters(f => ({ ...f, end: e.target.value }))} /></div>
            <div><Label title="Filtra pela data em que a NF foi importada para o sistema">Importada de</Label><Input type="date" value={filters.importStart} onChange={e => setFilters(f => ({ ...f, importStart: e.target.value }))} /></div>
            <div><Label>Importada até</Label><Input type="date" value={filters.importEnd} onChange={e => setFilters(f => ({ ...f, importEnd: e.target.value }))} /></div>
            <div>
              <Label title="Agrupa NFs importadas no mesmo upload (mesmo usuário em janela de 60s)">Lote de importação</Label>
              <Select value={filters.importBatch} onValueChange={value => setFilters(f => ({ ...f, importBatch: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-80">
                  <SelectItem value="all">Todos os lotes ({importBatches.length})</SelectItem>
                  {importBatches.map(b => (
                    <SelectItem key={b.key} value={b.key}>{batchLabel(b)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Entrega de</Label><Input type="date" value={filters.deliveryStart} onChange={e => setFilters(f => ({ ...f, deliveryStart: e.target.value }))} /></div>
            <div><Label>Entrega até</Label><Input type="date" value={filters.deliveryEnd} onChange={e => setFilters(f => ({ ...f, deliveryEnd: e.target.value }))} /></div>
            <div><Label>Situação</Label><Select value={filters.status} onValueChange={value => setFilters(f => ({ ...f, status: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(siatLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
            <div><Label>POD</Label><Select value={filters.pod} onValueChange={value => setFilters(f => ({ ...f, pod: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></div>
            <div><Label>Canhoto</Label><Select value={filters.canhoto} onValueChange={value => setFilters(f => ({ ...f, canhoto: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="yes">Sim</SelectItem><SelectItem value="no">Não</SelectItem></SelectContent></Select></div>
            <div>
              <Label title="Limite (em horas) acima do qual o SLA fica destacado em vermelho">SLA-limite (h)</Label>
              <Input
                type="number"
                min={1}
                value={slaThresholdH}
                onChange={e => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n > 0) {
                    setSlaThresholdH(n);
                    try { window.localStorage.setItem(SLA_THRESHOLD_KEY, String(n)); } catch {}
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        id="trace-top-scroll"
        className="overflow-x-scroll overflow-y-hidden h-5 rounded-t-md border border-b-0 bg-muted/40 [scrollbar-width:auto] [&::-webkit-scrollbar]:h-4 [&::-webkit-scrollbar]:block [&::-webkit-scrollbar-thumb]:bg-primary/60 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-track]:bg-muted/60 [&::-webkit-scrollbar-track]:rounded-full"
      >
        <div id="trace-top-scroll-inner" className="h-px" />
      </div>
      <Card className="rounded-t-none">
        <CardContent className="p-0">
          <div
            className="overflow-auto max-h-[70vh] [scrollbar-width:auto] [&::-webkit-scrollbar]:h-4 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar]:block [&::-webkit-scrollbar-thumb]:bg-primary/60 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-primary [&::-webkit-scrollbar-track]:bg-muted/60 [&::-webkit-scrollbar-track]:rounded-full"
            ref={(el) => {
              if (!el) return;
              const top = document.getElementById('trace-top-scroll');
              const topInner = document.getElementById('trace-top-scroll-inner');
              if (top && topInner) {
                topInner.style.width = el.scrollWidth + 'px';
                const syncTop = () => { top.scrollLeft = el.scrollLeft; };
                const syncBottom = () => { el.scrollLeft = top.scrollLeft; };
                el.onscroll = syncTop;
                top.onscroll = syncBottom;
              }
            }}
          >
            <table className="min-w-max w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="w-10"></TableHead><TableHead>Palete</TableHead><TableHead title="Comprovante de entrega (POD)">POD</TableHead><TableHead title="Canhoto recebido — clique para ver histórico">Canhoto</TableHead><TableHead>Situação</TableHead><TableHead>Nº NF</TableHead><TableHead title="Data/hora em que a NF foi importada — base do prazo de romaneio">Importada em</TableHead><TableHead>Nº Carga (empresa)</TableHead><TableHead>Carga Cliente (NF-e)</TableHead><TableHead>Ref. Pedido</TableHead><TableHead>Forma pgto</TableHead><TableHead>Valor Nota</TableHead><TableHead>Valor Frete</TableHead><TableHead>Cliente</TableHead><TableHead>Fornecedor</TableHead><TableHead>Placa</TableHead><TableHead>Motorista</TableHead><TableHead title="Data/hora da entrega (última parada concluída)">Entrega</TableHead><TableHead title={`Lead-time da importação até a entrega. Vermelho se > ${slaThresholdH}h.`}>SLA Entrega</TableHead><TableHead>Ocorrência</TableHead><TableHead></TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? <TableRow><TableCell colSpan={22} className="py-10 text-center text-muted-foreground">Carregando rastreabilidade...</TableCell></TableRow>
                : filteredRows.length === 0 ? <TableRow><TableCell colSpan={22} className="py-10 text-center text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
                : filteredRows.map(row => {
                  const lastStop = row.stops.at(-1);
                  const extr = extractionStatus(row.doc);
                  const delivered = row.siatStatus === 'delivered';
                  const slaHours = delivered ? computeSlaHours(row.doc.created_at, lastStop?.actual_arrival_at) : null;
                  const slaBreached = slaHours !== null && slaHours > slaThresholdH;
                  return (
                    <TableRow key={row.doc.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedRow(row)}>
                      <TableCell><Search className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell><Checkbox checked={(row.doc.pallet_count || 0) > 0} aria-label="Palete" /></TableCell>
                      <TableCell><Checkbox checked={delivered} aria-label="POD" /></TableCell>
                      <TableCell>
                        <Link
                          to={`/traceability/${row.doc.id}/pod`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          title="Abrir histórico completo do POD em nova aba"
                          className="inline-block hover:opacity-80 transition-opacity"
                        >
                          {delivered ? (
                            <Badge variant="outline" className="bg-success/10 text-success border-success/20 text-[10px] gap-1 cursor-pointer">
                              <CheckCircle2 className="h-3 w-3" /> {fmtDate(lastStop?.actual_arrival_at)}
                              <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-70" />
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-muted/40 text-muted-foreground text-[10px] gap-1 cursor-pointer">
                              Pendente
                              <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-70" />
                            </Badge>
                          )}
                        </Link>
                      </TableCell>
                      <TableCell><Badge variant="outline" className={statusBadgeClass(row.siatStatus)}>{siatLabels[row.siatStatus]}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{row.doc.invoice_number || '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap" title="Base de cálculo do prazo de romaneio/entrega">
                        <div className="flex flex-col leading-tight">
                          <span className="font-medium">{fmtDate(row.doc.created_at)}</span>
                          <span className="text-[10px] text-muted-foreground">{fmtTime(row.doc.created_at)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-primary">{row.doc.loads?.load_number || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.doc.client_load_number ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-info">{row.doc.client_load_number}</span>
                            {row.doc.client_load_source?.source && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1 py-0 leading-tight ${sourceBadgeClass(row.doc.client_load_source.source)}`}
                                title={`Origem: ${sourceLabel(row.doc.client_load_source.source)}${row.doc.client_load_source.ruleLabel ? ' • Regra: ' + row.doc.client_load_source.ruleLabel : ''}`}
                              >
                                {row.doc.client_load_source.source === 'xPed' ? 'NF' : row.doc.client_load_source.source === 'observation' ? 'OBS' : '?'}
                              </Badge>
                            )}
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.doc.orders?.order_number || '—'}</TableCell>
                      <TableCell className="text-xs">{row.doc.orders?.payment_plan || '—'}</TableCell>
                      <TableCell>{row.doc.value ? currency.format(Number(row.doc.value)) : '—'}</TableCell>
                      <TableCell>{row.doc.freight_value ? currency.format(Number(row.doc.freight_value)) : '—'}</TableCell>
                      <TableCell className="min-w-44">{row.doc.clients?.company_name || row.doc.recipient || '—'}</TableCell>
                      <TableCell className="min-w-40 text-xs">{row.doc.remitter || '—'}</TableCell>
                      <TableCell>{row.doc.loads?.vehicles?.plate || '—'}</TableCell>
                      <TableCell>{row.doc.loads?.drivers?.name || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {lastStop?.actual_arrival_at ? (
                          <div className="flex flex-col leading-tight">
                            <span className="font-medium text-success">{fmtDate(lastStop.actual_arrival_at)}</span>
                            <span className="text-[10px] text-muted-foreground">{fmtTime(lastStop.actual_arrival_at)}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {slaHours !== null ? (
                          <Badge
                            variant="outline"
                            className={`text-[11px] ${slaBreached ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-success/10 text-success border-success/20'}`}
                            title={`Importada em ${fmtDate(row.doc.created_at)} ${fmtTime(row.doc.created_at)} → Entrega em ${fmtDate(lastStop?.actual_arrival_at)} ${fmtTime(lastStop?.actual_arrival_at)} (${slaHours.toFixed(2)}h, limite ${slaThresholdH}h)`}
                          >
                            {formatSla(slaHours)}
                          </Badge>
                        ) : delivered ? (
                          <span className="text-[11px] text-muted-foreground" title="NF marcada como entregue, mas falta data de importação ou de chegada">—</span>
                        ) : row.doc.created_at ? (
                          (() => {
                            const elapsed = (Date.now() - new Date(row.doc.created_at).getTime()) / 3_600_000;
                            const overdue = elapsed > slaThresholdH;
                            return (
                              <Badge
                                variant="outline"
                                className={`text-[11px] ${overdue ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-warning/10 text-warning border-warning/20'}`}
                                title={`Em aberto há ${elapsed.toFixed(1)}h desde a importação (limite ${slaThresholdH}h)`}
                              >
                                {overdue ? 'Vencido' : 'Em aberto'} · {formatSla(elapsed)}
                              </Badge>
                            );
                          })()
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-56">{row.events[0]?.description || row.events[0]?.event_type || '—'}</TableCell>
                      <TableCell>{row.doc.load_id && <Link to={`/loads/${row.doc.load_id}`} onClick={e => e.stopPropagation()}><ExternalLink className="h-4 w-4 text-primary" /></Link>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedRow} onOpenChange={open => !open && setSelectedRow(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle>Detalhe da rastreabilidade</DialogTitle></DialogHeader>
          {selectedRow && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">NF</p><p className="font-semibold">{selectedRow.doc.invoice_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Nº Carga (empresa)</p><p className="font-semibold">{selectedRow.doc.loads?.load_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Carga Cliente (NF-e)</p>
                  <p className="font-semibold text-info">{selectedRow.doc.client_load_number || '—'}</p>
                  {selectedRow.doc.client_load_source?.source && selectedRow.doc.client_load_number && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge variant="outline" className={`text-[10px] ${sourceBadgeClass(selectedRow.doc.client_load_source.source)}`}>
                        {sourceLabel(selectedRow.doc.client_load_source.source)}
                      </Badge>
                      {selectedRow.doc.client_load_source.ruleLabel && (
                        <Badge variant="outline" className="text-[10px] bg-muted/40">
                          Regra: {selectedRow.doc.client_load_source.ruleLabel}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Ref. Pedido</p><p className="font-semibold">{selectedRow.doc.orders?.order_number || '—'}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Situação</p><Badge variant="outline" className={statusBadgeClass(selectedRow.siatStatus)}>{siatLabels[selectedRow.siatStatus]}</Badge></CardContent></Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-md border border-border p-4">
                  <h3 className="flex items-center gap-2 font-semibold"><PackageCheck className="h-4 w-4" /> Documento e mercadoria</h3>
                  <p className="text-sm"><span className="text-muted-foreground">Cliente:</span> {selectedRow.doc.clients?.company_name || selectedRow.doc.recipient || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Fornecedor / Remetente:</span> {selectedRow.doc.remitter || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Data Emissão:</span> {fmtDate(selectedRow.doc.issue_date)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Importada em:</span> <span className="font-medium">{fmtDate(selectedRow.doc.created_at)} {fmtTime(selectedRow.doc.created_at)}</span> <span className="text-xs text-muted-foreground">(base do prazo de romaneio)</span></p>
                  <p className="text-sm"><span className="text-muted-foreground">Forma de pagamento:</span> {selectedRow.doc.orders?.payment_plan || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Valor da Nota:</span> {selectedRow.doc.value ? currency.format(Number(selectedRow.doc.value)) : '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Valor Frete:</span> {selectedRow.doc.freight_value ? currency.format(Number(selectedRow.doc.freight_value)) : '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Destino:</span> {[selectedRow.doc.recipient_city, selectedRow.doc.recipient_state].filter(Boolean).join(' - ') || selectedRow.doc.loads?.destination || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Itens:</span> {selectedRow.doc.product_summary || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Paletes/Peso:</span> {selectedRow.doc.pallet_count || 0} · {selectedRow.doc.weight_kg || 0} kg</p>
                </div>
                <div className="space-y-2 rounded-md border border-border p-4">
                  <h3 className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" /> Transporte</h3>
                  <p className="text-sm"><span className="text-muted-foreground">Placa:</span> {selectedRow.doc.loads?.vehicles?.plate || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Motorista:</span> {selectedRow.doc.loads?.drivers?.name || '—'}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Início:</span> {fmtDate(selectedRow.trip?.actual_start_at || selectedRow.trip?.planned_start_at)} {fmtTime(selectedRow.trip?.actual_start_at || selectedRow.trip?.planned_start_at)}</p>
                  <p className="text-sm"><span className="text-muted-foreground">Fim:</span> {fmtDate(selectedRow.trip?.actual_end_at || selectedRow.trip?.planned_end_at)} {fmtTime(selectedRow.trip?.actual_end_at || selectedRow.trip?.planned_end_at)}</p>
                  {(() => {
                    const last = selectedRow.stops.at(-1);
                    const delivered = selectedRow.siatStatus === 'delivered';
                    return (
                      <>
                        <p className="text-sm"><span className="text-muted-foreground">Entrega (última parada):</span> {last?.actual_arrival_at ? <span className="font-medium text-success">{fmtDate(last.actual_arrival_at)} {fmtTime(last.actual_arrival_at)}</span> : '—'}</p>
                        <p className="text-sm"><span className="text-muted-foreground">Canhoto:</span> {delivered ? <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1"><CheckCircle2 className="h-3 w-3" /> Recebido {last?.actual_arrival_at ? `em ${fmtDate(last.actual_arrival_at)} ${fmtTime(last.actual_arrival_at)}` : ''}</Badge> : <Badge variant="outline" className="bg-muted/40 text-muted-foreground">Pendente</Badge>}</p>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> Histórico de paradas e ocorrências</h3>
                <div className="space-y-2">
                  {selectedRow.stops.map(stop => <div key={stop.id} className="flex items-center justify-between rounded-md bg-muted/40 p-2 text-sm"><span>{stop.stop_order}. {stop.destination || 'Parada'}</span><span className="text-muted-foreground">Chegada {fmtDate(stop.actual_arrival_at || stop.planned_arrival_at)} {fmtTime(stop.actual_arrival_at || stop.planned_arrival_at)} · Saída {fmtTime(stop.actual_departure_at)}</span></div>)}
                  {selectedRow.events.map(event => <div key={event.id} className="flex items-start gap-2 rounded-md bg-muted/40 p-2 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 text-warning" /><div><p>{event.description || event.event_type}</p><p className="text-xs text-muted-foreground">{fmtDate(event.created_at)} {fmtTime(event.created_at)} · {event.resolved_at ? 'Resolvida' : 'Aberta'}</p></div></div>)}
                  {!selectedRow.stops.length && !selectedRow.events.length && <p className="text-sm text-muted-foreground">Sem histórico operacional registrado para este documento.</p>}
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" /> Registrar ocorrência / atualizar situação</h3>
                <div className="grid gap-3 md:grid-cols-4">
                  <div><Label>Tipo</Label><Select value={eventForm.type} onValueChange={type => setEventForm(f => ({ ...f, type }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="other">Outro</SelectItem><SelectItem value="partial_delivery">Entrega parcial</SelectItem><SelectItem value="client_refused">Recusa</SelectItem><SelectItem value="damaged">Avaria</SelectItem><SelectItem value="wrong_address">Endereço errado</SelectItem></SelectContent></Select></div>
                  <div><Label>Severidade</Label><Select value={eventForm.severity} onValueChange={severity => setEventForm(f => ({ ...f, severity }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Baixa</SelectItem><SelectItem value="medium">Média</SelectItem><SelectItem value="high">Alta</SelectItem><SelectItem value="critical">Crítica</SelectItem></SelectContent></Select></div>
                  <div><Label>Nova situação</Label><Select value={eventForm.status} onValueChange={status => setEventForm(f => ({ ...f, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no_change">Não alterar</SelectItem><SelectItem value="planned">Pendente</SelectItem><SelectItem value="in_transit">Em trânsito</SelectItem><SelectItem value="delivered">Entregue</SelectItem></SelectContent></Select></div>
                  <div className="flex items-end"><Button className="w-full" onClick={() => registerEvent.mutate()} disabled={registerEvent.isPending}>Registrar</Button></div>
                </div>
                <div className="mt-3"><Label>Descrição</Label><Textarea value={eventForm.description} onChange={e => setEventForm(f => ({ ...f, description: e.target.value }))} placeholder="Ex.: Entrega realizada normalmente, canhoto recebido, divergência encontrada..." /></div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={analyzerOpen} onOpenChange={setAnalyzerOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-info" /> Análise de padrões — Observações sem carga extraída
            </DialogTitle>
          </DialogHeader>
          {analyzerResult ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Amostras analisadas</p><p className="text-lg font-semibold">{analyzerResult.usableSamples} <span className="text-xs text-muted-foreground">/ {analyzerResult.totalSamples}</span></p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Palavras-chave recorrentes</p><p className="text-lg font-semibold text-info">{analyzerResult.keywordClusters.length}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">Formatos estruturais</p><p className="text-lg font-semibold">{analyzerResult.signatureClusters.length}</p></CardContent></Card>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-warning" /> Regras sugeridas</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Cada bloco abaixo é uma palavra-chave que apareceu antes de um valor numérico em ≥ 2 observações. Copie a regra e cole em <code className="rounded bg-muted px-1">CLIENT_LOAD_OBSERVATION_RULES</code> em <code className="rounded bg-muted px-1">src/lib/documentParsers.ts</code> (mantenha as mais específicas no topo).
                </p>
                {analyzerResult.keywordClusters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum padrão recorrente encontrado nas observações disponíveis. Tente reduzir o filtro ou reimportar mais XMLs.</p>
                ) : (
                  <div className="space-y-3">
                    {analyzerResult.keywordClusters.map(c => (
                      <div key={c.keyword} className="rounded-md border border-border bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-info/10 text-info border-info/20">{c.suggestedLabel}</Badge>
                            <Badge variant="outline">{c.count} ocorrência(s)</Badge>
                            {c.alreadyCovered && <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">já coberto?</Badge>}
                          </div>
                          <Button size="sm" variant="outline" onClick={() => copyToClipboard(c.suggestedRuleSnippet)}>
                            <Copy className="mr-1 h-3 w-3" /> Copiar regra
                          </Button>
                        </div>
                        <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[11px] font-mono">{c.suggestedRuleSnippet}</pre>
                        <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                          <div>
                            <p className="font-semibold text-muted-foreground">Valores capturados (exemplos):</p>
                            <p className="font-mono">{c.capturedExamples.map(e => `"${e}"`).join(', ') || '—'}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-muted-foreground">Trechos de contexto:</p>
                            <ul className="space-y-0.5">
                              {c.contextExamples.map((ex, i) => <li key={i} className="font-mono text-muted-foreground">…{ex}…</li>)}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Formatos estruturais recorrentes</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Mostra o "esqueleto" do texto (dígitos viram <code>#</code>, letras viram <code>a</code>). Útil para identificar layouts repetidos em diferentes clientes.
                </p>
                {analyzerResult.signatureClusters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura estrutural recorrente.</p>
                ) : (
                  <div className="space-y-2">
                    {analyzerResult.signatureClusters.map(s => (
                      <div key={s.signature} className="rounded bg-muted/30 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <code className="font-mono">{s.signature.slice(0, 80)}{s.signature.length > 80 ? '…' : ''}</code>
                          <Badge variant="outline">{s.count}</Badge>
                        </div>
                        <ul className="mt-1 space-y-0.5 pl-2 text-muted-foreground">
                          {s.examples.map((ex, i) => <li key={i}>↳ {ex.slice(0, 140)}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma análise gerada ainda.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
