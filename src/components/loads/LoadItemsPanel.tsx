import { useState } from 'react';
import { useLoadItems, useCreateLoadItem, useDeleteLoadItem, useUpdateLoadItem, ITEM_STATUSES, ITEM_STATUS_LABELS, LoadItem } from '@/hooks/useLoadItems';
import { useOrders } from '@/hooks/useOrders';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LoadItemsPanelProps {
  loadId: string;
  vehicleMaxPallets?: number | null;
  vehicleMaxWeight?: number | null;
}

export default function LoadItemsPanel({ loadId, vehicleMaxPallets, vehicleMaxWeight }: LoadItemsPanelProps) {
  const { data: items = [], isLoading } = useLoadItems(loadId);
  const { data: orders = [] } = useOrders();
  const createItem = useCreateLoadItem();
  const deleteItem = useDeleteLoadItem();
  const updateItem = useUpdateLoadItem();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    order_id: '',
    item_description: '',
    quantity: 0,
    pallet_count: 0,
    weight_kg: 0,
  });

  const totalPallets = items.reduce((s, i) => s + i.pallet_count, 0);
  const totalWeight = items.reduce((s, i) => s + (i.weight_kg || 0), 0);
  const palletOccupancy = vehicleMaxPallets ? Math.round((totalPallets / vehicleMaxPallets) * 100) : null;
  const weightOccupancy = vehicleMaxWeight ? Math.round((totalWeight / vehicleMaxWeight) * 100) : null;
  const isOverPallets = palletOccupancy !== null && palletOccupancy > 100;
  const isOverWeight = weightOccupancy !== null && weightOccupancy > 100;

  const handleAdd = async () => {
    const newPallets = totalPallets + form.pallet_count;
    if (vehicleMaxPallets && newPallets > vehicleMaxPallets) {
      toast({ title: 'Capacidade excedida', description: `Máx: ${vehicleMaxPallets} paletes. Atual + novo: ${newPallets}`, variant: 'destructive' });
      return;
    }
    try {
      await createItem.mutateAsync({
        load_id: loadId,
        order_id: form.order_id || null,
        item_description: form.item_description || orders.find(o => o.id === form.order_id)?.order_number || 'Item',
        quantity: form.quantity,
        pallet_count: form.pallet_count,
        weight_kg: form.weight_kg,
      } as any);
      setAddOpen(false);
      setForm({ order_id: '', item_description: '', quantity: 0, pallet_count: 0, weight_kg: 0 });
      toast({ title: 'Item adicionado' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleStatusChange = async (item: LoadItem, status: string) => {
    try {
      await updateItem.mutateAsync({ id: item.id, status } as any);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const statusColor = (s: string) => {
    if (['delivered'].includes(s)) return 'bg-success/10 text-success';
    if (['in_transit', 'loaded'].includes(s)) return 'bg-blue-500/10 text-blue-500';
    if (['divergence', 'return'].includes(s)) return 'bg-destructive/10 text-destructive';
    if (['picking', 'in_loading', 'ready_for_load'].includes(s)) return 'bg-primary/10 text-primary';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Itens da Carga</CardTitle>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-3 w-3 mr-1" /> Adicionar Item</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Adicionar Item à Carga</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Pedido (opcional)</Label>
                  <Select value={form.order_id} onValueChange={v => setForm(f => ({ ...f, order_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Vincular a pedido" /></SelectTrigger>
                    <SelectContent>
                      {orders.filter(o => !['delivered', 'cancelled'].includes(o.status)).map(o => (
                        <SelectItem key={o.id} value={o.id}>
                          {o.order_number} — {o.clients?.company_name || 'Sem cliente'} ({o.pallet_count} pal)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Descrição</Label><Input value={form.item_description} onChange={e => setForm(f => ({ ...f, item_description: e.target.value }))} placeholder="Descrição do item" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))} /></div>
                  <div><Label>Paletes</Label><Input type="number" value={form.pallet_count} onChange={e => setForm(f => ({ ...f, pallet_count: parseInt(e.target.value) || 0 }))} /></div>
                  <div><Label>Peso (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: parseFloat(e.target.value) || 0 }))} /></div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
                  <Button onClick={handleAdd} disabled={createItem.isPending}>Adicionar</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Capacity indicators */}
        {(vehicleMaxPallets || vehicleMaxWeight) && (
          <div className="grid grid-cols-2 gap-4">
            {vehicleMaxPallets && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Paletes</span>
                  <span className={isOverPallets ? 'text-destructive font-bold' : ''}>{totalPallets} / {vehicleMaxPallets}</span>
                </div>
                <Progress value={Math.min(palletOccupancy!, 100)} className={isOverPallets ? '[&>div]:bg-destructive' : ''} />
                {isOverPallets && (
                  <div className="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Excede capacidade!
                  </div>
                )}
              </div>
            )}
            {vehicleMaxWeight && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Peso</span>
                  <span className={isOverWeight ? 'text-destructive font-bold' : ''}>{totalWeight} / {vehicleMaxWeight} kg</span>
                </div>
                <Progress value={Math.min(weightOccupancy!, 100)} className={isOverWeight ? '[&>div]:bg-destructive' : ''} />
                {isOverWeight && (
                  <div className="flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3 w-3" /> Excede capacidade!
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Pedido</TableHead>
              <TableHead>Qtd</TableHead>
              <TableHead>Paletes</TableHead>
              <TableHead>Peso</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">Carregando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-4">Nenhum item adicionado</TableCell></TableRow>
            ) : items.map(item => (
              <TableRow key={item.id}>
                <TableCell className="text-sm font-medium">{item.item_description || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.orders?.order_number || '—'}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{item.pallet_count}</TableCell>
                <TableCell>{item.weight_kg || '—'}</TableCell>
                <TableCell>
                  <Select value={item.status} onValueChange={v => handleStatusChange(item, v)}>
                    <SelectTrigger className="h-7 text-xs w-36">
                      <Badge variant="outline" className={`${statusColor(item.status)} text-xs`}>
                        {ITEM_STATUS_LABELS[item.status as keyof typeof ITEM_STATUS_LABELS] || item.status}
                      </Badge>
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_STATUSES.map(s => (
                        <SelectItem key={s} value={s}>{ITEM_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem.mutate(item.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
