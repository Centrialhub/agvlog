import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Truck,
  HelpCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Link2,
  ClipboardList,
  MapPin,
} from 'lucide-react';

interface Check {
  label: string;
  ok: boolean;
  hint?: string;
}

interface Props {
  driverLinked: boolean;
  driverActive: boolean;
  hasAssignedLoads: boolean;
  hasActiveTrip: boolean;
  driverName?: string | null;
  driverId?: string | null;
}

export default function NoLoadsHelp({
  driverLinked,
  driverActive,
  hasAssignedLoads,
  hasActiveTrip,
  driverName,
  driverId,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  // Probe: count loads with driver_id = me, ignoring status/on_hold/tenant.
  // Exposes hidden mismatches (on_hold, terminal status, other tenant) to support.
  const { data: probe } = useQuery({
    queryKey: ['driver_loads_probe', driverId, currentTenant?.id],
    queryFn: async () => {
      if (!driverId) return { total: 0, hidden: 0 };
      let query = supabase
        .from('loads')
        .select('id, status, on_hold, tenant_id')
        .eq('driver_id', driverId);
      if (currentTenant?.id) query = query.eq('tenant_id', currentTenant.id);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const terminal = new Set(['delivered', 'completed', 'cancelled', 'archived']);
      const hidden = rows.filter((r: any) => r.on_hold || terminal.has(r.status)).length;
      return { total: rows.length, hidden };
    },
    enabled: !!driverId,
  });

  const checks: Check[] = [
    {
      label: 'Sua conta está vinculada a um cadastro de motorista',
      ok: driverLinked,
      hint: 'Peça ao administrador para abrir /drivers, editar seu cadastro e vincular seu e-mail no campo "Vínculo de usuário".',
    },
    {
      label: 'Seu cadastro de motorista está ativo',
      ok: driverActive,
      hint: 'Um administrador precisa marcar seu cadastro como ativo em /drivers.',
    },
    {
      label: 'Existe uma carga atribuída a você',
      ok: hasAssignedLoads,
      hint: 'A operação precisa criar uma carga e selecionar seu nome no campo "Motorista" (ou atribuir o veículo que está vinculado a você).',
    },
    {
      label: 'A carga já virou uma viagem com paradas',
      ok: hasActiveTrip,
      hint: 'Se a carga aparece em "Cargas atribuídas" mas não há paradas, aguarde a operação transformar a carga em viagem (menu Despacho).',
    },
  ];

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div className="text-center">
          <Truck className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-medium">Nenhuma carga atribuída no momento</p>
          <p className="text-xs text-muted-foreground mt-1">
            {driverName ? `Olá, ${driverName}.` : ''} As cargas aparecem automaticamente assim que a
            operação atribuir você.
          </p>
        </div>

        {probe && probe.total > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
            <p className="font-medium text-warning-foreground">
              Existe(m) {probe.total} carga(s) vinculada(s) a você no sistema
              {probe.hidden > 0 ? ` — ${probe.hidden} em estado oculto (espera/finalizada)` : ''}.
            </p>
            <p className="text-muted-foreground mt-1">
              Se não aparecem aqui, peça à operação para conferir <b>on hold</b>, <b>status</b> e o
              <b> tenant</b> da carga.
            </p>
          </div>
        )}

        {(driverId || user?.email) && (
          <div className="rounded-md bg-muted/40 p-2 text-[10px] font-mono break-all">
            {user?.email && <div>email: {user.email}</div>}
            {driverId && <div>driver_id: {driverId}</div>}
          </div>
        )}

        <div className="space-y-1.5">
          {checks.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {c.ok ? (
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className={c.ok ? 'text-muted-foreground' : 'font-medium'}>{c.label}</p>
                {!c.ok && c.hint && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{c.hint}</p>
                )}
              </div>
              <Badge variant={c.ok ? 'outline' : 'secondary'} className="text-[9px]">
                {c.ok ? 'OK' : 'Verificar'}
              </Badge>
            </div>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setExpanded((v) => !v)}
        >
          <HelpCircle className="h-3.5 w-3.5 mr-1.5" />
          Como funciona a atribuição de cargas?
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 ml-1" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 ml-1" />
          )}
        </Button>

        {expanded && (
          <div className="space-y-3 text-xs text-muted-foreground border-t pt-3">
            <div className="flex gap-2">
              <UserCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">1. Vínculo da conta</p>
                <p>
                  Seu e-mail de login precisa estar vinculado a um cadastro em /drivers pelo
                  administrador.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Link2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">2. Atribuição da carga</p>
                <p>
                  A operação seleciona você na tela de <strong>Centro de Operações</strong> ou <strong>Painel de Controle</strong>.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <ClipboardList className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">3. Carga aparece aqui</p>
                <p>
                  A carga surge em "Cargas atribuídas". Se ainda não houver viagem formal, você verá
                  o aviso pedindo para aguardar.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <MapPin className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">4. Viagem e paradas</p>
                <p>
                  Quando a operação transformar a carga em viagem, o botão "Ver Paradas" fica
                  disponível.
                </p>
              </div>
            </div>
            <p className="text-[11px] italic pt-1">
              Ainda com dúvida? Fale com o responsável da operação e mostre esta tela.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}