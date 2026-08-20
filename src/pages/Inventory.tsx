import { useState, useMemo } from 'react';
import { useInventoryBalances, useInventoryMovements, useInventoryLocations, useCreateMovement, useCreateLocation, MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '@/hooks/useInventory';
import { useClients, useClientsArray } from '@/hooks/useClients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Search, Plus, Warehouse, Package, ArrowDownUp, MapPin, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function MovementForm({ clients, locations, onSave, onCancel }: { clients: any[]; locations: any[]; onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    movement_type: 'inbound' as string,
    location_id: '',
    client_id: '',
    item_description: '',
    quantity: 1,
    pallet_count: 0,
    weight_kg: '',
    notes: '',
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Tipo de Movimento *</Label>
          <Select value={form.movement_type} onValueChange={v => setForm(f => ({ ...f, movement_type: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MOVEMENT_TYPES.map(t => <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABELS[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Local</Label>
          <Select value={form.location_id} onValueChange={v => setForm(f => ({ ...f, location_id: v }))}>
            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
            <SelectContent>
              {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
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
        <Label>Descrição do Item *</Label>
        <Input value={form.item_description} onChange={e => setForm(f => ({ ...f, item_description: e.target.value }))} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div><Label>Quantidade</Label><Input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 0 }))} /></div>
        <div><Label>Paletes</Label><Input type="number" value={form.pallet_count} onChange={e => setForm(f => ({ ...f, pallet_count: parseInt(e.target.value) || 0 }))} /></div>
        <div><Label>Peso (kg)</Label><Input type="number" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} /></div>
      </div>
      <div><Label>Observações</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave({ ...form, location_id: form.location_id || null, client_id: form.client_id || null, weight_kg: form.weight_kg ? Number(form.weight_kg) : null })} disabled={!form.item_description.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

function LocationForm({ onSave, onCancel }: { onSave: (v: any) => void; onCancel: () => void }) {
  const [form, setForm] = useState({ name: '', code: '', description: '' });
  return (
    <div className="space-y-4">
      <div><Label>Nome *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div><Label>Código</Label><Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
      <div><Label>Descrição</Label><Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(form)} disabled={!form.name.trim()}>Salvar</Button>
      </div>
    </div>
  );
}

export default function Inventory() {
  const { data: balances = [], isLoading: balLoading } = useInventoryBalances();
  const { data: movements = [], isLoading: movLoading } = useInventoryMovements();
  const { data: locations = [] } = useInventoryLocations();
  const { data: clients = [] } = useClientsArray();
  const createMovement = useCreateMovement();
  const createLocation = useCreateLocation();
  const [search, setSearch] = useState('');
  const [movDialog, setMovDialog] = useState(false);
  const [locDialog, setLocDialog] = useState(false);
  const { toast } = useToast();

  const filteredBalances = useMemo(() => {
    const q = search.toLowerCase();
    return balances.filter(b => b.item_description.toLowerCase().includes(q) || (b.clients?.company_name || '').toLowerCase().includes(q));
  }, [balances, search]);

  const typeColor = (t: string) => {
    if (t === 'inbound') return 'bg-success/10 text-success';
    if (t === 'outbound') return 'bg-destructive/10 text-destructive';
    if (t === 'transfer') return 'bg-blue-500/10 text-blue-500';
    return 'bg-warning/10 text-warning';
  };

  const handleMovementSave = async (values: any) => {
    try {
      await createMovement.mutateAsync(values);
      toast({ title: 'Movimento registrado' });
      setMovDialog(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleLocationSave = async (values: any) => {
    try {
      await createLocation.mutateAsync(values);
      toast({ title: 'Local criado' });
      setLocDialog(false);
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  // Aging: items in stock for > 30 days
  const stagnant = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return balances.filter(b => b.quantity > 0 && b.first_inbound_at && new Date(b.first_inbound_at).getTime() < cutoff);
  }, [balances]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-primary" /> Estoque
          </h1>
          <p className="text-sm text-muted-foreground">{balances.length} itens em estoque • {stagnant.length} parados há +30 dias</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={locDialog} onOpenChange={setLocDialog}>
            <DialogTrigger asChild><Button variant="outline"><MapPin className="h-4 w-4 mr-2" /> Novo Local</Button></DialogTrigger>
            <DialogContent><DialogHeader><DialogTitle>Novo Local de Estoque</DialogTitle></DialogHeader><LocationForm onSave={handleLocationSave} onCancel={() => setLocDialog(false)} /></DialogContent>
          </Dialog>
          <Dialog open={movDialog} onOpenChange={setMovDialog}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Novo Movimento</Button></DialogTrigger>
            <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Registrar Movimento</DialogTitle></DialogHeader><MovementForm clients={clients} locations={locations} onSave={handleMovementSave} onCancel={() => setMovDialog(false)} /></DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{balances.reduce((s, b) => s + b.pallet_count, 0)}</div><p className="text-xs text-muted-foreground">Paletes em estoque</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold">{locations.length}</div><p className="text-xs text-muted-foreground">Locais cadastrados</p></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-2xl font-bold text-warning">{stagnant.length}</div><p className="text-xs text-muted-foreground">Itens parados +30 dias</p></CardContent></Card>
      </div>

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances"><Package className="h-4 w-4 mr-1" /> Saldos</TabsTrigger>
          <TabsTrigger value="movements"><ArrowDownUp className="h-4 w-4 mr-1" /> Movimentos</TabsTrigger>
          <TabsTrigger value="aging"><Clock className="h-4 w-4 mr-1" /> Aging</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-4">
          <div className="relative max-w-sm mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar item ou cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Paletes</TableHead>
                  <TableHead>Peso (kg)</TableHead>
                  <TableHead>Última Mov.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
                ) : filteredBalances.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum saldo encontrado</TableCell></TableRow>
                ) : filteredBalances.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.item_description}</TableCell>
                    <TableCell className="text-sm">{b.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm">{b.inventory_locations?.name || '—'}</TableCell>
                    <TableCell>{b.quantity}</TableCell>
                    <TableCell>{b.pallet_count}</TableCell>
                    <TableCell>{b.weight_kg || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{b.last_movement_at ? formatDistanceToNow(new Date(b.last_movement_at), { addSuffix: true, locale: ptBR }) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Qtd</TableHead>
                  <TableHead>Paletes</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
                ) : movements.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum movimento registrado</TableCell></TableRow>
                ) : movements.map(m => (
                  <TableRow key={m.id}>
                    <TableCell><Badge variant="outline" className={typeColor(m.movement_type)}>{MOVEMENT_TYPE_LABELS[m.movement_type]}</Badge></TableCell>
                    <TableCell className="font-medium">{m.item_description}</TableCell>
                    <TableCell className="text-sm">{m.clients?.company_name || '—'}</TableCell>
                    <TableCell className="text-sm">{m.inventory_locations?.name || '—'}</TableCell>
                    <TableCell>{m.quantity}</TableCell>
                    <TableCell>{m.pallet_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(m.moved_at), { addSuffix: true, locale: ptBR })}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="aging" className="mt-4">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Paletes</TableHead>
                  <TableHead>Primeira Entrada</TableHead>
                  <TableHead>Dias em Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stagnant.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum item parado há mais de 30 dias</TableCell></TableRow>
                ) : stagnant.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.item_description}</TableCell>
                    <TableCell className="text-sm">{b.clients?.company_name || '—'}</TableCell>
                    <TableCell>{b.pallet_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{b.first_inbound_at ? formatDistanceToNow(new Date(b.first_inbound_at), { addSuffix: true, locale: ptBR }) : '—'}</TableCell>
                    <TableCell className="font-medium text-warning">{b.first_inbound_at ? Math.floor((Date.now() - new Date(b.first_inbound_at).getTime()) / 86400000) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
