import { useEffect, useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { useClientPortalAccess, type PortalAccess } from '@/hooks/portal/useClientPortalAccess';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Building2, LogOut } from 'lucide-react';

const PERM_LABELS: Array<[keyof PortalAccess, string]> = [
  ['can_view_financial', 'Ver valores financeiros'],
  ['can_download_documents', 'Baixar documentos e canhotos'],
  ['can_open_occurrences', 'Abrir ocorrências'],
  ['can_request_pickup', 'Solicitar coleta'],
  ['can_view_vehicle_live', 'Ver veículo em tempo real'],
  ['can_view_driver_contact', 'Ver contato do motorista'],
];

const PREF_KEY = 'agvlog:portal:prefs:v1';

interface Prefs {
  compactCards: boolean;
  emailNotifications: boolean;
}

const DEFAULT_PREFS: Prefs = { compactCards: false, emailNotifications: true };

export default function PortalSettings() {
  const { data: access = [], isLoading, error, refetch } = useClientPortalAccess();
  const { user, signOut } = useAuth();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREF_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
    } catch {
      // Mantém as preferências padrão quando o storage local está inválido.
    }
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {
      // A preferência permanece ativa nesta sessão mesmo sem persistência local.
    }
  };

  return (
    <PortalSection
      title="Configurações"
      description="Informações da sua conta, clientes vinculados e preferências locais."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Sua conta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">E-mail</span><span>{user?.email || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">ID</span><span className="font-mono text-xs">{user?.id?.slice(0, 8) || '—'}…</span></div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Preferências</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="compact" className="text-sm">Cards compactos</Label>
              <Switch id="compact" checked={prefs.compactCards} onCheckedChange={(v) => update({ compactCards: v })} />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="email" className="text-sm">Notificações por e-mail</Label>
              <Switch id="email" checked={prefs.emailNotifications} onCheckedChange={(v) => update({ emailNotifications: v })} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Preferências ficam salvas apenas neste navegador.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Clientes vinculados & permissões</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 p-6 text-center text-sm text-destructive">
              <span>Erro ao carregar os vínculos: {(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
            </div>
          ) : access.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum cliente vinculado à sua conta.</p>
          ) : (
            access.map((a) => (
              <div key={a.client_id} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{a.client_name || a.client_id}</span>
                  {a.client_tax_id && <span className="text-xs text-muted-foreground">{a.client_tax_id}</span>}
                  <Badge variant="outline" className="ml-auto text-[10px]">{a.access_type}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PERM_LABELS.map(([k, label]) => (
                    <Badge
                      key={k as string}
                      variant={a[k] ? 'default' : 'outline'}
                      className="text-[10px] font-normal"
                    >
                      {a[k] ? '✓' : '✕'} {label}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
          <p className="text-[11px] text-muted-foreground">
            As permissões são definidas pela transportadora. Fale com o suporte para solicitar mudanças.
          </p>
        </CardContent>
      </Card>
    </PortalSection>
  );
}
