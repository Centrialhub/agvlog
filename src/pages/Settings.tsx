import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
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
import { toast } from 'sonner';
import {
  Plug, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Clock, Plus, Trash2,
  Activity, Wifi, Link2, Unlink, Radio,
} from 'lucide-react';

export default function Settings() {
  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configurações</h1>
        <p className="text-sm text-muted-foreground">Gerencie integrações e parâmetros do sistema</p>
      </div>
      <Tabs defaultValue="integration">
        <TabsList>
          <TabsTrigger value="integration">Integração SSX</TabsTrigger>
          <TabsTrigger value="units">Rastreadores</TabsTrigger>
          <TabsTrigger value="telemetry">Catálogo Telemetria</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="integration" className="mt-4"><IntegrationSection /></TabsContent>
        <TabsContent value="units" className="mt-4"><UnitsSection /></TabsContent>
        <TabsContent value="telemetry" className="mt-4"><TelemetryCatalogSection /></TabsContent>
        <TabsContent value="logs" className="mt-4"><IntegrationLogsSection /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ===== Integration Section (existing, cleaned up) ===== */
function IntegrationSection() {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['integration_accounts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('integration_accounts').select('*')
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
    onError: (e: any) => toast.error(e.message),
  });

  const loginMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('ssx-login', { body: { integration_account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
      toast.success(data.cached ? 'Token ainda válido (cache)' : 'Login SSX realizado!');
    },
    onError: (e: any) => toast.error(`Falha no login SSX: ${e.message}`),
  });

  const syncTelemetryMutation = useMutation({
    mutationFn: async (accountId: string) => {
      const { data, error } = await supabase.functions.invoke('ssx-sync-telemetry', { body: { integration_account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ['telemetry_catalog'] }); toast.success(`Sincronizado: ${data.upserted} telemetrias`); },
    onError: (e: any) => toast.error(`Falha: ${e.message}`),
  });

  const pollMutation = useMutation({
    mutationFn: async (accountId: string) => {
      // Login first, then poll
      await supabase.functions.invoke('ssx-login', { body: { integration_account_id: accountId } });
      const { data, error } = await supabase.functions.invoke('ssx-poll-positions', { body: { integration_account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['fleet_positions'] });
      toast.success(`Polling concluído: ${data.inserted || 0} novas posições`);
    },
    onError: (e: any) => toast.error(`Falha no polling: ${e.message}`),
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
        <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova integração</Button>
      </div>

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
          {accounts.map((acc: any) => (
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
                  <Button size="sm" onClick={() => loginMutation.mutate(acc.id)} disabled={loginMutation.isPending}>
                    <RefreshCw className={`mr-2 h-3 w-3 ${loginMutation.isPending ? 'animate-spin' : ''}`} />Testar Login
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => syncTelemetryMutation.mutate(acc.id)} disabled={syncTelemetryMutation.isPending || acc.status !== 'ok'}>
                    <Activity className={`mr-2 h-3 w-3 ${syncTelemetryMutation.isPending ? 'animate-spin' : ''}`} />Sync Telemetria
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => pollMutation.mutate(acc.id)} disabled={pollMutation.isPending || acc.status !== 'ok'}>
                    <Radio className={`mr-2 h-3 w-3 ${pollMutation.isPending ? 'animate-spin' : ''}`} />Rodar Polling
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover integração?')) deleteMutation.mutate(acc.id); }}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <IntegrationDialog open={dialogOpen} onOpenChange={setDialogOpen} tenantId={currentTenant?.id} />
    </div>
  );
}

function IntegrationDialog({ open, onOpenChange, tenantId }: { open: boolean; onOpenChange: (v: boolean) => void; tenantId?: string }) {
  const queryClient = useQueryClient();
  const [baseUrl, setBaseUrl] = useState('https://integration.systemsatx.com.br');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [hashauth, setHashauth] = useState('');
  const [hashcode, setHashcode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('agvlog-integration-upsert', {
        body: {
          tenant_id: tenantId, base_url: baseUrl, username, password,
          hashauth: hashauth || null, hashcode: hashcode || null,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Integração criada! Faça o teste de login.');
      queryClient.invalidateQueries({ queryKey: ['integration_accounts'] });
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova Integração SSX</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2"><Label>URL Base</Label><Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Usuário</Label><Input value={username} onChange={e => setUsername(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Senha</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <div className="space-y-2"><Label>HashAuth</Label><Input value={hashauth} onChange={e => setHashauth(e.target.value)} placeholder="Opcional" /></div>
          <div className="space-y-2"><Label>Hashcode</Label><Input value={hashcode} onChange={e => setHashcode(e.target.value)} placeholder="Opcional" /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ===== Units & Tracker Links Section (NEW) ===== */
function UnitsSection() {
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
                    <TableCell><Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover?')) removeUnit.mutate(u.id); }}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
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
                    <TableCell><Button size="sm" variant="ghost" onClick={() => { if (confirm('Desvincular?')) removeLink.mutate(l.id); }}><Unlink className="h-3 w-3 text-destructive" /></Button></TableCell>
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
