import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Plus, Clock } from 'lucide-react';

const ISSUE_TYPES = [
  { value: 'vehicle_breakdown', label: 'Pane no veículo' },
  { value: 'accident', label: 'Acidente' },
  { value: 'cargo_damage', label: 'Avaria na carga' },
  { value: 'delivery_refused', label: 'Entrega recusada' },
  { value: 'wrong_address', label: 'Endereço incorreto' },
  { value: 'road_blocked', label: 'Via bloqueada' },
  { value: 'other', label: 'Outro' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Média' },
  { value: 'high', label: 'Alta' },
];

export default function DriverIssues() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ event_type: 'other', severity: 'medium', description: '' });

  const { data: trip } = useQuery({
    queryKey: ['driver_issues_trip', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('id, load_id')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: events = [] } = useQuery({
    queryKey: ['driver_operational_events', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('operational_events')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const createIssue = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('operational_events').insert({
        tenant_id: currentTenant!.id,
        event_type: form.event_type,
        severity: form.severity,
        description: form.description || null,
        load_id: trip?.load_id || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Ocorrência registrada' });
      setOpen(false);
      setForm({ event_type: 'other', severity: 'medium', description: '' });
      qc.invalidateQueries({ queryKey: ['driver_operational_events'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const severityColors: Record<string, string> = {
    low: 'bg-muted text-muted-foreground',
    medium: 'bg-amber-100 text-amber-700',
    high: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Ocorrências</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5 mr-1" /> Nova</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Nova Ocorrência</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.event_type} onValueChange={v => setForm(f => ({ ...f, event_type: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ISSUE_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Severidade</Label>
                <Select value={form.severity} onValueChange={v => setForm(f => ({ ...f, severity: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Descrição</Label>
                <Textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Descreva o ocorrido..."
                  className="text-sm"
                />
              </div>
              <Button
                className="w-full"
                size="sm"
                onClick={() => createIssue.mutate()}
                disabled={createIssue.isPending}
              >
                {createIssue.isPending ? 'Salvando...' : 'Registrar Ocorrência'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((evt: any) => {
            const typeLabel = ISSUE_TYPES.find(t => t.value === evt.event_type)?.label || evt.event_type;
            return (
              <Card key={evt.id}>
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{typeLabel}</p>
                    <Badge className={`text-[10px] ${severityColors[evt.severity] || ''}`} variant="secondary">
                      {evt.severity}
                    </Badge>
                  </div>
                  {evt.description && (
                    <p className="text-xs text-muted-foreground">{evt.description}</p>
                  )}
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(evt.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
