import { useScopedAlerts } from '@/hooks/useAlertStore';
import { useState, useMemo } from 'react';
import { useOperationalRoutes, useCreateOperationalRoute, useUpdateOperationalRoute, useDeleteOperationalRoute, type OperationalRoute } from '@/hooks/useOperationalRoutes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Pencil, Trash2, Map as MapIcon, X } from 'lucide-react';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { normalizeCity as norm } from '@/lib/utils/normalizeCity';
import { getErrorMessage } from '@/lib/errors';
import { useListFilters } from '@/hooks/useListFilters';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { matchesSearch } from '@/lib/listFilters';


const CLASSIFICATIONS = [
  { value: 'general', label: 'Geral' },
  { value: 'municipality', label: 'Município' },
  { value: 'neighborhood', label: 'Bairro' },
  { value: 'regional', label: 'Regional' },
];

export default function OperationalRoutesPage() {
  const { confirmAction } = useScopedAlerts();
  const toast = useSonnerToast();
  const { filters, setFilter, resetFilters, activeCount } = useListFilters({ search: '', status: 'active', classification: 'all' });
  const { data: routes = [], isLoading } = useOperationalRoutes({ includeInactive: true });
  const createRoute = useCreateOperationalRoute();
  const updateRoute = useUpdateOperationalRoute();
  const deleteRoute = useDeleteOperationalRoute();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', classification: 'general', region_name: '', active: true, destinations: [] as string[],
  });
  const [newDest, setNewDest] = useState('');

  const filtered = routes.filter(row =>
    matchesSearch(filters.search, row.name, row.region_name, row.description, ...row.destinations.map(destination => typeof destination === 'string' ? destination : destination.name))
    && (filters.status === 'all' || row.active === (filters.status === 'active'))
    && (filters.classification === 'all' || row.classification === filters.classification));

  // Detecta cidades presentes em mais de uma rota ativa (duplicatas de cobertura)
  const duplicateCities = useMemo(() => {
    const counts = new Map<string, number>();
    routes.filter(r => r.active).forEach(r => {
      const seen = new Set<string>();
      r.destinations.forEach(destination => {
        const key = norm(typeof destination === 'string' ? destination : destination.name);
        if (key && !seen.has(key)) {
          seen.add(key);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      });
    });
    return counts;
  }, [routes]);

  const hasDuplicate = (r: OperationalRoute) => {
    if (!r.active) return false;
    return r.destinations.some(destination => {
      const key = norm(typeof destination === 'string' ? destination : destination.name);
      return key && (duplicateCities.get(key) || 0) > 1;
    });
  };

  const resetForm = () => {
    setForm({ name: '', description: '', classification: 'general', region_name: '', active: true, destinations: [] });
    setNewDest('');
    setEditingId(null);
    setDialogOpen(false);
  };

  const openEdit = (r: OperationalRoute) => {
    setEditingId(r.id);
    setForm({
      name: r.name || '',
      description: r.description || '',
      classification: r.classification || 'general',
      region_name: r.region_name || '',
      active: r.active !== false,
      destinations: r.destinations.map(destination => typeof destination === 'string' ? destination : destination.name),
    });
    setDialogOpen(true);
  };

  const addDest = () => {
    if (newDest.trim()) {
      setForm(f => ({ ...f, destinations: [...f.destinations, newDest.trim()] }));
      setNewDest('');
    }
  };

  const removeDest = (idx: number) => {
    setForm(f => ({ ...f, destinations: f.destinations.filter((_, i) => i !== idx) }));
  };

  const handleSave = async () => {
    try {
      if (!form.name.trim()) {
        toast.error('Informe o nome da rota');
        return;
      }
      const values: Partial<OperationalRoute> & Pick<OperationalRoute, 'name'> = {
        name: form.name,
        description: form.description || null,
        classification: form.classification,
        region_name: form.region_name || null,
        active: form.active,
        destinations: form.destinations.map(d => ({ name: d })),
      };
      if (editingId) {
        await updateRoute.mutateAsync({ id: editingId, ...values });
        toast.success('Rota atualizada');
      } else {
        await createRoute.mutateAsync(values);
        toast.success('Rota criada');
      }
      resetForm();
    } catch (error: unknown) {
      const msg = getErrorMessage(error, '');
      if (msg.includes('operational_routes_tenant_name_key') || msg.toLowerCase().includes('duplicate')) {
        toast.error('Já existe uma rota ativa com este nome. Renomeie ou desative a existente.');
      } else {
        toast.error(msg || 'Erro ao salvar rota');
      }
    }
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <MapIcon className="h-6 w-6 text-primary" /> Rotas Operacionais
          </h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de rotas para roteirização. Diferente de corredores monitorados (telemetria).
          </p>
        </div>
        <Button onClick={() => { resetForm(); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nova Rota
        </Button>
      </div>

      <ListFilterBar fields={[
        { key: 'search', label: 'Buscar rota', type: 'search', value: filters.search, onChange: value => setFilter('search', value), placeholder: 'Nome, região ou cidade atendida' },
        { key: 'status', label: 'Situação', value: filters.status, onChange: value => setFilter('status', value), options: [{ value: 'all', label: 'Todas' }, { value: 'active', label: 'Ativas' }, { value: 'inactive', label: 'Inativas' }] },
        { key: 'classification', label: 'Classificação', value: filters.classification, onChange: value => setFilter('classification', value), options: [{ value: 'all', label: 'Todas as classificações' }, ...CLASSIFICATIONS] },
      ]} onReset={resetFilters} activeCount={activeCount} resultCount={filtered.length} totalCount={routes.length} loading={isLoading} />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Rotas Cadastradas</CardTitle>
            <Badge variant="secondary">{filtered.length}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Região</TableHead>
                <TableHead>Destinos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma rota encontrada</TableCell></TableRow>
              ) : filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{r.name}</span>
                      {hasDuplicate(r) && (
                        <Badge variant="destructive" className="text-[10px]" title="Cidade coberta por outra rota ativa">Duplicada</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{CLASSIFICATIONS.find(c => c.value === r.classification)?.label || r.classification}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.region_name || '—'}</TableCell>
                  <TableCell className="text-sm">
                    {r.destinations.slice(0, 3).map((d, i) => (
                      <Badge key={i} variant="secondary" className="mr-1 text-xs">{typeof d === 'string' ? d : d.name || '?'}</Badge>
                    ))}
                    {r.destinations.length > 3 && <span className="text-xs text-muted-foreground">+{r.destinations.length - 3}</span>}
                  </TableCell>
                  <TableCell>
                    {r.active ? <Badge className="bg-green-500/10 text-green-600">Ativa</Badge> : <Badge variant="secondary">Inativa</Badge>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={async () => {
                        if (await confirmAction('Excluir esta rota?', { title: 'Excluir rota', confirmLabel: 'Excluir' })) deleteRoute.mutate(r.id, { onSuccess: () => toast.success('Rota removida'), onError: (error: Error) => toast.error(error.message) });
                      }}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={o => { if (!o) resetForm(); setDialogOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? 'Editar Rota' : 'Nova Rota Operacional'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: ROTA NORTE MG" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Classificação</Label>
                <Select value={form.classification} onValueChange={v => setForm({ ...form, classification: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CLASSIFICATIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Região</Label><Input value={form.region_name} onChange={e => setForm({ ...form, region_name: e.target.value })} placeholder="Ex: Norte de Minas" /></div>
            </div>
            <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>

            <div>
              <Label>Destinos da Rota</Label>
              <div className="flex gap-2 mt-1">
                <Input value={newDest} onChange={e => setNewDest(e.target.value)} placeholder="Adicionar destino" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addDest(); } }} />
                <Button variant="outline" size="sm" onClick={addDest}>+</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {form.destinations.map((d, i) => (
                  <Badge key={i} variant="secondary" className="gap-1">
                    {d}
                    <button onClick={() => removeDest(i)}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.active} onCheckedChange={v => setForm({ ...form, active: v })} />
              <Label>Ativa</Label>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!form.name.trim()}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
