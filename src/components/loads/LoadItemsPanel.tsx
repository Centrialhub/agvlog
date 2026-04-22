import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLoadItems, useCreateLoadItem, useDeleteLoadItem, useUpdateLoadItem, ITEM_STATUSES, ITEM_STATUS_LABELS, LoadItem } from '@/hooks/useLoadItems';
import { useOrders } from '@/hooks/useOrders';
import { useTenant } from '@/hooks/useTenant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Plus, Trash2, AlertTriangle, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface LoadItemsPanelProps {
  loadId: string;
  vehicleMaxPallets?: number | null;
  vehicleMaxWeight?: number | null;
}

const DOC_PAGE_SIZE = 25;
const FILTER_DEBOUNCE_MS = 250;

function useDebouncedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}

export default function LoadItemsPanel({ loadId, vehicleMaxPallets, vehicleMaxWeight }: LoadItemsPanelProps) {
  const { data: items = [], isLoading } = useLoadItems(loadId);
  const { data: orders = [] } = useOrders();
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  const createItem = useCreateLoadItem();
  const deleteItem = useDeleteLoadItem();
  const updateItem = useUpdateLoadItem();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [mode, setMode] = useState<'note' | 'manual'>('note');
  const [docFilters, setDocFilters] = useState({ invoice: '', client: '', neighborhood: '' });
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
  const [visibleDocCount, setVisibleDocCount] = useState(DOC_PAGE_SIZE);
  const debouncedDocFilters = useDebouncedValue(docFilters, FILTER_DEBOUNCE_MS);
  const [form, setForm] = useState({
    order_id: '',
    item_description: '',
    quantity: 0,
    pallet_count: 0,
    weight_kg: 0,
  });

  const { data: fiscalDocs = [] } = useQuery({
    queryKey: ['load_item_pull_fiscal_docs', currentTenant?.id, addOpen],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, remitter, recipient, recipient_neighborhood, recipient_city, recipient_state, pallet_count, weight_kg, product_summary, load_id, loads(id, load_number), clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant && addOpen,
  });

  const normalize = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filteredDocs = useMemo(() => {
    const invoice = normalize(debouncedDocFilters.invoice);
    const invoiceDigits = debouncedDocFilters.invoice.replace(/\D/g, '');
    const client = normalize(debouncedDocFilters.client);
    const neighborhood = normalize(debouncedDocFilters.neighborhood);
    const currentDocIds = new Set(items.map(item => item.fiscal_document_id).filter(Boolean));
    return fiscalDocs.filter((doc: any) => {
      if (currentDocIds.has(doc.id)) return false;
      const docInvoice = normalize(doc.invoice_number || '');
      const docInvoiceDigits = String(doc.invoice_number || '').replace(/\D/g, '');
      const docClient = normalize(doc.clients?.company_name || doc.recipient || '');
      const docNeighborhood = normalize(doc.recipient_neighborhood || '');
      if (invoice && !docInvoice.includes(invoice) && (!invoiceDigits || !docInvoiceDigits.includes(invoiceDigits))) return false;
      if (client && !docClient.includes(client)) return false;
      if (neighborhood && !docNeighborhood.includes(neighborhood)) return false;
      return true;
    });
  }, [debouncedDocFilters, fiscalDocs, items]);

  const visibleFilteredDocs = useMemo(() => filteredDocs.slice(0, visibleDocCount), [filteredDocs, visibleDocCount]);

  useEffect(() => {
    setVisibleDocCount(DOC_PAGE_SIZE);
  }, [debouncedDocFilters.invoice, debouncedDocFilters.client, debouncedDocFilters.neighborhood, addOpen]);

  const handleDocListScroll = (event: any) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleFilteredDocs.length < filteredDocs.length) {
      setVisibleDocCount(count => Math.min(count + DOC_PAGE_SIZE, filteredDocs.length));
    }
  };

  const totalPallets = items.reduce((s, i) => s + i.pallet_count, 0);
  const totalWeight = items.reduce((s, i) => s + (i.weight_kg || 0), 0);
  const palletOccupancy = vehicleMaxPallets ? Math.round((totalPallets / vehicleMaxPallets) * 100) : null;
  const weightOccupancy = vehicleMaxWeight ? Math.round((totalWeight / vehicleMaxWeight) * 100) : null;
  const isOverPallets = palletOccupancy !== null && palletOccupancy > 100;
  const isOverWeight = weightOccupancy !== null && weightOccupancy > 100;

  const handleAdd = async () => {
    if (mode === 'note') {
      const docs = fiscalDocs.filter((doc: any) => selectedDocIds.has(doc.id));
      if (docs.length === 0) {
        toast({ title: 'Selecione ao menos uma NF', variant: 'destructive' });
        return;
      }
      const newPallets = totalPallets + docs.reduce((sum: number, doc: any) => sum + (Number(doc.pallet_count) || 0), 0);
      if (vehicleMaxPallets && newPallets > vehicleMaxPallets) {
        toast({ title: 'Capacidade excedida', description: `Máx: ${vehicleMaxPallets} paletes. Atual + novo: ${newPallets}`, variant: 'destructive' });
        return;
      }
      try {
        const previousLoadIds = Array.from(new Set(docs.map((doc: any) => doc.load_id).filter(Boolean)));
        const docIds = docs.map((doc: any) => doc.id);
        await (supabase as any).from('load_items').delete().eq('tenant_id', currentTenant!.id).in('fiscal_document_id', docIds);
        await supabase.from('fiscal_documents').update({ load_id: loadId, updated_at: new Date().toISOString() } as any).in('id', docIds);
        const { error: insertError } = await (supabase as any).from('load_items').insert(docs.map((doc: any) => ({
          tenant_id: currentTenant!.id,
          load_id: loadId,
          fiscal_document_id: doc.id,
          item_description: doc.product_summary || `NF ${doc.invoice_number || ''}`.trim(),
          quantity: 1,
          pallet_count: Number(doc.pallet_count) || 0,
          weight_kg: Number(doc.weight_kg) || 0,
          status: 'pending',
        })));
        if (insertError) throw insertError;
        await refreshLoadTotals([...previousLoadIds, loadId]);
        setAddOpen(false);
        setSelectedDocIds(new Set());
        setDocFilters({ invoice: '', client: '', neighborhood: '' });
        qc.invalidateQueries({ queryKey: ['load_items'] });
        qc.invalidateQueries({ queryKey: ['load_documents'] });
        qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
        toast({ title: 'NF(s) puxada(s) para a carga' });
      } catch (e: any) {
        toast({ title: 'Erro', description: e.message, variant: 'destructive' });
      }
      return;
    }

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

  const refreshLoadTotals = async (loadIds: string[]) => {
    const uniqueLoadIds = Array.from(new Set(loadIds.filter(Boolean)));
    await Promise.all(uniqueLoadIds.map(async id => {
      const { data, error } = await (supabase as any).from('load_items').select('pallet_count, weight_kg, volume_m3').eq('load_id', id);
      if (error) throw error;
      const totals = (data || []).reduce((acc: any, item: any) => ({
        pallet_count: acc.pallet_count + (Number(item.pallet_count) || 0),
        weight_kg: acc.weight_kg + (Number(item.weight_kg) || 0),
        volume_m3: acc.volume_m3 + (Number(item.volume_m3) || 0),
      }), { pallet_count: 0, weight_kg: 0, volume_m3: 0 });
      const { error: updateError } = await supabase.from('loads').update({
        total_pallet_count: totals.pallet_count,
        total_weight_kg: totals.weight_kg,
        total_volume_m3: totals.volume_m3,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id);
      if (updateError) throw updateError;
    }));
  };

  const handleDelete = async (item: LoadItem) => {
    try {
      await deleteItem.mutateAsync(item.id);
      if (item.fiscal_document_id) {
        await supabase.from('fiscal_documents').update({ load_id: null, updated_at: new Date().toISOString() } as any).eq('id', item.fiscal_document_id);
      }
      await refreshLoadTotals([loadId]);
      qc.invalidateQueries({ queryKey: ['load_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      toast({ title: 'NF removida da carga e da geração de CT-e' });
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
            <DialogContent className="max-w-2xl max-h-[82vh] overflow-hidden">
              <DialogHeader><DialogTitle>Adicionar Item à Carga</DialogTitle></DialogHeader>
              <div className="flex max-h-[70vh] flex-col gap-3">
                <div className="flex gap-2 rounded-md bg-muted p-1">
                  <Button type="button" variant={mode === 'note' ? 'secondary' : 'ghost'} size="sm" className="flex-1" onClick={() => setMode('note')}>Puxar NF</Button>
                  <Button type="button" variant={mode === 'manual' ? 'secondary' : 'ghost'} size="sm" className="flex-1" onClick={() => setMode('manual')}>Item manual</Button>
                </div>
                {mode === 'note' ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input value={docFilters.invoice} onChange={e => setDocFilters(f => ({ ...f, invoice: e.target.value }))} placeholder="Nº NF" className="pl-8" />
                      </div>
                      <Input value={docFilters.client} onChange={e => setDocFilters(f => ({ ...f, client: e.target.value }))} placeholder="Cliente" />
                      <Input value={docFilters.neighborhood} onChange={e => setDocFilters(f => ({ ...f, neighborhood: e.target.value }))} placeholder="Bairro" />
                    </div>
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" onScroll={handleDocListScroll}>
                      {filteredDocs.length === 0 ? (
                        <div className="rounded-md border border-border py-6 text-center text-sm text-muted-foreground">Nenhuma NF disponível para esses filtros</div>
                      ) : visibleFilteredDocs.map((doc: any) => {
                        const isSelected = selectedDocIds.has(doc.id);
                        return (
                          <button key={doc.id} type="button" onClick={() => setSelectedDocIds(prev => { const next = new Set(prev); next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id); return next; })} className="flex w-full items-start gap-2 rounded-md border border-border px-3 py-1.5 text-left hover:bg-muted/60">
                            <Checkbox checked={isSelected} className="mt-0.5" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium">NF {doc.invoice_number || '—'} · {doc.clients?.company_name || doc.recipient || 'Sem cliente'}</span>
                              <span className="block text-xs text-muted-foreground">{doc.recipient_neighborhood || 'Sem bairro'} · {doc.pallet_count || 0} pal · {doc.weight_kg || 0} kg{doc.load_id ? ` · sairá da carga ${doc.loads?.load_number || 'atual'}` : ''}</span>
                            </span>
                          </button>
                        );
                      })}
                      {filteredDocs.length > visibleFilteredDocs.length && (
                        <div className="py-2 text-center text-[11px] text-muted-foreground">
                          Role para carregar mais {filteredDocs.length - visibleFilteredDocs.length} NF(s)
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                <div>
                  <Label>Pedido (opcional)</Label>
                  <Select value={form.order_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, order_id: v === '__none__' ? '' : v }))}>
                    <SelectTrigger><SelectValue placeholder="Vincular a pedido" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum</SelectItem>
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
                  </>
                )}
                <div className="flex shrink-0 gap-2 justify-end border-t border-border pt-3">
                  <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
                  <Button onClick={handleAdd} disabled={createItem.isPending}>{mode === 'note' ? 'Puxar NF(s)' : 'Adicionar'}</Button>
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
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(item)}>
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
