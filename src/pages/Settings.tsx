import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { INTEGRATION_ACCOUNT_SAFE_SELECT } from '@/integrations/supabase/selects';
import type { Json, Tables } from '@/integrations/supabase/types';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { useVehicles } from '@/hooks/useVehicles';
import { useProviderUnits, useProviderUnitMutations, useTrackerLinks, useTrackerLinkMutations } from '@/hooks/useProviderUnits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import {
  Plug, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock, Plus, Trash2,
  Activity, Wifi, Link2, Unlink, Radio, Pencil,
} from 'lucide-react';
import { CompanySettings } from '@/components/settings/CompanySettings';
import { InsuranceSettings } from '@/components/settings/InsuranceSettings';
import EmittersSettings from '@/components/settings/EmittersSettings';
import { IntegrationUnavailable } from '@/components/integrations/IntegrationUnavailable';

type IntegrationAccount = Pick<
  Tables<'integration_accounts'>,
  | 'id'
  | 'tenant_id'
  | 'provider'
  | 'base_url'
  | 'username'
  | 'status'
  | 'settings'
  | 'last_login_at'
  | 'last_error'
  | 'created_at'
  | 'updated_at'
  | 'token_expires_at'
>;

interface SsxAccountSettings {
  sync_units_backoff_until?: string;
  last_units_sync_at?: string;
  credential_reentry_required?: boolean;
}

interface SsxMutationError extends Error {
  retryAt?: string;
  cooldownActive?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseObject(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function readSsxSettings(value: Json): SsxAccountSettings {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SsxAccountSettings
    : {};
}

export default function Settings() {
  const { isEnabled, error, refetch } = useTenantCapabilities();
  const ssxEnabled = isEnabled('ssx');
  const ssxUnavailable = (
    <IntegrationUnavailable
      capability="ssx"
      degraded={Boolean(error)}
      onRetry={error ? () => { void refetch(); } : undefined}
    />
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie integrações e parâmetros do sistema</p>
      </div>
      <Tabs defaultValue="company">
        <TabsList className="flex-wrap">
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="emitters">Emitentes Fiscais</TabsTrigger>
          <TabsTrigger value="integration">Integração SSX</TabsTrigger>
          <TabsTrigger value="units" disabled={!ssxEnabled}>Rastreadores</TabsTrigger>
          <TabsTrigger value="telemetry" disabled={!ssxEnabled}>Catálogo Telemetria</TabsTrigger>
          <TabsTrigger value="mapping" disabled={!ssxEnabled}>Mapeamento</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="maintenance">Manutenção</TabsTrigger>
        </TabsList>
        <TabsContent value="company" className="mt-4 space-y-4">
          <CompanySettings />
          <InsuranceSettings />
        </TabsContent>
        <TabsContent value="emitters" className="mt-4"><EmittersSettings /></TabsContent>
        <TabsContent value="integration" className="mt-4"><IntegrationSection ssxEnabled={ssxEnabled} /></TabsContent>
        <TabsContent value="units" className="mt-4">{ssxEnabled ? <UnitsSection /> : ssxUnavailable}</TabsContent>
        <TabsContent value="telemetry" className="mt-4">{ssxEnabled ? <TelemetryCatalogSection /> : ssxUnavailable}</TabsContent>
        <TabsContent value="mapping" className="mt-4">{ssxEnabled ? <TelemetryMappingSection /> : ssxUnavailable}</TabsContent>
        <TabsContent value="logs" className="mt-4"><IntegrationLogsSection /></TabsContent>
        <TabsContent value="maintenance" className="mt-4"><MaintenanceSection /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ===== Maintenance Section (admin only) ===== */
function MaintenanceSection() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [confirmText, setConfirmText] = useState('');
  const CONFIRM_PHRASE = 'REVERTER TODOS OS XMLS';

  const revertMutation = useMutation({
    mutationFn: async () => {
      if (!currentTenant) throw new Error('Sem tenant');
      const { data, error } = await supabase.rpc('revert_xml_loads_to_available', { _tenant_id: currentTenant.id });
      if (error) throw error;
      return data as Record<string, any>;
    },
    onSuccess: (result) => {
      toast.success(result?.message || 'XMLs revertidos com sucesso');
      setConfirmText('');
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['dispatch_trips'] });
      qc.invalidateQueries({ queryKey: ['route_planning_drafts'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Erro ao reverter XMLs'),
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Apenas administradores podem acessar a área de manutenção.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-base text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Ações destrutivas
        </CardTitle>
        <CardDescription>
          Estas operações afetam dados em produção e não podem ser desfeitas. Use somente em situações excepcionais.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 space-y-2">
          <p className="font-medium">Reverter todos os XMLs para "carga disponível"</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Remove TODAS as viagens (dispatch_trips) criadas a partir de XMLs.</li>
            <li>Apaga paradas, eventos e vínculos relacionados.</li>
            <li>Reseta status das cargas para "planned", removendo veículo e motorista vinculados.</li>
            <li>Reseta rascunhos despachados para draft.</li>
          </ul>
          <p className="text-[11px]">Esta ação é registrada em auditoria do tenant.</p>
        </div>
        <div>
          <Label className="text-xs">Para confirmar, digite: <code className="font-mono text-destructive">{CONFIRM_PHRASE}</code></Label>
          <Input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            className="mt-1 font-mono"
          />
        </div>
        <Button
          variant="destructive"
          disabled={confirmText !== CONFIRM_PHRASE || revertMutation.isPending}
          onClick={() => revertMutation.mutate()}
        >
          {revertMutation.isPending ? 'Revertendo...' : 'Reverter todos os XMLs'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ===== Integration Section (existing, cleaned up) ===== */
function IntegrationSection({ ssxEnabled }: { ssxEnabled: boolean }) {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<IntegrationAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['integration_accounts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('integration_accounts').select(INTEGRATION_ACCOUNT_SAFE_SELECT)
        .eq('tenant_id', currentTenant.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('integration_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['integration_accounts'] }); toast.success('Integração removida'); },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  });

  const loginMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('ssx-login', {
        body: { integration_account_id: accountId, force: true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
      toast.success(data.cached ? 'Token ainda válido (cache)' : 'Login SSX realizado!');
    },
    onError: (e: unknown) => {
      const message = errorMessage(e);
      toast.error(
        message.includes('informada novamente') || message.includes('CREDENTIAL_REENTRY')
          ? 'Regrave a senha SSX pelo botão “Atualizar credencial”.'
          : `Falha no login SSX: ${message}`,
      );
    },
  });

  const syncTelemetryMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('ssx-sync-telemetry', { body: { integration_account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['telemetry_catalog'] }); toast.success(`Sincronizado: ${data.upserted} telemetrias`); },
    onError: (e: unknown) => toast.error(`Falha: ${errorMessage(e)}`),
  });

  const syncUnitsMutation = useMutation({
    mutationFn: async ({ accountId, force }: { accountId: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('ssx-sync-units', { body: { integration_account_id: accountId, force: !!force } });
      // Parse error from any source (SDK puts body in error.message, error.context, or even data for some versions)
      const parsed = parseObject(error?.message) || parseObject(error?.context);
      if (error) {
        const info = parsed || parseObject(data) || {};
        if (info.cooldown_active || info.retry_at) {
          const err = new Error(String(info.error || 'Rate limit')) as SsxMutationError;
          err.retryAt = typeof info.retry_at === 'string' ? info.retry_at : undefined;
          err.cooldownActive = info.cooldown_active === true;
          throw err;
        }
        throw new Error(String(info.error || error.message || 'Erro desconhecido'));
      }
      if (data?.error) {
        const err = new Error(data.error) as SsxMutationError;
        err.retryAt = data.retry_at;
        err.cooldownActive = data.cooldown_active;
        throw err;
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['provider_units'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['tracker_links'] });
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
      if (data.skipped) {
        const nextAt = data.next_sync_available_at ? new Date(data.next_sync_available_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        toast.info(`Rastreadores já sincronizados recentemente.${nextAt ? ` Próximo sync disponível às ${nextAt}.` : ''} Use "Forçar Sync" para atualizar agora.`);
      } else {
        const method = data.method === 'administration' ? 'Administration' : 'Fallback';
        const endpoint = data.tracker_endpoint_used ? ` via ${data.tracker_endpoint_used.split('/').slice(-2).join('/')}` : '';
        toast.success(`Sincronizado (${method}${endpoint}): ${data.upserted} rastreadores, ${data.vehicles_created || 0} veículos, ${data.links_created || 0} vínculos`);
      }
    },
    onError: (e: SsxMutationError) => {
      if (e.retryAt || e.cooldownActive) {
        const retryTime = e.retryAt ? new Date(e.retryAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        toast.error(`Limite SSX excedido. Tente novamente${retryTime ? ` às ${retryTime}` : ' em alguns minutos'}.`, { duration: 8000 });
      } else {
        const detail = e.message?.includes('attempted_endpoints') ? ' Veja aba Logs para detalhes.' : '';
        toast.error(`Falha sync rastreadores: ${e.message}${detail}`);
      }
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
    },
  });

  const pollMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('agvlog-pipeline-run', {
        body: { tenant_id: currentTenant?.id, integration_account_id: accountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['positions_last'] });
      queryClient.invalidateQueries({ queryKey: ['alert_instances'] });
      if (data.status === 'attention_required') {
        toast.error('Pipeline pausado: regrave a senha SSX em “Atualizar credencial”.');
        return;
      }
      toast.success(`Pipeline concluído: ${data.total_inserted || 0} posições, ${data.processed_vehicles || 0} veículos processados`);
    },
    onError: (e: unknown) => toast.error(`Falha no pipeline: ${errorMessage(e)}`),
  });

  const statusBadge = (status: string) => {
    switch (status) {
      case 'ok': return <Badge className="bg-success text-success-foreground"><CheckCircle2 className="mr-1 h-3 w-3" />OK</Badge>;
      case 'degraded': return <Badge className="bg-warning text-warning-foreground"><AlertTriangle className="mr-1 h-3 w-3" />Degradado</Badge>;
      case 'invalid_credentials': return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Credenciais inválidas</Badge>;
      default: return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" />Pendente</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Contas de Integração SSX</h2>
          <p className="text-sm text-muted-foreground">Configure suas credenciais de rastreamento</p>
        </div>
        <Button onClick={() => { setEditingAccount(null); setDialogOpen(true); }}><Plus className="mr-2 h-4 w-4" />Nova integração</Button>
      </div>

      {!ssxEnabled && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">SSX desativado — preparação segura disponível</p>
              <p className="text-xs text-muted-foreground">
                Você pode cadastrar ou atualizar a credencial. Login, sincronizações e polling permanecem bloqueados até a capability ser habilitada.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
      ) : accounts.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center py-12">
          <Plug className="h-12 w-12 text-muted-foreground mb-4" />
          <p className="font-medium text-foreground">Nenhuma integração configurada</p>
          <p className="text-sm text-muted-foreground mt-1">Adicione suas credenciais SSX para começar</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {(accounts as IntegrationAccount[]).map((acc) => (
            <Card key={acc.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Wifi className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{acc.provider} — {acc.username}</CardTitle>
                      <CardDescription className="text-xs font-mono">{acc.base_url}</CardDescription>
                    </div>
                  </div>
                  {statusBadge(acc.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Último login:</span>{' '}<span className="text-foreground">{acc.last_login_at ? new Date(acc.last_login_at).toLocaleString('pt-BR') : 'Nunca'}</span></div>
                  <div><span className="text-muted-foreground">Token expira:</span>{' '}<span className="text-foreground">{acc.token_expires_at ? new Date(acc.token_expires_at).toLocaleString('pt-BR') : '—'}</span></div>
                  {acc.last_error && <div className="col-span-2"><span className="text-muted-foreground">Último erro:</span>{' '}<span className="text-destructive text-xs">{acc.last_error}</span></div>}
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button size="sm" onClick={() => loginMutation.mutate(acc.id)} disabled={!ssxEnabled || loginMutation.isPending}>
                    <RefreshCw className={`mr-2 h-3 w-3 ${loginMutation.isPending ? 'animate-spin' : ''}`} />Testar Login
                  </Button>
                  <Button
                    size="sm"
                    variant={acc.status === 'invalid_credentials' ? 'default' : 'outline'}
                    onClick={() => { setEditingAccount(acc); setDialogOpen(true); }}
                  >
                    <Pencil className="mr-2 h-3 w-3" />Atualizar credencial
                  </Button>
                   {(() => {
                      const s = readSsxSettings(acc.settings);
                      const backoffUntil = s?.sync_units_backoff_until;
                       const isCooldown = Boolean(backoffUntil && new Date(backoffUntil).getTime() > Date.now());
                       const retryTime = isCooldown && backoffUntil ? new Date(backoffUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
                      const lastSync = s?.last_units_sync_at;
                       const hasCachedSync = Boolean(lastSync && (Date.now() - new Date(lastSync).getTime()) < 3600000);
                      return (
                        <>
                          <Button size="sm" variant="outline" onClick={() => syncUnitsMutation.mutate({ accountId: acc.id })} disabled={!ssxEnabled || syncUnitsMutation.isPending || !['ok', 'degraded'].includes(acc.status) || isCooldown}>
                             <Radio className={`mr-2 h-3 w-3 ${syncUnitsMutation.isPending ? 'animate-spin' : ''}`} />
                             {isCooldown ? `Aguarde até ${retryTime}` : 'Sync Rastreadores'}
                           </Button>
                           {hasCachedSync && !isCooldown && (
                             <Button size="sm" variant="ghost" onClick={() => syncUnitsMutation.mutate({ accountId: acc.id, force: true })} disabled={!ssxEnabled || syncUnitsMutation.isPending || !['ok', 'degraded'].includes(acc.status)}>
                               <RefreshCw className={`mr-2 h-3 w-3 ${syncUnitsMutation.isPending ? 'animate-spin' : ''}`} />Forçar Sync
                             </Button>
                           )}
                        </>
                      );
                    })()}
                   <Button size="sm" variant="outline" onClick={() => syncTelemetryMutation.mutate(acc.id)} disabled={!ssxEnabled || syncTelemetryMutation.isPending || !['ok', 'degraded'].includes(acc.status)}>
                     <Activity className={`mr-2 h-3 w-3 ${syncTelemetryMutation.isPending ? 'animate-spin' : ''}`} />Sync Telemetria
                   </Button>
                   <Button size="sm" variant="outline" onClick={() => pollMutation.mutate(acc.id)} disabled={!ssxEnabled || pollMutation.isPending || !['ok', 'degraded'].includes(acc.status)}>
                    <Radio className={`mr-2 h-3 w-3 ${pollMutation.isPending ? 'animate-spin' : ''}`} />Rodar Polling
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Remover integração?', { title: 'Remover integração', confirmLabel: 'Remover' })) deleteMutation.mutate(acc.id); }}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <IntegrationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenantId={currentTenant?.id}
        account={editingAccount}
      />
    </div>
  );
}

function IntegrationDialog({ open, onOpenChange, tenantId, account }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string;
  account: IntegrationAccount | null;
}) {
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('https://integration.systemsatx.com.br');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hashauth, setHashauth] = useState('');
  const [hashcode, setHashcode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBaseUrl(account?.base_url || 'https://integration.systemsatx.com.br');
    setUsername(account?.username || '');
    setPassword('');
    setHashauth('');
    setHashcode('');
  }, [account, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('agvlog-integration-upsert', {
        body: {
          id: account?.id,
          tenant_id: tenantId, base_url: baseUrl, username, password,
          hashauth: hashauth || null, hashcode: hashcode || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(account ? 'Credencial atualizada. Faça o teste de login.' : 'Integração criada! Faça o teste de login.');
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(errorMessage(err));
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{account ? 'Atualizar credencial SSX' : 'Nova Integração SSX'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="ssx-base-url">URL Base</Label><Input id="ssx-base-url" name="base_url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="ssx-username">Usuário</Label><Input id="ssx-username" name="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="ssx-password">Senha</Label><Input id="ssx-password" name="password" autoComplete="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <div className="space-y-2">
            <Label htmlFor="ssx-hashauth">HashAuth</Label>
            <Input id="ssx-hashauth" name="hashauth" value={hashauth} onChange={e => setHashauth(e.target.value)} placeholder={account ? 'Deixe em branco para manter o atual' : 'Recomendado para polling'} />
            {!account && !hashauth && (
              <p className="text-xs text-warning">
                ⚠ Sem HashAuth, o polling de posições (PositionHistory) e violações de regras podem não funcionar. Configure se disponível.
              </p>
            )}
          </div>
          <div className="space-y-2"><Label htmlFor="ssx-hashcode">Hashcode</Label><Input id="ssx-hashcode" name="hashcode" value={hashcode} onChange={e => setHashcode(e.target.value)} placeholder={account ? 'Deixe em branco para manter o atual' : 'Opcional'} /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : account ? 'Atualizar' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ===== Units & Tracker Links Section (NEW) ===== */
function UnitsSection() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('integration_accounts').select('id, username, provider')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });
  const { data: units = [], isLoading: unitsLoading } = useProviderUnits();
  const { data: links = [], isLoading: linksLoading } = useTrackerLinks();
  const { data: vehicles = [] } = useVehicles();
  const { create: createUnit, remove: removeUnit } = useProviderUnitMutations();
  const { create: createLink, remove: removeLink } = useTrackerLinkMutations();

  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [linkVehicleId, setLinkVehicleId] = useState('');
  const [linkUnitId, setLinkUnitId] = useState('');

  const handleAddUnit = () => {
    if (!currentTenant || !newAccountId || !newCode) return;
    createUnit.mutate({ tenant_id: currentTenant.id, integration_account_id: newAccountId, external_code: newCode, label: newLabel || undefined }, {
      onSuccess: () => { toast.success('Rastreador adicionado'); setNewCode(''); setNewLabel(''); },
      onError: (e: any) => toast.error(e.message),
    });
  };

  const handleAddLink = () => {
    if (!currentTenant || !linkVehicleId || !linkUnitId) return;
    createLink.mutate({ tenant_id: currentTenant.id, vehicle_id: linkVehicleId, provider_unit_id: linkUnitId }, {
      onSuccess: () => { toast.success('Vinculação criada'); setLinkVehicleId(''); setLinkUnitId(''); },
      onError: (e: any) => toast.error(e.message),
    });
  };

  // Unlinked units (not in any active link)
  const linkedUnitIds = new Set((links as any[]).map((l: any) => l.provider_unit_id));
  const unlinkedUnits = (units as any[]).filter((u: any) => !linkedUnitIds.has(u.id));

  return (
    <div className="space-y-6">
      {/* Add unit */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadastrar Rastreador (Provider Unit)</CardTitle>
          <CardDescription>Informe o código do rastreador na SSX (ex: placa ou código de unidade)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Conta SSX</Label>
              <Select value={newAccountId} onValueChange={setNewAccountId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.provider} — {a.username}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Código externo</Label>
              <Input value={newCode} onChange={e => setNewCode(e.target.value)} placeholder="LLU-0000" className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Apelido</Label>
              <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Opcional" className="w-40" />
            </div>
            <Button onClick={handleAddUnit} disabled={createUnit.isPending || !newCode || !newAccountId} size="sm">
              <Plus className="h-4 w-4 mr-1" />Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Units list */}
      <Card>
        <CardHeader><CardTitle className="text-base">Rastreadores cadastrados ({(units as any[]).length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Apelido</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unitsLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : (units as any[]).length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum rastreador cadastrado</TableCell></TableRow>
              ) : (
                (units as any[]).map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono text-xs">{u.external_code}</TableCell>
                    <TableCell>{u.label || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{u.integration_account_id?.slice(0, 8)}...</TableCell>
                    <TableCell>{linkedUnitIds.has(u.id) ? <Badge className="bg-success text-success-foreground text-xs"><Link2 className="mr-1 h-3 w-3" />Vinculado</Badge> : <Badge variant="secondary" className="text-xs"><Unlink className="mr-1 h-3 w-3" />Livre</Badge>}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Remover esta unidade?', { title: 'Remover unidade', confirmLabel: 'Remover' })) removeUnit.mutate(u.id); }}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Link unit to vehicle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vincular Rastreador a Veículo</CardTitle>
          <CardDescription>Associe um rastreador livre a um veículo cadastrado</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Veículo</Label>
              <Select value={linkVehicleId} onValueChange={setLinkVehicleId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map((v: any) => <SelectItem key={v.id} value={v.id}>{v.plate}{v.nickname ? ` (${v.nickname})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rastreador</Label>
              <Select value={linkUnitId} onValueChange={setLinkUnitId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {unlinkedUnits.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.external_code}{u.label ? ` (${u.label})` : ''}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddLink} disabled={createLink.isPending || !linkVehicleId || !linkUnitId} size="sm">
              <Link2 className="h-4 w-4 mr-1" />Vincular
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active links */}
      <Card>
        <CardHeader><CardTitle className="text-base">Vinculações ativas ({(links as any[]).length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Veículo</TableHead>
                <TableHead>Rastreador</TableHead>
                <TableHead>Desde</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linksLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : (links as any[]).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma vinculação ativa</TableCell></TableRow>
              ) : (
                (links as any[]).map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.vehicles?.plate || '—'}{l.vehicles?.nickname ? ` (${l.vehicles.nickname})` : ''}</TableCell>
                    <TableCell className="font-mono text-xs">{l.provider_units?.external_code || '—'}{l.provider_units?.label ? ` (${l.provider_units.label})` : ''}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(l.start_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Desvincular veículo e unidade?', { title: 'Desvincular unidade', confirmLabel: 'Desvincular' })) removeLink.mutate(l.id); }}><Unlink className="h-3 w-3 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ===== Telemetry Catalog (existing) ===== */
function TelemetryCatalogSection() {
  const { data: catalog = [], isLoading } = useQuery({
    queryKey: ['telemetry_catalog'],
    queryFn: async () => {
      const { data, error } = await supabase.from('telemetry_catalog').select('*').order('telemetry_id');
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Catálogo de Telemetrias</h2>
        <p className="text-sm text-muted-foreground">Sinais disponíveis na plataforma SSX ({catalog.length} registros)</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Nome</TableHead><TableHead>Descrição</TableHead><TableHead>Unidade</TableHead><TableHead>Tipo</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : catalog.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhuma telemetria sincronizada.</TableCell></TableRow>
              ) : catalog.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.telemetry_id}</TableCell>
                  <TableCell className="font-medium">{t.name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{t.description || '—'}</TableCell>
                  <TableCell>{t.unit || '—'}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-xs">{t.data_type || 'unknown'}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ===== Telemetry Mapping Section (NEW) ===== */
const CANONICAL_OPTIONS = [
  'ignition', 'odometer_km', 'fuel_level_percent', 'fuel_liters',
  'temperature_c', 'door_open', 'panic', 'engine_hours',
];

function autoSuggestCanonical(name: string | null, description: string | null): string | null {
  const text = `${name || ''} ${description || ''}`.toLowerCase();
  if (text.includes('combust') || text.includes('fuel') || text.includes('nível')) return 'fuel_level_percent';
  if (text.includes('igni') || text.includes('acc') || text.includes('ignição')) return 'ignition';
  if (text.includes('hod') || text.includes('odom') || text.includes('km') || text.includes('quilômetro')) return 'odometer_km';
  if (text.includes('temp') || text.includes('°c')) return 'temperature_c';
  if (text.includes('porta') || text.includes('door')) return 'door_open';
  if (text.includes('pânico') || text.includes('panic') || text.includes('sos')) return 'panic';
  if (text.includes('horímetro') || text.includes('engine hour')) return 'engine_hours';
  return null;
}

function TelemetryMappingSection() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();

  const { data: catalog = [] } = useQuery({
    queryKey: ['telemetry_catalog'],
    queryFn: async () => {
      const { data, error } = await supabase.from('telemetry_catalog').select('*').order('telemetry_id');
      if (error) throw error;
      return data;
    },
  });

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ['telemetry_mapping', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('telemetry_mapping').select('*')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const mappingByTelId = new Map<string, any>();
  for (const m of mappings as any[]) {
    mappingByTelId.set(m.telemetry_id, m);
  }

  const upsertMapping = useMutation({
    mutationFn: async ({ telemetryId, canonicalKey }: { telemetryId: string; canonicalKey: string }) => {
      if (!currentTenant) throw new Error('No tenant');
      const existing = mappingByTelId.get(telemetryId);
      if (existing) {
        if (!canonicalKey) {
          const { error } = await supabase.from('telemetry_mapping').delete().eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('telemetry_mapping').update({ canonical_key: canonicalKey }).eq('id', existing.id);
          if (error) throw error;
        }
      } else if (canonicalKey) {
        const { error } = await supabase.from('telemetry_mapping').insert({
          tenant_id: currentTenant.id, telemetry_id: telemetryId, canonical_key: canonicalKey,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['telemetry_mapping'] }),
    onError: (e: any) => toast.error(e.message),
  });

  const handleAutoSuggest = () => {
    let count = 0;
    for (const item of catalog as any[]) {
      if (mappingByTelId.has(item.telemetry_id)) continue;
      const suggestion = autoSuggestCanonical(item.name, item.description);
      if (suggestion) {
        upsertMapping.mutate({ telemetryId: item.telemetry_id, canonicalKey: suggestion });
        count++;
      }
    }
    toast.success(`Auto-sugestão aplicada a ${count} telemetrias`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Mapeamento de Telemetria</h2>
          <p className="text-sm text-muted-foreground">Vincule sinais do rastreador a chaves canônicas do sistema</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleAutoSuggest}>
          <RefreshCw className="mr-2 h-3 w-3" />Auto-sugerir
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telemetry ID</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Chave Canônica</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : catalog.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Sincronize telemetria primeiro</TableCell></TableRow>
              ) : (catalog as any[]).map((item: any) => {
                const current = mappingByTelId.get(item.telemetry_id)?.canonical_key || '';
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.telemetry_id}</TableCell>
                    <TableCell className="text-sm">{item.name || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{item.description || '—'}</TableCell>
                    <TableCell>
                      <Select
                        value={current || '__unmapped__'}
                        onValueChange={(v) => upsertMapping.mutate({ telemetryId: item.telemetry_id, canonicalKey: v === '__unmapped__' ? '' : v })}
                      >
                        <SelectTrigger className="w-48 h-8 text-xs">
                          <SelectValue placeholder="Não mapeado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unmapped__">Não mapeado</SelectItem>
                          {CANONICAL_OPTIONS.map(opt => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ===== Integration Logs (existing) ===== */
function IntegrationLogsSection() {
  const { currentTenant } = useTenant();
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['integration_logs', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('integration_logs').select('*')
        .eq('tenant_id', currentTenant.id).order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Logs de Integração</h2>
        <p className="text-sm text-muted-foreground">Últimas 50 operações</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Ação</TableHead><TableHead>Status</TableHead><TableHead>Duração</TableHead><TableHead>Detalhes</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Nenhum log registrado</TableCell></TableRow>
              ) : logs.map((l: any) => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{new Date(l.created_at).toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="font-mono text-xs">{l.action}</TableCell>
                  <TableCell>{l.success ? <Badge className="bg-success text-success-foreground text-xs">{l.status_code || 'OK'}</Badge> : <Badge variant="destructive" className="text-xs">{l.status_code || 'Erro'}</Badge>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.duration_ms ? `${l.duration_ms}ms` : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{l.error_message || (l.metadata ? JSON.stringify(l.metadata) : '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
