import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Pencil, Trash2, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

const UF_OPTIONS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

const emptyForm = {
  table_name: '',
  payer_group: '',
  payer: '',
  valid_from: new Date().toISOString().slice(0, 10),
  valid_until: '',
  origin_state: '',
  origin_municipality: '',
  origin_region: '',
  destination_state: '',
  destination_municipality: '',
  destination_region: '',
  distribution_type: '',
  route: '',
  blocked: false,
  rate_percent: '',
  fixed_value: '',
  min_value: '',
  per_kg_value: '',
  per_pallet_value: '',
  cargo_type: '',
  vehicle_type: '',
  body_type: '',
  ctrc_type: '',
  dispatch_value: '',
  tracking_value: '',
  toll_value: '',
  loading_value: '',
  gris_value: '',
  insurance_percent: '',
};

export default function FreightTables() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  // Filters
  const [fGroup, setFGroup] = useState('');
  const [fName, setFName] = useState('');
  const [fUfO, setFUfO] = useState('');
  const [fUfD, setFUfD] = useState('');
  const [fBlocked, setFBlocked] = useState<'all' | 'yes' | 'no'>('no');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['freight_tables', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('freight_tables')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('table_code', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: typeof form & { id?: string }) => {
      if (!currentTenant) throw new Error('Sem tenant');
      const record: any = {
        tenant_id: currentTenant.id,
        table_name: values.table_name,
        payer_group: values.payer_group || null,
        payer: values.payer || null,
        valid_from: values.valid_from,
        valid_until: values.valid_until || null,
        origin_state: values.origin_state || null,
        origin_municipality: values.origin_municipality || null,
        origin_region: values.origin_region || null,
        destination_state: values.destination_state || null,
        destination_municipality: values.destination_municipality || null,
        destination_region: values.destination_region || null,
        distribution_type: values.distribution_type || null,
        route: values.route || null,
        blocked: values.blocked,
        rate_percent: values.rate_percent ? parseFloat(values.rate_percent) : 0,
        fixed_value: values.fixed_value ? parseFloat(values.fixed_value) : 0,
        min_value: values.min_value ? parseFloat(values.min_value) : 0,
        per_kg_value: values.per_kg_value ? parseFloat(values.per_kg_value) : 0,
        per_pallet_value: values.per_pallet_value ? parseFloat(values.per_pallet_value) : 0,
      };
      if (values.id) {
        const { error } = await supabase.from('freight_tables').update(record).eq('id', values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('freight_tables').insert(record);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['freight_tables'] });
      toast.success(editingId ? 'Tabela atualizada' : 'Tabela cadastrada');
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('freight_tables').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['freight_tables'] });
      toast.success('Tabela removida');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setDialogOpen(false);
  }

  function openEdit(r: any) {
    setEditingId(r.id);
    setForm({
      table_name: r.table_name || '',
      payer_group: r.payer_group || '',
      payer: r.payer || '',
      valid_from: r.valid_from || '',
      valid_until: r.valid_until || '',
      origin_state: r.origin_state || '',
      origin_municipality: r.origin_municipality || '',
      origin_region: r.origin_region || '',
      destination_state: r.destination_state || '',
      destination_municipality: r.destination_municipality || '',
      destination_region: r.destination_region || '',
      distribution_type: r.distribution_type || '',
      route: r.route || '',
      blocked: r.blocked || false,
      rate_percent: r.rate_percent ? String(r.rate_percent) : '',
      fixed_value: r.fixed_value ? String(r.fixed_value) : '',
      min_value: r.min_value ? String(r.min_value) : '',
      per_kg_value: r.per_kg_value ? String(r.per_kg_value) : '',
      per_pallet_value: r.per_pallet_value ? String(r.per_pallet_value) : '',
      cargo_type: r.cargo_type || '',
      vehicle_type: r.vehicle_type || '',
      body_type: r.body_type || '',
      ctrc_type: r.ctrc_type || '',
      dispatch_value: r.dispatch_value ? String(r.dispatch_value) : '',
      tracking_value: r.tracking_value ? String(r.tracking_value) : '',
      toll_value: r.toll_value ? String(r.toll_value) : '',
      loading_value: r.loading_value ? String(r.loading_value) : '',
      gris_value: r.gris_value ? String(r.gris_value) : '',
      insurance_percent: r.insurance_percent ? String(r.insurance_percent) : '',
    });
    setDialogOpen(true);
  }

  const filtered = rows.filter((r: any) => {
    if (fGroup && !(r.payer_group || '').toLowerCase().includes(fGroup.toLowerCase())) return false;
    if (fName && !r.table_name.toLowerCase().includes(fName.toLowerCase())) return false;
    if (fUfO && r.origin_state !== fUfO) return false;
    if (fUfD && r.destination_state !== fUfD) return false;
    if (fBlocked === 'yes' && !r.blocked) return false;
    if (fBlocked === 'no' && r.blocked) return false;
    return true;
  });

  const fmtDate = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Frete Automático</h1>
          <p className="text-sm text-muted-foreground">
            Tabelas de frete por grupo pagador, região de origem e destino.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Nova Tabela</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar Tabela de Frete' : 'Nova Tabela de Frete'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Nome da Tabela *</Label>
                <Input value={form.table_name} onChange={(e) => setForm({ ...form, table_name: e.target.value })}
                  placeholder="Ex: TABELA TOZZI JAIBA 6%" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Grupo Pagador</Label>
                  <Input value={form.payer_group} onChange={(e) => setForm({ ...form, payer_group: e.target.value })}
                    placeholder="Ex: TABELA TOZZI" />
                </div>
                <div>
                  <Label>Pagador</Label>
                  <Input value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })}
                    placeholder="Cliente pagador" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Data Limite Início *</Label>
                  <Input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                </div>
                <div>
                  <Label>Data Limite Fim</Label>
                  <Input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
                </div>
              </div>

              <p className="text-xs font-semibold text-muted-foreground pt-2">Origem</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>UF Origem</Label>
                  <Select value={form.origin_state} onValueChange={(v) => setForm({ ...form, origin_state: v === '_' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {UF_OPTIONS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Município Origem</Label>
                  <Input value={form.origin_municipality} onChange={(e) => setForm({ ...form, origin_municipality: e.target.value })} />
                </div>
                <div>
                  <Label>Região Origem</Label>
                  <Input value={form.origin_region} onChange={(e) => setForm({ ...form, origin_region: e.target.value })} />
                </div>
              </div>

              <p className="text-xs font-semibold text-muted-foreground pt-2">Destino</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>UF Destino</Label>
                  <Select value={form.destination_state} onValueChange={(v) => setForm({ ...form, destination_state: v === '_' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_">—</SelectItem>
                      {UF_OPTIONS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Município Destino</Label>
                  <Input value={form.destination_municipality} onChange={(e) => setForm({ ...form, destination_municipality: e.target.value })} />
                </div>
                <div>
                  <Label>Região Destino</Label>
                  <Input value={form.destination_region} onChange={(e) => setForm({ ...form, destination_region: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo Distribuição</Label>
                  <Input value={form.distribution_type} onChange={(e) => setForm({ ...form, distribution_type: e.target.value })} />
                </div>
                <div>
                  <Label>Rota</Label>
                  <Input value={form.route} onChange={(e) => setForm({ ...form, route: e.target.value })} />
                </div>
              </div>

              <p className="text-xs font-semibold text-muted-foreground pt-2">Valores do Frete</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>% Frete</Label>
                  <Input type="number" step="0.01" placeholder="Ex: 6.5"
                    value={form.rate_percent} onChange={(e) => setForm({ ...form, rate_percent: e.target.value })} />
                </div>
                <div>
                  <Label>Valor Fixo (R$)</Label>
                  <Input type="number" step="0.01" placeholder="0.00"
                    value={form.fixed_value} onChange={(e) => setForm({ ...form, fixed_value: e.target.value })} />
                </div>
                <div>
                  <Label>Valor Mínimo (R$)</Label>
                  <Input type="number" step="0.01" placeholder="0.00"
                    value={form.min_value} onChange={(e) => setForm({ ...form, min_value: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>R$/kg</Label>
                  <Input type="number" step="0.0001" placeholder="0.00"
                    value={form.per_kg_value} onChange={(e) => setForm({ ...form, per_kg_value: e.target.value })} />
                </div>
                <div>
                  <Label>R$/Palete</Label>
                  <Input type="number" step="0.01" placeholder="0.00"
                    value={form.per_pallet_value} onChange={(e) => setForm({ ...form, per_pallet_value: e.target.value })} />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch checked={form.blocked} onCheckedChange={(v) => setForm({ ...form, blocked: v })} />
                <Label>Bloqueado</Label>
              </div>

              <Button className="w-full" disabled={!form.table_name || !form.valid_from}
                onClick={() => upsertMutation.mutate({ ...form, id: editingId || undefined })}>
                {editingId ? 'Salvar Alterações' : 'Cadastrar'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Search className="h-4 w-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Grupo Pagador</Label>
              <Input placeholder="Filtrar" value={fGroup} onChange={(e) => setFGroup(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Nome da Tabela</Label>
              <Input placeholder="Filtrar" value={fName} onChange={(e) => setFName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">UF Origem</Label>
              <Select value={fUfO} onValueChange={(v) => setFUfO(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {UF_OPTIONS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">UF Destino</Label>
              <Select value={fUfD} onValueChange={(v) => setFUfD(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {UF_OPTIONS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Bloqueado</Label>
              <Select value={fBlocked} onValueChange={(v: any) => setFBlocked(v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">Não</SelectItem>
                  <SelectItem value="yes">Sim</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Tabelas de Frete
            </CardTitle>
            <Badge variant="secondary">{filtered.length} registro(s)</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Cód.</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Grupo Pagador</TableHead>
                  <TableHead>Pagador</TableHead>
                  <TableHead>Nome da Tabela</TableHead>
                  <TableHead>UF O.</TableHead>
                  <TableHead>UF D.</TableHead>
                  <TableHead>Mun. Origem</TableHead>
                  <TableHead>Mun. Destino</TableHead>
                  <TableHead>Região O.</TableHead>
                  <TableHead>Região D.</TableHead>
                  <TableHead className="text-right">% Frete</TableHead>
                  <TableHead className="text-right">Fixo</TableHead>
                  <TableHead className="text-right">Mín.</TableHead>
                  <TableHead className="w-16">BL</TableHead>
                  <TableHead className="w-20">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={17} className="text-center py-8 text-muted-foreground">Nenhuma tabela encontrada</TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r: any) => (
                    <TableRow key={r.id} className={r.blocked ? 'opacity-50' : ''}>
                      <TableCell className="text-xs font-mono">{r.table_code}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.valid_from)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.valid_until)}</TableCell>
                      <TableCell className="text-xs">{r.payer_group || '*'}</TableCell>
                      <TableCell className="text-xs">{r.payer || '*'}</TableCell>
                      <TableCell className="text-sm font-medium">{r.table_name}</TableCell>
                      <TableCell className="text-xs">{r.origin_state || '*'}</TableCell>
                      <TableCell className="text-xs">{r.destination_state || '*'}</TableCell>
                      <TableCell className="text-xs">{r.origin_municipality || '*'}</TableCell>
                      <TableCell className="text-xs">{r.destination_municipality || '*'}</TableCell>
                      <TableCell className="text-xs">{r.origin_region || '*'}</TableCell>
                      <TableCell className="text-xs">{r.destination_region || '*'}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{r.rate_percent ? `${r.rate_percent}%` : '—'}</TableCell>
                      <TableCell className="text-xs text-right">{r.fixed_value ? `R$ ${Number(r.fixed_value).toFixed(2)}` : '—'}</TableCell>
                      <TableCell className="text-xs text-right">{r.min_value ? `R$ ${Number(r.min_value).toFixed(2)}` : '—'}</TableCell>
                      <TableCell>
                        {r.blocked ? (
                          <Badge variant="destructive" className="text-[10px]">Sim</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Não</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                            onClick={() => { if (confirm('Remover esta tabela?')) deleteMutation.mutate(r.id); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
