import { useState, useMemo } from 'react';
import { useFiscalDocuments, useCreateFiscalDocument, DOC_TYPES, DOC_TYPE_LABELS, FiscalDocument } from '@/hooks/useFiscalDocuments';
import { useClients } from '@/hooks/useClients';
import { useOrders } from '@/hooks/useOrders';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

function DocForm({ clients, orders, onSave, onCancel }: { clients: any[]; orders: any[]; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    document_type: 'inbound' as string,
    invoice_number: '',
    access_key: '',
    client_id: '',
    remitter: '',
    recipient: '',
    issue_date: '',
    order_id: '',
    product_summary: '',
    pallet_count: 0,
    weight_kg: '',
    value: '',
  });

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo *</Label>
          <Select value={form.document_type} onValueChange={v => setForm(f => ({ ...f, document_type: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Nº Nota Fiscal</Label>
          <Input value={form.invoice_number} onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))} />
        </div>
      </div>
      <div>
        <Label>Chave de Acesso</Label>
        <Input value={form.access_key} onChange={e => setForm(f => ({ ...f, access_key: e.target.value }))} placeholder="44 dígitos" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Cliente</Label>
          <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Pedido Vinculado</Label>
          <Select value={form.order_id} onValueChange={v => setForm(f => ({ ...f, order_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
            <SelectContent>
              {orders.map(o => <SelectItem key={o.id} value={o.id}>{o.order_number}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>Remetente</Label><Input value={form.remitter} onChange={e => setForm(f => ({ ...f, remitter: e.target.value }))} /></div>
        <div><Label>Destinatário</Label><Input value={form.recipient} onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div><Label>Data Emissão</Label><Input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))} /></div>
        <div><Label>Paletes</Label><Input type="number" value={form.pallet_count} onChange={e => setForm(f => ({ ...f, pallet_count: parseInt(e.target.value) || 0 }))} /></div>
        <div><Label>Peso (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} /></div>
      </div>
      <div><Label>Resumo dos Produtos</Label><Input value={form.product_summary} onChange={e => setForm(f => ({ ...f, product_summary: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave({ ...form, client_id: form.client_id || null, order_id: form.order_id || null, weight_kg: form.weight_kg ? Number(form.weight_kg) : null, value: form.value ? Number(form.value) : null })}>Salvar</Button>
      </div>
    </div>
  );
}

export default function FiscalDocuments() {
  const { data: docs = [], isLoading } = useFiscalDocuments();
  const { data: clients = [] } = useClients();
  const { data: orders = [] } = useOrders();
  const createDoc = useCreateFiscalDocument();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return docs.filter(d => {
      if (q && !(d.invoice_number || '').toLowerCase().includes(q) && !(d.clients?.company_name || '').toLowerCase().includes(q)) return false;
      if (typeFilter !== 'all' && d.document_type !== typeFilter) return false;
      return true;
    });
  }, [docs, search, typeFilter]);

  const handleSave = async (values: any) => {
    try {
      await createDoc.mutateAsync(values);
      toast({ title: 'Documento fiscal criado' });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const typeColor = (t: string) => {
    if (t === 'inbound') return 'bg-success/10 text-success';
    if (t === 'outbound') return 'bg-blue-500/10 text-blue-500';
    return 'bg-warning/10 text-warning';
  };

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Documentos Fiscais
          </h1>
          <p className="text-sm text-muted-foreground">{docs.length} documentos</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Novo Documento</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Novo Documento Fiscal</DialogTitle></DialogHeader>
            <DocForm clients={clients} orders={orders} onSave={handleSave} onCancel={() => setDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar NF ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{DOC_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Nº NF</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Paletes</TableHead>
                <TableHead>Peso (kg)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum documento encontrado</TableCell></TableRow>
              ) : filtered.map(d => (
                <TableRow key={d.id}>
                  <TableCell><Badge variant="outline" className={typeColor(d.document_type)}>{DOC_TYPE_LABELS[d.document_type as keyof typeof DOC_TYPE_LABELS] || d.document_type}</Badge></TableCell>
                  <TableCell className="font-medium">{d.invoice_number || '—'}</TableCell>
                  <TableCell className="text-sm">{d.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.issue_date ? format(new Date(d.issue_date + 'T12:00:00'), 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell className="text-sm">{d.pallet_count || 0}</TableCell>
                  <TableCell className="text-sm">{d.weight_kg ? `${d.weight_kg}` : '—'}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
