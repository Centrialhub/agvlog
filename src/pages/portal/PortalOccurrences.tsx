import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalOccurrences, useCreatePortalOccurrence } from '@/hooks/portal/usePortalOccurrences';
import { usePortalOccurrenceMessages, useReplyPortalOccurrence } from '@/hooks/portal/usePortalOccurrenceMessages';
import { useClientPortalAccess } from '@/hooks/portal/useClientPortalAccess';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Loader2, Plus, AlertTriangle, CheckCircle2, MessageSquare, Send } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { portalErrorMessage } from '@/lib/portal/portalErrors';
import {
  normalizePortalOccurrence,
  PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH,
  PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH,
  PORTAL_OCCURRENCE_MESSAGE_MAX_LENGTH,
} from '@/lib/portal/portalRequestValidation';

const SEVERITY_TONE: Record<string, string> = {
  low: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  medium: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  high: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  critical: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export default function PortalOccurrences() {
  const [searchParams] = useSearchParams();
  const { data: access = [] } = useClientPortalAccess();
  const { selectedClientId } = usePortalClientScope();
  const openableClients = access.filter(a => a.can_open_occurrences);
  const selectedClientCanOpen = selectedClientId
    ? openableClients.some((client) => client.client_id === selectedClientId)
    : openableClients.length > 0;
  const [severity, setSeverity] = useState<string>('all');
  const [resolved, setResolved] = useState<string>('all');
  const {
    data: occurrences = [], isLoading, error, refetch,
    fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError, restart,
  } = usePortalOccurrences({
    severity: severity === 'all' ? undefined : severity,
    resolved: resolved === 'all' ? undefined : resolved === 'yes',
  });
  const restartOccurrences = restart;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    client_id: '', event_type: '', severity: 'medium', description: '',
    load_id: '', fiscal_document_id: '', document_number: '',
  });
  const createRequestIdRef = useRef<string | null>(null);
  const linkedDocumentHandledRef = useRef<string | null>(null);
  useEffect(() => {
    const fiscalDocumentId = searchParams.get('documentId');
    if (!fiscalDocumentId || linkedDocumentHandledRef.current === fiscalDocumentId) return;
    linkedDocumentHandledRef.current = fiscalDocumentId;
    setForm((current) => ({
      ...current,
      client_id: searchParams.get('clientId') || current.client_id,
      load_id: searchParams.get('loadId') || '',
      fiscal_document_id: fiscalDocumentId,
      document_number: searchParams.get('documentNumber') || '',
    }));
    setOpen(true);
  }, [searchParams]);
  useEffect(() => {
    if (open && !form.client_id) {
      const preselect = selectedClientId && openableClients.some((client) => client.client_id === selectedClientId)
        ? selectedClientId
        : (openableClients.length === 1 ? openableClients[0].client_id : '');
      if (preselect) setForm(f => ({ ...f, client_id: preselect }));
    }
  }, [open, selectedClientId, openableClients, form.client_id]);
  const createMut = useCreatePortalOccurrence();
  const { toast } = useToast();
  const [threadId, setThreadId] = useState<string | null>(null);

  const submit = async () => {
    if (!form.client_id) {
      toast({ title: 'Preencha cliente, tipo e descrição', variant: 'destructive' });
      return;
    }
    if (!openableClients.some((client) => client.client_id === form.client_id)) {
      toast({ title: 'Sem permissão para abrir ocorrência para este cliente', variant: 'destructive' });
      return;
    }
    let normalizedForm: typeof form;
    try {
      normalizedForm = normalizePortalOccurrence(form);
    } catch (error: unknown) {
      toast({ title: 'Dados inválidos', description: error instanceof Error ? error.message : 'Revise os dados da ocorrência.', variant: 'destructive' });
      return;
    }
    try {
      const requestId = createRequestIdRef.current ?? crypto.randomUUID();
      createRequestIdRef.current = requestId;
      await createMut.mutateAsync({ ...normalizedForm, request_id: requestId });
      toast({ title: 'Ocorrência registrada' });
      createRequestIdRef.current = null;
      setOpen(false);
      setForm({ client_id: '', event_type: '', severity: 'medium', description: '', load_id: '', fiscal_document_id: '', document_number: '' });
    } catch (error: unknown) {
      toast({ title: 'Erro', description: portalErrorMessage(error, 'Não foi possível registrar a ocorrência.'), variant: 'destructive' });
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
        {selectedClientCanOpen && (
          <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) createRequestIdRef.current = null; setOpen(nextOpen); }}>
            <DialogTrigger asChild>
              <Button className="ml-auto"><Plus className="h-4 w-4 mr-2" />Abrir ocorrência</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova ocorrência</DialogTitle></DialogHeader>
              {form.fiscal_document_id && (
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Vinculada à NF {form.document_number || form.fiscal_document_id.slice(0, 8)}.
                </p>
              )}
              <div className="space-y-3">
                <div>
                  <Label>Cliente</Label>
                  <Select value={form.client_id} onValueChange={(v) => { createRequestIdRef.current = null; setForm(f => ({ ...f, client_id: v })); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {openableClients.map(c => (
                        <SelectItem key={c.client_id} value={c.client_id}>{c.client_name || c.client_id.slice(0, 8)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Input maxLength={PORTAL_OCCURRENCE_EVENT_TYPE_MAX_LENGTH} value={form.event_type} onChange={e => { createRequestIdRef.current = null; setForm(f => ({ ...f, event_type: e.target.value })); }} placeholder="ex.: avaria, atraso, divergência" />
                </div>
                <div>
                  <Label>Gravidade</Label>
                  <Select value={form.severity} onValueChange={(v) => { createRequestIdRef.current = null; setForm(f => ({ ...f, severity: v })); }}>
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
                  <Textarea maxLength={PORTAL_OCCURRENCE_DESCRIPTION_MAX_LENGTH} value={form.description} onChange={e => { createRequestIdRef.current = null; setForm(f => ({ ...f, description: e.target.value })); }} rows={4} />
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
      ) : error && !isFetchNextPageError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between gap-3">
          <span>Erro ao carregar ocorrências: {(error as Error).message}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
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
                {o.can_reply && !o.resolved_at && (
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setThreadId(o.id)}>
                    <MessageSquare className="h-4 w-4 mr-2" /> Conversar
                  </Button>
                </div>
                )}
              </CardContent>
            </Card>
          ))}
          {(hasNextPage || isFetchNextPageError) && (
            <div className="pt-2 text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (isFetchNextPageError) {
                    void restartOccurrences();
                    return;
                  }
                  void fetchNextPage();
                }}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isFetchNextPageError ? 'A lista mudou — atualizar' : 'Carregar mais ocorrências'}
              </Button>
            </div>
          )}
        </div>
      )}

      <OccurrenceThreadDialog
        occurrenceId={threadId}
        onClose={() => setThreadId(null)}
      />
    </PortalSection>
  );
}

export function OccurrenceThreadDialog({
  occurrenceId,
  onClose,
}: {
  occurrenceId: string | null;
  onClose: () => void;
}) {
  const {
    data: messages = [],
    isLoading,
    error: messagesError,
    refetch: refetchMessages,
    hasOlder,
    loadOlder,
    isLoadingOlder,
    olderError,
  } = usePortalOccurrenceMessages(occurrenceId);
  const replyMut = useReplyPortalOccurrence();
  const [text, setText] = useState('');
  const requestIdRef = useRef<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    requestIdRef.current = null;
  }, [occurrenceId]);

  const send = async () => {
    if (!occurrenceId || !text.trim()) return;
    const requestId = requestIdRef.current ?? crypto.randomUUID();
    requestIdRef.current = requestId;
    try {
      await replyMut.mutateAsync({ occurrence_id: occurrenceId, message: text.trim(), request_id: requestId });
      requestIdRef.current = null;
      setText('');
    } catch (error: unknown) {
      toast({ title: 'Erro ao enviar', description: portalErrorMessage(error, 'Não foi possível enviar a mensagem.'), variant: 'destructive' });
    }
  };

  return (
    <Dialog open={!!occurrenceId} onOpenChange={(v) => { if (!v) { requestIdRef.current = null; setText(''); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Conversa da ocorrência</DialogTitle>
          <DialogDescription>
            Histórico de mensagens entre o cliente e a operação.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto space-y-2 py-2">
          {!isLoading && !messagesError && hasOlder && (
            <div className="pb-2 text-center">
              <Button size="sm" variant="outline" onClick={() => { void loadOlder(); }} disabled={isLoadingOlder}>
                {isLoadingOlder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Carregar mensagens anteriores
              </Button>
              {olderError ? <p className="mt-2 text-xs text-destructive">Não foi possível carregar as mensagens anteriores.</p> : null}
            </div>
          )}
          {isLoading ? (
            <div className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : messagesError ? (
            <div className="space-y-3 py-6 text-center" role="alert">
              <p className="text-sm text-destructive">
                Não foi possível carregar a conversa. As mensagens permaneceram ocultas.
              </p>
              <Button size="sm" variant="outline" onClick={() => { void refetchMessages(); }}>
                Tentar novamente
              </Button>
            </div>
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
            onChange={(e) => { requestIdRef.current = null; setText(e.target.value); }}
            placeholder="Escreva uma mensagem..."
            rows={2}
            maxLength={PORTAL_OCCURRENCE_MESSAGE_MAX_LENGTH}
          />
          <Button aria-label="Enviar mensagem" onClick={send} disabled={!!messagesError || !text.trim() || replyMut.isPending}>
            {replyMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
