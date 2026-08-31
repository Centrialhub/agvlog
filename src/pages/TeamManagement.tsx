import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { Users, UserPlus, ShieldCheck, Truck, Building2, UserCog, Ban, CheckCircle2, AlertTriangle, Pencil, Link2 } from 'lucide-react';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch } from '@/lib/listFilters';
import { Checkbox } from '@/components/ui/checkbox';
import type { Enums, Tables, TablesInsert } from '@/integrations/supabase/types';

type AppRole = Enums<'app_role'>;
type TeamRole = Extract<AppRole, 'admin' | 'operator' | 'driver'>;
type DriverOption = Pick<Tables<'drivers'>, 'id' | 'name' | 'phone' | 'doc'>;
type ClientOption = Pick<Tables<'clients'>, 'id' | 'company_name'>;

interface EdgeUserSummary {
  id: string;
  email: string | null;
  full_name: string | null;
}

interface EdgeUsersResponse {
  users?: EdgeUserSummary[];
  error?: string;
}

interface CreateMemberResponse {
  success?: boolean;
  invited?: boolean;
  user_id?: string;
  email?: string | null;
  error?: string;
}

interface UpdateMemberResponse {
  success?: boolean;
  error?: string;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isTeamRole = (role: string): role is TeamRole =>
  role === 'admin' || role === 'operator' || role === 'driver';

const roleLabels: Record<string, string> = {
  owner: 'Proprietário',
  admin: 'Administrador',
  operator: 'Operador',
  client: 'Cliente',
  driver: 'Motorista',
};

const roleBadgeVariant: Record<string, string> = {
  owner: 'bg-primary text-primary-foreground',
  admin: 'bg-accent text-accent-foreground',
  operator: 'bg-secondary text-secondary-foreground',
  client: 'bg-muted text-muted-foreground',
  driver: 'bg-muted text-muted-foreground',
};

const roleIcons: Record<string, React.ReactNode> = {
  owner: <ShieldCheck className="h-3.5 w-3.5" />,
  admin: <ShieldCheck className="h-3.5 w-3.5" />,
  operator: <UserCog className="h-3.5 w-3.5" />,
  client: <Building2 className="h-3.5 w-3.5" />,
  driver: <Truck className="h-3.5 w-3.5" />,
};

interface MemberRow {
  id: string;
  user_id: string;
  role: AppRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  profile_name: string | null;
  profile_email: string | null;
}

export default function TeamManagement() {
  const toast = useSonnerToast();
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<MemberRow | null>(null);
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', role: 'all', status: 'all' });

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['tenant_members', currentTenant?.id],
    queryFn: async (): Promise<MemberRow[]> => {
      if (!currentTenant) return [];
      // Get memberships
      const { data: memberships, error } = await supabase
        .from('tenant_memberships')
        .select('id, user_id, role, active, created_at, updated_at')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Get profiles for names
      const userIds = (memberships || []).map(m => m.user_id);
      let profiles: Pick<Tables<'profiles'>, 'id' | 'full_name'>[] = [];
      if (userIds.length > 0) {
        const { data: p, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        if (profilesError) throw profilesError;
        profiles = p || [];
      }
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      // Get emails and metadata names via edge function (Admin API)
      const emailMap = new Map<string, { email: string | null; full_name: string | null }>();
      try {
        const { data: fnData, error: fnError } = await supabase.functions.invoke<EdgeUsersResponse>('list-tenant-members', {
          body: { tenant_id: currentTenant.id },
        });
        if (fnError) throw fnError;
        if (fnData?.error) throw new Error(fnData.error);
        const list = fnData?.users || [];
        for (const u of list) emailMap.set(u.id, { email: u.email, full_name: u.full_name });
      } catch {
        // ignore — falls back to profile name only
      }

      return (memberships || []).map(m => ({
        ...m,
        profile_name:
          profileMap.get(m.user_id)?.full_name ||
          emailMap.get(m.user_id)?.full_name ||
          null,
        profile_email: emailMap.get(m.user_id)?.email || null,
      }));
    },
    enabled: !!currentTenant,
  });

  // Drivers linked to users
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_team', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('drivers').select('id, name, phone, doc').eq('tenant_id', currentTenant.id).eq('active', true);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: TeamRole }) => {
      if (!currentTenant) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase
        .from('tenant_memberships')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      toast.success('Papel atualizado');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar papel')),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (!currentTenant) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase
        .from('tenant_memberships')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      toast.success('Status atualizado');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar status')),
  });

  const filtered = members.filter(row => matchesSearch(filters.search, row.profile_name, row.profile_email) && (filters.role === 'all' || row.role === filters.role) && (filters.status === 'all' || row.active === (filters.status === 'active')));

  const stats = {
    total: members.length,
    active: members.filter(m => m.active).length,
    admins: members.filter(m => m.role === 'admin' || m.role === 'owner').length,
    operators: members.filter(m => m.role === 'operator').length,
    drivers: members.filter(m => m.role === 'driver').length,
    clients: members.filter(m => m.role === 'client').length,
  };

  if (!isAdmin) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-3 text-warning">
          <AlertTriangle className="h-5 w-5" />
          <p className="text-sm">Você não tem permissão para acessar esta página. Apenas administradores podem gerenciar a equipe.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Equipe & Acessos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie membros, convide novos usuários e controle os níveis de acesso
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />Convidar membro
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={stats.total} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Ativos" value={stats.active} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
        <StatCard label="Admins" value={stats.admins} icon={<ShieldCheck className="h-4 w-4" />} />
        <StatCard label="Operadores" value={stats.operators} icon={<UserCog className="h-4 w-4" />} />
        <StatCard label="Motoristas" value={stats.drivers} icon={<Truck className="h-4 w-4" />} />
        <StatCard label="Clientes" value={stats.clients} icon={<Building2 className="h-4 w-4" />} />
      </div>

      {/* Info cards explaining roles */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Níveis de Acesso</CardTitle>
          <CardDescription>Cada papel tem permissões diferentes no sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <RoleInfo role="owner" desc="Acesso total. Pode gerenciar a empresa, integrações e todos os membros." />
            <RoleInfo role="admin" desc="Acesso administrativo completo, igual ao proprietário." />
            <RoleInfo role="operator" desc="Acesso operacional: cargas, viagens, veículos e motoristas. Sem configurações." />
            <RoleInfo role="driver" desc="Acesso ao app do motorista: entregas, checklist, jornada e despesas." />
            <RoleInfo role="client" desc="Acesso ao portal do cliente: acompanhar pedidos e cargas próprias." />
          </div>
        </CardContent>
      </Card>

      {/* Members table */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Membros ({members.length})</TabsTrigger>
          <TabsTrigger value="portal_access">Acessos do Portal</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4 space-y-4">
          <ListFilterBar fields={[
            { key: 'search', label: 'Buscar membro', type: 'search', value: filters.search, onChange: value => setFilter('search', value), placeholder: 'Nome ou e-mail' },
            { key: 'role', label: 'Papel de acesso', value: filters.role, onChange: value => setFilter('role', value), options: [{ value: 'all', label: 'Todos os papéis' }, ...Object.entries(roleLabels).map(([value, label]) => ({ value, label }))] },
            { key: 'status', label: 'Situação', value: filters.status, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas' }, { value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }] },
          ]} onReset={resetFilters} activeCount={activeCount} resultCount={filtered.length} totalCount={members.length} loading={isLoading} description="Os indicadores acima representam toda a equipe." />

          {isLoading ? (
            <Card><CardContent className="py-8 text-center text-muted-foreground">Carregando...</CardContent></Card>
          ) : (
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        Nenhum membro encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map(m => (
                      <TableRow key={m.id} className={!m.active ? 'opacity-50' : ''}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-foreground">
                              {m.profile_name || m.profile_email || 'Usuário sem nome'}
                            </p>
                            {m.profile_email ? (
                              <p className="text-xs text-muted-foreground">{m.profile_email}</p>
                            ) : (
                              <p className="text-xs text-muted-foreground font-mono">{m.user_id.slice(0, 8)}...</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {m.role === 'owner' ? (
                            <Badge className={roleBadgeVariant[m.role]}>
                              {roleIcons[m.role]}
                              <span className="ml-1">{roleLabels[m.role]}</span>
                            </Badge>
                          ) : (
                            <Select
                              value={m.role}
                              onValueChange={(role) => {
                                if (isTeamRole(role)) updateRoleMutation.mutate({ id: m.id, role });
                              }}
                              disabled={updateRoleMutation.isPending}
                            >
                              <SelectTrigger className="w-36 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Administrador</SelectItem>
                                <SelectItem value="operator">Operador</SelectItem>
                                <SelectItem value="driver">Motorista</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.active ? 'default' : 'secondary'}>
                            {m.active ? 'Ativo' : 'Inativo'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(m.created_at).toLocaleDateString('pt-BR')}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {m.role !== 'owner' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditMember(m)}
                              >
                                <Pencil className="mr-1 h-3 w-3" />Editar
                              </Button>
                              <Button
                                size="sm"
                                variant={m.active ? 'ghost' : 'outline'}
                                onClick={() => toggleActiveMutation.mutate({ id: m.id, active: !m.active })}
                                disabled={toggleActiveMutation.isPending}
                              >
                                {m.active ? (
                                  <><Ban className="mr-1 h-3 w-3 text-destructive" />Desativar</>
                                ) : (
                                  <><CheckCircle2 className="mr-1 h-3 w-3 text-success" />Reativar</>
                                )}
                              </Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="portal_access" className="mt-4">
          <PortalAccessTab tenantId={currentTenant?.id} />
        </TabsContent>
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={currentTenant?.id}
        drivers={drivers}
      />

      <EditMemberDialog
        member={editMember}
        onOpenChange={(open) => { if (!open) setEditMember(null); }}
        tenantId={currentTenant?.id}
      />
    </div>
  );
}

// =====================================================================
// Acessos do Portal — CRUD de client_portal_access
// =====================================================================
const ACCESS_TYPES = [
  { value: 'full', label: 'Completo' },
  { value: 'remitter', label: 'Remetente' },
  { value: 'recipient', label: 'Destinatário' },
  { value: 'payer', label: 'Pagador' },
  { value: 'financial', label: 'Financeiro' },
  { value: 'documents_only', label: 'Apenas documentos' },
  { value: 'viewer', label: 'Somente leitura' },
];

type PortalAccessRow = Pick<
  Tables<'client_portal_access'>,
  | 'id'
  | 'user_id'
  | 'client_id'
  | 'access_type'
  | 'active'
  | 'can_view_financial'
  | 'can_download_documents'
  | 'can_open_occurrences'
  | 'can_request_pickup'
  | 'can_view_vehicle_live'
  | 'can_view_driver_contact'
>;

type PortalPermissionKey =
  | 'can_view_financial'
  | 'can_download_documents'
  | 'can_open_occurrences'
  | 'can_request_pickup'
  | 'can_view_vehicle_live'
  | 'can_view_driver_contact';

const PERM_FIELDS: ReadonlyArray<readonly [PortalPermissionKey, string]> = [
  ['can_view_financial', 'Ver valores'],
  ['can_download_documents', 'Baixar documentos/canhotos'],
  ['can_open_occurrences', 'Abrir ocorrências'],
  ['can_request_pickup', 'Solicitar coleta'],
  ['can_view_vehicle_live', 'Ver veículo ao vivo'],
  ['can_view_driver_contact', 'Ver contato do motorista'],
];

function PortalAccessTab({ tenantId }: { tenantId?: string }) {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PortalAccessRow | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['client_portal_access_admin', tenantId],
    queryFn: async () => {
      if (!tenantId) return [] as PortalAccessRow[];
      const { data, error } = await supabase
        .from('client_portal_access')
        .select('id, user_id, client_id, access_type, active, can_view_financial, can_download_documents, can_open_occurrences, can_request_pickup, can_view_vehicle_live, can_view_driver_contact')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PortalAccessRow[];
    },
    enabled: !!tenantId,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_for_portal_access', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase.from('clients').select('id, company_name').eq('tenant_id', tenantId).eq('active', true).order('company_name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('client_portal_access').update({ active }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client_portal_access_admin'] }); toast.success('Acesso atualizado'); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar acesso')),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('client_portal_access').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['client_portal_access_admin'] }); toast.success('Acesso removido'); },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao remover acesso')),
  });

  const clientMap = new Map(clients.map(c => [c.id, c.company_name]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Conceda acesso a clientes externos. O cliente <strong>não</strong> precisa ser membro da empresa —
          basta criar a conta dele no Supabase e adicionar uma linha aqui.
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setOpen(true); }}>
          <Link2 className="h-4 w-4 mr-1" /> Novo acesso
        </Button>
      </div>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Permissões</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum acesso de portal cadastrado.</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id} className={!r.active ? 'opacity-50' : ''}>
                  <TableCell className="font-mono text-xs">{r.user_id.slice(0, 8)}…</TableCell>
                  <TableCell>{clientMap.get(r.client_id) || r.client_id.slice(0, 8)}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{r.access_type}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {PERM_FIELDS.filter(([key]) => r[key]).map(([, label]) => label).join(' · ') || <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell><Badge variant={r.active ? 'default' : 'secondary'}>{r.active ? 'Ativo' : 'Inativo'}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3 w-3" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleActive.mutate({ id: r.id, active: !r.active })}>
                      {r.active ? <Ban className="h-3 w-3 text-destructive" /> : <CheckCircle2 className="h-3 w-3 text-success" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Copiar link do portal"
                      onClick={() => {
                        const url = `${window.location.origin}/portal`;
                        navigator.clipboard.writeText(url);
                        toast.success('Link do portal copiado');
                      }}
                    >
                      <Link2 className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAction('Remover acesso?', { title: 'Remover acesso', confirmLabel: 'Remover' })) remove.mutate(r.id); }}>
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      <PortalAccessDialog
        open={open}
        onOpenChange={(v) => { if (!v) setEditing(null); setOpen(v); }}
        editing={editing}
        clients={clients}
        tenantId={tenantId}
      />
    </div>
  );
}

function PortalAccessDialog({ open, onOpenChange, editing, clients, tenantId }: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: PortalAccessRow | null; clients: ClientOption[]; tenantId?: string;
}) {
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState<Array<{ id: string; email: string | null; full_name: string | null }>>([]);
  const [searching, setSearching] = useState(false);
  const [pickedLabel, setPickedLabel] = useState<string>('');
  const [clientId, setClientId] = useState('');
  const [accessType, setAccessType] = useState('full');
  const [perms, setPerms] = useState<Partial<Record<PortalPermissionKey, boolean>>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (editing) {
        setUserId(editing.user_id);
        setPickedLabel(editing.user_id);
        setClientId(editing.client_id);
        setAccessType(editing.access_type);
        setPerms(Object.fromEntries(PERM_FIELDS.map(([key]) => [key, editing[key]])));
      } else {
        setUserId(''); setPickedLabel(''); setUserQuery(''); setUserResults([]);
        setClientId(''); setAccessType('full'); setPerms({});
      }
    }
  }, [open, editing]);

  useEffect(() => {
    if (!open || !tenantId) return undefined;
    const q = userQuery.trim();
    if (q.length < 2) { setUserResults([]); return undefined; }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke<EdgeUsersResponse>('search-users-by-email', {
          body: { tenant_id: tenantId, query: q },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setUserResults(data?.users || []);
      } catch (error: unknown) {
        toast.error(errorMessage(error, 'Falha na busca de usuários'));
      } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(handle);
  }, [toast, userQuery, open, tenantId]);

  const save = async () => {
    if (!tenantId || !userId || !clientId) { toast.error('Preencha usuário, cliente e tipo'); return; }
    setLoading(true);
    try {
      const payload: TablesInsert<'client_portal_access'> = {
        tenant_id: tenantId,
        user_id: userId.trim(),
        client_id: clientId,
        access_type: accessType,
        active: true,
        can_view_financial: !!perms.can_view_financial,
        can_download_documents: !!perms.can_download_documents,
        can_open_occurrences: !!perms.can_open_occurrences,
        can_request_pickup: !!perms.can_request_pickup,
        can_view_vehicle_live: !!perms.can_view_vehicle_live,
        can_view_driver_contact: !!perms.can_view_driver_contact,
      };
      if (editing) {
        const { error } = await supabase.from('client_portal_access').update(payload).eq('id', editing.id).eq('tenant_id', tenantId);
        if (error) throw error;
        toast.success('Acesso atualizado');
      } else {
        const { error } = await supabase.from('client_portal_access').insert(payload);
        if (error) throw error;
        toast.success('Acesso criado');
      }
      queryClient.invalidateQueries({ queryKey: ['client_portal_access_admin'] });
      onOpenChange(false);
      setUserId(''); setPickedLabel(''); setUserQuery(''); setUserResults([]);
      setClientId(''); setAccessType('full'); setPerms({});
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Falha ao salvar acesso'));
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar acesso ao portal' : 'Novo acesso ao portal'}</DialogTitle>
          <DialogDescription>Configure o que este usuário pode ver e fazer no portal do cliente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Usuário</Label>
            {userId && pickedLabel ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="truncate">{pickedLabel}</span>
                <Button size="sm" variant="ghost" onClick={() => { setUserId(''); setPickedLabel(''); setUserQuery(''); }}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <Input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Buscar por e-mail ou nome (mín. 2 caracteres)"
                />
                {searching && <p className="text-[11px] text-muted-foreground">Buscando…</p>}
                {!searching && userQuery.trim().length >= 2 && userResults.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">Nenhum usuário encontrado.</p>
                )}
                {userResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                    {userResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => {
                          setUserId(u.id);
                          setPickedLabel(u.full_name ? `${u.full_name} <${u.email ?? '?'}>` : (u.email ?? u.id));
                          setUserResults([]); setUserQuery('');
                        }}
                      >
                        <div className="font-medium">{u.full_name || u.email || u.id}</div>
                        {u.email && <div className="text-[11px] text-muted-foreground">{u.email}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cliente</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger><SelectValue placeholder="Selecione um cliente" /></SelectTrigger>
              <SelectContent>
                {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo de acesso</Label>
            <Select value={accessType} onValueChange={setAccessType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCESS_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Permissões</Label>
            <div className="grid grid-cols-2 gap-2">
              {PERM_FIELDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={!!perms[k]} onCheckedChange={(checked) => setPerms((current) => ({ ...current, [k]: !!checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={save} disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">{icon}</div>
        <div>
          <p className="text-xl font-bold text-foreground">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function RoleInfo({ role, desc }: { role: string; desc: string }) {
  return (
    <div className="flex gap-2 rounded-md border p-3">
      <div className="mt-0.5">{roleIcons[role]}</div>
      <div>
        <p className="font-medium text-foreground text-sm">{roleLabels[role]}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  tenantId,
  drivers,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string;
  drivers: DriverOption[];
}) {
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<TeamRole>('operator');
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'create' | 'existing'>('create');

  const resetForm = () => {
    setEmail('');
    setFullName('');
    setRole('operator');
    setUserId('');
  };

  const handleCreateAccount = async () => {
    if (!tenantId || !email) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke<CreateMemberResponse>('create-team-member', {
        body: { tenant_id: tenantId, email, full_name: fullName || email, role },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.success || !data.email) throw new Error('Resposta inválida ao criar convite.');
      toast.success(`Convite enviado para ${data.email}`);
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      resetForm();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Erro ao criar conta'));
    }
    setLoading(false);
  };

  const [userId, setUserId] = useState('');
  const handleAddById = async () => {
    if (!tenantId || !userId) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('tenant_memberships').insert({
        tenant_id: tenantId,
        user_id: userId.trim(),
        role,
        active: true,
      });
      if (error) {
        if (error.code === '23505') {
          toast.error('Este usuário já é membro desta empresa.');
        } else {
          throw error;
        }
      } else {
        toast.success(`Membro adicionado como ${roleLabels[role]}`);
        queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
        resetForm();
        onOpenChange(false);
      }
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Erro ao vincular membro'));
    }
    setLoading(false);
  };

  const isCreateValid = email.includes('@');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Membro</DialogTitle>
          <DialogDescription>
            Convide uma nova conta ou vincule um usuário existente à sua empresa.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'create' | 'existing')}>
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1"><UserPlus className="mr-1.5 h-3.5 w-3.5" />Convidar</TabsTrigger>
            <TabsTrigger value="existing" className="flex-1"><Users className="mr-1.5 h-3.5 w-3.5" />Usuário existente</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input placeholder="ex: João Silva" value={fullName} onChange={e => setFullName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>E-mail *</Label>
              <Input type="email" placeholder="joao@empresa.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">O usuário receberá um link seguro e definirá a própria senha.</p>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={role} onValueChange={(value) => { if (isTeamRole(value)) setRole(value); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador — acesso total</SelectItem>
                  <SelectItem value="operator">Operador — acesso operacional</SelectItem>
                  <SelectItem value="driver">Motorista — app do motorista</SelectItem>
                  
                </SelectContent>
              </Select>
            </div>

            {role === 'driver' && drivers.length > 0 && (
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">
                  <strong>Dica:</strong> Após criar a conta, vincule o usuário ao cadastro de motorista na página de Motoristas.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleCreateAccount} disabled={loading || !isCreateValid}>
                {loading ? 'Enviando...' : 'Enviar convite'}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="existing" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={role} onValueChange={(value) => { if (isTeamRole(value)) setRole(value); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador — acesso total</SelectItem>
                  <SelectItem value="operator">Operador — acesso operacional</SelectItem>
                  <SelectItem value="driver">Motorista — app do motorista</SelectItem>
                  
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>ID do Usuário (UUID)</Label>
              <Input placeholder="ex: a1b2c3d4-e5f6-..." value={userId} onChange={e => setUserId(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                O usuário pode encontrar seu ID na página de perfil ou nas configurações da conta.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleAddById} disabled={loading || !userId.trim()}>
                {loading ? 'Adicionando...' : 'Vincular membro'}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  member,
  onOpenChange,
  tenantId,
}: {
  member: MemberRow | null;
  onOpenChange: (open: boolean) => void;
  tenantId?: string;
}) {
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  // Reset form when member changes
  const open = !!member;
  useEffect(() => {
    if (member) {
      setFullName(member.profile_name || '');
      setEmail(member.profile_email || '');
    }
  }, [member]);

  // Use effect-like reset via key
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setFullName('');
      setEmail('');
    }
    onOpenChange(v);
  };

  const handleSave = async () => {
    if (!tenantId || !member) return;
    setLoading(true);
    try {
      const body: Record<string, string> = {
        tenant_id: tenantId,
        user_id: member.user_id,
      };
      if (fullName.trim()) body.full_name = fullName.trim();
      if (email.trim()) body.email = email.trim();

      if (!body.full_name && !body.email) {
        toast.info('Nenhuma alteração informada.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke<UpdateMemberResponse>('update-team-member', { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Conta atualizada com sucesso');
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      handleOpenChange(false);
    } catch (error: unknown) {
      toast.error(errorMessage(error, 'Erro ao atualizar conta'));
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Membro</DialogTitle>
          <DialogDescription>
            Altere os dados da conta de {member?.profile_name || 'usuário'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome completo</Label>
            <Input
              placeholder={member?.profile_name || 'Nome do usuário'}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input
              type="email"
              placeholder="Novo e-mail (deixe vazio para manter)"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
            <Button
              onClick={handleSave}
              disabled={loading}
            >
              {loading ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
