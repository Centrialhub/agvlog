import { useState, useMemo } from 'react';
import {
  useOperationalEvents, useCreateOperationalEvent, useUpdateOperationalEvent,
  EVENT_TYPES, EVENT_TYPE_LABELS, SEVERITY_LABELS, OperationalEvent,
} from '@/hooks/useOperationalEvents';
import { useLoads } from '@/hooks/useLoads';
import { useClients } from '@/hooks/useClients';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, AlertOctagon, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function OperationalEvents() {
  const { currentTenant } = useTenant();
  const { data: events = [], isLoading } = useOperationalEvents();
  const { data: loads = [] } = useLoads();
  const { data: clients = [] } = useClients();
  const createEvent = useCreateOperationalEvent();
  const updateEvent = useUpdateOperationalEvent();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [dialogOpen, setDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers').select('id, name').eq('tenant_id', currentTenant.id).eq('active', true).order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const [form, setForm] = useState({
    event_type: 'missing_goods' as string,
    severity: 'medium',
    load_id: '',
    client_id: '',
    driver_id: '',
    description: '',
    financial_impact: 0,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return events.filter(e => {
      if (q && !(e.description || '').toLowerCase().includes(q) && !(e.loads?.load_number || '').toLowerCase().includes(q)) return false;
      if (statusFilter === 'open' && e.resolved_at) return false;
      if (statusFilter === 'resolved' && !e.resolved_at) return false;
      return true;
    });
  }, [events, search, statusFilter]);

  const handleCreate = async () => {
    try {
      await createEvent.mutateAsync({
        ...form,
        load_id: form.load_id || null,
        client_id: form.client_id || null,
        driver_id: form.driver_id || null,
      } as any);
      toast({ title: 'Ocorrência registrada' });
      setDialogOpen(false);
      setForm({ event_type: 'missing_goods', severity: 'medium', load_id: '', client_id: '', driver_id: '', description: '', financial_impact: 0 });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const handleResolve = async (evt: OperationalEvent) => {
    try {
      await updateEvent.mutateAsync({ id: evt.id, resolved_at: new Date().toISOString(), resolution: 'Resolvido' } as any);
      toast({ title: 'Ocorrência resolvida' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  const severityColor = (s: string) => {
    if (s === 'critical') return 'bg-destructive/10 text-destructive';
    if (s === 'high') return 'bg-orange-500/10 text-orange-500';
    if (s === 'medium') return 'bg-warning/10 text-warning';
    return 'bg-muted text-muted-foreground';
  };

  const openCount = events.filter(e => !e.resolved_at).length;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-destructive" /> Ocorrências
          </h1>
          <p className="text-sm text-muted-foreground">{openCount} abertas · {events.length} total</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova Ocorrência</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Registrar Ocorrência</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map(t => <SelectItem key={t} value={t}>{EVENT_TYPE_LABELS[t]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Severidade</Label>
                  <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEVERITY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Carga</Label>
                  <Select value={form.load_id} onValueChange={v => setForm(f => ({ ...f, load_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{loads.map(l => <SelectItem key={l.id} value={l.id}>{l.load_number}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{clients.map(c => <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Motorista</Label>
                  <Select value={form.driver_id} onValueChange={v => setForm(f => ({ ...f, driver_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{drivers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label>Descrição</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><Label>Impacto Financeiro (R$)</Label><Input type="number" value={form.financial_impact} onChange={e => setForm(f => ({ ...f, financial_impact: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={createEvent.isPending}>Registrar</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-3 items-center">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="open">Abertas</SelectItem>
            <SelectItem value="resolved">Resolvidas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Severidade</TableHead>
                <TableHead>Carga</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Motorista</TableHead>
                <TableHead>Impacto</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhuma ocorrência</TableCell></TableRow>
              ) : filtered.map(e => (
                <TableRow key={e.id} className={e.resolved_at ? 'opacity-60' : ''}>
                  <TableCell className="text-sm font-medium">{EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] || e.event_type}</TableCell>
                  <TableCell><Badge variant="outline" className={severityColor(e.severity)}>{SEVERITY_LABELS[e.severity] || e.severity}</Badge></TableCell>
                  <TableCell className="text-sm">{e.loads?.load_number || '—'}</TableCell>
                  <TableCell className="text-sm">{e.clients?.company_name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.drivers?.name || '—'}</TableCell>
                  <TableCell className="text-sm">{e.financial_impact ? `R$ ${e.financial_impact.toLocaleString('pt-BR')}` : '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(e.created_at), { addSuffix: true, locale: ptBR })}</TableCell>
                  <TableCell>
                    {!e.resolved_at && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleResolve(e)} title="Resolver">
                        <CheckCircle className="h-4 w-4 text-success" />
                      </Button>
                    )}
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
