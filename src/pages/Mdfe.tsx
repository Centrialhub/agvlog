import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, Download, FileCheck2, FileSignature, Loader2, RefreshCw,
  Search, Truck, XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  downloadMdfeFile, type MdfeManifest, useCloseMdfe, useMdfeHistory, useSyncMdfe,
} from '@/hooks/useMdfe';
import {
  canCloseMdfe, canDownloadMdfe, MDFE_STATUS_LABELS, normalizeMdfeStatus,
  type MdfeLifecycleStatus,
} from '@/lib/fiscal/mdfeStatus';
import { getErrorMessage } from '@/lib/errors';
import { useSonnerToast } from '@/hooks/useSonnerToast';

const statusTone: Record<MdfeLifecycleStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  processing: 'border-info/30 bg-info/10 text-info',
  provider_unknown: 'border-warning/30 bg-warning/10 text-warning',
  authorized: 'border-success/30 bg-success/10 text-success',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
  closing: 'border-info/30 bg-info/10 text-info',
  closed: 'border-success/30 bg-success/10 text-success',
  cancelled: 'bg-muted text-muted-foreground',
};

const returnedLoad = (manifest: MdfeManifest) => Boolean(manifest.loads?.arrival_at) ||
  ['delivered', 'partial_delivery', 'returned', 'refused', 'failed'].includes(manifest.loads?.status || '');

const includesSearch = (manifest: MdfeManifest, search: string) => {
  const needle = search.trim().toLocaleLowerCase('pt-BR');
  if (!needle) return true;
  return [
    manifest.loads?.load_number, manifest.document_number, manifest.access_key,
    manifest.loads?.drivers?.name, manifest.loads?.vehicles?.plate,
    manifest.tenant_emitters?.razao_social,
  ].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle));
};

export default function Mdfe() {
  const navigate = useNavigate();
  const toast = useSonnerToast();
  const { data: manifests = [], isLoading, isFetching, error, refetch } = useMdfeHistory();
  const syncMdfe = useSyncMdfe();
  const closeMdfe = useCloseMdfe();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | MdfeLifecycleStatus>('all');
  const [fileBusy, setFileBusy] = useState<string | null>(null);

  const filtered = useMemo(() => manifests.filter(manifest => {
    const lifecycle = normalizeMdfeStatus(manifest.status);
    return (status === 'all' || lifecycle === status) && includesSearch(manifest, search);
  }), [manifests, search, status]);

  const totals = useMemo(() => manifests.reduce((result, manifest) => {
    const lifecycle = normalizeMdfeStatus(manifest.status);
    result.total += 1;
    if (lifecycle === 'authorized') result.open += 1;
    if (lifecycle === 'closed') result.closed += 1;
    if (['rejected', 'provider_unknown'].includes(lifecycle)) result.attention += 1;
    return result;
  }, { total: 0, open: 0, closed: 0, attention: 0 }), [manifests]);

  const handleSync = async (manifest: MdfeManifest) => {
    try {
      await syncMdfe.mutateAsync(manifest);
      toast.success('Situação do MDF-e sincronizada.');
    } catch (syncError: unknown) {
      toast.error(getErrorMessage(syncError, 'Não foi possível sincronizar o MDF-e.'));
    }
  };

  const handleClose = async (manifest: MdfeManifest) => {
    try {
      await closeMdfe.mutateAsync(manifest);
      toast.success('Encerramento solicitado. Sincronize para confirmar o protocolo.');
    } catch (closeError: unknown) {
      toast.error(getErrorMessage(closeError, 'Não foi possível encerrar o MDF-e.'));
    }
  };

  const handleDownload = async (manifest: MdfeManifest, format: 'pdf' | 'xml') => {
    const busyKey = `${manifest.id}-${format}`;
    setFileBusy(busyKey);
    try {
      await downloadMdfeFile(manifest, format);
    } catch (downloadError: unknown) {
      toast.error(getErrorMessage(downloadError, `Não foi possível baixar o ${format.toUpperCase()}.`));
    } finally {
      setFileBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight"><FileSignature className="h-6 w-6" /> MDF-e</h1>
          <p className="text-muted-foreground">Manifestos emitidos por carga, arquivos oficiais e encerramento no retorno do motorista.</p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Manifestos</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{totals.total}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Em viagem</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-info">{totals.open}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Encerrados</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-success">{totals.closed}</CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Requer atenção</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-destructive">{totals.attention}</CardContent></Card>
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-center md:justify-between">
          <div><CardTitle className="text-base">Consulta de manifestos</CardTitle><p className="mt-1 text-xs text-muted-foreground">A emissão de um novo MDF-e é feita dentro da carga correspondente.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9 sm:w-72" value={search} onChange={event => setSearch(event.target.value)} placeholder="Carga, chave, motorista ou placa" /></div>
            <select aria-label="Filtrar por situação" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={event => setStatus(event.target.value as typeof status)}>
              <option value="all">Todas as situações</option>
              {Object.entries(MDFE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm"><p>{getErrorMessage(error, 'Não foi possível carregar os MDF-es.')}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void refetch()}>Tentar novamente</Button></div>
          ) : isLoading ? (
            <p role="status" className="py-10 text-center text-sm text-muted-foreground">Carregando MDF-es…</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center"><Truck className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">Nenhum MDF-e encontrado</p><p className="text-sm text-muted-foreground">Abra uma carga pronta para emitir o primeiro manifesto.</p><Button className="mt-4" variant="outline" onClick={() => navigate('/loads')}>Ir para cargas</Button></div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Carga</TableHead><TableHead>MDF-e</TableHead><TableHead>Motorista / veículo</TableHead><TableHead>Situação</TableHead><TableHead>Datas</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filtered.map(manifest => {
                    const lifecycle = normalizeMdfeStatus(manifest.status);
                    return (
                      <TableRow key={manifest.id}>
                        <TableCell><button className="font-semibold text-primary hover:underline" onClick={() => navigate(`/loads/${manifest.load_id}?tab=manifesto`)}>{manifest.loads?.load_number || manifest.load_id.slice(0, 8)}</button><p className="text-xs text-muted-foreground">{manifest.tenant_emitters?.razao_social || 'Emitente'}</p></TableCell>
                        <TableCell><p className="font-medium">{manifest.document_number || manifest.manifest_number}</p><p className="max-w-52 truncate font-mono text-[10px] text-muted-foreground" title={manifest.access_key || ''}>{manifest.access_key || 'Chave aguardando autorização'}</p></TableCell>
                        <TableCell><p>{manifest.loads?.drivers?.name || '—'}</p><p className="text-xs text-muted-foreground">{manifest.loads?.vehicles?.plate || '—'}</p></TableCell>
                        <TableCell><Badge variant="outline" className={statusTone[lifecycle]}>{MDFE_STATUS_LABELS[lifecycle]}</Badge>{manifest.status_message && ['rejected', 'provider_unknown'].includes(lifecycle) ? <p className="mt-1 max-w-52 truncate text-xs text-destructive" title={manifest.status_message}>{manifest.status_message}</p> : null}</TableCell>
                        <TableCell className="text-xs"><p>Emissão: {manifest.issued_at ? new Date(manifest.issued_at).toLocaleString('pt-BR') : '—'}</p><p>Encerramento: {manifest.closed_at ? new Date(manifest.closed_at).toLocaleString('pt-BR') : '—'}</p></TableCell>
                        <TableCell className="text-right"><div className="inline-flex flex-wrap justify-end gap-1">
                          {manifest.hub_document_id ? <Button size="icon" variant="ghost" title="Sincronizar" onClick={() => void handleSync(manifest)} disabled={syncMdfe.isPending}><RefreshCw className="h-4 w-4" /></Button> : null}
                          {canDownloadMdfe(lifecycle) ? <><Button size="icon" variant="ghost" title="Baixar XML" onClick={() => void handleDownload(manifest, 'xml')} disabled={fileBusy !== null}><Download className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Baixar PDF para o motorista" onClick={() => void handleDownload(manifest, 'pdf')} disabled={fileBusy !== null}>{fileBusy === `${manifest.id}-pdf` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}</Button></> : null}
                          {canCloseMdfe(lifecycle) ? <Button size="sm" variant="outline" title={returnedLoad(manifest) ? 'Encerrar manifesto' : 'Disponível após o retorno da carga'} onClick={() => void handleClose(manifest)} disabled={!returnedLoad(manifest) || closeMdfe.isPending}><CheckCircle2 className="mr-1 h-4 w-4" />Encerrar</Button> : null}
                          {lifecycle === 'rejected' ? <Button size="sm" variant="outline" onClick={() => navigate(`/loads/${manifest.load_id}?tab=manifesto`)}><XCircle className="mr-1 h-4 w-4" />Corrigir</Button> : null}
                        </div></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
