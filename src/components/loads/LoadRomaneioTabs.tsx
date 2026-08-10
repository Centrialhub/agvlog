import { useEffect, useMemo, useState } from 'react';
import { isBillableFiscalDoc } from '@/lib/fiscal/documentStatus';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useUpdateLoad } from '@/hooks/useLoads';
import { useTenant } from '@/hooks/useTenant';
import { useVehicles } from '@/hooks/useVehicles';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import LoadItemsPanel from './LoadItemsPanel';
import CTeWorkbench from './CTeWorkbench';
import NFSePanel from './NFSePanel';
import ManifestPanel from './ManifestPanel';
import LoadNotesPanel from './LoadNotesPanel';
import {
  FileText, DollarSign, Package, TrendingUp, FileSignature,
  HandCoins, ShieldCheck, Boxes, Files, Truck, Save, Plus,
  Unlock, Database, Network, DollarSign as DollarIcon, Bot, Search,
  X as XIcon, Lock, ClipboardCheck, AlertTriangle, Pencil, FileSearch,
  FilePlus, Key,
} from 'lucide-react';

interface Props {
  load: any;
  documents: any[];
  items: any[];
  onSaved?: () => void;
}

const OP_TYPES = [
  { value: '__none__', label: '— Selecionar —' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'distribuicao', label: 'Distribuição' },
  { value: 'coleta', label: 'Coleta' },
  { value: 'entrega', label: 'Entrega' },
  { value: 'redespacho', label: 'Redespacho' },
  { value: 'devolucao', label: 'Devolução' },
];

const toLocalDT = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalDT = (v: string) => (v ? new Date(v).toISOString() : null);
const fmtMoney = (n?: number | null) =>
  n == null ? 'R$ 0,00' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function LoadRomaneioTabs({ load, documents, items, onSaved }: Props) {
  const { currentTenant } = useTenant();
  const { data: vehicles = [] } = useVehicles();
  const updateLoad = useUpdateLoad();
  const navigate = useNavigate();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_picker', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('drivers')
        .select('id, name, current_vehicle_id')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const [form, setForm] = useState({
    driver_id: load.driver_id || '__none__',
    vehicle_id: load.vehicle_id || '__none__',
    trailer_plate: load.trailer_plate || '',
    operation_type: load.operation_type || '__none__',
    origin: load.origin || '',
    destination: load.destination || '',
    actual_load_at: toLocalDT(load.actual_load_at),
    estimated_arrival_at: toLocalDT(load.estimated_arrival_at),
    gate_departure_at: toLocalDT(load.gate_departure_at),
    arrival_at: toLocalDT(load.arrival_at),
    ciot: load.ciot || '',
    monitored: !!load.monitored,
    dedicated_vehicle: !!load.dedicated_vehicle,
    monitor_responsible: load.monitor_responsible || '',
    sm_manager: load.sm_manager || '',
    sm_release: load.sm_release || '',
    driver_type: load.driver_type || '',
    merchandise_value: load.merchandise_value?.toString() || '',
    total_pallet_count: load.total_pallet_count?.toString() || '',
    total_weight_kg: load.total_weight_kg?.toString() || '',
    total_volume_m3: load.total_volume_m3?.toString() || '',
    notes: load.notes || '',
    distribution_manifest: load.distribution_manifest || '',
    shipment_manifest: load.shipment_manifest || '',
  });

  useEffect(() => {
    setForm(f => ({ ...f, driver_id: load.driver_id || '__none__', vehicle_id: load.vehicle_id || '__none__' }));
  }, [load.id]);

  const vehicle = useMemo(() => vehicles.find((v: any) => v.id === load.vehicle_id) as any, [vehicles, load.vehicle_id]);

  // Totais NF e CT-e
  const nfeTotal = useMemo(() => documents
    .filter((d: any) => d.document_type === 'inbound' && isBillableFiscalDoc(d))
    .reduce((s: number, d: any) => s + Number(d.value || 0), 0), [documents]);
  const nfeQty = useMemo(() => documents.filter((d: any) => d.document_type === 'inbound' && isBillableFiscalDoc(d)).length, [documents]);
  const deliveriesQty = useMemo(() => {
    const recipients = new Set(
      documents
        .filter((d: any) => d.document_type === 'inbound')
        .map((d: any) => (d.recipient_name || d.recipient || d.destination || '').trim().toUpperCase())
        .filter(Boolean)
    );
    return recipients.size;
  }, [documents]);

  const { data: ctes = [] } = useQuery({
    queryKey: ['romaneio_ctes', load.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('cte_documents')
        .select('id, cte_number, cte_series, freight_value, cargo_value, status, is_voided, recipient')
        .contains('load_ids', [load.id]);
      return data || [];
    },
  });
  const cteTotal = useMemo(() => ctes
    .filter((c: any) => !c.is_voided && isBillableFiscalDoc(c))
    .reduce((s: number, c: any) => s + Number(c.freight_value || 0), 0), [ctes]);

  // Despesas (via dispatch_trips)
  const { data: tripIds = [] } = useQuery({
    queryKey: ['romaneio_trip_ids', load.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('dispatch_trips')
        .select('id')
        .eq('load_id', load.id);
      return (data || []).map((t: any) => t.id);
    },
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ['romaneio_expenses', tripIds],
    enabled: tripIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('driver_expenses')
        .select('id, category, amount, expense_at, notes, approval_status, dispatch_trip_id')
        .in('dispatch_trip_id', tripIds);
      return data || [];
    },
  });
  const totalExpenses = expenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const advances = expenses.filter((e: any) => /adiant/i.test(e.category || ''));
  const totalAdvances = advances.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const otherExpenses = expenses.filter((e: any) => !/adiant/i.test(e.category || ''));

  // Stops
  const { data: stops = [] } = useQuery({
    queryKey: ['romaneio_stops', tripIds],
    enabled: tripIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('dispatch_stops')
        .select('id, stop_order, destination, status, planned_at, arrival_at, clients(name)')
        .in('dispatch_trip_id', tripIds)
        .order('stop_order');
      return data || [];
    },
  });

  // Capacidade
  const palletPct = vehicle?.max_pallets ? Math.round(((load.total_pallet_count || 0) / vehicle.max_pallets) * 100) : null;
  const weightPct = vehicle?.max_weight_kg ? Math.round(((load.total_weight_kg || 0) / vehicle.max_weight_kg) * 100) : null;
  const volumePct = vehicle?.max_volume_m3 ? Math.round(((load.total_volume_m3 || 0) / vehicle.max_volume_m3) * 100) : null;

  const rentability = useMemo(() => {
    const revenue = cteTotal;
    const cost = totalExpenses;
    const profit = revenue - cost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, margin };
  }, [cteTotal, totalExpenses]);

  const handleSave = async () => {
    try {
      await updateLoad.mutateAsync({
        id: load.id,
        driver_id: form.driver_id !== '__none__' ? form.driver_id : null,
        vehicle_id: form.vehicle_id !== '__none__' ? form.vehicle_id : null,
        trailer_plate: form.trailer_plate || null,
        operation_type: form.operation_type !== '__none__' ? form.operation_type as any : null,
        origin: form.origin || null,
        destination: form.destination || null,
        actual_load_at: fromLocalDT(form.actual_load_at),
        estimated_arrival_at: fromLocalDT(form.estimated_arrival_at),
        gate_departure_at: fromLocalDT(form.gate_departure_at),
        arrival_at: fromLocalDT(form.arrival_at),
        ciot: form.ciot || null,
        monitored: form.monitored,
        dedicated_vehicle: form.dedicated_vehicle,
        monitor_responsible: form.monitor_responsible || null,
        sm_manager: form.sm_manager || null,
        sm_release: form.sm_release || null,
        driver_type: form.driver_type || null,
        merchandise_value: form.merchandise_value ? Number(form.merchandise_value) : null,
        total_pallet_count: form.total_pallet_count ? Number(form.total_pallet_count) : null,
        total_weight_kg: form.total_weight_kg ? Number(form.total_weight_kg) : null,
        total_volume_m3: form.total_volume_m3 ? Number(form.total_volume_m3) : null,
        notes: form.notes || null,
        distribution_manifest: form.distribution_manifest || null,
        shipment_manifest: form.shipment_manifest || null,
      } as any);
      toast.success('Cabeçalho do romaneio salvo');
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* Barra de ações rápidas (replica do sistema legado, com cores) */}
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 border-b bg-gradient-to-r from-primary/10 via-primary/5 to-transparent">
        {([
          // OPERAÇÃO
          { icon: Unlock, label: 'Liberar Travas', color: 'text-amber-600',
            onClick: () => toast.info('Liberar travas operacionais — confirme com supervisor (em breve).') },
          { icon: Lock, label: 'Bloquear', color: 'text-slate-600',
            onClick: () => toast.info('Bloquear edição da carga — em breve.') },
          { icon: Pencil, label: 'Editar', color: 'text-sky-600',
            onClick: () => { const el = document.getElementById('romaneio-form-top'); el?.scrollIntoView({ behavior: 'smooth' }); toast.info('Edite os campos abaixo e clique em Salvar.'); } },
          { icon: Save, label: 'Salvar', color: 'text-white', primary: true, onClick: handleSave },
          { sep: true },
          // INTEGRAÇÕES
          { icon: Database, label: 'WMS', color: 'text-emerald-600',
            onClick: () => navigate('/inventory') },
          { icon: Network, label: 'EDI', color: 'text-indigo-600',
            onClick: () => navigate('/integration-health') },
          { icon: Bot, label: 'RPA', color: 'text-purple-600',
            onClick: () => navigate('/ingestion') },
          { sep: true },
          // FINANCEIRO
          { icon: DollarIcon, label: 'Financeiro', color: 'text-green-600',
            onClick: () => navigate('/financial') },
          { icon: HandCoins, label: 'Receber', color: 'text-green-700',
            onClick: () => navigate('/receivables') },
          { sep: true },
          // DOCUMENTOS FISCAIS
          { icon: FileSearch, label: 'CON (Monitor)', color: 'text-blue-600',
            onClick: () => navigate(`/cte-hub?tab=monitor&load=${load.load_number}`) },
          { icon: Search, label: 'Consultar CT-e', color: 'text-blue-700',
            onClick: () => navigate(`/cte-hub?tab=consulta&load=${load.load_number}`) },
          { icon: Files, label: 'ORT', color: 'text-orange-600',
            onClick: () => navigate('/ort-management') },
          { icon: FilePlus, label: 'Novo Doc.', color: 'text-teal-600',
            onClick: () => navigate(`/fiscal-documents?load=${load.id}`) },
          { icon: Key, label: 'Chave Acesso', color: 'text-yellow-600',
            onClick: () => navigate(`/cte-hub?tab=consulta&key=${load.id}`) },
          { sep: true },
          // OPERACIONAL / QUALIDADE
          { icon: ClipboardCheck, label: 'Checklist', color: 'text-cyan-600',
            onClick: () => navigate(`/checklists?load=${load.id}`) },
          { icon: AlertTriangle, label: 'Ocorrência', color: 'text-red-600',
            onClick: () => navigate(`/incidents?load=${load.id}`) },
          { icon: XIcon, label: 'Cancelar Carga', color: 'text-destructive',
            onClick: () => toast.warning('Use o menu Status (acima) para cancelar a carga.') },
          { icon: FileText, label: 'Imprimir', color: 'text-zinc-600',
            onClick: () => window.print() },
        ] as Array<any>).map((b, i) => {
          if (b.sep) return <div key={`sep-${i}`} className="h-6 w-px bg-border mx-1" />;
          const Icon = b.icon;
          return (
            <Button
              key={b.label}
              size="sm"
              variant={b.primary ? 'default' : 'outline'}
              className={`h-8 px-2 text-xs gap-1 ${b.primary ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm' : 'bg-background hover:bg-muted'}`}
              onClick={b.onClick}
              title={b.label}
            >
              <Icon className={`h-3.5 w-3.5 ${b.primary ? '' : b.color}`} />
              <span className="hidden lg:inline">{b.label}</span>
            </Button>
          );
        })}
      </div>
      <Tabs defaultValue="geral" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b bg-muted/40 h-auto flex-wrap p-0">
          <TabsTrigger value="geral" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><FileText className="h-3 w-3 mr-1" />Geral</TabsTrigger>
          <TabsTrigger value="despesas" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><DollarSign className="h-3 w-3 mr-1" />Despesas/Custo Extra</TabsTrigger>
          <TabsTrigger value="dados" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><Package className="h-3 w-3 mr-1" />Dados da Carga</TabsTrigger>
          <TabsTrigger value="rent" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><TrendingUp className="h-3 w-3 mr-1" />Rentabilidade</TabsTrigger>
          <TabsTrigger value="manifesto" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><FileSignature className="h-3 w-3 mr-1" />Manifesto/Pedágio</TabsTrigger>
          <TabsTrigger value="adiant" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><HandCoins className="h-3 w-3 mr-1" />Adiantamentos</TabsTrigger>
          <TabsTrigger value="risco" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><ShieldCheck className="h-3 w-3 mr-1" />Gerenciadora de Risco</TabsTrigger>
          <TabsTrigger value="paletes" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><Boxes className="h-3 w-3 mr-1" />Mov. Paletes</TabsTrigger>
          <TabsTrigger value="docs" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none border-r"><Files className="h-3 w-3 mr-1" />Documentos</TabsTrigger>
          <TabsTrigger value="ciot" className="data-[state=active]:bg-background data-[state=active]:shadow-none rounded-none"><Truck className="h-3 w-3 mr-1" />CIOT Frota</TabsTrigger>
        </TabsList>

        {/* ===================== GERAL ===================== */}
        <TabsContent value="geral" className="p-4 space-y-4 m-0">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* COLUNA 1 */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase text-muted-foreground border-b pb-1">Identificação & Datas</div>
              <div>
                <Label className="text-[10px]">Motorista</Label>
                <SearchableSelect
                  value={form.driver_id}
                  onChange={v => {
                    const drv: any = drivers.find((d: any) => d.id === v);
                    setForm(f => ({
                      ...f,
                      driver_id: v,
                      // Auto-fill plate from driver's current vehicle (only if empty/none)
                      vehicle_id:
                        drv?.current_vehicle_id && (f.vehicle_id === '__none__' || !f.vehicle_id)
                          ? drv.current_vehicle_id
                          : f.vehicle_id,
                    }));
                  }}
                  options={[
                    { value: '__none__', label: '— Nenhum —' },
                    ...drivers.map((d: any) => ({ value: d.id, label: d.name })),
                  ]}
                  placeholder="Selecionar motorista"
                  searchPlaceholder="Digite o nome..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Placa</Label>
                  <SearchableSelect
                    value={form.vehicle_id}
                    onChange={v => setForm({ ...form, vehicle_id: v })}
                    options={[
                      { value: '__none__', label: '— Nenhum —' },
                      ...vehicles.map((v: any) => ({
                        value: v.id,
                        label: v.plate,
                        hint: v.nickname || undefined,
                      })),
                    ]}
                    placeholder="Placa"
                    searchPlaceholder="Digite a placa..."
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Placa Carreta</Label>
                  <Input className="h-8 text-xs" value={form.trailer_plate} onChange={e => setForm({ ...form, trailer_plate: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">% Ocup. M³</Label>
                  <div className={`h-8 text-xs rounded-md border px-2 flex items-center font-semibold ${volumePct && volumePct > 100 ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-muted/40'}`}>
                    {volumePct ?? 0}%
                  </div>
                </div>
                <div>
                  <Label className="text-[10px]">% Ocup. KG</Label>
                  <div className={`h-8 text-xs rounded-md border px-2 flex items-center font-semibold ${weightPct && weightPct > 100 ? 'bg-destructive/10 text-destructive border-destructive/30' : 'bg-muted/40'}`}>
                    {weightPct ?? 0}%
                  </div>
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Data Emissão</Label>
                <Input className="h-8 text-xs" disabled value={new Date(load.created_at).toLocaleString('pt-BR')} />
              </div>
              <div>
                <Label className="text-[10px]">Data do Carregamento</Label>
                <Input type="datetime-local" className="h-8 text-xs" value={form.actual_load_at} onChange={e => setForm({ ...form, actual_load_at: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Data Previsão Chegada</Label>
                <Input type="datetime-local" className="h-8 text-xs" value={form.estimated_arrival_at} onChange={e => setForm({ ...form, estimated_arrival_at: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Data Saída (Portaria)</Label>
                <Input type="datetime-local" className="h-8 text-xs" value={form.gate_departure_at} onChange={e => setForm({ ...form, gate_departure_at: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Data de Chegada</Label>
                <Input type="datetime-local" className="h-8 text-xs" value={form.arrival_at} onChange={e => setForm({ ...form, arrival_at: e.target.value })} />
              </div>
            </div>

            {/* COLUNA 2 */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase text-muted-foreground border-b pb-1">Operação & Carga</div>
              <div>
                <Label className="text-[10px]">Tipo Operação (Romexp)</Label>
                <SearchableSelect
                  value={form.operation_type}
                  onChange={v => setForm({ ...form, operation_type: v })}
                  options={OP_TYPES.map(o => ({ value: o.value, label: o.label }))}
                  placeholder="— Selecionar —"
                  searchPlaceholder="Digite o tipo..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Origem</Label>
                  <Input className="h-8 text-xs" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} />
                </div>
                <div>
                  <Label className="text-[10px]">Destino</Label>
                  <Input className="h-8 text-xs" value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px]">Peso Total (kg)</Label>
                  <Input type="number" step="0.01" className="h-8 text-xs" value={form.total_weight_kg} onChange={e => setForm({ ...form, total_weight_kg: e.target.value })} />
                </div>
                <div>
                  <Label className="text-[10px]">Volume M³</Label>
                  <Input type="number" step="0.001" className="h-8 text-xs" value={form.total_volume_m3} onChange={e => setForm({ ...form, total_volume_m3: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="text-[10px]">Paletes</Label>
                <Input type="number" className="h-8 text-xs" value={form.total_pallet_count} onChange={e => setForm({ ...form, total_pallet_count: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Valor CT-e Bruto (auto)</Label>
                <Input className="h-8 text-xs font-semibold" disabled value={fmtMoney(cteTotal)} />
              </div>
              <div>
                <Label className="text-[10px]">Observações</Label>
                <Textarea rows={3} className="text-xs" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {/* COLUNA 3 */}
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase text-muted-foreground border-b pb-1">Notas & Monitoramento</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px]">Qtd Entregas</Label>
                  <Input className="h-8 text-xs" disabled value={deliveriesQty} />
                </div>
                <div>
                  <Label className="text-[10px]">Qtd NFS</Label>
                  <Input className="h-8 text-xs" disabled value={nfeQty} />
                </div>
                <div>
                  <Label className="text-[10px]">Valor Total NFS</Label>
                  <Input className="h-8 text-xs font-semibold" disabled value={fmtMoney(nfeTotal)} />
                </div>
              </div>
              <div>
                <Label className="text-[10px]">CIOT</Label>
                <Input className="h-8 text-xs" value={form.ciot} onChange={e => setForm({ ...form, ciot: e.target.value })} />
              </div>
              <div>
                <Label className="text-[10px]">Tipo Motorista</Label>
                <Input className="h-8 text-xs" value={form.driver_type} onChange={e => setForm({ ...form, driver_type: e.target.value })} placeholder="Próprio / Agregado / Terceiro" />
              </div>
              <div>
                <Label className="text-[10px]">Resp. Monitoramento</Label>
                <Input className="h-8 text-xs" value={form.monitor_responsible} onChange={e => setForm({ ...form, monitor_responsible: e.target.value })} />
              </div>
              <div className="flex items-center justify-between p-2 border rounded-md">
                <Label className="text-xs">Monitorado</Label>
                <Switch checked={form.monitored} onCheckedChange={v => setForm({ ...form, monitored: v })} />
              </div>
            </div>
          </div>

          {/* Tabela de paradas (rodapé) */}
          <div className="border rounded-md">
            <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-bold uppercase">Paradas / Roteiro</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">#</TableHead>
                  <TableHead className="text-[10px]">Destino</TableHead>
                  <TableHead className="text-[10px]">Cliente</TableHead>
                  <TableHead className="text-[10px]">Status</TableHead>
                  <TableHead className="text-[10px]">Previsto</TableHead>
                  <TableHead className="text-[10px]">Chegada</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stops.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-4">Nenhuma parada — despache a carga para gerar o roteiro.</TableCell></TableRow>
                ) : stops.map((s: any) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-xs font-semibold">{s.stop_order}</TableCell>
                    <TableCell className="text-xs">{s.destination}</TableCell>
                    <TableCell className="text-xs">{s.clients?.name || '—'}</TableCell>
                    <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{s.status}</Badge></TableCell>
                    <TableCell className="text-xs">{s.planned_at ? new Date(s.planned_at).toLocaleString('pt-BR') : '—'}</TableCell>
                    <TableCell className="text-xs">{s.arrival_at ? new Date(s.arrival_at).toLocaleString('pt-BR') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Painel de Notas Fiscais (POPUP_LG_ROMEXP_CLI) */}
          <LoadNotesPanel load={load} documents={documents} onSaved={onSaved} />

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={updateLoad.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {updateLoad.isPending ? 'Salvando...' : 'Salvar Cabeçalho'}
            </Button>
          </div>
        </TabsContent>

        {/* ===================== DESPESAS ===================== */}
        <TabsContent value="despesas" className="p-4 space-y-3 m-0">
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              Total geral: <span className="font-bold text-foreground">{fmtMoney(totalExpenses)}</span> · {expenses.length} lançamento(s)
            </div>
            <Button size="sm" variant="outline" onClick={() => window.open(`/expense-approval`, '_self')}>
              <Plus className="h-3 w-3 mr-1" /> Gerenciar Despesas
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs">Categoria</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Obs.</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {otherExpenses.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-6">Sem despesas registradas para esta carga.</TableCell></TableRow>
              ) : otherExpenses.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.expense_at).toLocaleDateString('pt-BR')}</TableCell>
                  <TableCell className="text-xs">{e.category}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{e.approval_status}</Badge></TableCell>
                  <TableCell className="text-xs">{e.notes || '—'}</TableCell>
                  <TableCell className="text-xs text-right font-medium">{fmtMoney(Number(e.amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ===================== DADOS DA CARGA ===================== */}
        <TabsContent value="dados" className="p-4 m-0">
          <LoadItemsPanel
            loadId={load.id}
            vehicleMaxPallets={vehicle?.max_pallets}
            vehicleMaxWeight={vehicle?.max_weight_kg}
          />
        </TabsContent>

        {/* ===================== RENTABILIDADE ===================== */}
        <TabsContent value="rent" className="p-4 m-0">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Receita (CT-es)</div><div className="text-lg font-bold text-success">{fmtMoney(rentability.revenue)}</div></CardContent></Card>
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Custos (Despesas)</div><div className="text-lg font-bold text-destructive">{fmtMoney(rentability.cost)}</div></CardContent></Card>
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Lucro</div><div className={`text-lg font-bold ${rentability.profit >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtMoney(rentability.profit)}</div></CardContent></Card>
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Margem</div><div className={`text-lg font-bold ${rentability.margin >= 0 ? 'text-success' : 'text-destructive'}`}>{rentability.margin.toFixed(1)}%</div></CardContent></Card>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">Cálculo: Receita (soma frete CT-es ativos) − Despesas (driver_expenses dos trips da carga).</p>
        </TabsContent>

        {/* ===================== MANIFESTO ===================== */}
        <TabsContent value="manifesto" className="p-4 m-0">
          <ManifestPanel
            loadId={load.id}
            loadNumber={load.load_number}
            origin={(load as any).origin}
            destination={load.destination}
          />
        </TabsContent>

        {/* ===================== ADIANTAMENTOS ===================== */}
        <TabsContent value="adiant" className="p-4 space-y-3 m-0">
          <div className="text-xs text-muted-foreground">
            Total adiantado: <span className="font-bold text-foreground">{fmtMoney(totalAdvances)}</span> · {advances.length} lançamento(s)
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Data</TableHead>
                <TableHead className="text-xs">Categoria</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advances.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">Sem adiantamentos registrados.</TableCell></TableRow>
              ) : advances.map((e: any) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.expense_at).toLocaleDateString('pt-BR')}</TableCell>
                  <TableCell className="text-xs">{e.category}</TableCell>
                  <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{e.approval_status}</Badge></TableCell>
                  <TableCell className="text-xs text-right font-medium">{fmtMoney(Number(e.amount))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        {/* ===================== RISCO ===================== */}
        <TabsContent value="risco" className="p-4 m-0 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label className="text-[10px]">Gerenciadora SM</Label><Input className="h-8 text-xs" value={form.sm_manager} onChange={e => setForm({ ...form, sm_manager: e.target.value })} /></div>
            <div><Label className="text-[10px]">Liberação SM</Label><Input className="h-8 text-xs" value={form.sm_release} onChange={e => setForm({ ...form, sm_release: e.target.value })} /></div>
            <div><Label className="text-[10px]">Resp. Monitoramento</Label><Input className="h-8 text-xs" value={form.monitor_responsible} onChange={e => setForm({ ...form, monitor_responsible: e.target.value })} /></div>
            <div className="flex items-center justify-between p-2 border rounded-md"><Label className="text-xs">Monitorado</Label><Switch checked={form.monitored} onCheckedChange={v => setForm({ ...form, monitored: v })} /></div>
          </div>
          <div className="flex justify-end"><Button onClick={handleSave} size="sm"><Save className="h-3 w-3 mr-1" />Salvar</Button></div>
        </TabsContent>

        {/* ===================== PALETES ===================== */}
        <TabsContent value="paletes" className="p-4 m-0 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Paletes Carregados</div><div className="text-lg font-bold">{load.total_pallet_count || 0}</div></CardContent></Card>
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Capacidade Veículo</div><div className="text-lg font-bold">{vehicle?.max_pallets ?? '—'}</div></CardContent></Card>
            <Card><CardContent className="py-3"><div className="text-[10px] uppercase text-muted-foreground">Ocupação</div><div className={`text-lg font-bold ${(palletPct ?? 0) > 100 ? 'text-destructive' : ''}`}>{palletPct ?? 0}%</div></CardContent></Card>
          </div>
          <p className="text-[11px] text-muted-foreground">A movimentação detalhada de paletes (saída/retorno) está disponível na execução da viagem (Driver Workspace).</p>
        </TabsContent>

        {/* ===================== DOCUMENTOS ===================== */}
        <TabsContent value="docs" className="p-4 m-0 space-y-4">
          <CTeWorkbench loadId={load.id} loadNumber={load.load_number} destination={load.destination} documents={documents as any} />
          <NFSePanel
            loadId={load.id}
            loadNumber={load.load_number}
            destination={load.destination}
            defaultClientName={(documents as any)?.[0]?.recipient ?? null}
            defaultClientCnpj={(documents as any)?.[0]?.recipient_cnpj ?? null}
            freightTotal={(documents as any)?.reduce((s: number, d: any) => s + Number(d.freight_value || 0), 0) ?? 0}
          />
        </TabsContent>

        {/* ===================== CIOT FROTA ===================== */}
        <TabsContent value="ciot" className="p-4 m-0 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label className="text-[10px]">CIOT</Label><Input className="h-8 text-xs font-mono" value={form.ciot} onChange={e => setForm({ ...form, ciot: e.target.value })} placeholder="000000000000" /></div>
            <div><Label className="text-[10px]">Tipo Motorista</Label><Input className="h-8 text-xs" value={form.driver_type} onChange={e => setForm({ ...form, driver_type: e.target.value })} placeholder="Próprio / Agregado / Terceiro" /></div>
            <div><Label className="text-[10px]">Placa Cavalo</Label><Input className="h-8 text-xs" disabled value={vehicle?.plate || '—'} /></div>
            <div><Label className="text-[10px]">Placa Carreta</Label><Input className="h-8 text-xs" value={form.trailer_plate} onChange={e => setForm({ ...form, trailer_plate: e.target.value.toUpperCase() })} /></div>
          </div>
          <p className="text-[11px] text-muted-foreground">O CIOT é obrigatório para motoristas autônomos em operações de fretamento. Salvo junto ao cabeçalho.</p>
          <div className="flex justify-end"><Button onClick={handleSave} size="sm"><Save className="h-3 w-3 mr-1" />Salvar</Button></div>
        </TabsContent>
      </Tabs>
    </Card>
  );
}