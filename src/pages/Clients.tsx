import { useState, useMemo } from 'react';
import { useClients, useClientsArray, useCreateClient, useUpdateClient, Client } from '@/hooks/useClients';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Plus, Building2, Edit, Check, X, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ClientFormDialog } from '@/components/clients/ClientFormDialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type KindFilter = 'all' | 'client' | 'supplier' | 'both';

export default function Clients() {
  const { data: clients = [], isLoading } = useClientsArray();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [kind, setKind] = useState<KindFilter>('all');
  const [defaultNewKind, setDefaultNewKind] = useState<'client' | 'supplier'>('client');
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byKind = clients.filter(c => {
      const isC = c.is_client !== false;
      const isS = c.is_supplier === true;
      if (kind === 'client') return isC && !isS;
      if (kind === 'supplier') return isS && !isC;
      if (kind === 'both') return isC && isS;
      return true;
    });
    if (!q) return byKind;
    return byKind.filter(c =>
      c.company_name.toLowerCase().includes(q) ||
      (c.legal_name || '').toLowerCase().includes(q) ||
      (c.trade_name || '').toLowerCase().includes(q) ||
      (c.tax_id || '').toLowerCase().includes(q) ||
      (c.internal_code || '').toLowerCase().includes(q) ||
      (c.sigla || '').toLowerCase().includes(q) ||
      (c.payer_group || '').toLowerCase().includes(q) ||
      (c.address_city || '').toLowerCase().includes(q)
    );
  }, [clients, search, kind]);

  const counts = useMemo(() => {
    let c = 0, s = 0, b = 0;
    for (const x of clients) {
      const isC = x.is_client !== false;
      const isS = x.is_supplier === true;
      if (isC && isS) b++;
      else if (isC) c++;
      else if (isS) s++;
    }
    return { clients: c, suppliers: s, both: b, total: clients.length };
  }, [clients]);

  const handleSave = async (values: any) => {
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
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (c: Client) => {
    await updateClient.mutateAsync({ id: c.id, active: !c.active } as any);
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

      <Tabs value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
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
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum cadastro encontrado</TableCell></TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => { setEditingClient(c); setDialogOpen(true); }}>
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
                    <Badge
                      variant={c.active ? 'default' : 'secondary'}
                      className="cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); handleToggleActive(c); }}
                    >
                      {c.active ? <><Check className="h-3 w-3 mr-1" /> Ativo</> : <><X className="h-3 w-3 mr-1" /> Inativo</>}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setEditingClient(c); setDialogOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
