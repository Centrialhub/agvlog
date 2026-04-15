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
  const [plate, setPlate] = useState('');
  const [nickname, setNickname] = useState('');
  const [type, setType] = useState('truck');
  const [bodyType, setBodyType] = useState('');
  const [maxPallets, setMaxPallets] = useState('');
  const [maxWeightKg, setMaxWeightKg] = useState('');
  const [maxVolumeM3, setMaxVolumeM3] = useState('');
  const [tankCapacity, setTankCapacity] = useState('');
  const [loading, setLoading] = useState(false);

  // Sync form when dialog opens or vehicle changes
  useEffect(() => {
    if (open) {
      setPlate(vehicle?.plate || '');
      setNickname(vehicle?.nickname || '');
      setType(vehicle?.type || 'truck');
      setBodyType(vehicle?.body_type || '');
      setMaxPallets(vehicle?.max_pallets?.toString() || '');
      setMaxWeightKg(vehicle?.max_weight_kg?.toString() || '');
      setMaxVolumeM3(vehicle?.max_volume_m3?.toString() || '');
      setTankCapacity(vehicle?.tank_capacity_liters?.toString() || '');
    }
  }, [open, vehicle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);

    const payload: any = {
      tenant_id: tenantId,
      plate: plate.toUpperCase(),
      nickname: nickname || null,
      type,
      body_type: bodyType || null,
      max_pallets: maxPallets ? parseInt(maxPallets) : null,
      max_weight_kg: maxWeightKg ? parseFloat(maxWeightKg) : null,
      max_volume_m3: maxVolumeM3 ? parseFloat(maxVolumeM3) : null,
      tank_capacity_liters: tankCapacity ? parseFloat(tankCapacity) : null,
      updated_by: userId,
    };

    if (vehicle) {
      const { error } = await supabase.from('vehicles').update(payload).eq('id', vehicle.id);
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Veículo atualizado');
    } else {
      const { error } = await supabase.from('vehicles').insert({ ...payload, created_by: userId });
      if (error) { toast.error(error.message); setLoading(false); return; }
      toast.success('Veículo criado');
    }

    queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    onOpenChange(false);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{vehicle ? 'Editar veículo' : 'Novo veículo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Placa</Label>
            <Input value={plate} onChange={e => setPlate(e.target.value)} placeholder="ABC-1234" required />
          </div>
          <div className="space-y-2">
            <Label>Apelido</Label>
            <Input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="Opcional" />
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Input value={type} onChange={e => setType(e.target.value)} placeholder="truck, van, car..." />
          </div>
          <div className="space-y-2">
            <Label>Tipo de Carroceria</Label>
            <Input value={bodyType} onChange={e => setBodyType(e.target.value)} placeholder="Baú, Sider, Graneleira..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Max Paletes</Label>
              <Input type="number" value={maxPallets} onChange={e => setMaxPallets(e.target.value)} placeholder="Ex: 24" />
            </div>
            <div className="space-y-2">
              <Label>Peso Máx (kg)</Label>
              <Input type="number" value={maxWeightKg} onChange={e => setMaxWeightKg(e.target.value)} placeholder="Ex: 14000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Volume Máx (m³)</Label>
              <Input type="number" value={maxVolumeM3} onChange={e => setMaxVolumeM3(e.target.value)} placeholder="Ex: 45" />
            </div>
            <div className="space-y-2">
              <Label>Cap. Tanque (L)</Label>
              <Input type="number" value={tankCapacity} onChange={e => setTankCapacity(e.target.value)} placeholder="Ex: 300" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
