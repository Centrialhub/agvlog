import { useState, useMemo } from 'react';
import { useAssets, useCreateAsset, useUpdateAsset, Asset, ASSET_CATEGORIES, ASSET_CATEGORY_LABELS, ASSET_STATUSES, ASSET_STATUS_LABELS } from '@/hooks/useAssets';
import { useEmployees } from '@/hooks/useEmployees';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Package, Edit } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

export default function Assets() {
  const { data: assets = [], isLoading } = useAssets();
  const { data: employees = [] } = useEmployees();
  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | undefined>();

  const [form, setForm] = useState({
    asset_code: '', name: '', category: 'equipment' as string, status: 'available' as string,
    serial_number: '', plate: '', brand: '', model: '',
    responsible_employee_id: '', current_location: '', branch: '', cost_center: '',
    supplier: '', acquisition_date: '', acquisition_cost: '', notes: '',
  });

  const filtered = useMemo(() => {
    let list = assets;
    if (catFilter !== 'all') list = list.filter(a => a.category === catFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(a => a.name.toLowerCase().includes(s) || a.asset_code.toLowerCase().includes(s) || a.serial_number?.toLowerCase().includes(s) || a.plate?.toLowerCase().includes(s));
    }
    return list;
  }, [assets, search, catFilter]);

  const openCreate = () => {
    setEditing(undefined);
    setForm({ asset_code: '', name: '', category: 'equipment', status: 'available', serial_number: '', plate: '', brand: '', model: '', responsible_employee_id: '', current_location: '', branch: '', cost_center: '', supplier: '', acquisition_date: '', acquisition_cost: '', notes: '' });
    setDialogOpen(true);
  };

  const openEdit = (a: Asset) => {
    setEditing(a);
    setForm({
      asset_code: a.asset_code, name: a.name, category: a.category, status: a.status,
      serial_number: a.serial_number || '', plate: a.plate || '', brand: a.brand || '', model: a.model || '',
      responsible_employee_id: a.responsible_employee_id || '', current_location: a.current_location || '',
      branch: a.branch || '', cost_center: a.cost_center || '', supplier: a.supplier || '',
      acquisition_date: a.acquisition_date || '', acquisition_cost: String(a.acquisition_cost || ''), notes: a.notes || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.asset_code.trim() || !form.name.trim()) { toast.error('Código e nome obrigatórios'); return; }
    const payload: any = { ...form, acquisition_cost: form.acquisition_cost ? Number(form.acquisition_cost) : 0 };
    ['responsible_employee_id','acquisition_date'].forEach(k => { if (!payload[k]) payload[k] = null; });
    Object.keys(payload).forEach(k => { if (payload[k] === '') payload[k] = null; });
    payload.asset_code = form.asset_code; payload.name = form.name; payload.category = form.category; payload.status = form.status;
    try {
      if (editing) await updateAsset.mutateAsync({ id: editing.id, ...payload });
      else await createAsset.mutateAsync(payload);
      setDialogOpen(false);
      toast.success(editing ? 'Ativo atualizado' : 'Ativo cadastrado');
    } catch (e: any) { toast.error(e.message); }
  };

  const fmt = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const totalValue = useMemo(() => assets.reduce((s, a) => s + (a.acquisition_cost || 0), 0), [assets]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Package className="h-5 w-5" /> Ativos e Patrimônio</h1>
          <p className="text-sm text-muted-foreground">{assets.length} ativos | Valor total: {fmt(totalValue)}</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Novo Ativo</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {ASSET_STATUSES.map(s => (
          <Card key={s}><CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase">{ASSET_STATUS_LABELS[s]}</p>
            <p className="text-lg font-bold">{assets.filter(a => a.status === s).length}</p>
          </CardContent></Card>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="Buscar código, nome, placa..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todas Categorias</SelectItem>{ASSET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <Card><CardContent className="p-0">
        <Table><TableHeader><TableRow>
          <TableHead>Código</TableHead><TableHead>Nome</TableHead><TableHead>Categoria</TableHead>
          <TableHead>Responsável</TableHead><TableHead>Localização</TableHead><TableHead>Valor</TableHead>
          <TableHead>Status</TableHead><TableHead className="w-10"></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {isLoading ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
          : filtered.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum ativo</TableCell></TableRow>
          : filtered.map(a => (
            <TableRow key={a.id}>
              <TableCell className="font-mono text-xs">{a.asset_code}</TableCell>
              <TableCell className="font-medium text-sm">{a.name}</TableCell>
              <TableCell className="text-sm">{ASSET_CATEGORY_LABELS[a.category] || a.category}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{a.employees?.name || '—'}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{a.current_location || a.branch || '—'}</TableCell>
              <TableCell className="text-sm">{fmt(a.acquisition_cost)}</TableCell>
              <TableCell><Badge variant="outline" className="text-[10px]">{ASSET_STATUS_LABELS[a.status]}</Badge></TableCell>
              <TableCell><Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Edit className="h-4 w-4" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody></Table>
      </CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Ativo' : 'Novo Ativo'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Código Patrimonial *</Label><Input value={form.asset_code} onChange={e => setForm(f => ({ ...f, asset_code: e.target.value }))} /></div>
            <div><Label className="text-xs">Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label className="text-xs">Categoria</Label>
              <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ASSET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{ASSET_CATEGORY_LABELS[c]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ASSET_STATUSES.map(s => <SelectItem key={s} value={s}>{ASSET_STATUS_LABELS[s]}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Nº Série</Label><Input value={form.serial_number} onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))} /></div>
            <div><Label className="text-xs">Placa</Label><Input value={form.plate} onChange={e => setForm(f => ({ ...f, plate: e.target.value }))} /></div>
            <div><Label className="text-xs">Marca</Label><Input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} /></div>
            <div><Label className="text-xs">Modelo</Label><Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div><Label className="text-xs">Responsável</Label>
              <Select value={form.responsible_employee_id} onValueChange={v => setForm(f => ({ ...f, responsible_employee_id: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{employees.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><Label className="text-xs">Localização</Label><Input value={form.current_location} onChange={e => setForm(f => ({ ...f, current_location: e.target.value }))} /></div>
            <div><Label className="text-xs">Filial</Label><Input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} /></div>
            <div><Label className="text-xs">Centro de Custo</Label><Input value={form.cost_center} onChange={e => setForm(f => ({ ...f, cost_center: e.target.value }))} /></div>
            <div><Label className="text-xs">Fornecedor</Label><Input value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} /></div>
            <div><Label className="text-xs">Data Aquisição</Label><Input type="date" value={form.acquisition_date} onChange={e => setForm(f => ({ ...f, acquisition_date: e.target.value }))} /></div>
            <div><Label className="text-xs">Custo Aquisição (R$)</Label><Input type="number" step="0.01" value={form.acquisition_cost} onChange={e => setForm(f => ({ ...f, acquisition_cost: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Observações</Label><Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={createAsset.isPending || updateAsset.isPending}>Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
