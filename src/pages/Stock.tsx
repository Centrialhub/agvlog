import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { DataPagination } from '@/components/ui/data-pagination';
import { useListFilters } from '@/hooks/useListFilters';
import { useState, useEffect } from 'react';
import { useStockItems, useStockItemsPage, useStockMovementsPage, useStockWorkspaceMetrics, useCreateStockItem, useUpdateStockItem, useCreateStockMovement, StockItem, STOCK_CATEGORIES, STOCK_CATEGORY_LABELS, MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS, MOVEMENT_REASON_LABELS } from '@/hooks/useStock';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Warehouse, Edit, ArrowDown, ArrowUp } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { parseISO } from 'date-fns';
import { getErrorMessage } from '@/lib/errors';
import { useTenant } from '@/hooks/useTenant';

export default function Stock() {
  const toast = useSonnerToast();
  const { currentTenant, currentRole } = useTenant();
  const canManage=currentRole==='owner'||currentRole==='admin';
  const tenantTimeZone=currentTenant?.timezone||'America/Sao_Paulo';
  const createItem = useCreateStockItem();
  const updateItem = useUpdateStockItem();
  const createMovement = useCreateStockMovement();
  const itemFilters = useListFilters({ search: '', category: 'all', quantity: 'all' }, 'item_');
  const movementFilters = useListFilters({ search: '', type: 'all', from: '', to: '' }, 'movement_');
  const { search, category: catFilter, quantity } = itemFilters.filters;
  const [tab, setTab] = useState('items');
  const [itemDialog, setItemDialog] = useState(false);
  const [movDialog, setMovDialog] = useState(false);
  const [itemPage,setItemPage]=useState(1);const [movementPage,setMovementPage]=useState(1);const pageSize=50;
  const itemsQuery=useStockItemsPage(itemFilters.filters,itemPage,pageSize);const items=itemsQuery.data?.rows??[],itemsLoading=itemsQuery.isLoading;
  const movementsQuery=useStockMovementsPage(movementFilters.filters,movementPage,pageSize,tab==='movements');const movements=movementsQuery.data?.rows??[],movementsLoading=movementsQuery.isLoading;
  const metricsQuery=useStockWorkspaceMetrics();const metrics=metricsQuery.data;
  const itemCatalogQuery=useStockItems({enabled:movDialog});const catalogItems=itemCatalogQuery.data??[];
  const employeesQuery=useEmployees({enabled:movDialog});const employees=employeesQuery.data??[];
  const [editingItem, setEditingItem] = useState<StockItem | undefined>();

  const [itemForm, setItemForm] = useState({ code: '', name: '', category: 'general' as string, unit: 'un', min_quantity: '', location: '', supplier: '', notes: '' });
  const [movForm, setMovForm] = useState({ stock_item_id: '', movement_type: 'inbound' as string, adjustment_direction:'decrease' as 'increase'|'decrease', quantity: '', unit_cost: '', reason: 'purchase', justification: '', responsible_employee_id: '' });

  useEffect(()=>{
    setItemDialog(false);setMovDialog(false);setEditingItem(undefined);
    setItemForm({ code: '', name: '', category: 'general', unit: 'un', min_quantity: '', location: '', supplier: '', notes: '' });
  },[currentTenant?.id]);

  const itemTotal=itemsQuery.data?.total??0,movementTotal=movementsQuery.data?.total??0;
  const itemPageCount=Math.max(1,Math.ceil(itemTotal/pageSize)),movementPageCount=Math.max(1,Math.ceil(movementTotal/pageSize));
  const itemPagination={page:itemPage,pageCount:itemPageCount,totalCount:itemTotal,start:itemTotal?(itemPage-1)*pageSize+1:0,end:Math.min(itemTotal,itemPage*pageSize)};
  const movementPagination={page:movementPage,pageCount:movementPageCount,totalCount:movementTotal,start:movementTotal?(movementPage-1)*pageSize+1:0,end:Math.min(movementTotal,movementPage*pageSize)};
  useEffect(()=>setItemPage(1),[search,catFilter,quantity]);
  useEffect(()=>setMovementPage(1),[movementFilters.filters.search,movementFilters.filters.type,movementFilters.filters.from,movementFilters.filters.to]);
  useEffect(()=>{if(itemPage>itemPageCount)setItemPage(itemPageCount);},[itemPage,itemPageCount]);
  useEffect(()=>{if(movementPage>movementPageCount)setMovementPage(movementPageCount);},[movementPage,movementPageCount]);

  const openCreateItem = () => { setEditingItem(undefined); setItemForm({ code: '', name: '', category: 'general', unit: 'un', min_quantity: '', location: '', supplier: '', notes: '' }); setItemDialog(true); };
  const openEditItem = (i: StockItem) => {
    setEditingItem(i); setItemForm({ code: i.code || '', name: i.name, category: i.category, unit: i.unit, min_quantity: String(i.min_quantity || ''), location: i.location || '', supplier: i.supplier || '', notes: i.notes || '' });
    setItemDialog(true);
  };

  const handleSaveItem = async () => {
    if (!itemForm.name.trim()) { toast.error('Nome obrigatório'); return; }
    if (!itemForm.unit.trim()) { toast.error('Unidade obrigatória'); return; }
    if (!Number.isFinite(Number(itemForm.min_quantity)) || Number(itemForm.min_quantity) < 0) { toast.error('A quantidade mínima não pode ser negativa'); return; }
    const payload = {
      code: itemForm.code || null,
      name: itemForm.name.trim(),
      category: itemForm.category,
      unit: itemForm.unit.trim(),
      min_quantity: Number(itemForm.min_quantity) || 0,
      location: itemForm.location.trim() || null,
      supplier: itemForm.supplier.trim() || null,
      notes: itemForm.notes.trim() || null,
    };
    try {
      if (editingItem) await updateItem.mutateAsync({ id: editingItem.id, expected_updated_at: editingItem.updated_at, ...payload });
      else await createItem.mutateAsync(payload);
      setItemDialog(false); toast.success('Item salvo');
    } catch (error) { toast.error(getErrorMessage(error, 'Não foi possível salvar o item.')); }
  };

  const handleSaveMovement = async () => {
    if (!movForm.stock_item_id || !movForm.quantity) { toast.error('Item e quantidade obrigatórios'); return; }
    if (movForm.movement_type === 'adjustment' && !movForm.justification.trim()) { toast.error('Ajustes precisam de justificativa'); return; }
    const qty = Number(movForm.quantity);
    const unitCost = Number(movForm.unit_cost) || 0;
    if (!Number.isFinite(qty) || qty <= 0) { toast.error('A quantidade deve ser positiva'); return; }
    if (!Number.isFinite(unitCost) || unitCost < 0) { toast.error('O custo unitário não pode ser negativo'); return; }
    try {
      await createMovement.mutateAsync({
        stock_item_id: movForm.stock_item_id, movement_type: movForm.movement_type,
        adjustment_direction:movForm.movement_type==='adjustment'?movForm.adjustment_direction:null,
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
          <p className="text-sm text-muted-foreground">{metrics?.itemCount??'—'} itens cadastrados</p>
        </div>
        <div className="flex gap-2">
          {canManage&&<Button size="sm" variant="outline" onClick={() => { setMovForm({ stock_item_id: '', movement_type: 'inbound', adjustment_direction:'decrease', quantity: '', unit_cost: '', reason: 'purchase', justification: '', responsible_employee_id: '' }); setMovDialog(true); }}>
            <ArrowDown className="h-4 w-4 mr-1" /> Movimentar
          </Button>}
          {canManage&&<Button size="sm" onClick={openCreateItem}><Plus className="h-4 w-4 mr-1" /> Novo Item</Button>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Total Itens</p><p className="text-lg font-bold">{metrics?.itemCount??'—'}</p></CardContent></Card>
        <Card className={(metrics?.lowStockCount??0) > 0 ? 'border-warning' : ''}><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Estoque Baixo</p><p className="text-lg font-bold text-warning">{metrics?.lowStockCount??'—'}</p></CardContent></Card>
        <Card><CardContent className="py-3 px-4"><p className="text-[10px] text-muted-foreground uppercase">Movimentações — últimos 30 dias</p><p className="text-lg font-bold">{metrics?.recentMovementCount??'—'}</p></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        {(itemsQuery.isError||metricsQuery.isError||(tab==='movements'&&movementsQuery.isError)||(movDialog&&(employeesQuery.isError||itemCatalogQuery.isError)))&&<Card><CardContent className="py-4" role="alert">Não foi possível carregar itens, movimentos ou responsáveis. Dados indisponíveis não serão tratados como vazios. <Button variant="outline" onClick={()=>void Promise.all([itemsQuery,metricsQuery,movementsQuery,employeesQuery,itemCatalogQuery].filter(query=>query.isError).map(query=>query.refetch()))}>Tentar novamente</Button></CardContent></Card>}
        <TabsList><TabsTrigger value="items">Itens</TabsTrigger><TabsTrigger value="movements">Movimentações</TabsTrigger></TabsList>

        <TabsContent value="items" className="space-y-3 mt-3">
          <ListFilterBar activeCount={itemFilters.activeCount} onReset={itemFilters.resetFilters} resultCount={itemTotal} totalCount={metrics?.itemCount??itemTotal} loading={itemsLoading} fields={[
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
              {itemsLoading ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow> : !itemsQuery.isError&&items.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum item encontrado</TableCell></TableRow> : null}
              {items.map(i => (
                <TableRow key={i.id} className={(i.current_quantity ?? 0) <= (i.min_quantity ?? 0) && (i.min_quantity ?? 0) > 0 ? 'bg-warning/5' : ''}>
                  <TableCell className="font-mono text-xs">{i.code || '—'}</TableCell>
                  <TableCell className="font-medium text-sm">{i.name}{i.active===false&&<Badge variant="outline" className="ml-2">Inativo</Badge>}</TableCell>
                  <TableCell className="text-sm">{STOCK_CATEGORY_LABELS[i.category] || i.category}</TableCell>
                  <TableCell className="text-right font-semibold">{i.current_quantity}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{i.min_quantity}</TableCell>
                  <TableCell className="text-sm">{i.unit}</TableCell>
                  <TableCell>{canManage&&<Button variant="ghost" size="icon" onClick={() => openEditItem(i)}><Edit className="h-4 w-4" /></Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table><DataPagination {...itemPagination} onPageChange={setItemPage} />
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-3 space-y-3">
          <ListFilterBar activeCount={movementFilters.activeCount} onReset={movementFilters.resetFilters} resultCount={movementTotal} totalCount={movementTotal} loading={movementsLoading} description="Busca e filtros executados no histórico completo." fields={[
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
              {movementsLoading ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow> : !movementsQuery.isError&&movements.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum movimento encontrado</TableCell></TableRow> : null}
              {movements.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{new Intl.DateTimeFormat('pt-BR',{timeZone:tenantTimeZone,dateStyle:'short',timeStyle:'short'}).format(parseISO(m.moved_at))}</TableCell>
                  <TableCell className="text-sm font-medium">{m.stock_items?.name || '—'}</TableCell>
                  <TableCell><Badge variant="outline" className={`text-[10px] ${m.movement_type === 'inbound'||m.movement_type==='return'||(m.movement_type==='adjustment'&&m.adjustment_direction==='increase') ? 'bg-green-500/10 text-green-600' : 'bg-orange-500/10 text-orange-600'}`}>
                    {m.movement_type === 'inbound'||m.movement_type==='return'||(m.movement_type==='adjustment'&&m.adjustment_direction==='increase') ? <ArrowDown className="h-3 w-3 mr-0.5 inline" /> : <ArrowUp className="h-3 w-3 mr-0.5 inline" />}
                    {MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type}
                  </Badge></TableCell>
                  <TableCell className="text-right font-semibold">{m.quantity} {m.unit_snapshot||m.stock_items?.unit||''}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{MOVEMENT_REASON_LABELS[m.reason]||m.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.employees?.name || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody></Table><DataPagination {...movementPagination} onPageChange={setMovementPage} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      {/* Item Dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Editar Item' : 'Novo Item'}</DialogTitle>
            <DialogDescription>
              {editingItem
                ? 'Revise a identificação, a categoria e os limites de estoque do item.'
                : 'Cadastre a identificação, a categoria e os limites de estoque do novo item.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Código</Label><Input value={itemForm.code} onChange={e => setItemForm(f => ({ ...f, code: e.target.value }))} /></div>
            <div><Label className="text-xs">Nome *</Label><Input value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Categoria</Label>
              <Select value={itemForm.category} onValueChange={v => setItemForm(f => ({ ...f, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STOCK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{STOCK_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Unidade</Label><Input value={itemForm.unit} onChange={e => setItemForm(f => ({ ...f, unit: e.target.value }))} placeholder="un, lt, kg" /></div>
            <div><Label className="text-xs">Qtd Mínima</Label><Input type="number" min="0" value={itemForm.min_quantity} onChange={e => setItemForm(f => ({ ...f, min_quantity: e.target.value }))} /></div>
            <div><Label className="text-xs">Local</Label><Input value={itemForm.location} onChange={e => setItemForm(f => ({ ...f, location: e.target.value }))} /></div>
            <div><Label className="text-xs">Fornecedor</Label><Input value={itemForm.supplier} onChange={e => setItemForm(f => ({ ...f, supplier: e.target.value }))} /></div>
            <div className="col-span-2"><Label className="text-xs">Observações</Label><Textarea value={itemForm.notes} onChange={e => setItemForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-3"><Button variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button><Button onClick={handleSaveItem}>Salvar</Button></div>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={movDialog} onOpenChange={setMovDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Movimentação</DialogTitle>
            <DialogDescription>
              Registre uma entrada, saída ou ajuste de saldo para um item do estoque.
            </DialogDescription>
          </DialogHeader>
          {createMovement.pendingCommand&&<div role="alert" className="rounded-md border border-warning p-3 text-sm space-y-2"><p>Existe uma movimentação com resultado incerto. Reenvie o mesmo pedido para confirmar o resultado ou descarte-o antes de preencher outro.</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={async()=>{try{await createMovement.recoverPending();setMovDialog(false);toast.success('Movimentação recuperada e confirmada');}catch(error){toast.error(getErrorMessage(error,'Não foi possível recuperar a movimentação.'));}}}>Reenviar pendente</Button><Button type="button" size="sm" variant="ghost" onClick={()=>{createMovement.discardPending();toast.info('Pedido pendente descartado');}}>Descartar pendente</Button></div></div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label className="text-xs">Item *</Label>
              <Select value={movForm.stock_item_id} onValueChange={v => setMovForm(f => ({ ...f, stock_item_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{catalogItems.filter(i=>i.active!==false).map(i => <SelectItem key={i.id} value={i.id}>{i.name} · {i.code||'sem código'} · {STOCK_CATEGORY_LABELS[i.category]||i.category} · {i.location||'sem local'} ({i.current_quantity} {i.unit})</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Tipo</Label>
              <Select value={movForm.movement_type} onValueChange={v => setMovForm(f => ({ ...f, movement_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MOVEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Quantidade *</Label><Input type="number" min="0.0001" step="any" value={movForm.quantity} onChange={e => setMovForm(f => ({ ...f, quantity: e.target.value }))} /></div>
            <div><Label className="text-xs">Custo Unitário (R$)</Label><Input type="number" min="0" step="0.01" value={movForm.unit_cost} onChange={e => setMovForm(f => ({ ...f, unit_cost: e.target.value }))} /></div>
            <div><Label className="text-xs">Motivo</Label>
              <Select value={movForm.reason} onValueChange={v => setMovForm(f => ({ ...f, reason: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="purchase">Compra</SelectItem><SelectItem value="maintenance">Manutenção</SelectItem><SelectItem value="incident">Ocorrência</SelectItem><SelectItem value="vehicle_use">Uso Veículo</SelectItem><SelectItem value="adjustment">Ajuste</SelectItem><SelectItem value="return">Devolução</SelectItem><SelectItem value="transfer">Transferência</SelectItem><SelectItem value="other">Outro</SelectItem></SelectContent></Select>
            </div>
            <div><Label className="text-xs">Responsável</Label>
              <Select value={movForm.responsible_employee_id} onValueChange={v => setMovForm(f => ({ ...f, responsible_employee_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
            </div>
            {movForm.movement_type === 'adjustment' && (
              <><div className="col-span-2"><Label className="text-xs">Direção do ajuste *</Label><Select value={movForm.adjustment_direction} onValueChange={v=>setMovForm(f=>({...f,adjustment_direction:v as 'increase'|'decrease'}))}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="increase">Aumentar saldo</SelectItem><SelectItem value="decrease">Diminuir saldo</SelectItem></SelectContent></Select></div><div className="col-span-2"><Label className="text-xs">Justificativa *</Label><Textarea rows={2} value={movForm.justification} onChange={e => setMovForm(f => ({ ...f, justification: e.target.value }))} /></div></>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-3"><Button variant="outline" onClick={() => setMovDialog(false)}>Cancelar</Button><Button onClick={handleSaveMovement}>Registrar</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
