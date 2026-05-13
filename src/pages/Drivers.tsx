import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, RefreshCw, Truck } from 'lucide-react';
import { toast } from 'sonner';

export default function Drivers() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: drivers = [], isLoading } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('drivers')
        .select('*, current_vehicle:vehicles!drivers_current_vehicle_id_fkey(id, plate, nickname)')
        .eq('tenant_id', currentTenant.id).order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ['vehicles_for_assign', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('vehicles').select('id, plate, nickname, current_driver_id')
        .eq('tenant_id', currentTenant.id).eq('active', true).order('plate');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ driverId, vehicleId }: { driverId: string; vehicleId: string | null }) => {
      const { error } = await supabase.from('drivers')
        .update({ current_vehicle_id: vehicleId })
        .eq('id', driverId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles_for_assign'] });
      toast.success('Vínculo atualizado');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['integration_accounts_for_drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('integration_accounts')
        .select('id, username, provider, status')
        .eq('tenant_id', currentTenant.id).eq('status', 'ok');
      return data || [];
    },
    enabled: !!currentTenant && isAdmin,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('drivers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast.success('Motorista removido');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const syncMutation = useMutation({
    mutationFn: async ({ driverId, accountId }: { driverId: string; accountId: string }) => {
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
    onError: (e: any) => toast.error(`Falha sync SSX: ${e.message}`),
  });

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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Veículo Vinculado</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>SSX Sync</TableHead>
                {isAdmin && <TableHead className="w-32">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : drivers.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhum motorista cadastrado</TableCell></TableRow>
              ) : (
                drivers.map((d: any) => (
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
                            <SelectItem value="__none__">Sem veículo</SelectItem>
                            {vehicles.map((v: any) => (
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
                      <Badge variant={d.active ? 'default' : 'secondary'}>{d.active ? 'Ativo' : 'Inativo'}</Badge>
                    </TableCell>
                    <TableCell>{syncStatusBadge(d.provider_person_sync_status)}</TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => { setEditing(d); setDialogOpen(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {accounts.length > 0 && d.provider_person_sync_status !== 'synced' && (
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => syncMutation.mutate({ driverId: d.id, accountId: accounts[0].id })}
                              disabled={syncMutation.isPending}
                              title="Sincronizar com SSX"
                            >
                              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm('Remover?')) deleteMutation.mutate(d.id); }}>
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

      <DriverDialog open={dialogOpen} onOpenChange={setDialogOpen} driver={editing} tenantId={currentTenant?.id} userId={user?.id} />
    </div>
  );
}

function DriverDialog({ open, onOpenChange, driver, tenantId, userId }: {
  open: boolean; onOpenChange: (v: boolean) => void; driver: any; tenantId?: string; userId?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({});
  const [driverType, setDriverType] = useState<'proprio' | 'terceiro'>('proprio');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(driver || {});
      setDriverType((driver?.driver_type as any) || 'proprio');
    }
  }, [open, driver]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    if (driverType === 'proprio') {
      const required = ['name', 'birth_date', 'naturalidade', 'address_street', 'address_neighborhood', 'address_city', 'cpf', 'cnh_number'];
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
    const { id, created_at, updated_at, created_by, current_vehicle, current_vehicle_id, provider_person_id, provider_person_sync_status, ...rest } = form;
    const payload: any = {
      ...rest,
      driver_type: driverType,
      tenant_id: tenantId,
      updated_by: userId,
    };
    // Convert empty strings to null
    Object.keys(payload).forEach((k) => { if (payload[k] === '') payload[k] = null; });
    // Mirror cpf into legacy doc if doc empty
    if (!payload.doc && payload.cpf) payload.doc = payload.cpf;
    if (!payload.phone && payload.mobile) payload.phone = payload.mobile;

    if (driver) {
      const { error } = await supabase.from('drivers').update(payload).eq('id', driver.id);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Motorista atualizado');
    } else {
      const { error } = await supabase.from('drivers').insert({ ...payload, created_by: userId });
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Motorista criado');
    }
    queryClient.invalidateQueries({ queryKey: ['drivers'] });
    onOpenChange(false);
    setLoading(false);
  };

  const req = (k: string) => driverType === 'proprio' && (
    <span className="text-destructive ml-0.5">*</span>
  );

  const field = ({ label, k, type = 'text', required = false, placeholder, className }: any) => (
    <div className={`space-y-1 ${className || ''}`}>
      <Label className="text-xs">{label}{required && req(k)}</Label>
      <Input
        key={k}
        type={type}
        value={form[k] ?? ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{driver ? 'Editar motorista' : 'Novo motorista'}</DialogTitle>
        </DialogHeader>

        <Tabs value={driverType} onValueChange={(v) => setDriverType(v as any)} className="w-full">
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
              {[
                ['emit_contract', 'Emitir contrato'],
                ['blocked', 'Bloqueado'],
                ['commissioned', 'Comissionado'],
                ['mechanic', 'Mecânico'],
                ['romaneio_monitor_responsible', 'Resp. Monit. Romaneio'],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox checked={!!form[k]} onCheckedChange={(c) => set(k, !!c)} />
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
              {field({label:"CNH nº",k:"cnh_number",required:true})}
              {field({label:"CNH categoria",k:"cnh_category",placeholder:"A, B, C, D, E"})}
              {field({label:"CNH validade",k:"cnh_expiry",type:"date"})}
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
