import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Package, Truck, Clock, CheckCircle, MapPin } from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planejada',
  assembling: 'Em montagem',
  ready: 'Pronta',
  loading: 'Carregando',
  loaded: 'Carregada',
  in_transit: 'Em Trânsito',
  delivered: 'Entregue',
  divergent: 'Divergente',
  received: 'Recebido',
  shipped: 'Enviado',
};

const STATUS_ICONS: Record<string, typeof Package> = {
  in_transit: Truck,
  delivered: CheckCircle,
  planned: Clock,
};

export default function ClientPortal() {
  const { currentTenant } = useTenant();
  const { signOut } = useAuth();

  const { data: orders = [] } = useQuery({
    queryKey: ['portal_orders', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('orders')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: loads = [] } = useQuery({
    queryKey: ['portal_loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('id, load_number, status, origin, destination, updated_at')
        .eq('tenant_id', currentTenant.id)
        .order('updated_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Truck className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm">AGVLog</span>
            <Badge variant="secondary" className="text-[10px]">Portal do Cliente</Badge>
          </div>
          <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground">Sair</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h1 className="text-lg font-bold">Acompanhamento</h1>
          <p className="text-sm text-muted-foreground">Veja o status dos seus pedidos e cargas</p>
        </div>

        {/* Active loads */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Cargas Recentes</h2>
          {loads.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma carga encontrada.</p>
              </CardContent>
            </Card>
          ) : (
            loads.map((load: any) => {
              const Icon = STATUS_ICONS[load.status] || Package;
              return (
                <Card key={load.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Carga {load.load_number}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {STATUS_LABELS[load.status] || load.status}
                      </Badge>
                    </div>
                    {(load.origin || load.destination) && (
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {load.origin || '—'} → {load.destination || '—'}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Atualizado: {new Date(load.updated_at).toLocaleString('pt-BR')}
                    </p>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        {/* Orders */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Pedidos</h2>
          {orders.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-center">
                <p className="text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
              </CardContent>
            </Card>
          ) : (
            orders.map((order: any) => (
              <Card key={order.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Pedido {order.order_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {order.destination || '—'} · {order.promised_date ? new Date(order.promised_date).toLocaleDateString('pt-BR') : 'S/D'}
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {STATUS_LABELS[order.status] || order.status}
                  </Badge>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
