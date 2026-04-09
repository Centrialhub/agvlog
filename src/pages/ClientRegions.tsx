import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Search, Pencil, Trash2, MapPin } from 'lucide-react';
import { toast } from 'sonner';

const UF_OPTIONS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

export default function ClientRegions() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  const [filterRegion, setFilterRegion] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterPayer, setFilterPayer] = useState('');
  const [filterMunicipality, setFilterMunicipality] = useState('');
  const [filterUf, setFilterUf] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    client_id: '',
    payer_group: '',
    municipality: '',
    state_code: '',
    region_name: '',
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients_list', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase
        .from('clients')
        .select('id, company_name')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('company_name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: regions = [], isLoading } = useQuery({
    queryKey: ['client_regions', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('client_regions')
        .select('*, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .order('region_name')
        .order('municipality');
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const upsertMutation = useMutation({
    mutationFn: async (values: typeof form & { id?: string }) => {
      if (!currentTenant) throw new Error('Sem tenant');
      const record = {
        tenant_id: currentTenant.id,
        client_id: values.client_id || null,
        payer_group: values.payer_group || null,
        municipality: values.municipality,
        state_code: values.state_code,
        region_name: values.region_name,
      };
      if (values.id) {
        const { error } = await supabase
          .from('client_regions')
          .update(record)
          .eq('id', values.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('client_regions')
          .insert(record);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_regions'] });
      toast.success(editingId ? 'Região atualizada' : 'Região cadastrada');
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_regions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_regions'] });
      toast.success('Região removida');
    },
    onError: (e: any) => toast.error(e.message),
  });

  function resetForm() {
    setForm({ client_id: '', payer_group: '', municipality: '', state_code: '', region_name: '' });
    setEditingId(null);
    setDialogOpen(false);
  }

  function openEdit(r: any) {
    setEditingId(r.id);
    setForm({
      client_id: r.client_id || '',
      payer_group: r.payer_group || '',
      municipality: r.municipality,
      state_code: r.state_code,
      region_name: r.region_name,
    });
    setDialogOpen(true);
  }

  const filtered = regions.filter((r: any) => {
    const clientName = r.clients?.company_name || '';
    if (filterRegion && !r.region_name.toLowerCase().includes(filterRegion.toLowerCase())) return false;
    if (filterClient && !clientName.toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterPayer && !(r.payer_group || '').toLowerCase().includes(filterPayer.toLowerCase())) return false;
    if (filterMunicipality && !r.municipality.toLowerCase().includes(filterMunicipality.toLowerCase())) return false;
    if (filterUf && r.state_code !== filterUf) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Regiões por Cliente</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de regiões para cálculo de frete. Não interfere na roteirização.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" />Nova Região</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? 'Editar Região' : 'Cadastrar Região'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Cliente</Label>
                <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Grupo Pagador</Label>
                <Input
                  value={form.payer_group}
                  onChange={(e) => setForm({ ...form, payer_group: e.target.value })}
                  placeholder="Ex: TABELA SEVERINI"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Município</Label>
                  <Input
                    value={form.municipality}
                    onChange={(e) => setForm({ ...form, municipality: e.target.value })}
                    placeholder="Ex: BERIZAL"
                  />
                </div>
                <div>
                  <Label>UF</Label>
                  <Select value={form.state_code} onValueChange={(v) => setForm({ ...form, state_code: v })}>
                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {UF_OPTIONS.map((uf) => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Região</Label>
                <Input
                  value={form.region_name}
                  onChange={(e) => setForm({ ...form, region_name: e.target.value })}
                  placeholder="Ex: SALINAS + JAIBA"
                />
              </div>
              <Button
                className="w-full"
                disabled={!form.municipality || !form.state_code || !form.region_name}
                onClick={() => upsertMutation.mutate({ ...form, id: editingId || undefined })}
              >
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
              <Label className="text-xs">Região</Label>
              <Input
                placeholder="Filtrar região"
                value={filterRegion}
                onChange={(e) => setFilterRegion(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Input
                placeholder="Filtrar cliente"
                value={filterClient}
                onChange={(e) => setFilterClient(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Grupo Pagador</Label>
              <Input
                placeholder="Filtrar grupo"
                value={filterPayer}
                onChange={(e) => setFilterPayer(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Município</Label>
              <Input
                placeholder="Filtrar município"
                value={filterMunicipality}
                onChange={(e) => setFilterMunicipality(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">UF</Label>
              <Select value={filterUf} onValueChange={(v) => setFilterUf(v === 'all' ? '' : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {UF_OPTIONS.map((uf) => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Regiões Cadastradas
            </CardTitle>
            <Badge variant="secondary">{filtered.length} registro(s)</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Grupo Pagador</TableHead>
                <TableHead>Município</TableHead>
                <TableHead>UF</TableHead>
                <TableHead>Região</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma região encontrada</TableCell>
                </TableRow>
              ) : (
                filtered.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{r.clients?.company_name || '*'}</TableCell>
                    <TableCell className="text-sm">{r.payer_group || '—'}</TableCell>
                    <TableCell className="text-sm font-medium">{r.municipality}</TableCell>
                    <TableCell className="text-sm">{r.state_code}</TableCell>
                    <TableCell className="text-sm">{r.region_name}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => {
                            if (confirm('Remover esta região?')) deleteMutation.mutate(r.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
