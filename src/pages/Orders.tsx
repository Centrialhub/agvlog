import { useState, useMemo, useCallback } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Search, Plus, ShoppingCart, Edit, DollarSign, FileSearch } from 'lucide-react';
import { getNextStatuses } from '@/lib/statusPipeline';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import FreightAuditDrawer from '@/components/freight/FreightAuditDrawer';

const n = (v: any) => (v ? Number(v) : 0);
const numField = (label: string, value: any, onChange: (v: string) => void, opts?: { step?: string; prefix?: string }) => (
  <div>
    <Label>{label}</Label>
    <Input type="number" step={opts?.step || '0.01'} placeholder="0,00" value={value || ''} onChange={e => onChange(e.target.value)} />
  </div>
);

function OrderForm({ order, clients, onSave, onCancel }: { order?: Order; clients: any[]; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Record<string, any>>({
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
    city: order?.city || '',
    neighborhood: order?.neighborhood || '',
    remitter: order?.remitter || '',
    recipient: order?.recipient || '',
    nf_series: order?.nf_series || '',
    issue_date: order?.issue_date || '',
    value: order?.value || '',
    payment_plan: order?.payment_plan || '',
    payer_type: order?.payer_type || 'CIF',
    freight_weight_value: order?.freight_weight_value || '',
    freight_delivery_value: order?.freight_delivery_value || '',
    insurance_value: order?.insurance_value || '',
    insurance_percent: order?.insurance_percent || '',
    toll_value: order?.toll_value || '',
    loading_value: order?.loading_value || '',
    tracking_value: order?.tracking_value || '',
    gris_value: order?.gris_value || '',
    other_costs: order?.other_costs || '',
    icms_base: order?.icms_base || '',
    icms_rate: order?.icms_rate || '',
    icms_value: order?.icms_value || '',
    pis_rate: order?.pis_rate ?? '0.65',
    pis_value: order?.pis_value || '',
    cofins_rate: order?.cofins_rate ?? '3',
    cofins_value: order?.cofins_value || '',
    total_freight: order?.total_freight || '',
    discount_value: order?.discount_value || '',
    subtotal: order?.subtotal || '',
    financial_value: order?.financial_value || '',
    cbs_base: order?.cbs_base || '',
    cbs_rate: order?.cbs_rate ?? '0.90',
    cbs_value: order?.cbs_value || '',
    ibs_base: order?.ibs_base || '',
    ibs_rate: order?.ibs_rate ?? '0.10',
    ibs_value: order?.ibs_value || '',
  });

  const set = useCallback((key: string, val: any) => setForm(f => ({ ...f, [key]: val })), []);

  // Auto-calculate totals
  const calcTotals = useCallback(() => {
    setForm(prev => {
      const fw = n(prev.freight_weight_value);
      const fd = n(prev.freight_delivery_value);
      const ins = n(prev.insurance_value);
      const toll = n(prev.toll_value);
      const load = n(prev.loading_value);
      const track = n(prev.tracking_value);
      const gris = n(prev.gris_value);
      const other = n(prev.other_costs);
      const sub = fw + fd + ins + toll + load + track + gris + other;
      const disc = n(prev.discount_value);
      const total = Math.max(sub - disc, 0);

      const icmsBase = n(prev.icms_base) || total;
      const icmsRate = n(prev.icms_rate);
      const icmsVal = icmsBase * icmsRate / 100;
      const pisRate = n(prev.pis_rate);
      const pisVal = total * pisRate / 100;
      const cofinsRate = n(prev.cofins_rate);
      const cofinsVal = total * cofinsRate / 100;
      const cbsBase = n(prev.cbs_base) || total;
      const cbsRate = n(prev.cbs_rate);
      const cbsVal = cbsBase * cbsRate / 100;
      const ibsBase = n(prev.ibs_base) || total;
      const ibsRate = n(prev.ibs_rate);
      const ibsVal = ibsBase * ibsRate / 100;

      return {
        ...prev,
        subtotal: sub.toFixed(2),
        total_freight: total.toFixed(2),
        icms_value: icmsVal.toFixed(2),
        pis_value: pisVal.toFixed(2),
        cofins_value: cofinsVal.toFixed(2),
        cbs_value: cbsVal.toFixed(2),
        ibs_value: ibsVal.toFixed(2),
        financial_value: (total - icmsVal - pisVal - cofinsVal - cbsVal - ibsVal).toFixed(2),
      };
    });
  }, []);

  const handleSubmit = () => {
    const numFields = [
      'quantity', 'weight_kg', 'volume_m3', 'value',
      'freight_weight_value', 'freight_delivery_value', 'insurance_value', 'insurance_percent',
      'toll_value', 'loading_value', 'tracking_value', 'gris_value', 'other_costs',
      'icms_base', 'icms_rate', 'icms_value', 'pis_rate', 'pis_value',
      'cofins_rate', 'cofins_value', 'total_freight', 'discount_value', 'subtotal', 'financial_value',
      'cbs_base', 'cbs_rate', 'cbs_value', 'ibs_base', 'ibs_rate', 'ibs_value',
    ];
    const out: any = { ...form };
    numFields.forEach(k => { out[k] = out[k] ? Number(out[k]) : null; });
    ['client_id', 'remitter', 'recipient', 'nf_series', 'issue_date', 'payment_plan', 'city', 'neighborhood'].forEach(k => { out[k] = out[k] || null; });
    onSave(out);
  };

  return (
    <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-2">
      <Tabs defaultValue="geral">
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="frete">Frete & Custos</TabsTrigger>
          <TabsTrigger value="fiscal">Fiscal / ICMS</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="space-y-4 pt-4">
          <p className="text-xs font-semibold text-muted-foreground">Documento</p>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Nº Pedido *</Label><Input value={form.order_number} onChange={e => set('order_number', e.target.value)} /></div>
            <div><Label>Série NF</Label><Input value={form.nf_series} onChange={e => set('nf_series', e.target.value)} /></div>
            <div><Label>Data Emissão</Label><Input type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Cliente (Carga)</Label>
              <Select value={form.client_id} onValueChange={v => set('client_id', v)}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={form.status}>{ORDER_STATUS_LABELS[form.status as keyof typeof ORDER_STATUS_LABELS] || form.status}</SelectItem>
                  {getNextStatuses(form.status, 'order').map(s => (
                    <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s as keyof typeof ORDER_STATUS_LABELS] || s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs font-semibold text-muted-foreground pt-2">Remetente / Destinatário</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Remetente</Label><Input value={form.remitter} onChange={e => set('remitter', e.target.value)} /></div>
            <div><Label>Destinatário</Label><Input value={form.recipient} onChange={e => set('recipient', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Origem</Label><Input value={form.origin} onChange={e => set('origin', e.target.value)} /></div>
            <div><Label>Destino</Label><Input value={form.destination} onChange={e => set('destination', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cidade</Label><Input value={form.city} onChange={e => set('city', e.target.value)} /></div>
            <div><Label>Bairro</Label><Input value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} /></div>
          </div>
          <p className="text-xs font-semibold text-muted-foreground pt-2">Carga</p>
          <div className="grid grid-cols-4 gap-3">
            <div><Label>Valor NF (R$)</Label><Input type="number" step="0.01" value={form.value} onChange={e => set('value', e.target.value)} /></div>
            <div><Label>Volume (m³)</Label><Input type="number" step="0.01" value={form.volume_m3} onChange={e => set('volume_m3', e.target.value)} /></div>
            <div><Label>Peso (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} /></div>
            <div><Label>Paletes</Label><Input type="number" value={form.pallet_count} onChange={e => set('pallet_count', parseInt(e.target.value) || 0)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Tipo Carga</Label><Input value={form.cargo_type} onChange={e => set('cargo_type', e.target.value)} /></div>
            <div><Label>Qtd</Label><Input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} /></div>
            <div><Label>Plano Pagamento</Label><Input placeholder="Ex: 30/60 dias" value={form.payment_plan} onChange={e => set('payment_plan', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Data Prometida</Label><Input type="date" value={form.promised_date} onChange={e => set('promised_date', e.target.value)} /></div>
            <div>
              <Label>Pagador</Label>
              <RadioGroup value={form.payer_type} onValueChange={v => set('payer_type', v)} className="flex gap-4 pt-1">
                <div className="flex items-center gap-1"><RadioGroupItem value="CIF" id="cif" /><Label htmlFor="cif" className="text-sm">Pago (CIF)</Label></div>
                <div className="flex items-center gap-1"><RadioGroupItem value="FOB" id="fob" /><Label htmlFor="fob" className="text-sm">À pagar (FOB)</Label></div>
                <div className="flex items-center gap-1"><RadioGroupItem value="consignee" id="cons" /><Label htmlFor="cons" className="text-sm">Consignatário</Label></div>
              </RadioGroup>
            </div>
          </div>
          <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
        </TabsContent>

        <TabsContent value="frete" className="space-y-4 pt-4">
          <p className="text-xs font-semibold text-muted-foreground">Componentes do Frete</p>
          <div className="grid grid-cols-3 gap-3">
            {numField('Frete Peso (R$)', form.freight_weight_value, v => set('freight_weight_value', v))}
            {numField('Valor Entrega (R$)', form.freight_delivery_value, v => set('freight_delivery_value', v))}
            {numField('Seguro (R$)', form.insurance_value, v => set('insurance_value', v))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {numField('Pedágio (R$)', form.toll_value, v => set('toll_value', v))}
            {numField('Carga/Descarga (R$)', form.loading_value, v => set('loading_value', v))}
            {numField('GRIS (R$)', form.gris_value, v => set('gris_value', v))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {numField('Rastreamento (R$)', form.tracking_value, v => set('tracking_value', v))}
            {numField('Outros (R$)', form.other_costs, v => set('other_costs', v))}
            {numField('Desconto (R$)', form.discount_value, v => set('discount_value', v))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={calcTotals}>
            <DollarSign className="h-4 w-4 mr-1" /> Calcular Totais
          </Button>
          <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-muted/50 border">
            <div><Label className="text-muted-foreground text-xs">Subtotal</Label><p className="font-semibold">R$ {n(form.subtotal).toFixed(2)}</p></div>
            <div><Label className="text-muted-foreground text-xs">Total Frete</Label><p className="font-semibold text-primary">R$ {n(form.total_freight).toFixed(2)}</p></div>
            <div><Label className="text-muted-foreground text-xs">Valor Financeiro</Label><p className="font-semibold">R$ {n(form.financial_value).toFixed(2)}</p></div>
          </div>
        </TabsContent>

        <TabsContent value="fiscal" className="space-y-4 pt-4">
          <p className="text-xs font-semibold text-muted-foreground">ICMS / Incidência</p>
          <div className="grid grid-cols-3 gap-3">
            {numField('Base ICMS (R$)', form.icms_base, v => set('icms_base', v))}
            {numField('Alíquota ICMS (%)', form.icms_rate, v => set('icms_rate', v))}
            {numField('Valor ICMS (R$)', form.icms_value, v => set('icms_value', v))}
          </div>
          <p className="text-xs font-semibold text-muted-foreground pt-2">PIS / COFINS</p>
          <div className="grid grid-cols-2 gap-3">
            {numField('Alíquota PIS (%)', form.pis_rate, v => set('pis_rate', v))}
            {numField('Valor PIS (R$)', form.pis_value, v => set('pis_value', v))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {numField('Alíquota COFINS (%)', form.cofins_rate, v => set('cofins_rate', v))}
            {numField('Valor COFINS (R$)', form.cofins_value, v => set('cofins_value', v))}
          </div>
          <p className="text-xs font-semibold text-muted-foreground pt-2">CBS / IBS (Reforma Tributária)</p>
          <div className="grid grid-cols-3 gap-3">
            {numField('Base CBS (R$)', form.cbs_base, v => set('cbs_base', v))}
            {numField('Alíquota CBS (%)', form.cbs_rate, v => set('cbs_rate', v))}
            {numField('Valor CBS (R$)', form.cbs_value, v => set('cbs_value', v))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {numField('Base IBS (R$)', form.ibs_base, v => set('ibs_base', v))}
            {numField('Alíquota IBS (%)', form.ibs_rate, v => set('ibs_rate', v))}
            {numField('Valor IBS (R$)', form.ibs_value, v => set('ibs_value', v))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={calcTotals}>
            <DollarSign className="h-4 w-4 mr-1" /> Recalcular
          </Button>
          <div className="p-3 rounded-md bg-muted/50 border">
            <Label className="text-muted-foreground text-xs">Valor Financeiro Líquido</Label>
            <p className="text-lg font-bold text-primary">R$ {n(form.financial_value).toFixed(2)}</p>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 justify-end pt-2">
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
  const [auditOrderId, setAuditOrderId] = useState<string | null>(null);
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
          <DialogContent className="max-w-3xl">
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
                <TableHead className="text-right">Valor NF</TableHead>
                <TableHead className="text-right">Total Frete</TableHead>
                <TableHead>Pgto</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">Nenhum pedido encontrado</TableCell></TableRow>
              ) : filtered.map(o => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">{o.order_number}{o.nf_series ? ` / ${o.nf_series}` : ''}</TableCell>
                  <TableCell className="text-sm">{o.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.remitter || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.recipient || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.issue_date ? format(new Date(o.issue_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell className="text-sm text-right">{o.value ? `R$ ${Number(o.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                  <TableCell className="text-sm text-right font-medium text-primary">{o.total_freight ? `R$ ${Number(o.total_freight).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                  <TableCell className="text-xs">{o.payer_type || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={statusColor(o.status)}>{ORDER_STATUS_LABELS[o.status] || o.status}</Badge></TableCell>
                  <TableCell className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditingOrder(o); setDialogOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    {o.total_freight ? (
                      <Button variant="ghost" size="icon" onClick={() => setAuditOrderId(o.id)} title="Auditoria do frete">
                        <FileSearch className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <FreightAuditDrawer
        open={!!auditOrderId}
        onOpenChange={() => setAuditOrderId(null)}
        entityId={auditOrderId}
        entityType="order"
      />
    </div>
  );
}
