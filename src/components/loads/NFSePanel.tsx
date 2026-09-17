import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Send, FileText, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { useNFSeList, useIssueNFSe } from '@/hooks/useNFSe';
import NFSeFormDialog from '@/components/nfse/NFSeFormDialog';
import { FiscalEnvironmentSelect } from '@/components/fiscal/FiscalEnvironmentSelect';
import type { HubEnvironment } from '@/lib/fiscal/hubFiscalClient';

interface Props {
  loadId: string;
  loadNumber: string;
  destination: string | null;
  defaultClientName?: string | null;
  defaultClientCnpj?: string | null;
  freightTotal?: number | null;
}

export default function NFSePanel({ loadId, loadNumber, destination, defaultClientName, defaultClientCnpj, freightTotal }: Props) {
  const notesQuery = useNFSeList({ loadId });
  const notes = notesQuery.data ?? [];
  const [environment, setEnvironment] = useState<HubEnvironment>('production');
  const issue = useIssueNFSe(environment);
  const [open, setOpen] = useState(false);
  const initialDocument = useMemo(() => ({
    cliente_nome: defaultClientName || '',
    cliente_cnpj: defaultClientCnpj || '',
    description: `Prestação de serviço de transporte — Carga ${loadNumber}${destination ? ` para ${destination}` : ''}`,
    valor_servicos: freightTotal || 0,
    load_id: loadId,
  }), [defaultClientCnpj, defaultClientName, destination, freightTotal, loadId, loadNumber]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" /> NFS-e — Carga {loadNumber}
        </CardTitle>
        <Button size="sm" onClick={() => setOpen(true)} disabled={notesQuery.isLoading || notesQuery.isError}>
          <Plus className="h-3 w-3 mr-1" /> Nova NFS-e
        </Button>
      </CardHeader>
      <CardContent>
        <FiscalEnvironmentSelect value={environment} onChange={setEnvironment} disabled={issue.isPending} />
        {notesQuery.isLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Consultando NFS-e da carga…
          </div>
        ) : notesQuery.isError ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm" role="alert">
            <TriangleAlert className="h-4 w-4 text-destructive" />
            <span>Não foi possível consultar as NFS-e desta carga. Nenhuma nova nota será criada até a consulta ser refeita.</span>
            <Button size="sm" variant="outline" onClick={() => void notesQuery.refetch()} disabled={notesQuery.isFetching}>
              {notesQuery.isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Tentar novamente
            </Button>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma NFS-e gerada para esta carga.</p>
        ) : (
          <div className="space-y-2">
            {notes.map(n => (
              <div key={n.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                <div className="flex items-center gap-3">
                  <Badge variant={n.status === 'issued' ? 'default' : n.status === 'rejected' ? 'destructive' : 'secondary'}>
                    {n.status}
                  </Badge>
                  <span className="font-mono text-xs">{n.nfse_number || `RPS ${n.rps_number}`}</span>
                  <span className="text-muted-foreground truncate max-w-[260px]">{n.cliente_nome}</span>
                  <span className="tabular-nums">R$ {Number(n.valor_servicos).toFixed(2)}</span>
                </div>
                {n.status === 'draft' && (
                  <Button size="sm" variant="outline" onClick={() => issue.mutate(n.id)} disabled={issue.isPending}>
                    <Send className="h-3 w-3 mr-1" /> Emitir
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <NFSeFormDialog
          open={open}
          environment={environment}
          onEnvironmentChange={setEnvironment}
          issuing={issue.isPending}
          onOpenChange={setOpen}
          loadId={loadId}
          initial={initialDocument}
        />
      </CardContent>
    </Card>
  );
}
