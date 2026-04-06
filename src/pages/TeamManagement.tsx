import { useState } from 'react';
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
import { toast } from 'sonner';
import { Users, UserPlus, ShieldCheck, Truck, Building2, UserCog, Ban, CheckCircle2, AlertTriangle } from 'lucide-react';

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
  role: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  profile_name: string | null;
  profile_email: string | null;
}

export default function TeamManagement() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [filterRole, setFilterRole] = useState<string>('all');

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
      let profiles: any[] = [];
      if (userIds.length > 0) {
        const { data: p } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        profiles = p || [];
      }
      const profileMap = new Map(profiles.map(p => [p.id, p]));

      return (memberships || []).map(m => ({
        ...m,
        profile_name: profileMap.get(m.user_id)?.full_name || null,
        profile_email: null, // email only available via admin API
      }));
    },
    enabled: !!currentTenant,
  });

  // Drivers linked to users
  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_team', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name, phone, doc').eq('tenant_id', currentTenant.id).eq('active', true);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients_for_team', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('clients').select('id, company_name').eq('tenant_id', currentTenant.id).eq('active', true);
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const { error } = await supabase
        .from('tenant_memberships')
        .update({ role: role as any, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      toast.success('Papel atualizado');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('tenant_memberships')
        .update({ active, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant_members'] });
      toast.success('Status atualizado');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const filtered = filterRole === 'all' ? members : members.filter(m => m.role === filterRole);

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
        </TabsList>
        <TabsContent value="members" className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">Filtrar por papel:</Label>
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="owner">Proprietário</SelectItem>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="operator">Operador</SelectItem>
                <SelectItem value="driver">Motorista</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>

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
                            <p className="font-medium text-foreground">{m.profile_name || 'Usuário'}</p>
                            <p className="text-xs text-muted-foreground font-mono">{m.user_id.slice(0, 8)}...</p>
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
                              onValueChange={(v) => updateRoleMutation.mutate({ id: m.id, role: v })}
                              disabled={updateRoleMutation.isPending}
                            >
                              <SelectTrigger className="w-36 h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Administrador</SelectItem>
                                <SelectItem value="operator">Operador</SelectItem>
                                <SelectItem value="driver">Motorista</SelectItem>
                                <SelectItem value="client">Cliente</SelectItem>
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
                        <TableCell className="text-right">
                          {m.role !== 'owner' && (
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
      </Tabs>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        tenantId={currentTenant?.id}
        drivers={drivers}
        clients={clients}
      />
    </div>
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
  clients,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string;
  drivers: any[];
  clients: any[];
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('operator');
  const [loading, setLoading] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !email) return;
    setLoading(true);
    try {
      // Use Supabase Auth admin invite (via edge function) or manual lookup
      // For now: check if user exists by looking up profiles, then create membership
      // This is a simplified flow - in production you'd use an edge function with service role
      
      // Try to find user by checking if there's a profile with matching full_name/email
      // Since we can't query auth.users from client, we'll create a pending invite
      // For MVP: admin must share the signup link and then manually add the user_id
      
      toast.info(
        'Funcionalidade de convite por e-mail requer configuração de Edge Function. ' +
        'Por enquanto, peça ao usuário para criar uma conta e informe o ID do usuário para adicioná-lo manualmente.',
        { duration: 8000 }
      );
      
      // Alternative: add by user_id directly
    } catch (err: any) {
      toast.error(err.message);
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
        role: role as any,
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
        setUserId('');
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar Membro</DialogTitle>
          <DialogDescription>
            Adicione um novo membro à sua empresa. O usuário precisa já ter uma conta no sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Papel</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrador — acesso total</SelectItem>
                <SelectItem value="operator">Operador — acesso operacional</SelectItem>
                <SelectItem value="driver">Motorista — app do motorista</SelectItem>
                <SelectItem value="client">Cliente — portal do cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>ID do Usuário (UUID)</Label>
            <Input
              placeholder="ex: a1b2c3d4-e5f6-..."
              value={userId}
              onChange={e => setUserId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              O usuário pode encontrar seu ID na página de perfil ou nas configurações da conta.
            </p>
          </div>

          {role === 'driver' && drivers.length > 0 && (
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">
                <strong>Dica:</strong> Após adicionar o membro como motorista, vincule-o ao cadastro de motorista na página de Motoristas.
              </p>
            </div>
          )}

          {role === 'client' && clients.length > 0 && (
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-xs text-muted-foreground mb-1">
                <strong>Dica:</strong> Após adicionar o membro como cliente, vincule-o ao cadastro de cliente na página de Clientes.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleAddById} disabled={loading || !userId.trim()}>
              {loading ? 'Adicionando...' : 'Adicionar membro'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
