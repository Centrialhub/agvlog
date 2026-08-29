import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useFleetPositions } from '@/hooks/usePositions';
import { fiscalDocRevenue, isVoidFiscalStatus } from '@/lib/fiscal/documentStatus';
import { useFleetState, MovementState, stateColor, stateLabel, formatStoppedDuration } from '@/hooks/useVehiclesState';
import { useVehicles } from '@/hooks/useVehicles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapAutoFit } from '@/components/maps/MapAutoFit';
import { createTruckMarkerIcon, DEFAULT_BRAZIL_MAP_CENTER } from '@/lib/maps/leaflet';
import {
  PackageCheck, AlertTriangle, Truck, Clock, ArrowRight, Receipt,
  TrendingUp, FileText, Wrench, Users, Layers, MapPin,
  BarChart3, ShieldAlert, Bell, Eye, Zap,
  ChevronRight, Navigation, CircleDot, Package, Scale,
  Sun, Moon, Sunrise,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid, Area, AreaChart,
} from 'recharts';

function createVehicleIcon(state: MovementState) {
  const color = stateColor(state);
  return createTruckMarkerIcon({
    color,
    opacity: state === 'offline' || state === 'unknown' ? 0.6 : 1,
    className: 'custom-vehicle-marker',
  });
}

const COLORS = [
  'hsl(215, 80%, 48%)', 'hsl(142, 64%, 38%)', 'hsl(38, 92%, 50%)',
  'hsl(0, 72%, 51%)', 'hsl(270, 60%, 55%)', 'hsl(180, 60%, 40%)',
  'hsl(320, 65%, 50%)', 'hsl(25, 85%, 55%)',
];

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada', assembling: 'Montando', ready: 'Pronta',
  loading: 'Carregando', loaded: 'Carregada', in_transit: 'Em Trânsito',
  delivered: 'Entregue', divergent: 'Divergente',
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-muted text-muted-foreground',
  assembling: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  loading: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  loaded: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  in_transit: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  divergent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
  high: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400',
  medium: 'bg-warning/15 text-warning border-warning/30',
  low: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400',
};

export default function OperationsCenter() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Clock (Brasilia) ──
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const brasiliaTime = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const brasiliaDate = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const brasiliaHour = parseInt(now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }));

  const getGreeting = () => {
    if (brasiliaHour >= 5 && brasiliaHour < 12) return 'Bom dia';
    if (brasiliaHour >= 12 && brasiliaHour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  const getGreetingIcon = () => {
    if (brasiliaHour >= 5 && brasiliaHour < 12) return <Sunrise className="h-5 w-5 text-amber-400" />;
    if (brasiliaHour >= 12 && brasiliaHour < 18) return <Sun className="h-5 w-5 text-amber-500" />;
    return <Moon className="h-5 w-5 text-indigo-400" />;
  };

  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Operador';

  const MOTIVATIONAL_QUOTES = [
    'A excelência não é um ato, é um hábito. — Aristóteles',
    'Cada entrega feita com cuidado constrói confiança.',
    'O sucesso é a soma de pequenos esforços repetidos dia após dia.',
    'Logística é a arte de fazer o impossível parecer simples.',
    'Quem planeja bem, executa melhor.',
    'Disciplina é a ponte entre metas e conquistas.',
    'Grandes resultados nascem de equipes comprometidas.',
    'Eficiência hoje, crescimento amanhã.',
    'Cada quilômetro rodado é uma promessa cumprida.',
    'A estrada é longa, mas o destino compensa.',
    'Precisão nos detalhes, excelência no resultado.',
    'Juntos somos mais fortes — e mais rápidos.',
    'Segurança em primeiro lugar, sempre.',
    'Um bom dia começa com um bom planejamento.',
    'Entregar no prazo é entregar respeito.',
    'Cada carga carrega a confiança do nosso cliente.',
    'O caminho se faz ao caminhar. — Antonio Machado',
    'Persistência transforma esforço em resultado.',
    'A melhor rota é aquela bem planejada.',
    'Hoje é um bom dia para superar expectativas.',
    'Trabalho em equipe divide tarefas e multiplica resultados.',
    'Pontualidade é o compromisso com quem espera.',
    'Inovação é fazer mais com menos, sem perder qualidade.',
    'Cada desafio é uma oportunidade disfarçada.',
    'Quem cuida da frota, cuida do futuro.',
    'A operação não para — e nós também não.',
    'Compromisso com a qualidade, todos os dias.',
    'O detalhe faz a diferença entre bom e excelente.',
    'Velocidade com segurança: esse é o nosso ritmo.',
    'Um dia produtivo começa com foco e atitude.',
  ];

  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const dailyQuote = MOTIVATIONAL_QUOTES[dayOfYear % MOTIVATIONAL_QUOTES.length];


  const { data: loads = [] } = useQuery({
    queryKey: ['ops_loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });

  // ── Fiscal Documents ──
  const { data: fiscalDocs = [] } = useQuery({
    queryKey: ['ops_fiscal', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, document_type, value, weight_kg, pallet_count, status, created_at, issue_date, freight_value')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Alert Instances ──
  const { data: alerts = [] } = useQuery({
    queryKey: ['ops_alerts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('alert_instances')
        .select('*, alert_rules(rule_type, params), vehicles(plate, nickname)')
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });

  // ── Incidents ──
  const { data: incidents = [] } = useQuery({
    queryKey: ['ops_incidents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('incidents')
        .select('id, status, severity, title, incident_type, created_at, occurred_at')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Fleet ──
  const { data: vehicles = [] } = useVehicles();
  const { data: vehicleStates = [] } = useFleetState();
  const { data: positions = [] } = useFleetPositions();

  // ── Drivers ──
  const { data: drivers = [] } = useQuery({
    queryKey: ['ops_drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('drivers')
        .select('id, active, name, current_vehicle_id')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Pending expenses ──
  const { data: pendingExpenses = 0 } = useQuery({
    queryKey: ['ops_expenses_count', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase
        .from('driver_expenses')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .eq('approval_status', 'pending');
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  // ── Maintenance ──
  const { data: openMaintenance = 0 } = useQuery({
    queryKey: ['ops_maintenance', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return 0;
      const { count, error } = await supabase
        .from('maintenance_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .not('status', 'in', '("closed","completed")');
      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentTenant,
  });

  // ── Dispatch Trips ──
  const { data: activeTrips = [] } = useQuery({
    queryKey: ['ops_trips', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('id, status, vehicle_id, driver_id, load_id, planned_start_at, actual_start_at')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // ── Fleet Map Data ──
  const stateMap = useMemo(() => {
    const map: Record<string, (typeof vehicleStates)[number]> = {};
    for (const s of vehicleStates) map[s.vehicle_id] = s;
    return map;
  }, [vehicleStates]);

  const enrichedVehicles = useMemo(() => {
    return vehicles.map(v => {
      const state = stateMap[v.id];
      const pos = positions.find((position) => position.vehicle_id === v.id);
      return {
        vehicle: v,
        state: (state?.movement_state || 'unknown') as MovementState,
        lat: state?.lat ?? pos?.lat ?? null,
        lng: state?.lng ?? pos?.lng ?? null,
        speed: state?.speed ?? 0,
        stoppedDuration: state?.stopped_duration_seconds ?? 0,
        lastPositionAt: state?.last_position_at || pos?.captured_at || null,
      };
    });
  }, [vehicles, stateMap, positions]);

  const vehiclesWithPosition = useMemo(() =>
    enrichedVehicles.filter(e => e.lat != null && e.lng != null),
    [enrichedVehicles]
  );
  const mapPoints = useMemo<[number, number][]>(
    () => vehiclesWithPosition.map((entry) => [entry.lat as number, entry.lng as number]),
    [vehiclesWithPosition],
  );

  const fleetStats = useMemo(() => {
    const moving = enrichedVehicles.filter(e => e.state === 'moving').length;
    const stopped = enrichedVehicles.filter(e => e.state === 'stopped').length;
    const idle = enrichedVehicles.filter(e => e.state === 'idle').length;
    const offline = enrichedVehicles.filter(e => e.state === 'offline').length;
    const unknown = enrichedVehicles.filter(e => e.state === 'unknown').length;
    return { total: vehicles.length, moving, stopped, idle, offline, unknown, online: moving + stopped + idle };
  }, [vehicles, enrichedVehicles]);

  // ── Computed Stats ──
  const stats = useMemo(() => {
    const activeLoads = loads.filter((load) => !['delivered', 'cancelled'].includes(load.status));
    const inTransit = loads.filter((load) => load.status === 'in_transit');
    const delivered = loads.filter((load) => load.status === 'delivered');
    const delayed = loads.filter((load) => {
      if (load.status === 'delivered' || load.status === 'cancelled') return false;
      const hoursSince = (Date.now() - new Date(load.updated_at).getTime()) / 3600000;
      return hoursSince > 24;
    });
    const totalWeightActive = activeLoads.reduce((sum, load) => sum + (Number(load.total_weight_kg) || 0), 0);
    const totalPalletsActive = activeLoads.reduce((sum, load) => sum + (Number(load.total_pallet_count) || 0), 0);

    // Documentos válidos seguindo lógica fiscal centralizada
    const nfes = fiscalDocs.filter((document) => document.document_type === 'inbound' && !isVoidFiscalStatus(document.status));
    const ctes = fiscalDocs.filter((document) => document.document_type === 'outbound' && !isVoidFiscalStatus(document.status));
    
    const totalNfeValue = nfes.reduce((sum, document) => sum + (Number(document.value) || 0), 0);
    // Receita de CT-e (confirmados): rascunhos/transmitindo não somam em faturamento real no dashboard
    const totalFreight = ctes.filter(d => !['draft', 'pending', 'processing', 'submitted'].includes(d.status))
      .reduce((sum, document) => sum + fiscalDocRevenue(document), 0);
    const totalCteValue = totalFreight;

    const activeDrivers = drivers.filter((driver) => driver.active);
    const driversWithVehicle = drivers.filter((driver) => driver.active && driver.current_vehicle_id);
    const openIncidents = incidents.filter((incident) => !['closed', 'resolved', 'cancelled'].includes(incident.status));
    const criticalIncidents = openIncidents.filter((incident) => incident.severity === 'critical' || incident.severity === 'high');

    return {
      activeLoads: activeLoads.length,
      inTransit: inTransit.length,
      delivered: delivered.length,
      delayed: delayed.length,
      totalWeightActive,
      totalPalletsActive,
      nfeCount: nfes.length,
      cteCount: ctes.length,
      totalNfeValue,
      totalCteValue,
      totalFreight,
      activeDrivers: activeDrivers.length,
      driversWithVehicle: driversWithVehicle.length,
      openIncidents: openIncidents.length,
      criticalIncidents: criticalIncidents.length,
      activeTrips: activeTrips.length,
    };
  }, [loads, fiscalDocs, drivers, incidents, activeTrips]);

  // ── Chart Data ──
  const destChart = useMemo(() => {
    const activeLoads = loads.filter((load) => !['delivered'].includes(load.status));
    const groups: Record<string, { pallets: number; weight: number; count: number }> = {};
    activeLoads.forEach((load) => {
      const dest = (load.destination || 'Sem destino').substring(0, 20);
      if (!groups[dest]) groups[dest] = { pallets: 0, weight: 0, count: 0 };
      groups[dest].pallets += Number(load.total_pallet_count) || 0;
      groups[dest].weight += Number(load.total_weight_kg) || 0;
      groups[dest].count += 1;
    });
    return Object.entries(groups)
      .map(([dest, v]) => ({ dest, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [loads]);

  const statusChart = useMemo(() => {
    const counts: Record<string, number> = {};
    loads.forEach((load) => {
      const s = load.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABELS[status] || status,
      value,
    }));
  }, [loads]);

  const nfeByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const nfes = fiscalDocs.filter((document) => document.document_type === 'inbound');
    nfes.forEach((document) => {
      const day = (document.issue_date || document.created_at?.slice(0, 10)) || '';
      if (day) days[day] = (days[day] || 0) + 1;
    });
    return Object.entries(days)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, qty]) => ({ day: format(new Date(day + 'T12:00:00'), 'dd/MM'), qty }))
      .slice(-14);
  }, [fiscalDocs]);

  const fmtCurrency = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtWeight = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}t` : `${v.toFixed(0)}kg`;

  return (
    <div className="animate-fade-in space-y-5">
      {/* ── Welcome Banner ── */}
      <div className="relative overflow-hidden rounded-2xl border bg-card p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/3 to-accent/5" />
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-primary/5 blur-2xl" />
        <div className="absolute -bottom-12 -left-12 w-36 h-36 rounded-full bg-accent/5 blur-2xl" />

        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar / Greeting Icon */}
            <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-sm">
              {getGreetingIcon()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">
                  {getGreeting()}, <span className="text-primary">{userName}</span>
                </h1>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5 capitalize">
                {brasiliaDate}
              </p>
              <p className="text-[11px] text-muted-foreground/70 mt-1 italic max-w-md">
                "{dailyQuote}"
              </p>
            </div>
          </div>

          {/* Clock + Actions */}
          <div className="flex items-center gap-4">
            {/* Clock */}
            <div className="hidden md:flex flex-col items-end mr-2">
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-medium">Brasília</span>
              </div>
              <p className="text-2xl font-mono font-bold text-foreground tracking-wider tabular-nums mt-0.5">
                {brasiliaTime}
              </p>
            </div>

            <div className="h-10 w-px bg-border hidden md:block" />

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/ingestion')}>
                <FileText className="h-4 w-4 mr-1" /> Importar
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/route-planning')}>
                <MapPin className="h-4 w-4 mr-1" /> Roteirizar
              </Button>
              <Button size="sm" onClick={() => navigate('/loads')}>
                <PackageCheck className="h-4 w-4 mr-1" /> Cargas
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          className="relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 border-primary/20 group"
          onClick={() => navigate('/loads')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-primary/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-primary/5 group-hover:bg-primary/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <PackageCheck className="h-5 w-5 text-primary" />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">ativas</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{stats.activeLoads}</p>
            <p className="text-xs text-muted-foreground mt-1">Cargas em operação</p>
            <div className="flex gap-3 mt-3 text-[10px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Scale className="h-3 w-3" /> {fmtWeight(stats.totalWeightActive)}
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Package className="h-3 w-3" /> {stats.totalPalletsActive} pal
              </span>
            </div>
          </CardContent>
        </Card>

        <Card
          className="relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 border-purple-500/20 group"
          onClick={() => navigate('/loads')}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/8 via-purple-500/4 to-transparent" />
          <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-purple-500/5 group-hover:bg-purple-500/10 transition-colors" />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                <Truck className="h-5 w-5 text-purple-600" />
              </div>
              <Badge variant="secondary" className="text-[10px] font-medium">trânsito</Badge>
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{stats.inTransit}</p>
            <p className="text-xs text-muted-foreground mt-1">Em trânsito agora</p>
            <div className="flex gap-3 mt-3 text-[10px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Navigation className="h-3 w-3" /> {stats.activeTrips} viagens
              </span>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 group ${stats.delayed > 0 ? 'border-destructive/30' : 'border-border'}`}
        >
          <div className={`absolute inset-0 ${stats.delayed > 0 ? 'bg-gradient-to-br from-destructive/8 via-destructive/4 to-transparent' : ''}`} />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${stats.delayed > 0 ? 'bg-destructive/10' : 'bg-muted'}`}>
                <Clock className={`h-5 w-5 ${stats.delayed > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
              </div>
              {stats.delayed > 0 && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                </span>
              )}
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{stats.delayed}</p>
            <p className="text-xs text-muted-foreground mt-1">Atrasadas (&gt;24h)</p>
          </CardContent>
        </Card>

        <Card
          className={`relative overflow-hidden cursor-pointer hover:shadow-xl transition-all duration-300 group ${stats.openIncidents > 0 ? 'border-warning/30' : 'border-border'}`}
          onClick={() => navigate('/incidents')}
        >
          <div className={`absolute inset-0 ${stats.openIncidents > 0 ? 'bg-gradient-to-br from-warning/8 via-warning/4 to-transparent' : ''}`} />
          <CardContent className="p-5 relative">
            <div className="flex items-center justify-between mb-3">
              <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${stats.openIncidents > 0 ? 'bg-warning/10' : 'bg-muted'}`}>
                <ShieldAlert className={`h-5 w-5 ${stats.openIncidents > 0 ? 'text-warning' : 'text-muted-foreground'}`} />
              </div>
              {stats.openIncidents > 0 && (
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
                </span>
              )}
            </div>
            <p className="text-3xl font-extrabold text-foreground tracking-tight">{stats.openIncidents}</p>
            <p className="text-xs text-muted-foreground mt-1">Incidentes abertos</p>
            {stats.criticalIncidents > 0 && (
              <p className="text-[10px] text-destructive font-medium mt-1">{stats.criticalIncidents} crítico(s)</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Secondary KPIs ── */}
      <div className="grid grid-cols-3 lg:grid-cols-7 gap-3">
        {[
          { icon: FileText, label: 'NF-es', value: stats.nfeCount, sub: fmtCurrency(stats.totalNfeValue), color: 'text-blue-500', path: '/fiscal-documents' },
          { icon: Receipt, label: 'CT-es', value: stats.cteCount, sub: stats.cteCount > 0 ? fmtCurrency(stats.totalCteValue) : '—', color: 'text-emerald-500', path: '/fiscal-documents' },
          { icon: Truck, label: 'Frota', value: fleetStats.total, sub: `${fleetStats.online} online`, color: 'text-indigo-500', path: '/vehicles' },
          { icon: Users, label: 'Motoristas', value: stats.activeDrivers, sub: `${stats.driversWithVehicle} alocados`, color: 'text-teal-500', path: '/drivers' },
          { icon: Wrench, label: 'Manutenção', value: openMaintenance, sub: 'OS abertas', color: 'text-orange-500', path: '/maintenance-orders', warn: openMaintenance > 0 },
          { icon: Receipt, label: 'Despesas', value: pendingExpenses, sub: 'pendentes', color: 'text-amber-500', path: '/expense-approval', warn: pendingExpenses > 0 },
          { icon: Bell, label: 'Alertas', value: alerts.length, sub: 'ativos', color: 'text-red-500', path: '/alerts', warn: alerts.length > 0 },
        ].map(({ icon: Icon, label, value, sub, color, path, warn }) => (
          <Card
            key={label}
            className={`cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${warn ? 'border-warning/40' : ''}`}
            onClick={() => navigate(path)}
          >
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
              </div>
              <p className="text-lg font-bold">{value}</p>
              <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Fleet Map Preview + Alerts ── */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Mini Map */}
        <Card className="lg:col-span-3 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" /> Frota em Tempo Real
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-green-500" /> {fleetStats.moving}</span>
                  <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-amber-500" /> {fleetStats.stopped}</span>
                  <span className="flex items-center gap-1"><CircleDot className="h-2.5 w-2.5 text-slate-400" /> {fleetStats.offline}</span>
                </div>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/fleet-map')}>
                  <Eye className="h-3 w-3 mr-1" /> Expandir
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[320px] w-full">
              <MapContainer
                center={mapPoints[0] ?? DEFAULT_BRAZIL_MAP_CENTER}
                zoom={4}
                style={{ height: '100%', width: '100%' }}
                zoomControl={true}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {mapPoints.length > 0 && (
                  <MapAutoFit points={mapPoints} padding={20} maxZoom={12} />
                )}
                {vehiclesWithPosition.map(e => (
                  <Marker
                    key={e.vehicle.id}
                    position={[e.lat!, e.lng!]}
                    icon={createVehicleIcon(e.state)}
                  >
                    <Popup>
                      <div className="min-w-[180px]">
                        <p className="font-bold text-sm">{e.vehicle.plate}</p>
                        {e.vehicle.nickname && <p className="text-xs text-gray-500">{e.vehicle.nickname}</p>}
                        <div className="mt-2 space-y-1 text-xs">
                          <p>Status: <strong>{stateLabel(e.state)}</strong></p>
                          <p>Velocidade: <strong>{Math.round(e.speed)} km/h</strong></p>
                          {(e.state === 'stopped' || e.state === 'idle') && e.stoppedDuration > 0 && (
                            <p>Parado há: <strong>{formatStoppedDuration(e.stoppedDuration)}</strong></p>
                          )}
                          {e.lastPositionAt && (
                            <p>Última posição: {formatDistanceToNow(new Date(e.lastPositionAt), { addSuffix: true, locale: ptBR })}</p>
                          )}
                        </div>
                        <button
                          onClick={() => navigate(`/vehicles/${e.vehicle.id}`)}
                          className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" /> Ver detalhes
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </CardContent>
        </Card>

        {/* Alerts + Incidents */}
        <div className="lg:col-span-2 space-y-4">
          {/* Active Alerts */}
          <Card className={`${alerts.length > 0 ? 'border-destructive/20' : ''}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-destructive" /> Alertas Ativos
                  {alerts.length > 0 && (
                    <Badge variant="destructive" className="text-[9px] h-4 px-1.5">{alerts.length}</Badge>
                  )}
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/alerts')}>
                  Ver todos <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-[140px] overflow-y-auto">
              {alerts.slice(0, 6).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30 hover:bg-muted/60 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium truncate">
                      {alert.alert_rules?.rule_type || 'Alerta'}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {alert.vehicles?.plate || '—'} · {formatDistanceToNow(new Date(alert.opened_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 ml-2" />
                </div>
              ))}
              {alerts.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta ativo ✓</p>
              )}
            </CardContent>
          </Card>

          {/* Recent Incidents */}
          <Card className={`${stats.openIncidents > 0 ? 'border-warning/20' : ''}`}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-warning" /> Incidentes
                </CardTitle>
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/incidents')}>
                  Ver todos <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-[120px] overflow-y-auto">
              {incidents.filter((incident) => !['closed', 'resolved'].includes(incident.status)).slice(0, 5).map((inc) => (
                <div key={inc.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-muted/30">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium truncate">{inc.title}</p>
                    <p className="text-[10px] text-muted-foreground">{inc.incident_type}</p>
                  </div>
                  <Badge className={`text-[9px] shrink-0 ml-2 ${SEVERITY_COLORS[inc.severity] || ''}`}>
                    {inc.severity}
                  </Badge>
                </div>
              ))}
              {stats.openIncidents === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Sem incidentes abertos ✓</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Charts Row ── */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Loads by Destination */}
        <Card className="lg:col-span-2 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Distribuição por Destino
            </CardTitle>
          </CardHeader>
          <CardContent>
            {destChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={destChart} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="dest" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}
                    formatter={(value: number, name: string) => [
                      name === 'weight' ? fmtWeight(value) : value,
                      name === 'weight' ? 'Peso' : name === 'count' ? 'Cargas' : 'Paletes',
                    ]}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Cargas" />
                  <Bar dataKey="pallets" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Paletes" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                Sem dados de destino
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Pie */}
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" /> Status das Cargas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            {statusChart.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <PieChart>
                    <Pie
                      data={statusChart}
                      cx="50%" cy="50%"
                      innerRadius={45} outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {statusChart.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: 'hsl(var(--card))' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                  {statusChart.map((entry, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-[10px] text-muted-foreground">{entry.name} ({entry.value})</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">Sem cargas</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── NF-e Flow ── */}
      {nfeByDay.length > 0 && (
        <Card className="shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Fluxo de NF-es Recebidas
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">{stats.nfeCount} total</Badge>
                {stats.totalFreight > 0 && (
                  <Badge variant="outline" className="text-[10px]">Frete: {fmtCurrency(stats.totalFreight)}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={nfeByDay} margin={{ left: -10, right: 10 }}>
                <defs>
                  <linearGradient id="nfeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, background: 'hsl(var(--card))' }} />
                <Area type="monotone" dataKey="qty" stroke="hsl(var(--primary))" fill="url(#nfeGrad)" strokeWidth={2} name="NF-es" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Bottom: Loads + Quick Actions ── */}
      <div className="grid lg:grid-cols-5 gap-4">
        {/* Recent Loads */}
        <Card className="lg:col-span-3 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <PackageCheck className="h-4 w-4" /> Cargas Recentes
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => navigate('/loads')}>
                Ver todas <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {loads.slice(0, 8).map((load) => {
                const vehicle = load.vehicles;
                const driver = load.drivers;
                return (
                  <div
                    key={load.id}
                    className="flex items-center justify-between py-2.5 px-4 cursor-pointer hover:bg-muted/40 transition-colors group"
                    onClick={() => navigate(`/loads/${load.id}`)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{load.load_number}</span>
                          {vehicle && (
                            <span className="text-[10px] text-muted-foreground">
                              <Truck className="inline h-2.5 w-2.5 mr-0.5" />{vehicle.plate}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {load.origin || '—'} → {load.destination || '—'}
                          {driver && <span className="ml-2">• {driver.name}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-2 hidden sm:block">
                        <p className="text-[10px] text-muted-foreground">{fmtWeight(Number(load.total_weight_kg || 0))}</p>
                        <p className="text-[10px] text-muted-foreground">{load.total_pallet_count || 0} pal</p>
                      </div>
                      <Badge className={`text-[10px] ${STATUS_COLORS[load.status] || ''}`} variant="secondary">
                        {STATUS_LABELS[load.status] || load.status}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                );
              })}
              {loads.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8">Nenhuma carga encontrada. Importe NF-es para começar.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" /> Ações Rápidas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { icon: FileText, label: 'Importar NF-es', path: '/ingestion', color: 'text-blue-500' },
                { icon: MapPin, label: 'Planejar Rotas', path: '/route-planning', color: 'text-emerald-500' },
                { icon: Receipt, label: 'Documentos Fiscais', path: '/fiscal-documents', color: 'text-purple-500' },
                { icon: Truck, label: 'Mapa da Frota', path: '/fleet-map', color: 'text-indigo-500' },
              ].map(({ icon: Icon, label, path, color }) => (
                <Button
                  key={path}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-xs h-8 hover:bg-muted/60 transition-colors"
                  onClick={() => navigate(path)}
                >
                  <Icon className={`h-3.5 w-3.5 mr-2 ${color}`} /> {label}
                </Button>
              ))}
              {pendingExpenses > 0 && (
                <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-warning/40 text-warning" onClick={() => navigate('/expense-approval')}>
                  <Receipt className="h-3.5 w-3.5 mr-2" /> {pendingExpenses} despesa(s) pendente(s)
                </Button>
              )}
              {openMaintenance > 0 && (
                <Button variant="outline" size="sm" className="w-full justify-start text-xs h-8 border-orange-400/40 text-orange-600" onClick={() => navigate('/maintenance-orders')}>
                  <Wrench className="h-3.5 w-3.5 mr-2" /> {openMaintenance} OS de manutenção
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Fleet Summary mini card */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" /> Resumo da Frota
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Movendo', count: fleetStats.moving, dot: 'bg-green-500' },
                  { label: 'Parados', count: fleetStats.stopped, dot: 'bg-amber-500' },
                  { label: 'Ociosos', count: fleetStats.idle, dot: 'bg-blue-500' },
                  { label: 'Offline', count: fleetStats.offline, dot: 'bg-slate-400' },
                ].map(({ label, count, dot }) => (
                  <div key={label} className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-muted/30">
                    <div className={`h-2 w-2 rounded-full ${dot}`} />
                    <span className="text-[11px] text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-semibold ml-auto">{count}</span>
                  </div>
                ))}
              </div>
              {fleetStats.total > 0 && (
                <div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Utilização</span>
                    <span>{fleetStats.total > 0 ? Math.round((fleetStats.online / fleetStats.total) * 100) : 0}%</span>
                  </div>
                  <Progress value={fleetStats.total > 0 ? (fleetStats.online / fleetStats.total) * 100 : 0} className="h-1.5" />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
