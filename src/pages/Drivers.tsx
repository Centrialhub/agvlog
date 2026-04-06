import { useState } from 'react';
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
  const [name, setName] = useState('');
  const [doc, setDoc] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (v: boolean) => {
    if (v) { setName(driver?.name || ''); setDoc(driver?.doc || ''); setPhone(driver?.phone || ''); }
    onOpenChange(v);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    const payload = { tenant_id: tenantId, name, doc: doc || null, phone: phone || null, updated_by: userId };
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{driver ? 'Editar motorista' : 'Novo motorista'}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2"><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Documento (CPF/CNH)</Label><Input value={doc} onChange={e => setDoc(e.target.value)} placeholder="Opcional" /></div>
          <div className="space-y-2"><Label>Telefone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Opcional" /></div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
