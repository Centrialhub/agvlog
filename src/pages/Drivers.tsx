import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { useListFilters } from '@/hooks/useListFilters';
import { matchesSearch } from '@/lib/listFilters';
import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useTenantCapabilities } from '@/hooks/useTenantCapabilities';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, RefreshCw, Truck } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

type DriverRow = Tables<'drivers'>;
type DriverVehicle = Pick<Tables<'vehicles'>, 'id' | 'plate' | 'nickname'>;
type DriverWithVehicle = DriverRow & { current_vehicle: DriverVehicle | null };
type DriverUser = { id: string; full_name: string | null };
type DriverForm = TablesUpdate<'drivers'>;

interface MemberUserSummary {
  id: string;
  email: string | null;
  full_name: string | null;
}

interface MemberUsersResponse {
  users?: MemberUserSummary[];
  error?: string;
}

interface FieldProps {
  label: string;
  k: keyof DriverForm;
  type?: React.HTMLInputTypeAttribute;
  required?: boolean;
  placeholder?: string;
  className?: string;
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const isDriverType = (value: string): value is 'proprio' | 'terceiro' =>
  value === 'proprio' || value === 'terceiro';

const normalizeEmptyStrings = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item === '' ? null : item])) as T;

const driverToForm = (driver: DriverWithVehicle): DriverForm =>
  Object.fromEntries(Object.entries(driver).filter(([key]) => key !== 'current_vehicle')) as DriverForm;

const DRIVER_BOOLEAN_FIELDS = [
  ['emit_contract', 'Emitir contrato'],
  ['blocked', 'Bloqueado'],
  ['commissioned', 'Comissionado'],
  ['mechanic', 'Mecânico'],
  ['romaneio_monitor_responsible', 'Resp. Monit. Romaneio'],
] as const satisfies ReadonlyArray<readonly [keyof DriverForm, string]>;

const DRIVER_NON_EDITABLE_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'current_vehicle_id',
  'provider_person_id',
  'provider_person_sync_status',
]);

export default function Drivers() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { isEnabled } = useTenantCapabilities();
  const ssxEnabled = isEnabled('ssx');
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'all', vehicle: 'all', access: 'all' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DriverWithVehicle | null>(null);
  const [vehicleSearch, setVehicleSearch] = useState<Record<string, string>>({});

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async (): Promise<DriverWithVehicle[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('drivers')
        .select('*, current_vehicle:vehicles!drivers_tenant_current_vehicle_fkey(id, plate, nickname)')
        .eq('tenant_id', currentTenant.id).order('name');
      if (error) throw error;
      return (data || []) as DriverWithVehicle[];
    },
    enabled: !!currentTenant,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles_for_assign', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('vehicles').select('id, plate, nickname, current_driver_id')
        .eq('tenant_id', currentTenant.id).eq('active', true).order('plate');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  // Usuários da tenant que têm role 'driver' (candidatos a vincular a um motorista)
  const { data: driverUsers = [] } = useQuery({
    queryKey: ['driver_users_for_link', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data: m, error: membershipsError } = await supabase
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', currentTenant.id)
        .eq('role', 'driver')
        .eq('active', true);
      if (membershipsError) throw membershipsError;
      const ids = (m || []).map(membership => membership.user_id);
      if (!ids.length) return [];
      const { data: p, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', ids);
      if (profilesError) throw profilesError;
      const profileMap = new Map((p || []).map(profile => [profile.id, profile.full_name]));

      // Enrich with email/metadata name via edge function (Admin API).
      const emailMap = new Map<string, { email: string | null; full_name: string | null }>();
      try {
        const { data: fn, error: fnError } = await supabase.functions.invoke<MemberUsersResponse>('list-tenant-members', {
          body: { tenant_id: currentTenant.id },
        });
        if (fnError) throw fnError;
        if (fn?.error) throw new Error(fn.error);
        for (const u of (fn?.users ?? [])) {
          emailMap.set(u.id, { email: u.email, full_name: u.full_name });
        }
      } catch {
        // fallback silently
      }

      return ids.map((id) => {
        const email = emailMap.get(id)?.email ?? null;
        const name = profileMap.get(id) || emailMap.get(id)?.full_name || email || null;
        return { id, full_name: name };
      });
    },
    enabled: !!currentTenant && isAdmin,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null }) => {
      if (!currentTenant) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('drivers')
        .update({ current_vehicle_id: vehicleId })
        .eq('id', driverId)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles_for_assign'] });
      toast.success('Vínculo atualizado');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao atualizar vínculo')),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts_for_drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('integration_accounts')
        .select('id, username, provider, status')
        .eq('tenant_id', currentTenant.id).eq('status', 'ok');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant ativo não encontrado.');
      const { error } = await supabase.from('drivers').delete().eq('id', id).eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista removido');
    },
    onError: (error: unknown) => toast.error(errorMessage(error, 'Falha ao remover motorista')),
  });

  const syncMutation = useMutation({
    mutationFn: async ({ driverId, accountId }: { driverId: string; accountId: string }) => {
      if (!ssxEnabled) throw new Error('Integração SSX em implantação');
      const { data, error } = await supabase.functions.invoke('ssx-insert-person', {
        body: { tenant_id: currentTenant?.id, driver_id: driverId, integration_account_id: accountId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista sincronizado com SSX');
    },
    onError: (error: unknown) => toast.error(`Falha sync SSX: ${errorMessage(error, 'erro desconhecido')}`),
  });

  const filteredDrivers = drivers.filter(driver =>
    matchesSearch(filters.search, driver.name, driver.doc, driver.phone, driver.current_vehicle?.plate) &&
    (filters.status === 'all' || driver.active === (filters.status === 'active')) &&
    (filters.vehicle === 'all' || Boolean(driver.current_vehicle_id) === (filters.vehicle === 'assigned')) &&
    (filters.access === 'all' || Boolean(driver.user_id) === (filters.access === 'linked'))
  );

  const syncStatusBadge = (status: string | null) => {
    switch (status) {
      case 'synced': return <Badge className="bg-success text-success-foreground text-xs">Sincronizado</Badge>;
      case 'error': return <Badge variant="destructive" className="text-xs">Erro</Badge>;
      default: return <Badge variant="secondary" className="text-xs">Não sincronizado</Badge>;
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Motoristas</h1>
          <p className="text-sm text-muted-foreground">Gerencie os motoristas da frota</p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />Novo motorista
          </Button>
        )}
      </div>

      <ListFilterBar activeCount={activeCount} onReset={resetFilters} resultCount={filteredDrivers.length} totalCount={drivers.length} loading={isLoading} fields={[
        { key: 'search', label: 'Buscar motorista', type: 'search', placeholder: 'Nome, documento, telefone ou placa', value: filters.search, onChange: value => setFilter('search', value) },
        { key: 'status', label: 'Situação', value: filters.status, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas as situações' }, { value: 'active', label: 'Ativos' }, { value: 'inactive', label: 'Inativos' }] },
        { key: 'vehicle', label: 'Vínculo com veículo', value: filters.vehicle, onChange: value => setFilter('vehicle', value), options: [{ value: 'all', label: 'Todos os motoristas' }, { value: 'assigned', label: 'Com veículo' }, { value: 'unassigned', label: 'Sem veículo' }] },
        { key: 'access', label: 'Acesso ao aplicativo', value: filters.access, onChange: value => setFilter('access', value), options: [{ value: 'all', label: 'Todos os acessos' }, { value: 'linked', label: 'Com usuário vinculado' }, { value: 'unlinked', label: 'Sem usuário vinculado' }] },
      ]} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Veículo Vinculado</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>{ssxEnabled ? 'SSX Sync' : 'SSX · Em implantação'}</TableHead>
                {isAdmin && <TableHead className="w-32">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filteredDrivers.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{activeCount ? 'Nenhum motorista corresponde aos filtros' : 'Nenhum motorista cadastrado'}</TableCell></TableRow>
              ) : (
                filteredDrivers.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell className="font-mono">{d.doc || '—'}</TableCell>
                    <TableCell>{d.phone || '—'}</TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Select
                          value={d.current_vehicle_id || '__none__'}
                          onValueChange={val => assignMutation.mutate({
                            driverId: d.id,
                            vehicleId: val === '__none__' ? null : val,
                          })}
                        >
                          <SelectTrigger className="h-7 w-40 text-xs">
                            <SelectValue placeholder="Sem veículo" />
                          </SelectTrigger>
                          <SelectContent>
                            <div className="p-1 sticky top-0 bg-popover z-10 border-b">
                              <Input
                                autoFocus
                                placeholder="Buscar placa..."
                                className="h-7 text-xs"
                                value={vehicleSearch[d.id] || ''}
                                onChange={e => setVehicleSearch(s => ({ ...s, [d.id]: e.target.value }))}
                                onKeyDown={e => e.stopPropagation()}
                              />
                            </div>
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {vehicles
                              .filter(v => {
                                const q = (vehicleSearch[d.id] || '').toLowerCase().trim();
                                if (!q) return true;
                                return (v.plate || '').toLowerCase().includes(q) || (v.nickname || '').toLowerCase().includes(q);
                              })
                              .map(v => (
                                <SelectItem key={v.id} value={v.id}>
                                  {v.plate} {v.nickname ? `(${v.nickname})` : ''} {v.current_driver_id && v.current_driver_id !== d.id ? '(em uso)' : ''}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm flex items-center gap-1">
                          {d.current_vehicle ? (
                            <><Truck className="h-3 w-3" /> {d.current_vehicle.plate}</>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.user_id ? (
                        <span className="text-xs">{driverUsers.find(u => u.id === d.user_id)?.full_name || d.user_id.slice(0, 8)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sem vínculo</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={d.active ? 'default' : 'secondary'}>{d.active ? 'Ativo' : 'Inativo'}</Badge>
                    </TableCell>
                    <TableCell>{syncStatusBadge(d.provider_person_sync_status)}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" aria-label={`Editar motorista ${d.name}`} onClick={() => { setEditing(d); setDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {ssxEnabled && accounts.length > 0 && d.provider_person_sync_status !== 'synced' && (
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => syncMutation.mutate({ driverId: d.id, accountId: accounts[0].id })}
                              disabled={syncMutation.isPending}
                              title="Sincronizar com SSX"
                            >
                              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={async () => { if (await confirmAction('Remover este motorista?', { title: 'Remover motorista', confirmLabel: 'Remover' })) deleteMutation.mutate(d.id); }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <DriverDialog open={dialogOpen} onOpenChange={setDialogOpen} driver={editing} tenantId={currentTenant?.id} userId={user?.id} driverUsers={driverUsers} existingDrivers={drivers} />
    </div>
  );
}

function DriverDialog({ open, onOpenChange, driver, tenantId, userId, driverUsers, existingDrivers }: {
  open: boolean; onOpenChange: (v: boolean) => void; driver: DriverWithVehicle | null; tenantId?: string; userId?: string;
  driverUsers: DriverUser[]; existingDrivers: DriverWithVehicle[];
}) {
  const toast = useSonnerToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DriverForm>({});
  const [driverType, setDriverType] = useState<'proprio' | 'terceiro'>('proprio');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (driver) {
        setForm(driverToForm(driver));
      } else {
        setForm({});
      }
      const savedType = driver?.driver_type || '';
      setDriverType(isDriverType(savedType) ? savedType : 'proprio');
    }
  }, [open, driver]);

  const set = <K extends keyof DriverForm>(key: K, value: DriverForm[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    if (driverType === 'proprio') {
      const required: Array<keyof DriverForm> = ['name', 'birth_date', 'naturalidade', 'address_street', 'address_neighborhood', 'address_city', 'cpf', 'cnh_number'];
      const missing = required.filter((k) => !form[k] || String(form[k]).trim() === '');
      if (missing.length) {
        toast.error('Preencha os campos obrigatórios do motorista próprio');
        return;
      }
    }
    if (!form.name || !String(form.name).trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setLoading(true);
    // Strip nested/system fields
    const rest = Object.fromEntries(
      Object.entries(form).filter(([key]) => !DRIVER_NON_EDITABLE_FIELDS.has(key)),
    ) as TablesUpdate<'drivers'>;
    const payload = normalizeEmptyStrings<TablesUpdate<'drivers'>>({
      ...rest,
      driver_type: driverType,
      tenant_id: tenantId,
      updated_by: userId ?? null,
    });
    // Mirror cpf into legacy doc if doc empty
    if (!payload.doc && payload.cpf) payload.doc = payload.cpf;
    if (!payload.phone && payload.mobile) payload.phone = payload.mobile;

    if (driver) {
      const { error } = await supabase.from('drivers').update(payload).eq('id', driver.id).eq('tenant_id', tenantId);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Motorista atualizado');
    } else {
      const insertPayload: TablesInsert<'drivers'> = {
        ...payload,
        tenant_id: tenantId,
        name: String(payload.name).trim(),
        created_by: userId ?? null,
      };
      const { error } = await supabase.from('drivers').insert(insertPayload);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Motorista criado');
    }
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
    onOpenChange(false);
    setLoading(false);
  };

  const req = () => driverType === 'proprio' && (
    <span className="text-destructive ml-0.5">*</span>
  );

  const field = ({ label, k, type = 'text', required = false, placeholder, className }: FieldProps) => {
    const value = form[k];
    return (
      <div className={`space-y-1 ${className || ''}`}>
        <Label className="text-xs">{label}{required && req()}</Label>
        <Input
          key={k}
          type={type}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
          onChange={(event) => setForm(current => ({ ...current, [k]: event.target.value }))}
          placeholder={placeholder}
          className="h-9"
        />
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{driver ? 'Editar motorista' : 'Novo motorista'}</DialogTitle>
        </DialogHeader>

        <Tabs value={driverType} onValueChange={(value) => { if (isDriverType(value)) setDriverType(value); }} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="proprio">Motorista Próprio</TabsTrigger>
            <TabsTrigger value="terceiro">Motorista Terceiro</TabsTrigger>
          </TabsList>
          <div className="text-[11px] text-muted-foreground mt-2">
            {driverType === 'proprio'
              ? 'Campos com * são obrigatórios para motoristas próprios.'
              : 'Nenhum campo é obrigatório para motoristas terceiros (apenas o nome).'}
          </div>
        </Tabs>

        <form onSubmit={handleSubmit} className="space-y-5 mt-2">
          {/* Identificação */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Identificação</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"Sigla",k:"sigla"})}
              {field({label:"Data cadastro",k:"registration_date",type:"date"})}
              {field({label:"Fornecedor",k:"supplier"})}
              {field({label:"Contato",k:"contact"})}
              <div className="col-span-2 md:col-span-2">
                {field({label:"Nome",k:"name",required:true})}
              </div>
              {field({label:"E-mail",k:"email",type:"email"})}
              <div className="space-y-1">
                <Label className="text-xs">Tipo (frota)</Label>
                <Select value={form.fleet_type ?? ''} onValueChange={(v) => set('fleet_type', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FROTA">FROTA</SelectItem>
                    <SelectItem value="AGREGADO">AGREGADO</SelectItem>
                    <SelectItem value="TERCEIRO">TERCEIRO</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field({label:"Tipo motorista (cód.)",k:"driver_kind_code"})}
            </div>
            <div className="flex flex-wrap gap-4 pt-1">
              {DRIVER_BOOLEAN_FIELDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={!!form[k]} onCheckedChange={(checked) => setForm(current => ({ ...current, [k]: !!checked }))} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          {/* Documentos */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Documentos</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"CPF",k:"cpf",required:true})}
              {field({label:"RG",k:"rg"})}
              {field({label:"Órgão emissor",k:"rg_issuer"})}
              {field({label:"UF RG",k:"rg_uf"})}
              {field({label:"CNH nº",k:"cnh_number",required:true})}
              {field({label:"UF CNH",k:"cnh_uf"})}
              {field({label:"CNH categoria",k:"cnh_category",placeholder:"A, B, C, D, E"})}
              {field({label:"CNH validade",k:"cnh_expiry",type:"date"})}
              {field({label:"Cód. segurança CNH",k:"cnh_security_code"})}
              {field({label:"Renach",k:"renach"})}
              {field({label:"Emissão CNH",k:"cnh_issued_at",type:"date"})}
              {field({label:"1ª Habilitação",k:"first_license_date",type:"date"})}
              {field({label:"Validade MOPE",k:"mope_expiry",type:"date"})}
              {field({label:"Nº Pamcary",k:"pamcary_number"})}
              {field({label:"Vencimento Pamcary",k:"pamcary_expiry",type:"date"})}
              {field({label:"Nº Cartão",k:"card_number"})}
              {field({label:"Nº Cooperado",k:"coop_number"})}
              {field({label:"Região atendida",k:"served_region"})}
            </div>
          </section>

          {/* Trabalhista */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Dados trabalhistas</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"CTPS",k:"ctps"})}
              {field({label:"Série",k:"ctps_series"})}
              {field({label:"PIS",k:"pis"})}
              {field({label:"INSS",k:"inss"})}
              {field({label:"INPS",k:"inps"})}
              {field({label:"INSC",k:"insc"})}
            </div>
          </section>

          {/* Dados pessoais */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Dados pessoais</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"Data nasc.",k:"birth_date",type:"date",required:true})}
              {field({label:"Naturalidade",k:"naturalidade",required:true})}
              {field({label:"UF",k:"naturalidade_uf"})}
              {field({label:"Nacionalidade",k:"nacionalidade"})}
              <div className="space-y-1">
                <Label className="text-xs">Sexo</Label>
                <Select value={form.sex ?? ''} onValueChange={(v) => set('sex', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="M">Masculino</SelectItem>
                    <SelectItem value="F">Feminino</SelectItem>
                    <SelectItem value="O">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Estado civil</Label>
                <Select value={form.marital_status ?? ''} onValueChange={(v) => set('marital_status', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SOLTEIRO">Solteiro(a)</SelectItem>
                    <SelectItem value="CASADO">Casado(a)</SelectItem>
                    <SelectItem value="DIVORCIADO">Divorciado(a)</SelectItem>
                    <SelectItem value="VIUVO">Viúvo(a)</SelectItem>
                    <SelectItem value="UNIAO_ESTAVEL">União estável</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field({label:"Cônjuge",k:"spouse_name"})}
              <div className="space-y-1">
                <Label className="text-xs">Escolaridade</Label>
                <Select value={form.education ?? ''} onValueChange={(v) => set('education', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FUND_INC">Fundamental incompleto</SelectItem>
                    <SelectItem value="FUND_COMP">Fundamental completo</SelectItem>
                    <SelectItem value="MEDIO_INC">Médio incompleto</SelectItem>
                    <SelectItem value="MEDIO_COMP">Médio completo</SelectItem>
                    <SelectItem value="SUPERIOR_INC">Superior incompleto</SelectItem>
                    <SelectItem value="SUPERIOR_COMP">Superior completo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field({label:"Pai",k:"father_name",className:"md:col-span-2"})}
              {field({label:"Mãe",k:"mother_name",className:"md:col-span-2"})}
              {field({label:"Cor pele",k:"skin_color"})}
              {field({label:"Cor olhos",k:"eye_color"})}
              {field({label:"Cor cabelo",k:"hair_color"})}
              {field({label:"Sinais",k:"distinguishing_marks"})}
              {field({label:"Peso (kg)",k:"weight_kg",type:"number"})}
              {field({label:"Altura (m)",k:"height_m",type:"number"})}
            </div>
          </section>

          {/* Contatos */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Contatos</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {field({label:"Telefone",k:"phone"})}
              {field({label:"Telefone secundário",k:"phone_secondary"})}
              {field({label:"Celular",k:"mobile"})}
            </div>
          </section>

          {/* Endereço atual */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Residência atual</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"Data inicial",k:"residence_since",type:"date"})}
              <div className="space-y-1">
                <Label className="text-xs">Tipo residência</Label>
                <Select value={form.residence_type ?? ''} onValueChange={(v) => set('residence_type', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASA">Casa</SelectItem>
                    <SelectItem value="APARTAMENTO">Apartamento</SelectItem>
                    <SelectItem value="ALUGADA">Alugada</SelectItem>
                    <SelectItem value="PROPRIA">Própria</SelectItem>
                    <SelectItem value="FAMILIAR">Familiar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field({label:"CEP",k:"address_zip"})}
              {field({label:"UF",k:"address_state"})}
              <div className="md:col-span-2">{field({label:"Endereço",k:"address_street",required:true})}</div>
              {field({label:"Número",k:"address_number"})}
              {field({label:"Complemento",k:"address_complement"})}
              {field({label:"Bairro",k:"address_neighborhood",required:true})}
              <div className="md:col-span-2">{field({label:"Município",k:"address_city",required:true})}</div>
            </div>
          </section>

          {/* Endereço anterior */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Residência anterior</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {field({label:"Tempo residência",k:"prev_residence_duration"})}
              <div className="space-y-1">
                <Label className="text-xs">Tipo residência</Label>
                <Select value={form.prev_residence_type ?? ''} onValueChange={(v) => set('prev_residence_type', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASA">Casa</SelectItem>
                    <SelectItem value="APARTAMENTO">Apartamento</SelectItem>
                    <SelectItem value="ALUGADA">Alugada</SelectItem>
                    <SelectItem value="PROPRIA">Própria</SelectItem>
                    <SelectItem value="FAMILIAR">Familiar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {field({label:"CEP",k:"prev_address_zip"})}
              {field({label:"UF",k:"prev_address_state"})}
              <div className="md:col-span-2">{field({label:"Endereço",k:"prev_address_street"})}</div>
              {field({label:"Número",k:"prev_address_number"})}
              {field({label:"Complemento",k:"prev_address_complement"})}
              {field({label:"Bairro",k:"prev_address_neighborhood"})}
              <div className="md:col-span-2">{field({label:"Município",k:"prev_address_city"})}</div>
            </div>
          </section>

          {/* Vínculo de usuário */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Vínculo de usuário (app do motorista)</h3>
            <p className="text-[11px] text-muted-foreground">
              Selecione o usuário que vai operar o app deste motorista. Apenas usuários com papel
              "Motorista" na equipe aparecem aqui. Cada usuário só pode estar vinculado a um motorista.
            </p>
            <Select
              value={form.user_id ?? '__none__'}
              onValueChange={(v) => set('user_id', v === '__none__' ? null : v)}
            >
              <SelectTrigger className="h-9 max-w-md"><SelectValue placeholder="Sem vínculo" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sem vínculo</SelectItem>
                {driverUsers.map((u) => {
                  const usedBy = existingDrivers.find((d) => d.user_id === u.id && d.id !== driver?.id);
                  return (
                    <SelectItem key={u.id} value={u.id} disabled={!!usedBy}>
                      {u.full_name || u.id.slice(0, 8)} {usedBy ? `(já vinculado a ${usedBy.name})` : ''}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </section>

          {/* Observações */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground border-b pb-1">Observações</h3>
            <Textarea value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} rows={3} />
          </section>

          <div className="flex justify-end gap-2 sticky bottom-0 bg-background pt-3 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
