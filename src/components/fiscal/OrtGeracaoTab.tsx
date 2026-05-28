import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useClients } from '@/hooks/useClients';
import { useCreatePickupOrder } from '@/hooks/usePickupOrders';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sparkles, Search, FileSpreadsheet, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FilePlus } from 'lucide-react';
import NewManualOrtDialog from '@/components/pickup/NewManualOrtDialog';

const OPERACAO_LABELS = ['Distribuição', 'Filial', 'Armazenagem', 'Frota'];
const ROMANEIO_LABELS = ['Entrega/Coleta', 'Viagem Direta', 'Retira', 'Transferência', 'Devolução', 'Redespacho/Sub'];

export default function OrtGeracaoTab() {
  const { currentTenant } = useTenant();
  const { data: clients = [] } = useClients();
  const createPickup = useCreatePickupOrder();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [filters, setFilters] = useState({
    loteDinamico: '',
    loteControle: '',
    osNumber: '',
    ordemColeta: '',
    referencia: '',
    clientId: '',
    cnpj: '',
    nota: '',
    nfFrom: '',
    nfTo: '',
    romaneioFornecedor: '',
    romaneioDistribuicao: '',
    romexpOrigem: '',
    romaneioExpedicao: '',
    statusCarga: 'all',
    placa: '',
    cargFrom: '',
    cargTo: '',
    fornecedor: '',
  });

  const [operacao, setOperacao] = useState<Record<string, boolean>>({
    Distribuição: true, Filial: true, Armazenagem: true, Frota: false,
  });
  const [romaneio, setRomaneio] = useState<Record<string, boolean>>(
    Object.fromEntries(ROMANEIO_LABELS.map(l => [l, false])),
  );
  const [todosRomaneio, setTodosRomaneio] = useState(true);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [searched, setSearched] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  const { data: candidates = [], isLoading, refetch } = useQuery({
    queryKey: ['ort_candidates', currentTenant?.id, filters],
    enabled: false,
    queryFn: async () => {
      let q = supabase
        .from('fiscal_documents')
        .select('id, invoice_number, issue_date, value, pallet_count, weight_kg, remitter, recipient, client_id, clients(company_name), load_id')
        .eq('tenant_id', currentTenant!.id)
        .eq('document_type', 'inbound')
        .is('pickup_order_id', null)
        .neq('status', 'cancelled')
        .order('issue_date', { ascending: false })
        .limit(500);
      if (filters.nota) q = q.ilike('invoice_number', `%${filters.nota}%`);
      if (filters.clientId) q = q.eq('client_id', filters.clientId);
      if (filters.fornecedor) q = q.ilike('remitter', `%${filters.fornecedor}%`);
      if (filters.nfFrom) q = q.gte('issue_date', filters.nfFrom);
      if (filters.nfTo) q = q.lte('issue_date', filters.nfTo);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([k]) => k), [selected]);
  const totals = useMemo(() => {
    const rows = candidates.filter((c: any) => selected[c.id]);
    return {
      count: rows.length,
      value: rows.reduce((s: number, c: any) => s + (Number(c.value) || 0), 0),
      pallets: rows.reduce((s: number, c: any) => s + (Number(c.pallet_count) || 0), 0),
      weight: rows.reduce((s: number, c: any) => s + (Number(c.weight_kg) || 0), 0),
    };
  }, [candidates, selected]);

  const handleSearch = async () => {
    setSelected({});
    setSearched(true);
    await refetch();
  };

  const clearAll = () => {
    setFilters({
      loteDinamico: '', loteControle: '', osNumber: '', ordemColeta: '', referencia: '',
      clientId: '', cnpj: '', nota: '', nfFrom: '', nfTo: '',
      romaneioFornecedor: '', romaneioDistribuicao: '', romexpOrigem: '', romaneioExpedicao: '',
      statusCarga: 'all', placa: '', cargFrom: '', cargTo: '', fornecedor: '',
    });
    setSelected({});
    setSearched(false);
  };

  const handleGenerate = async () => {
    if (selectedIds.length === 0) {
      toast({ title: 'Selecione ao menos uma NF', variant: 'destructive' });
      return;
    }
    try {
      const pickup = await createPickup.mutateAsync({
        status: 'pendente',
        pickup_at: new Date().toISOString(),
        notes: `Geração automática de ORT • ${selectedIds.length} NF(s)`,
      } as any);

      const { error } = await supabase
        .from('fiscal_documents')
        .update({ pickup_order_id: (pickup as any).id })
        .in('id', selectedIds);
      if (error) throw error;

      toast({
        title: 'ORT gerada',
        description: `Coleta #${(pickup as any).pickup_number} criada com ${selectedIds.length} NF(s).`,
      });
      setSelected({});
      navigate('/pickup-orders');
    } catch (e: any) {
      toast({ title: 'Erro ao gerar ORT', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-primary" /> Geração Automática de ORT
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}>
                <FilePlus className="h-4 w-4 mr-1" /> Criar ORT Manual
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/ingestion')}>
                <Upload className="h-4 w-4 mr-1" /> Importar XML/PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <div><Label className="text-xs">Lote de notas dinâmico</Label>
              <Input value={filters.loteDinamico} onChange={e => setFilters(f => ({ ...f, loteDinamico: e.target.value }))} /></div>
            <div><Label className="text-xs">Lote Controle</Label>
              <Input value={filters.loteControle} onChange={e => setFilters(f => ({ ...f, loteControle: e.target.value }))} /></div>
            <div><Label className="text-xs">Nº OS</Label>
              <Input value={filters.osNumber} onChange={e => setFilters(f => ({ ...f, osNumber: e.target.value }))} /></div>
            <div><Label className="text-xs">Ordem de Coleta</Label>
              <Input value={filters.ordemColeta} onChange={e => setFilters(f => ({ ...f, ordemColeta: e.target.value }))} /></div>

            <div><Label className="text-xs">Nº Referência</Label>
              <Input value={filters.referencia} onChange={e => setFilters(f => ({ ...f, referencia: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={filters.clientId || 'all'} onValueChange={v => setFilters(f => ({ ...f, clientId: v === 'all' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {clients.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">CNPJ</Label>
              <Input value={filters.cnpj} onChange={e => setFilters(f => ({ ...f, cnpj: e.target.value }))} /></div>
            <div><Label className="text-xs">Nota Fiscal</Label>
              <Input value={filters.nota} onChange={e => setFilters(f => ({ ...f, nota: e.target.value }))} /></div>

            <div><Label className="text-xs">Emissão NF — de</Label>
              <Input type="date" value={filters.nfFrom} onChange={e => setFilters(f => ({ ...f, nfFrom: e.target.value }))} /></div>
            <div><Label className="text-xs">Emissão NF — até</Label>
              <Input type="date" value={filters.nfTo} onChange={e => setFilters(f => ({ ...f, nfTo: e.target.value }))} /></div>
            <div><Label className="text-xs">Romaneio do Fornecedor</Label>
              <Input value={filters.romaneioFornecedor} onChange={e => setFilters(f => ({ ...f, romaneioFornecedor: e.target.value }))} /></div>
            <div><Label className="text-xs">Romaneio de Distribuição</Label>
              <Input value={filters.romaneioDistribuicao} onChange={e => setFilters(f => ({ ...f, romaneioDistribuicao: e.target.value }))} /></div>

            <div><Label className="text-xs">Romexp Origem</Label>
              <Input value={filters.romexpOrigem} onChange={e => setFilters(f => ({ ...f, romexpOrigem: e.target.value }))} /></div>
            <div><Label className="text-xs">Romaneio de Expedição</Label>
              <Input value={filters.romaneioExpedicao} onChange={e => setFilters(f => ({ ...f, romaneioExpedicao: e.target.value }))} /></div>
            <div>
              <Label className="text-xs">Status da Carga</Label>
              <Select value={filters.statusCarga} onValueChange={v => setFilters(f => ({ ...f, statusCarga: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="no_load">Sem carga vinculada</SelectItem>
                  <SelectItem value="with_load">Com carga vinculada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Placa</Label>
              <Input value={filters.placa} onChange={e => setFilters(f => ({ ...f, placa: e.target.value }))} /></div>

            <div><Label className="text-xs">Data Carregamento — de</Label>
              <Input type="date" value={filters.cargFrom} onChange={e => setFilters(f => ({ ...f, cargFrom: e.target.value }))} /></div>
            <div><Label className="text-xs">Data Carregamento — até</Label>
              <Input type="date" value={filters.cargTo} onChange={e => setFilters(f => ({ ...f, cargTo: e.target.value }))} /></div>
            <div className="md:col-span-2"><Label className="text-xs">Fornecedor (remetente)</Label>
              <Input value={filters.fornecedor} onChange={e => setFilters(f => ({ ...f, fornecedor: e.target.value }))} /></div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t">
            <div>
              <Label className="text-xs mb-2 block">Operação</Label>
              <div className="flex flex-wrap gap-3">
                {OPERACAO_LABELS.map(l => (
                  <label key={l} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!operacao[l]} onCheckedChange={(v) => setOperacao(o => ({ ...o, [l]: !!v }))} />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Tipo Romaneio Expedição</Label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={todosRomaneio} onCheckedChange={(v) => setTodosRomaneio(!!v)} /> Todos
                </label>
                {ROMANEIO_LABELS.map(l => (
                  <label key={l} className="flex items-center gap-2 text-sm opacity-90">
                    <Checkbox
                      disabled={todosRomaneio}
                      checked={todosRomaneio || !!romaneio[l]}
                      onCheckedChange={(v) => setRomaneio(r => ({ ...r, [l]: !!v }))}
                    /> {l}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={clearAll}>Limpar</Button>
            <Button size="sm" onClick={handleSearch} disabled={isLoading}>
              <Search className="h-4 w-4 mr-1" /> Buscar candidatas
            </Button>
          </div>
        </CardContent>
      </Card>

      {searched && (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium">NFs candidatas</span>
                <Badge variant="outline">{candidates.length}</Badge>
                {selectedIds.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    • {totals.count} selecionada(s) • R$ {totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • {totals.pallets} plt • {totals.weight.toLocaleString('pt-BR')} kg
                  </span>
                )}
              </div>
              <Button size="sm" onClick={handleGenerate} disabled={createPickup.isPending || selectedIds.length === 0}>
                <Sparkles className="h-4 w-4 mr-1" /> Gerar ORT ({selectedIds.length})
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={candidates.length > 0 && selectedIds.length === candidates.length}
                      onCheckedChange={(v) => {
                        if (v) setSelected(Object.fromEntries(candidates.map((c: any) => [c.id, true])));
                        else setSelected({});
                      }}
                    />
                  </TableHead>
                  <TableHead>Nº NF</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Paletes</TableHead>
                  <TableHead className="text-right">Peso (kg)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Buscando...</TableCell></TableRow>
                ) : candidates.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Nenhuma NF candidata encontrada.</TableCell></TableRow>
                ) : candidates.map((c: any) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => setSelected(s => ({ ...s, [c.id]: !s[c.id] }))}>
                    <TableCell onClick={e => e.stopPropagation()}>
                      <Checkbox checked={!!selected[c.id]} onCheckedChange={(v) => setSelected(s => ({ ...s, [c.id]: !!v }))} />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{c.invoice_number || '—'}</TableCell>
                    <TableCell className="text-sm">{c.issue_date || '—'}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate">{c.remitter || '—'}</TableCell>
                    <TableCell className="text-sm">{c.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-right text-sm">{c.value ? `R$ ${Number(c.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                    <TableCell className="text-right text-sm">{c.pallet_count || 0}</TableCell>
                    <TableCell className="text-right text-sm">{c.weight_kg ? Number(c.weight_kg).toLocaleString('pt-BR') : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <NewManualOrtDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={() => navigate('/pickup-orders')}
      />
    </div>
  );
}