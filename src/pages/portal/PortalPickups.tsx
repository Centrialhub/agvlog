import { useEffect, useState } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalPickups, useRequestPortalPickup, useCancelPortalPickup } from '@/hooks/portal/usePortalPickups';
import { useClientPortalAccess, hasAnyPermission } from '@/hooks/portal/useClientPortalAccess';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Loader2, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { portalErrorMessage } from '@/lib/portal/portalErrors';

const STATUS_TONE: Record<string, string> = {
  pendente: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  vinculada: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  finalizada: 'bg-green-500/15 text-green-700 dark:text-green-400',
  cancelada: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export default function PortalPickups() {
  const { data: access = [] } = useClientPortalAccess();
  const { selectedClientId } = usePortalClientScope();
  const canRequest = hasAnyPermission(access, 'can_request_pickup');
  const requestableClients = access.filter(a => a.can_request_pickup);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { data: pickups = [], isLoading, error, refetch } = usePortalPickups({
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const [open, setOpen] = useState(false);
  const [cancelPickupId, setCancelPickupId] = useState<string | null>(null);
  const [form, setForm] = useState({ client_id: '', pickup_at: '', recipient_name: '', notes: '' });
  // Pré-selecionar cliente quando escopo estiver reduzido a um único cliente
  useEffect(() => {
    if (open && !form.client_id) {
      const preselect = selectedClientId
        || (requestableClients.length === 1 ? requestableClients[0].client_id : '');
      if (preselect) setForm(f => ({ ...f, client_id: preselect }));
    }
  }, [open, selectedClientId, requestableClients, form.client_id]);
  const requestMut = useRequestPortalPickup();
  const cancelMut = useCancelPortalPickup();
  const { toast } = useToast();

  const handleCancel = async () => {
    if (!cancelPickupId) return;
    try {
      await cancelMut.mutateAsync(cancelPickupId);
      toast({ title: 'Coleta cancelada' });
      setCancelPickupId(null);
    } catch (error: unknown) {
      toast({ title: 'Erro ao cancelar', description: portalErrorMessage(error, 'Não foi possível cancelar a coleta.'), variant: 'destructive' });
    }
  };

  const submit = async () => {
    if (!form.client_id || !form.pickup_at) {
      toast({ title: 'Preencha cliente e data', variant: 'destructive' });
      return;
    }
    try {
      await requestMut.mutateAsync({
        client_id: form.client_id,
        pickup_at: new Date(form.pickup_at).toISOString(),
        recipient_name: form.recipient_name || undefined,
        notes: form.notes || undefined,
      });
      toast({ title: 'Coleta solicitada' });
      setOpen(false);
      setForm({ client_id: '', pickup_at: '', recipient_name: '', notes: '' });
    } catch (error: unknown) {
      toast({ title: 'Erro', description: portalErrorMessage(error, 'Não foi possível solicitar a coleta.'), variant: 'destructive' });
    }
  };

  return (
    <PortalSection
      title="Coletas"
      description="Acompanhe e solicite coletas de mercadoria."
    >
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="vinculada">Vinculada</SelectItem>
            <SelectItem value="finalizada">Finalizada</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        {canRequest && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="ml-auto"><Plus className="h-4 w-4 mr-2" />Solicitar coleta</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova solicitação de coleta</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Cliente / Remetente</Label>
                  <Select value={form.client_id} onValueChange={(v) => setForm(f => ({ ...f, client_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {requestableClients.map(c => (
                        <SelectItem key={c.client_id} value={c.client_id}>{c.client_name || c.client_id.slice(0, 8)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data/Hora da coleta</Label>
                  <Input type="datetime-local" value={form.pickup_at} onChange={e => setForm(f => ({ ...f, pickup_at: e.target.value }))} />
                </div>
                <div>
                  <Label>Destinatário (opcional)</Label>
                  <Input value={form.recipient_name} onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))} />
                </div>
                <div>
                  <Label>Observações</Label>
                  <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit} disabled={requestMut.isPending}>
                  {requestMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Solicitar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : error ? (
            <div className="p-4 text-xs text-destructive flex items-center justify-between gap-3">
              <span>Erro ao carregar coletas: {(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
            </div>
          ) : pickups.length === 0 ? (
            <PortalEmptyState title="Nenhuma coleta" description="Você ainda não tem coletas registradas." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>XMLs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pickups.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">#{p.pickup_number}</TableCell>
                    <TableCell>{p.pickup_at && format(new Date(p.pickup_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{p.remitter_name || '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{p.recipient_name || '—'}</TableCell>
                    <TableCell>{p.linked_docs_count || 0}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[p.status] || ''}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === 'pendente' && canRequest && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelPickupId(p.id)}
                          disabled={cancelMut.isPending}
                          title="Cancelar coleta"
                          aria-label={`Cancelar coleta ${p.pickup_number}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={!!cancelPickupId} onOpenChange={(nextOpen) => { if (!nextOpen) setCancelPickupId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar coleta?</AlertDialogTitle>
            <AlertDialogDescription>
              A solicitação será marcada como cancelada. Esta ação não altera coletas já finalizadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} disabled={cancelMut.isPending}>
              {cancelMut.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalSection>
  );
}
