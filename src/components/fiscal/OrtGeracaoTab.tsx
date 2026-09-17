import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useClients } from '@/hooks/useClients';
import { useAuth } from '@/hooks/useAuth';
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
import { acknowledgeDurableOperatorCommand, prepareDurableOperatorCommand } from '@/lib/operator/durableOperatorCommand';
import { useQueryClient } from '@tanstack/react-query';

const OPERACAO_LABELS = ['Distribuição', 'Filial', 'Armazenagem', 'Frota'];
const ROMANEIO_LABELS = ['Entrega/Coleta', 'Viagem Direta', 'Retira', 'Transferência', 'Devolução', 'Redespacho/Sub'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha inesperada ao gerar ORT';
}

interface OrtCandidate {
  id: string;
  invoice_number: string | null;
  issue_date: string | null;
  value: number | null;
  pallet_count: number | null;
  weight_kg: number | null;
  remitter: string | null;
  recipient: string | null;
  client_id: string | null;
  clients: { company_name: string | null } | null;
  load_id: string | null;
}

const EMPTY_CANDIDATES: OrtCandidate[] = [];

export default function OrtGeracaoTab() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clients = [], isLoading: clientsLoading, isError: clientsIsError, error: clientsError, refetch: refetchClients } = useClients();
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
  const [searchCriteria, setSearchCriteria] = useState<Record<string, unknown> | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const invalidNfPeriod = Boolean(filters.nfFrom && filters.nfTo && filters.nfFrom > filters.nfTo);
  const invalidLoadPeriod = Boolean(filters.cargFrom && filters.cargTo && filters.cargFrom > filters.cargTo);

  const { data: candidates = EMPTY_CANDIDATES, isLoading, isFetching, isError: candidatesIsError, error: candidatesError, refetch } = useQuery({
    queryKey: ['ort_candidates', currentTenant?.id, searchCriteria],
    enabled: !!currentTenant && !!searchCriteria,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('read_ort_candidates_v1' as never, {
        _tenant_id: currentTenant!.id,
        _filters: searchCriteria,
      } as never);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('O servidor retornou candidatas de ORT inválidas.');
      return data as unknown as OrtCandidate[];
    },
    retry: false,
  });

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([k]) => k), [selected]);
  const totals = useMemo(() => {
    const rows = candidates.filter((candidate) => selected[candidate.id]);
    return {
      count: rows.length,
      value: rows.reduce((sum, candidate) => sum + (Number(candidate.value) || 0), 0),
      pallets: rows.reduce((sum, candidate) => sum + (Number(candidate.pallet_count) || 0), 0),
      weight: rows.reduce((sum, candidate) => sum + (Number(candidate.weight_kg) || 0), 0),
    };
  }, [candidates, selected]);

  const handleSearch = async () => {
    if (invalidNfPeriod || invalidLoadPeriod) {
      toast({ title: 'Período inválido', description: 'A data final deve ser igual ou posterior à inicial.', variant: 'destructive' });
      return;
    }
    const criteria = {
      ...filters,
      operacao: Object.entries(operacao).filter(([, enabled]) => enabled).map(([label]) => label),
      romaneio: Object.entries(romaneio).filter(([, enabled]) => enabled).map(([label]) => label),
      todosRomaneio,
    };
    setSelected({});
    setSearched(true);
    if (JSON.stringify(searchCriteria) === JSON.stringify(criteria)) await refetch();
    else setSearchCriteria(criteria);
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
    setSearchCriteria(null);
  };

  const handleGenerate = async () => {
    if (!currentTenant) {
      toast({ title: 'Tenant não selecionado', variant: 'destructive' });
      return;
    }
    if (selectedIds.length === 0) {
      toast({ title: 'Selecione ao menos uma NF', variant: 'destructive' });
      return;
    }
    if (!user) {
      toast({ title: 'Usuário não autenticado', variant: 'destructive' });
      return;
    }
    setIsGenerating(true);
    try {
      const commandPayload = {
        tenant_id: currentTenant.id,
        document_ids: [...selectedIds].sort(),
        status: 'pendente',
        pickup_at: new Date().toISOString(),
        notes: `Geração automática de ORT • ${selectedIds.length} NF(s)`,
      };
      const pending = await prepareDurableOperatorCommand({
        tenantId: currentTenant.id,
        actorId: user.id,
        action: 'create_ort_pickup',
        entityId: 'new',
        payload: commandPayload,
      });
      const { data, error } = await supabase.rpc('create_ort_pickup_v1' as never, {
        _payload: { ...commandPayload, request_id: pending.requestId },
      } as never);
      if (error) throw error;
      const pickup = data as unknown as { id?: string; pickup_number?: string; linked_count?: number };
      if (!pickup?.id || pickup.linked_count !== selectedIds.length) throw new Error('O servidor não confirmou todos os vínculos da ORT.');
      acknowledgeDurableOperatorCommand(pending);
      await queryClient.invalidateQueries({ queryKey: ['pickup_orders'] });

      toast({
        title: 'ORT gerada',
        description: `Coleta #${pickup.pickup_number} criada com ${selectedIds.length} NF(s).`,
      });
      setSelected({});
      navigate('/pickup-orders');
    } catch (error: unknown) {
      toast({ title: 'Erro ao gerar ORT', description: errorMessage(error), variant: 'destructive' });
    } finally {
      setIsGenerating(false);
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

          {clientsIsError && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
              <span>Não foi possível carregar os clientes. {clientsError instanceof Error ? clientsError.message : 'Tente novamente.'}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchClients()}>Tentar novamente</Button>
            </div>
          )}

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
              <Select disabled={clientsLoading || clientsIsError} value={filters.clientId || 'all'} onValueChange={v => setFilters(f => ({ ...f, clientId: v === 'all' ? '' : v }))}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.company_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">CNPJ</Label>
              <Input value={filters.cnpj} onChange={e => setFilters(f => ({ ...f, cnpj: e.target.value }))} /></div>
            <div><Label className="text-xs">Nota Fiscal</Label>
              <Input value={filters.nota} onChange={e => setFilters(f => ({ ...f, nota: e.target.value }))} /></div>

            <div><Label htmlFor="ort-nf-from" className="text-xs">Emissão NF — de</Label>
              <Input id="ort-nf-from" type="date" max={filters.nfTo || undefined} value={filters.nfFrom} onChange={e => setFilters(f => ({ ...f, nfFrom: e.target.value }))} /></div>
            <div><Label htmlFor="ort-nf-to" className="text-xs">Emissão NF — até</Label>
              <Input id="ort-nf-to" type="date" min={filters.nfFrom || undefined} value={filters.nfTo} onChange={e => setFilters(f => ({ ...f, nfTo: e.target.value }))} /></div>
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

            <div><Label htmlFor="ort-load-from" className="text-xs">Data Carregamento — de</Label>
              <Input id="ort-load-from" type="date" max={filters.cargTo || undefined} value={filters.cargFrom} onChange={e => setFilters(f => ({ ...f, cargFrom: e.target.value }))} /></div>
            <div><Label htmlFor="ort-load-to" className="text-xs">Data Carregamento — até</Label>
              <Input id="ort-load-to" type="date" min={filters.cargFrom || undefined} value={filters.cargTo} onChange={e => setFilters(f => ({ ...f, cargTo: e.target.value }))} /></div>
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

          {(invalidNfPeriod || invalidLoadPeriod) && <p role="alert" className="text-xs text-destructive">A data final deve ser igual ou posterior à inicial.</p>}

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={clearAll}>Limpar</Button>
            <Button size="sm" onClick={handleSearch} disabled={isFetching || invalidNfPeriod || invalidLoadPeriod}>
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
                <Badge variant="outline">{candidatesIsError ? '—' : candidates.length}</Badge>
                {selectedIds.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    • {totals.count} selecionada(s) • R$ {totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • {totals.pallets} plt • {totals.weight.toLocaleString('pt-BR')} kg
                  </span>
                )}
              </div>
              <Button size="sm" onClick={handleGenerate} disabled={isGenerating || candidatesIsError || selectedIds.length === 0}>
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
                        if (v) setSelected(Object.fromEntries(candidates.map((candidate) => [candidate.id, true])));
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
                {candidatesIsError ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-destructive">Não foi possível buscar as NFs candidatas. {candidatesError instanceof Error ? candidatesError.message : ''} <Button variant="link" onClick={() => refetch()}>Tentar novamente</Button></TableCell></TableRow>
                ) : isLoading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Buscando...</TableCell></TableRow>
                ) : candidates.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Nenhuma NF candidata encontrada.</TableCell></TableRow>
                ) : candidates.map((c) => (
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
