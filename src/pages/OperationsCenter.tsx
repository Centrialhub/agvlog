import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PackageCheck,
  AlertTriangle,
  Truck,
  Clock,
  ArrowRight,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function OperationsCenter() {
  const { currentTenant } = useTenant();
  const navigate = useNavigate();

  const { data: loads = [] } = useQuery({
    queryKey: ['ops_loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('*, vehicles(plate), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: openEvents = [] } = useQuery({
    queryKey: ['ops_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('operational_events')
        .select('*, loads(load_number), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

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

  const stats = useMemo(() => {
    const active = loads.filter((l: any) => !['delivered', 'divergent'].includes(l.status));
    const inTransit = loads.filter((l: any) => l.status === 'in_transit');
    const delayed = loads.filter((l: any) => {
      if (l.status === 'delivered') return false;
      const updated = new Date(l.updated_at);
      const hoursSince = (Date.now() - updated.getTime()) / 3600000;
      return hoursSince > 24;
    });
    return { active: active.length, inTransit: inTransit.length, delayed: delayed.length };
  }, [loads]);

  const statusColors: Record<string, string> = {
    planned: 'bg-muted text-muted-foreground',
    assembling: 'bg-blue-100 text-blue-700',
    ready: 'bg-emerald-100 text-emerald-700',
    loading: 'bg-amber-100 text-amber-700',
    loaded: 'bg-indigo-100 text-indigo-700',
    in_transit: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
    divergent: 'bg-red-100 text-red-700',
  };

  const statusLabels: Record<string, string> = {
    planned: 'Planejada',
    assembling: 'Montando',
    ready: 'Pronta',
    loading: 'Carregando',
    loaded: 'Carregada',
    in_transit: 'Em Trânsito',
    delivered: 'Entregue',
    divergent: 'Divergente',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Centro de Operações</h1>
        <p className="text-sm text-muted-foreground">Visão geral operacional em tempo real</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/loads')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <PackageCheck className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Cargas Ativas</span>
            </div>
            <p className="text-2xl font-bold">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Truck className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Em Trânsito</span>
            </div>
            <p className="text-2xl font-bold">{stats.inTransit}</p>
          </CardContent>
        </Card>
        <Card className={stats.delayed > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-destructive" />
              <span className="text-xs text-muted-foreground">Atrasadas</span>
            </div>
            <p className="text-2xl font-bold">{stats.delayed}</p>
          </CardContent>
        </Card>
        <Card className={openEvents.length > 0 ? 'border-warning/50' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-xs text-muted-foreground">Ocorrências</span>
            </div>
            <p className="text-2xl font-bold">{openEvents.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Active Loads */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Cargas Recentes</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate('/loads')}>
                Ver todas <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {loads.slice(0, 8).map((load: any) => (
              <div
                key={load.id}
                className="flex items-center justify-between py-1.5 border-b last:border-0 cursor-pointer hover:bg-muted/30 px-1 rounded transition-colors"
                onClick={() => navigate(`/loads/${load.id}`)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium">{load.load_number}</span>
                  <span className="text-[10px] text-muted-foreground truncate">
                    {load.origin || '—'} → {load.destination || '—'}
                  </span>
                </div>
                <Badge className={`text-[10px] ${statusColors[load.status] || ''}`} variant="secondary">
                  {statusLabels[load.status] || load.status}
                </Badge>
              </div>
            ))}
            {loads.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhuma carga encontrada.</p>
            )}
          </CardContent>
        </Card>

        {/* Open Issues */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Ocorrências Abertas</CardTitle>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => navigate('/events')}>
                  Ver todas <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {openEvents.slice(0, 5).map((evt: any) => (
                <div key={evt.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{evt.event_type}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{evt.description || '—'}</p>
                  </div>
                  <Badge
                    variant={evt.severity === 'high' ? 'destructive' : 'secondary'}
                    className="text-[10px] shrink-0"
                  >
                    {evt.severity}
                  </Badge>
                </div>
              ))}
              {openEvents.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhuma ocorrência aberta.</p>
              )}
            </CardContent>
          </Card>

          {/* Pending expense approvals */}
          {pendingExpenses > 0 && (
            <Card className="border-warning/50">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-warning" />
                  <div>
                    <p className="text-sm font-medium">{pendingExpenses} despesa(s) pendente(s)</p>
                    <p className="text-xs text-muted-foreground">Aguardando aprovação</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => navigate('/expense-approval')}>
                  Revisar
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
