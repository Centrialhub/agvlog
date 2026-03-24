import { useState, useMemo } from 'react';
import { useClients, useCreateClient, useUpdateClient, Client } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Building2, Edit, Check, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

function ClientForm({ client, onSave, onCancel }: { client?: Client; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    company_name: client?.company_name || '',
    legal_name: client?.legal_name || '',
    tax_id: client?.tax_id || '',
    service_notes: client?.service_notes || '',
    payment_notes: client?.payment_notes || '',
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Nome Fantasia *</Label>
        <Input value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
      </div>
      <div>
        <Label>Razão Social</Label>
        <Input value={form.legal_name} onChange={e => setForm(f => ({ ...f, legal_name: e.target.value }))} />
      </div>
      <div>
        <Label>CNPJ / CPF</Label>
        <Input value={form.tax_id} onChange={e => setForm(f => ({ ...f, tax_id: e.target.value }))} />
      </div>
      <div>
        <Label>Notas de Serviço</Label>
        <Textarea value={form.service_notes} onChange={e => setForm(f => ({ ...f, service_notes: e.target.value }))} />
      </div>
      <div>
        <Label>Notas de Pagamento / Prazo</Label>
        <Textarea value={form.payment_notes} onChange={e => setForm(f => ({ ...f, payment_notes: e.target.value }))} />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(form)} disabled={!form.company_name.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

export default function Clients() {
  const { data: clients = [], isLoading } = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | undefined>();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter(c => c.company_name.toLowerCase().includes(q) || (c.tax_id || '').includes(q));
  }, [clients, search]);

  const handleSave = async (values: any) => {
    try {
      if (editingClient) {
        await updateClient.mutateAsync({ id: editingClient.id, ...values });
        toast({ title: 'Cliente atualizado' });
      } else {
        await createClient.mutateAsync(values);
        toast({ title: 'Cliente criado' });
      }
      setDialogOpen(false);
      setEditingClient(undefined);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (c: Client) => {
    await updateClient.mutateAsync({ id: c.id, active: !c.active } as any);
    toast({ title: c.active ? 'Cliente inativado' : 'Cliente reativado' });
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Clientes
          </h1>
          <p className="text-sm text-muted-foreground">{clients.length} clientes cadastrados</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={v => { setDialogOpen(v); if (!v) setEditingClient(undefined); }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo Cliente</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle>
            </DialogHeader>
            <ClientForm client={editingClient} onSave={handleSave} onCancel={() => { setDialogOpen(false); setEditingClient(undefined); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou CNPJ..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CNPJ/CPF</TableHead>
                <TableHead>Razão Social</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum cliente encontrado</TableCell></TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.company_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.tax_id || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.legal_name || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => handleToggleActive(c)}>
                      {c.active ? <><Check className="h-3 w-3 mr-1" /> Ativo</> : <><X className="h-3 w-3 mr-1" /> Inativo</>}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => { setEditingClient(c); setDialogOpen(true); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
