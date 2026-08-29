import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useClientCounts,
  useClientsPage,
  useCreateClient,
  useUpdateClient,
  type Client,
  type ClientKindFilter,
  type CreateClientInput,
} from '@/hooks/useClients';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus, Building2, Edit, Check, X, Lock, RefreshCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataPagination } from '@/components/ui/data-pagination';

const PAGE_SIZE = 50;
const CLIENT_KINDS: readonly ClientKindFilter[] = ['all', 'client', 'supplier', 'both'];

export default function Clients() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = searchParams.get('kind');
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [kind, setKind] = useState<ClientKindFilter>(
    CLIENT_KINDS.includes(initialKind as ClientKindFilter) ? initialKind as ClientKindFilter : 'all',
  );
  const [page, setPage] = useState(Math.max(1, Number(searchParams.get('page')) || 1));
  const debouncedSearch = useDebouncedValue(search, 300);
  const {
    data: clientPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useClientsPage({ page, pageSize: PAGE_SIZE, search: debouncedSearch, kind });
  const clients = clientPage?.rows || [];
  const totalCount = clientPage?.totalCount || 0;
  const { data: counts = { clients: 0, suppliers: 0, both: 0, total: 0 } } = useClientCounts();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [defaultNewKind, setDefaultNewKind] = useState<'client' | 'supplier'>('client');
  const { toast } = useToast();

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageStart = totalCount === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(safePage * PAGE_SIZE, totalCount);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, kind]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (kind !== 'all') next.set('kind', kind);
    if (page > 1) next.set('page', String(page));
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, kind, page, setSearchParams]);

  const handleSave = async (values: CreateClientInput) => {
    try {
      if (editingClient) {
        await updateClient.mutateAsync({ id: editingClient.id, ...values });
        toast({ title: 'Cadastro atualizado' });
      } else {
        await createClient.mutateAsync(values);
        toast({ title: values.is_supplier && !values.is_client ? 'Fornecedor criado' : 'Cliente criado' });
      }
      setDialogOpen(false);
      setEditingClient(null);
    } catch (error: unknown) {
      const description = error instanceof Error ? error.message : 'Não foi possível salvar o cadastro.';
      toast({ title: 'Erro', description, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (c: Client) => {
    await updateClient.mutateAsync({ id: c.id, active: !c.active });
    toast({ title: c.active ? 'Cadastro inativado' : 'Cadastro reativado' });
  };

  const openNew = (asSupplier: boolean) => {
    setDefaultNewKind(asSupplier ? 'supplier' : 'client');
    setEditingClient(null);
    setDialogOpen(true);
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Clientes e Fornecedores
          </h1>
          <p className="text-sm text-muted-foreground">
            {counts.total} cadastros — {counts.clients} clientes, {counts.suppliers} fornecedores, {counts.both} ambos
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openNew(true)}>
            <Plus className="h-4 w-4 mr-2" /> Novo Fornecedor
          </Button>
          <Button onClick={() => openNew(false)}>
            <Plus className="h-4 w-4 mr-2" /> Novo Cliente
          </Button>
        </div>
      </div>

      <Tabs value={kind} onValueChange={(v) => setKind(v as ClientKindFilter)}>
        <TabsList>
          <TabsTrigger value="all">Todos ({counts.total})</TabsTrigger>
          <TabsTrigger value="client">Clientes ({counts.clients})</TabsTrigger>
          <TabsTrigger value="supplier">Fornecedores ({counts.suppliers})</TabsTrigger>
          <TabsTrigger value="both">Ambos ({counts.both})</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nome, CNPJ, código, sigla, grupo pagador, cidade..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Código</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Razão Social</TableHead>
                <TableHead>CNPJ/CPF</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Cidade/UF</TableHead>
                <TableHead>Grupo Pagador</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center">
                    <div role="alert" className="flex flex-col items-center gap-3 text-destructive">
                      <span>Não foi possível carregar os cadastros: {error instanceof Error ? error.message : 'erro inesperado'}.</span>
                      <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                        <RefreshCcw className="mr-2 h-4 w-4" /> Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum cadastro encontrado</TableCell></TableRow>
              ) : clients.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs text-muted-foreground">{c.internal_code || '—'}</TableCell>
                  <TableCell className="font-medium">
                    {c.blocked ? <Lock className="inline h-3 w-3 mr-1 text-destructive" /> : null}
                    {c.company_name}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.legal_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.tax_id || '—'}</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex gap-1 flex-wrap">
                      {c.is_client !== false && <Badge variant="outline" className="text-xs">Cliente</Badge>}
                      {c.is_supplier && <Badge variant="secondary" className="text-xs">Fornecedor</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {[c.address_city, c.address_state].filter(Boolean).join('/') || '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.payer_group || '—'}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${c.active ? 'Inativar' : 'Reativar'} ${c.company_name}`}
                      className="h-auto p-0"
                      onClick={() => handleToggleActive(c)}
                    >
                      <Badge variant={c.active ? 'default' : 'secondary'}>
                        {c.active ? <><Check className="h-3 w-3 mr-1" /> Ativo</> : <><X className="h-3 w-3 mr-1" /> Inativo</>}
                      </Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${c.company_name}`}
                      onClick={() => { setEditingClient(c); setDialogOpen(true); }}
                    >
                      <Edit className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataPagination
            page={safePage}
            pageCount={pageCount}
            totalCount={totalCount}
            start={pageStart}
            end={pageEnd}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>

      <ClientFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditingClient(null); }}
        client={editingClient}
        defaultKind={defaultNewKind}
        onSave={handleSave}
      />
    </div>
  );
}
