import { useEffect, useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalOccurrences, useCreatePortalOccurrence } from '@/hooks/portal/usePortalOccurrences';
import { usePortalOccurrenceMessages, useReplyPortalOccurrence } from '@/hooks/portal/usePortalOccurrenceMessages';
import { useClientPortalAccess, hasAnyPermission } from '@/hooks/portal/useClientPortalAccess';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, AlertTriangle, CheckCircle2, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  critical: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export default function PortalOccurrences() {
  const { data: access = [] } = useClientPortalAccess();
  const { selectedClientId } = usePortalClientScope();
  const canOpen = hasAnyPermission(access, 'can_open_occurrences');
  const openableClients = access.filter(a => a.can_open_occurrences);
  const [severity, setSeverity] = useState<string>('all');
  const [resolved, setResolved] = useState<string>('all');
  const { data: occurrences = [], isLoading } = usePortalOccurrences({
    severity: severity === 'all' ? undefined : severity,
    resolved: resolved === 'all' ? undefined : resolved === 'yes',
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_id: '', event_type: '', severity: 'medium', description: '' });
  useEffect(() => {
    if (open && !form.client_id) {
      const preselect = selectedClientId
        || (openableClients.length === 1 ? openableClients[0].client_id : '');
      if (preselect) setForm(f => ({ ...f, client_id: preselect }));
    }
  }, [open, selectedClientId, openableClients, form.client_id]);
  const createMut = useCreatePortalOccurrence();
  const { toast } = useToast();
  const [threadId, setThreadId] = useState<string | null>(null);

  const submit = async () => {
    if (!form.client_id || !form.event_type || !form.description) {
      toast({ title: 'Preencha cliente, tipo e descrição', variant: 'destructive' });
      return;
    }
    try {
      await createMut.mutateAsync(form);
      toast({ title: 'Ocorrência registrada' });
      setOpen(false);
      setForm({ client_id: '', event_type: '', severity: 'medium', description: '' });
    } catch (e: any) {
      toast({ title: 'Erro', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <PortalSection title="Ocorrências" description="Acompanhe e registre ocorrências relacionadas à sua operação.">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Gravidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas gravidades</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
            <SelectItem value="medium">Média</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="critical">Crítica</SelectItem>
          </SelectContent>
        </Select>
        <Select value={resolved} onValueChange={setResolved}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="no">Em aberto</SelectItem>
            <SelectItem value="yes">Resolvidas</SelectItem>
          </SelectContent>
        </Select>
        {canOpen && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="ml-auto"><Plus className="h-4 w-4 mr-2" />Abrir ocorrência</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova ocorrência</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={(v) => setForm(f => ({ ...f, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {openableClients.map(c => (
                        <SelectItem key={c.client_id} value={c.client_id}>{c.client_id.slice(0, 8)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Input value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))} placeholder="ex.: avaria, atraso, divergência" />
                </div>
                <div>
                  <Label>Gravidade</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm(f => ({ ...f, severity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Baixa</SelectItem>
                      <SelectItem value="medium">Média</SelectItem>
                      <SelectItem value="high">Alta</SelectItem>
                      <SelectItem value="critical">Crítica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Descrição</Label>
                  <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={4} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={createMut.isPending}>
                  {createMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Registrar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : occurrences.length === 0 ? (
        <PortalEmptyState title="Sem ocorrências" description="Nenhuma ocorrência registrada para os filtros selecionados." />
      ) : (
        <div className="space-y-3">
          {occurrences.map(o => (
            <Card key={o.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {o.resolved_at ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-orange-600" />
                      )}
                      <span className="font-medium">{o.event_type}</span>
                      <Badge variant="outline" className={SEVERITY_TONE[o.severity] || ''}>{o.severity}</Badge>
                      {o.client_action_required && <Badge variant="destructive">Ação necessária</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{o.description}</p>
                    {o.resolution && (
                      <p className="text-xs mt-2 text-green-700 dark:text-green-400">Resolução: {o.resolution}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(o.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setThreadId(o.id)}>
                    <MessageSquare className="h-4 w-4 mr-2" /> Conversar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <OccurrenceThreadDialog
        occurrenceId={threadId}
        onClose={() => setThreadId(null)}
      />
    </PortalSection>
  );
}

function OccurrenceThreadDialog({
  occurrenceId,
  onClose,
}: {
  occurrenceId: string | null;
  onClose: () => void;
}) {
  const { data: messages = [], isLoading } = usePortalOccurrenceMessages(occurrenceId);
  const replyMut = useReplyPortalOccurrence();
  const [text, setText] = useState('');
  const { toast } = useToast();

  const send = async () => {
    if (!occurrenceId || !text.trim()) return;
    try {
      await replyMut.mutateAsync({ occurrence_id: occurrenceId, message: text.trim() });
      setText('');
    } catch (e: any) {
      toast({ title: 'Erro ao enviar', description: e.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={!!occurrenceId} onOpenChange={(v) => { if (!v) { setText(''); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conversa da ocorrência</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-auto space-y-2 py-2">
          {isLoading ? (
            <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-center text-muted-foreground py-6">
              Nenhuma mensagem ainda. Envie a primeira abaixo.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.author_role === 'client' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
                    m.author_role === 'client'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <div className="text-[10px] opacity-80 mb-0.5">
                    {m.author_name} · {format(new Date(m.created_at), 'dd/MM HH:mm', { locale: ptBR })}
                  </div>
                  <div className="whitespace-pre-wrap">{m.message}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Escreva uma mensagem..."
            rows={2}
          />
          <Button onClick={send} disabled={!text.trim() || replyMut.isPending}>
            {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
