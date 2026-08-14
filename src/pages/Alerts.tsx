import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant, useIsAdmin } from '@/hooks/useTenant';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { Bell, CheckCircle2, Eye, EyeOff, Plus, AlertTriangle, Clock, X, Play } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function ProcessButton() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const [running, setRunning] = useState(false);

  if (!isAdmin) return null;

  const handleProcess = async () => {
    if (!currentTenant) return;
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('agvlog-pipeline-run', {
        body: { tenant_id: currentTenant.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Pipeline concluído: ${data.processed_vehicles || 0} veículos, ${data.total_inserted || 0} posições`);
    } catch (e: any) {
      toast.error(`Erro: ${e.message}`);
    }
    setRunning(false);
  };

  return (
    <Button onClick={handleProcess} disabled={running} variant="outline" size="sm">
      <Play className="mr-2 h-4 w-4" />{running ? 'Processando...' : 'Rodar processamento'}
    </Button>
  );
}

export default function Alerts() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bell className="h-6 w-6 text-primary" /> Alertas
          </h1>
          <p className="text-sm text-muted-foreground">Monitore eventos e gerencie regras de alerta</p>
        </div>
        <ProcessButton />
      </div>
      <Tabs defaultValue="instances">
        <TabsList>
          <TabsTrigger value="instances">Alertas Ativos</TabsTrigger>
          <TabsTrigger value="stale-docs">Notas paradas</TabsTrigger>
          <TabsTrigger value="rules">Regras</TabsTrigger>
        </TabsList>
        <TabsContent value="instances" className="mt-4"><AlertInstancesSection /></TabsContent>
        <TabsContent value="stale-docs" className="mt-4"><StaleFiscalDocsSection /></TabsContent>
        <TabsContent value="rules" className="mt-4"><AlertRulesSection /></TabsContent>
      </Tabs>
    </div>
  );
}

function AlertInstancesSection() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('open');

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['alert_instances', currentTenant?.id, statusFilter],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase.from('alert_instances').select('*, vehicles(plate, nickname), alert_rules(rule_type, params)')
        .eq('tenant_id', currentTenant.id).order('opened_at', { ascending: false }).limit(100);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const ackMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alert_instances').update({ status: 'ack' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert_instances'] }); toast.success('Alerta reconhecido'); },
  });

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alert_instances').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert_instances'] }); toast.success('Alerta fechado'); },
  });

  const severityColor = (type: string) => {
    if (type === 'overspeed') return 'destructive';
    if (type === 'offline') return 'secondary';
    return 'default';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Abertos</SelectItem>
            <SelectItem value="ack">Reconhecidos</SelectItem>
            <SelectItem value="closed">Fechados</SelectItem>
            <SelectItem value="all">Todos</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{instances.length} alertas</span>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aberto em</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : instances.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Bell className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  Nenhum alerta {statusFilter === 'open' ? 'aberto' : ''}
                </TableCell></TableRow>
              ) : instances.map((inst: any) => (
                <TableRow key={inst.id}>
                  <TableCell>
                    <Badge variant={severityColor(inst.alert_rules?.rule_type)} className="text-xs">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      {inst.alert_rules?.rule_type || 'unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{inst.vehicles?.plate || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={inst.status === 'open' ? 'destructive' : inst.status === 'ack' ? 'secondary' : 'outline'} className="text-xs">
                      {inst.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(inst.opened_at), { addSuffix: true, locale: ptBR })}
                  </TableCell>
                  <TableCell>
                    {isAdmin && inst.status === 'open' && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => ackMutation.mutate(inst.id)} disabled={ackMutation.isPending}>
                          <Eye className="h-3 w-3 mr-1" />ACK
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => closeMutation.mutate(inst.id)} disabled={closeMutation.isPending}>
                          <X className="h-3 w-3 mr-1" />Fechar
                        </Button>
                      </div>
                    )}
                    {isAdmin && inst.status === 'ack' && (
                      <Button size="sm" variant="ghost" onClick={() => closeMutation.mutate(inst.id)}><X className="h-3 w-3 mr-1" />Fechar</Button>
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

function StaleFiscalDocsSection() {
  const { currentTenant } = useTenant();
  const cutoff = useMemoDate(7);

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['stale_fiscal_docs_without_load', currentTenant?.id, cutoff],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, invoice_number, issue_date, recipient, recipient_neighborhood, recipient_city, recipient_state, remitter, pallet_count, weight_kg, value, status, clients!fiscal_documents_client_id_fkey(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('document_type', 'inbound')
        .is('load_id', null)
        .neq('status', 'cancelled')
        .lte('issue_date', cutoff)
        .order('issue_date', { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-warning" /> Notas com mais de 7 dias sem romaneio/saída
        </CardTitle>
        <CardDescription>Notas de entrada sem carga vinculada para corrigir antes do fechamento operacional.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>NF</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Destino</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead>Fechamento</TableHead>
              <TableHead>Atraso</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : docs.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Nenhuma nota com mais de 7 dias pendente de romaneio/saída.</TableCell></TableRow>
            ) : docs.map((doc: any) => {
              const issueDate = doc.issue_date ? new Date(`${doc.issue_date}T12:00:00`) : null;
              const closingDate = issueDate ? addDays(issueDate, 7) : null;
              const overdueDays = closingDate ? Math.max(0, differenceInCalendarDays(new Date(), closingDate)) : 0;
              return (
                <TableRow key={doc.id}>
                  <TableCell className="font-mono font-medium">{doc.invoice_number || '—'}</TableCell>
                  <TableCell>{doc.clients?.company_name || doc.recipient || '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{[doc.recipient_neighborhood, doc.recipient_city, doc.recipient_state].filter(Boolean).join(' / ') || '—'}</TableCell>
                  <TableCell>{issueDate ? format(issueDate, 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell>{closingDate ? format(closingDate, 'dd/MM/yyyy') : '—'}</TableCell>
                  <TableCell><Badge variant="destructive" className="text-xs">{overdueDays} dia(s)</Badge></TableCell>
                  <TableCell className="text-right"><Button asChild variant="outline" size="sm"><Link to="/fiscal-documents">Corrigir</Link></Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function useMemoDate(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return format(date, 'yyyy-MM-dd');
}

function AlertRulesSection() {
  const { currentTenant } = useTenant();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['alert_rules', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.from('alert_rules').select('*')
        .eq('tenant_id', currentTenant.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from('alert_rules').update({ enabled }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert_rules'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('alert_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['alert_rules'] }); toast.success('Regra removida'); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rules.length} regras configuradas</p>
        {isAdmin && <Button onClick={() => setDialogOpen(true)}><Plus className="mr-2 h-4 w-4" />Nova Regra</Button>}
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Parâmetros</TableHead><TableHead>Ativo</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhuma regra. Crie regras de alerta para monitorar offline, excesso de velocidade, etc.</TableCell></TableRow>
              ) : rules.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant="outline" className="text-xs">{r.rule_type}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">{JSON.stringify(r.params)}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <Switch checked={r.enabled} onCheckedChange={v => toggleMutation.mutate({ id: r.id, enabled: v })} />
                    ) : (
                      <Badge variant={r.enabled ? 'default' : 'secondary'}>{r.enabled ? 'Sim' : 'Não'}</Badge>
                    )}
                  </TableCell>
                  <TableCell>{isAdmin && <Button size="sm" variant="ghost" onClick={() => { if (confirm('Remover regra?')) deleteMutation.mutate(r.id); }}><X className="h-3 w-3 text-destructive" /></Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {isAdmin && <NewRuleDialog open={dialogOpen} onOpenChange={setDialogOpen} tenantId={currentTenant?.id} />}
    </div>
  );
}

function NewRuleDialog({ open, onOpenChange, tenantId }: { open: boolean; onOpenChange: (v: boolean) => void; tenantId?: string }) {
  const qc = useQueryClient();
  const [ruleType, setRuleType] = useState('offline');
  const [threshold, setThreshold] = useState('15');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setLoading(true);
    const params: any = {};
    if (ruleType === 'offline') params.threshold_minutes = parseInt(threshold);
    if (ruleType === 'overspeed') params.speed_limit_kmh = parseInt(threshold);
    if (ruleType === 'long_stop') params.threshold_minutes = parseInt(threshold);

    const { error } = await supabase.from('alert_rules').insert({ tenant_id: tenantId, rule_type: ruleType, params, enabled: true });
    if (error) toast.error(error.message);
    else { toast.success('Regra criada!'); qc.invalidateQueries({ queryKey: ['alert_rules'] }); onOpenChange(false); }
    setLoading(false);
  };

  const labels: Record<string, string> = { offline: 'Minutos offline', overspeed: 'Limite km/h', long_stop: 'Minutos parado' };
  const defaults: Record<string, string> = { offline: '15', overspeed: '80', long_stop: '120' };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Nova Regra de Alerta</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={ruleType} onValueChange={v => { setRuleType(v); setThreshold(defaults[v] || '15'); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="offline">Veículo Offline</SelectItem>
                <SelectItem value="overspeed">Excesso de Velocidade</SelectItem>
                <SelectItem value="long_stop">Parada Longa</SelectItem>
                <SelectItem value="geofence">Geofence</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {ruleType !== 'geofence' && (
            <div className="space-y-2">
              <Label>{labels[ruleType]}</Label>
              <Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} required />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Salvando...' : 'Criar'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
