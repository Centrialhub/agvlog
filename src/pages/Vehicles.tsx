import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, ExternalLink, User, LinkIcon, Unlink } from 'lucide-react';
import { toast } from 'sonner';

export default function Vehicles() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<any>(null);

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ['vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicles')
        .select('*, current_driver:drivers!vehicles_current_driver_id_fkey(id, name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers_for_assign', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name, current_vehicle_id')
        .eq('tenant_id', currentTenant.id).eq('active', true).order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ vehicleId, driverId }: { vehicleId: string; driverId: string | null }) => {
      const { error } = await supabase.from('vehicles')
        .update({ current_driver_id: driverId })
        .eq('id', vehicleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['drivers_for_assign'] });
      toast.success('Vínculo atualizado');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vehicles').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast.success('Veículo removido');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleEdit = (v: any) => {
    setEditingVehicle(v);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingVehicle(null);
    setDialogOpen(true);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Veículos</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie a frota de {currentTenant?.name}
          </p>
        </div>
        {isAdmin && (
          <Button onClick={handleNew}>
            <Plus className="mr-2 h-4 w-4" />
            Novo veículo
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Placa</TableHead>
                <TableHead>Apelido</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Carroceria</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="w-24">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : vehicles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Nenhum veículo cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                vehicles.map((v: any) => (
                  <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/vehicles/${v.id}`)}>
                    <TableCell className="font-mono font-medium">{v.plate}</TableCell>
                    <TableCell>{v.nickname || '—'}</TableCell>
                    <TableCell className="capitalize">{v.type}</TableCell>
                    <TableCell onClick={e => e.stopPropagation()}>
                      {isAdmin ? (
                        <Select
                          value={v.current_driver_id || '__none__'}
                          onValueChange={val => assignMutation.mutate({
                            vehicleId: v.id,
                            driverId: val === '__none__' ? null : val,
                          })}
                        >
                          <SelectTrigger className="h-7 w-40 text-xs">
                            <SelectValue placeholder="Sem motorista" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sem motorista</SelectItem>
                            {drivers.map((d: any) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.name} {d.current_vehicle_id && d.current_vehicle_id !== v.id ? '(em outro)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-sm flex items-center gap-1">
                          {v.current_driver ? (
                            <><User className="h-3 w-3" /> {v.current_driver.name}</>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{v.body_type || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={v.active ? 'default' : 'secondary'}>
                        {v.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(v)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              if (confirm('Remover este veículo?')) deleteMutation.mutate(v.id);
                            }}
                          >
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

      <VehicleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        vehicle={editingVehicle}
        tenantId={currentTenant?.id}
        userId={user?.id}
      />
    </div>
  );
}

function VehicleDialog({ open, onOpenChange, vehicle, tenantId, userId }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicle: any;
  tenantId?: string;
  userId?: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<any>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setForm(vehicle ? { ...vehicle } : { type: 'truck', active: true, blocked: false, in_maintenance: false });
  }, [open, vehicle]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const text = (k: string, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={form[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
    </div>
  );
  const num = (k: string, label: string, placeholder?: string) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step="any" value={form[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={placeholder} />
    </div>
  );
  const bool = (k: string, label: string) => (
    <div className="flex items-center justify-between rounded-md border p-3">
      <Label className="text-sm">{label}</Label>
      <Switch checked={!!form[k]} onCheckedChange={v => set(k, v)} />
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !form.plate) { toast.error('Placa é obrigatória'); return; }
    setLoading(true);

    const numKeys = ['odometer_km','year_of_manufacture','capacity_ton','avg_km_per_liter','max_pallets','max_weight_kg','max_volume_m3','tank_capacity_liters','speed_limit_kmh'];
    const payload: any = { tenant_id: tenantId, updated_by: userId };
    Object.keys(form).forEach(k => {
      if (['id','tenant_id','created_at','updated_at','created_by','updated_by','current_driver','current_driver_id','tags'].includes(k)) return;
      let v = form[k];
      if (v === '' || v === undefined) v = null;
      if (numKeys.includes(k) && v !== null) v = Number(v);
      payload[k] = v;
    });
    if (payload.plate) {
      payload.plate = String(payload.plate).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!payload.plate) { toast.error('Placa inválida'); setLoading(false); return; }
    }

    const { error } = vehicle
      ? await supabase.from('vehicles').update(payload).eq('id', vehicle.id)
      : await supabase.from('vehicles').insert({ ...payload, created_by: userId });
    if (error) { toast.error(error.message); setLoading(false); return; }
    toast.success(vehicle ? 'Veículo atualizado' : 'Veículo criado');
    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    onOpenChange(false);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{vehicle ? `Editar veículo ${vehicle.plate || ''}` : 'Novo veículo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Tabs defaultValue="ident">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="ident">Identificação</TabsTrigger>
              <TabsTrigger value="tech">Técnico</TabsTrigger>
              <TabsTrigger value="op">Operação</TabsTrigger>
              <TabsTrigger value="owner">Proprietário</TabsTrigger>
              <TabsTrigger value="tracker">Rastreador</TabsTrigger>
            </TabsList>

            <TabsContent value="ident" className="space-y-3 pt-3">
              <div className="grid grid-cols-3 gap-3">
                {text('plate','Placa *','ABC-1234')}
                {text('nickname','Apelido')}
                {text('renavam','RENAVAM')}
                {text('chassis','Chassi')}
                {text('brand','Marca')}
                {text('model','Modelo')}
                {num('year_of_manufacture','Ano de fabricação')}
                {text('color','Cor')}
                {text('city','Cidade')}
                {text('uf','UF')}
              </div>
            </TabsContent>

            <TabsContent value="tech" className="space-y-3 pt-3">
              <div className="grid grid-cols-3 gap-3">
                {text('type','Tipo (interno)','truck, van, car...')}
                {text('vehicle_type_code','Tipo Veículo (código)','01 - CAVALO MECÂNICO')}
                {text('body_type','Tipo de Carroceria')}
                {text('body_type_code','Carroceria (código)')}
                {text('category','Categoria')}
                {text('axle_structure','Estrutura de eixos')}
                {num('capacity_ton','Capacidade (ton)')}
                {num('max_pallets','Max paletes')}
                {num('max_weight_kg','Peso máx (kg)')}
                {num('max_volume_m3','Volume máx (m³)')}
                {num('tank_capacity_liters','Cap. tanque (L)')}
                {num('avg_km_per_liter','Média km/L prev.')}
              </div>
            </TabsContent>

            <TabsContent value="op" className="space-y-3 pt-3">
              <div className="grid grid-cols-3 gap-3">
                {num('odometer_km','KM do veículo')}
                {num('speed_limit_kmh','Limite velocidade (km/h)')}
                {text('result_center','Centro de resultado')}
                {text('result_area','Área de resultado')}
                {text('business_unit','Unidade de negócio')}
                {text('fleet_type_code','Tipo de frota')}
                {text('situation_code','Situação do veículo')}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {bool('active','Ativo')}
                {bool('blocked','Bloqueado')}
                {bool('in_maintenance','Em manutenção')}
              </div>
            </TabsContent>

            <TabsContent value="owner" className="space-y-3 pt-3">
              <div className="grid grid-cols-2 gap-3">
                {text('owner_name','Proprietário')}
                {text('owner_neighborhood','Bairro')}
                {text('owner_mobile','Celular')}
                {text('owner_phone','Telefone')}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea value={form.owner_notes ?? ''} onChange={e => set('owner_notes', e.target.value)} rows={3} />
              </div>
            </TabsContent>

            <TabsContent value="tracker" className="space-y-3 pt-3">
              <div className="grid grid-cols-3 gap-3">
                {text('tracker_name','Rastreador')}
                {text('tracker_login','Login')}
                {text('tracker_password','Senha')}
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
