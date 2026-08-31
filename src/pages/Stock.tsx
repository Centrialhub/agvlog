import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { usePagination } from '@/hooks/usePagination';
import { DataPagination } from '@/components/ui/data-pagination';
import { useListFilters } from '@/hooks/useListFilters';
import { matchesSearch, matchesDateRange } from '@/lib/listFilters';
import { useState, useMemo } from 'react';
import { useStockItems, useCreateStockItem, useUpdateStockItem, useStockMovements, useCreateStockMovement, StockItem, STOCK_CATEGORIES, STOCK_CATEGORY_LABELS, MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '@/hooks/useStock';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Warehouse, Edit, ArrowDown, ArrowUp } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { format, parseISO } from 'date-fns';
import { getErrorMessage } from '@/lib/errors';

export default function Stock() {
  const toast = useSonnerToast();
  const { data: items = [], isLoading: itemsLoading } = useStockItems();
  const { data: movements = [], isLoading: movementsLoading } = useStockMovements();
  const { data: employees = [] } = useEmployees();
  const createItem = useCreateStockItem();
  const updateItem = useUpdateStockItem();
  const createMovement = useCreateStockMovement();
  const itemFilters = useListFilters({ search: '', category: 'all', quantity: 'all' }, 'item_');
  const movementFilters = useListFilters({ search: '', type: 'all', from: '', to: '' }, 'movement_');
  const { search, category: catFilter, quantity } = itemFilters.filters;
  const [tab, setTab] = useState('items');
  const [itemDialog, setItemDialog] = useState(false);
  const [movDialog, setMovDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | undefined>();

  const [itemForm, setItemForm] = useState({ code: '', name: '', category: 'general' as string, unit: 'un', min_quantity: '', location: '', supplier: '', notes: '' });
  const [movForm, setMovForm] = useState({ stock_item_id: '', movement_type: 'inbound' as string, quantity: '', unit_cost: '', reason: 'purchase', justification: '', responsible_employee_id: '' });

  const filteredItems = useMemo(() => items.filter(item =>
    matchesSearch(search, item.name, item.code, item.supplier, item.location) &&
    (catFilter === 'all' || item.category === catFilter) &&
    (quantity === 'all' || (quantity === 'empty' ? (item.current_quantity ?? 0) <= 0 : (item.min_quantity ?? 0) > 0 && (item.current_quantity ?? 0) <= (item.min_quantity ?? 0)))
  ), [items, search, catFilter, quantity]);
  const filteredMovements = movements.filter(movement =>
    matchesSearch(movementFilters.filters.search, movement.stock_items?.name, movement.reason, movement.employees?.name) &&
    (movementFilters.filters.type === 'all' || movement.movement_type === movementFilters.filters.type) &&
    matchesDateRange(movement.moved_at, movementFilters.filters.from, movementFilters.filters.to)
  );

  const itemPagination = usePagination(filteredItems, { pageSize: 50, resetKey: JSON.stringify(itemFilters.filters) });
  const movementPagination = usePagination(filteredMovements, { pageSize: 50, resetKey: JSON.stringify(movementFilters.filters) });

  const lowStock = useMemo(() => items.filter(i =>
    (i.current_quantity ?? 0) <= (i.min_quantity ?? 0) && (i.min_quantity ?? 0) > 0,
  ), [items]);

  const openCreateItem = () => { setEditingItem(undefined); setItemForm({ code: '', name: '', category: 'general', unit: 'un', min_quantity: '', location: '', supplier: '', notes: '' }); setItemDialog(true); };
  const openEditItem = (i: StockItem) => {
    setEditingItem(i); setItemForm({ code: i.code || '', name: i.name, category: i.category, unit: i.unit, min_quantity: String(i.min_quantity || ''), location: i.location || '', supplier: i.supplier || '', notes: i.notes || '' });
    setItemDialog(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name.trim()) { toast.error('Nome obrigatório'); return; }
    const payload = {
      code: itemForm.code || null,
      name: itemForm.name,
      category: itemForm.category,
      unit: itemForm.unit,
      min_quantity: Number(itemForm.min_quantity) || 0,
      location: itemForm.location || null,
      supplier: itemForm.supplier || null,
      notes: itemForm.notes || null,
    };
    try {
      if (editingItem) await updateItem.mutateAsync({ id: editingItem.id, ...payload });
      else await createItem.mutateAsync(payload);
      setItemDialog(false); toast.success('Item salvo');
    } catch (error) { toast.error(getErrorMessage(error, 'Não foi possível salvar o item.')); }
  };

  const handleSaveMovement = async () => {
    if (!movForm.stock_item_id || !movForm.quantity) { toast.error('Item e quantidade obrigatórios'); return; }
    if (movForm.movement_type === 'adjustment' && !movForm.justification.trim()) { toast.error('Ajustes precisam de justificativa'); return; }
    const qty = Number(movForm.quantity);
    const unitCost = Number(movForm.unit_cost) || 0;
    try {
      await createMovement.mutateAsync({
        stock_item_id: movForm.stock_item_id, movement_type: movForm.movement_type,
        quantity: qty, unit_cost: unitCost, total_cost: qty * unitCost,
        reason: movForm.reason, justification: movForm.justification || null,
        responsible_employee_id: movForm.responsible_employee_id || null,
      });
      setMovDialog(false); toast.success('Movimentação registrada');
    } catch (error) { toast.error(getErrorMessage(error, 'Não foi possível registrar a movimentação.')); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Warehouse className="h-5 w-5" /> Estoque e Almoxarifado</h1>
          <p className="text-sm text-muted-foreground">{items.length} itens cadastrados</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setMovForm({ stock_item_id: '', movement_type: 'inbound', quantity: '', unit_cost: '', reason: 'purchase', justification: '', responsible_employee_id: '' }); setMovDialog(true); }}>
            <ArrowDown className="h-4 w-4 mr-1" /> Movimentar
          </Button>
          <Button size="sm" onClick={openCreateItem}><Plus className="h-4 w-4 mr-1" /> Novo Item</Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Total Itens</p><p className="text-lg font-bold">{items.length}</p></CardContent></Card>
        <Card className={lowStock.length > 0 ? 'border-warning' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Estoque Baixo</p><p className="text-lg font-bold text-warning">{lowStock.length}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Movimentações recentes</p><p className="text-lg font-bold">{movements.length}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="items">Itens</TabsTrigger><TabsTrigger value="movements">Movimentações</TabsTrigger></TabsList>

        <TabsContent value="items" className="space-y-3 mt-3">
          <ListFilterBar activeCount={itemFilters.activeCount} onReset={itemFilters.resetFilters} resultCount={filteredItems.length} totalCount={items.length} loading={itemsLoading} fields={[
            { key: 'search', label: 'Buscar item', type: 'search', placeholder: 'Nome, código, fornecedor ou localização', value: search, onChange: value => itemFilters.setFilter('search', value) },
            { key: 'category', label: 'Categoria', value: catFilter, onChange: value => itemFilters.setFilter('category', value), options: [{ value: 'all', label: 'Todas as categorias' }, ...STOCK_CATEGORIES.map(value => ({ value, label: STOCK_CATEGORY_LABELS[value] }))] },
            { key: 'quantity', label: 'Disponibilidade', value: quantity, onChange: value => itemFilters.setFilter('quantity', value), options: [{ value: 'all', label: 'Todos os itens' }, { value: 'low', label: 'Abaixo ou no mínimo' }, { value: 'empty', label: 'Sem saldo disponível' }] },
          ]} />
          <Card><CardContent className="p-0">
            <Table><TableHeader><TableRow>
              <TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Categoria</TableHead>
              <TableHead className="text-right">Qtd Atual</TableHead><TableHead className="text-right">Mínimo</TableHead>
              <TableHead>Unid</TableHead><TableHead className="w-10"></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {itemsLoading ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow> : filteredItems.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum item encontrado</TableCell></TableRow> : null}
              {itemPagination.items.map(i => (
                <TableRow key={i.id} className={(i.current_quantity ?? 0) <= (i.min_quantity ?? 0) && (i.min_quantity ?? 0) > 0 ? 'bg-warning/5' : ''}>
                  <TableCell className="font-mono text-xs">{i.code || '—'}</TableCell>
                  <TableCell className="font-medium text-sm">{i.name}</TableCell>
                  <TableCell className="text-sm">{STOCK_CATEGORY_LABELS[i.category] || i.category}</TableCell>
                  <TableCell className="text-right font-semibold">{i.current_quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{i.min_quantity}</TableCell>
                  <TableCell className="text-sm">{i.unit}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => openEditItem(i)}><Edit className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody></Table><DataPagination {...itemPagination} onPageChange={itemPagination.setPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-3 space-y-3">
          <ListFilterBar activeCount={movementFilters.activeCount} onReset={movementFilters.resetFilters} resultCount={filteredMovements.length} totalCount={movements.length} loading={movementsLoading} description="Busca nas 500 movimentações mais recentes carregadas." fields={[
            { key: 'search', label: 'Buscar movimento', type: 'search', placeholder: 'Item, motivo ou responsável', value: movementFilters.filters.search, onChange: value => movementFilters.setFilter('search', value) },
            { key: 'type', label: 'Tipo de movimento', value: movementFilters.filters.type, onChange: value => movementFilters.setFilter('type', value), options: [{ value: 'all', label: 'Todos os tipos' }, ...MOVEMENT_TYPES.map(value => ({ value, label: MOVEMENT_TYPE_LABELS[value] }))] },
            { key: 'from', label: 'Movimentação de', type: 'date', value: movementFilters.filters.from, onChange: value => movementFilters.setFilter('from', value), max: movementFilters.filters.to || undefined },
            { key: 'to', label: 'Movimentação até', type: 'date', value: movementFilters.filters.to, onChange: value => movementFilters.setFilter('to', value), min: movementFilters.filters.from || undefined },
          ]} />
          <Card><CardContent className="p-0">
            <Table><TableHeader><TableRow>
              <TableHead>Data</TableHead><TableHead>Item</TableHead><TableHead>Tipo</TableHead>
              <TableHead className="text-right">Qtd</TableHead><TableHead>Motivo</TableHead><TableHead>Responsável</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {movementsLoading ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow> : filteredMovements.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum movimento encontrado</TableCell></TableRow> : null}
              {movementPagination.items.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{format(parseISO(m.moved_at), 'dd/MM/yy HH:mm')}</TableCell>
                  <TableCell className="text-sm font-medium">{m.stock_items?.name || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`text-[10px] ${m.movement_type === 'inbound' ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'}`}>
                    {m.movement_type === 'inbound' ? <ArrowDown className="h-3 w-3 mr-0.5 inline" /> : <ArrowUp className="h-3 w-3 mr-0.5 inline" />}
                    {MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type}
                  </Badge></TableCell>
                  <TableCell className="text-right font-semibold">{m.quantity}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.employees?.name || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table><DataPagination {...movementPagination} onPageChange={movementPagination.setPage} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Item Dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent><DialogHeader><DialogTitle>{editingItem ? 'Editar Item' : 'Novo Item'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Código</Label><Input value={itemForm.code} onChange={e => setItemForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div><Label className="text-xs">Nome *</Label><Input value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Categoria</Label>
              <Select value={itemForm.category} onValueChange={v => setItemForm(f => ({ ...f, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STOCK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{STOCK_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Unidade</Label><Input value={itemForm.unit} onChange={e => setItemForm(f => ({ ...f, unit: e.target.value }))} placeholder="un, lt, kg" /></div>
            <div><Label className="text-xs">Qtd Mínima</Label><Input type="number" value={itemForm.min_quantity} onChange={e => setItemForm(f => ({ ...f, min_quantity: e.target.value }))} /></div>
            <div><Label className="text-xs">Local</Label><Input value={itemForm.location} onChange={e => setItemForm(f => ({ ...f, location: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-3"><Button variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button><Button onClick={handleSaveItem}>Salvar</Button></div>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={movDialog} onOpenChange={setMovDialog}>
        <DialogContent><DialogHeader><DialogTitle>Nova Movimentação</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Item *</Label>
              <Select value={movForm.stock_item_id} onValueChange={v => setMovForm(f => ({ ...f, stock_item_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{items.map(i => <SelectItem key={i.id} value={i.id}>{i.name} ({i.current_quantity} {i.unit})</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Tipo</Label>
              <Select value={movForm.movement_type} onValueChange={v => setMovForm(f => ({ ...f, movement_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MOVEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Quantidade *</Label><Input type="number" value={movForm.quantity} onChange={e => setMovForm(f => ({ ...f, quantity: e.target.value }))} /></div>
            <div><Label className="text-xs">Custo Unitário (R$)</Label><Input type="number" step="0.01" value={movForm.unit_cost} onChange={e => setMovForm(f => ({ ...f, unit_cost: e.target.value }))} /></div>
            <div><Label className="text-xs">Motivo</Label>
              <Select value={movForm.reason} onValueChange={v => setMovForm(f => ({ ...f, reason: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="purchase">Compra</SelectItem><SelectItem value="maintenance">Manutenção</SelectItem><SelectItem value="incident">Ocorrência</SelectItem><SelectItem value="vehicle_use">Uso Veículo</SelectItem><SelectItem value="adjustment">Ajuste</SelectItem><SelectItem value="return">Devolução</SelectItem><SelectItem value="transfer">Transferência</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select>
            </div>
            <div><Label className="text-xs">Responsável</Label>
              <Select value={movForm.responsible_employee_id} onValueChange={v => setMovForm(f => ({ ...f, responsible_employee_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
            </div>
            {movForm.movement_type === 'adjustment' && (
              <div className="col-span-2"><Label className="text-xs">Justificativa *</Label><Textarea rows={2} value={movForm.justification} onChange={e => setMovForm(f => ({ ...f, justification: e.target.value }))} /></div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-3"><Button variant="outline" onClick={() => setMovDialog(false)}>Cancelar</Button><Button onClick={handleSaveMovement}>Registrar</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
