import { useState, useMemo } from 'react';
import { useOrders, useCreateOrder, useUpdateOrder, ORDER_STATUSES, ORDER_STATUS_LABELS, Order } from '@/hooks/useOrders';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, ShoppingCart, Edit } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

function OrderForm({ order, clients, onSave, onCancel }: { order?: Order; clients: any[]; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    order_number: order?.order_number || '',
    client_id: order?.client_id || '',
    promised_date: order?.promised_date || '',
    origin: order?.origin || '',
    destination: order?.destination || '',
    cargo_type: order?.cargo_type || '',
    quantity: order?.quantity || '',
    pallet_count: order?.pallet_count || 0,
    weight_kg: order?.weight_kg || '',
    volume_m3: order?.volume_m3 || '',
    notes: order?.notes || '',
    status: order?.status || 'received',
    remitter: order?.remitter || '',
    recipient: order?.recipient || '',
    nf_series: order?.nf_series || '',
    issue_date: order?.issue_date || '',
    value: order?.value || '',
    payment_plan: order?.payment_plan || '',
  });

  const handleSubmit = () => {
    onSave({
      ...form,
      quantity: form.quantity ? Number(form.quantity) : null,
      weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
      volume_m3: form.volume_m3 ? Number(form.volume_m3) : null,
      value: form.value ? Number(form.value) : null,
      client_id: form.client_id || null,
      remitter: form.remitter || null,
      recipient: form.recipient || null,
      nf_series: form.nf_series || null,
      issue_date: form.issue_date || null,
      payment_plan: form.payment_plan || null,
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <p className="text-xs font-semibold text-muted-foreground">Documento</p>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Nº Pedido *</Label>
          <Input value={form.order_number} onChange={e => setForm(f => ({ ...f, order_number: e.target.value }))} />
        </div>
        <div>
          <Label>Série NF</Label>
          <Input value={form.nf_series} onChange={e => setForm(f => ({ ...f, nf_series: e.target.value }))} />
        </div>
        <div>
          <Label>Data Emissão</Label>
          <Input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Cliente (Carga)</Label>
          <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as typeof f.status }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs font-semibold text-muted-foreground pt-2">Remetente / Destinatário</p>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Remetente</Label><Input value={form.remitter} onChange={e => setForm(f => ({ ...f, remitter: e.target.value }))} /></div>
        <div><Label>Destinatário</Label><Input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Origem</Label><Input value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} /></div>
        <div><Label>Destino</Label><Input value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} /></div>
      </div>

      <p className="text-xs font-semibold text-muted-foreground pt-2">Valores e Carga</p>
      <div className="grid grid-cols-4 gap-4">
        <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))} /></div>
        <div><Label>Volume (m³)</Label><Input type="number" step="0.01" value={form.volume_m3} onChange={e => setForm(f => ({ ...f, volume_m3: e.target.value }))} /></div>
        <div><Label>Peso (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} /></div>
        <div><Label>Paletes</Label><Input type="number" value={form.pallet_count} onChange={e => setForm(f => ({ ...f, pallet_count: parseInt(e.target.value) || 0 }))} /></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div><Label>Tipo Carga</Label><Input value={form.cargo_type} onChange={e => setForm(f => ({ ...f, cargo_type: e.target.value }))} /></div>
        <div><Label>Qtd</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} /></div>
        <div><Label>Plano Pagamento</Label><Input placeholder="Ex: 30/60 dias" value={form.payment_plan} onChange={e => setForm(f => ({ ...f, payment_plan: e.target.value }))} /></div>
      </div>
      <div>
        <Label>Data Prometida</Label>
        <Input type="date" value={form.promised_date} onChange={e => setForm(f => ({ ...f, promised_date: e.target.value }))} className="max-w-xs" />
      </div>
      <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={!form.order_number.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

export default function Orders() {
  const { data: orders = [], isLoading } = useOrders();
  const { data: clients = [] } = useClients();
  const createOrder = useCreateOrder();
  const updateOrder = useUpdateOrder();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | undefined>();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter(o => {
      if (q && !o.order_number.toLowerCase().includes(q) && !(o.clients?.company_name || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, search, statusFilter]);

  const handleSave = async (values: any) => {
    try {
      if (editingOrder) {
        await updateOrder.mutateAsync({ id: editingOrder.id, ...values });
        toast({ title: 'Pedido atualizado' });
      } else {
        await createOrder.mutateAsync(values);
        toast({ title: 'Pedido criado' });
      }
      setDialogOpen(false);
      setEditingOrder(undefined);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const statusColor = (s: string) => {
    if (s === 'delivered') return 'bg-success/10 text-success';
    if (s === 'shipped' || s === 'in_transit' || s === 'loading') return 'bg-blue-500/10 text-blue-500';
    if (s === 'cancelled') return 'bg-destructive/10 text-destructive';
    return 'bg-warning/10 text-warning';
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" /> Pedidos
          </h1>
          <p className="text-sm text-muted-foreground">{orders.length} pedidos</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEditingOrder(undefined); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo Pedido</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editingOrder ? 'Editar Pedido' : 'Novo Pedido'}</DialogTitle></DialogHeader>
            <OrderForm order={editingOrder} clients={clients} onSave={handleSave} onCancel={() => { setDialogOpen(false); setEditingOrder(undefined); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar pedido..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {ORDER_STATUSES.map(s => <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pedido</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Remetente</TableHead>
                <TableHead>Destinatário</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Peso</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum pedido encontrado</TableCell></TableRow>
              ) : filtered.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.order_number}{o.nf_series ? ` / ${o.nf_series}` : ''}</TableCell>
                  <TableCell className="text-sm">{o.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.remitter || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.recipient || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.issue_date ? format(new Date(o.issue_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{o.value ? `R$ ${Number(o.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                  <TableCell className="text-sm">{o.weight_kg ? `${o.weight_kg} kg` : '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColor(o.status)}>{ORDER_STATUS_LABELS[o.status] || o.status}</Badge></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => { setEditingOrder(o); setDialogOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
