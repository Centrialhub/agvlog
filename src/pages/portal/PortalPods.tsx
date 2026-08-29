import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalPods, useDownloadPortalPod } from '@/hooks/portal/usePortalPods';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Download, Search, X } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { portalErrorMessage } from '@/lib/portal/portalErrors';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  uploaded: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  validated: 'bg-green-500/15 text-green-700 dark:text-green-400',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
  missing: 'bg-muted text-muted-foreground',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  uploaded: 'Recebido',
  validated: 'Validado',
  rejected: 'Rejeitado',
  missing: 'Não enviado',
};

export default function PortalPods() {
  const { can } = usePortalClientScope();
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const { data: pods = [], isLoading, error, refetch } = usePortalPods({
    status: status === 'all' ? undefined : status,
    start: startDate || undefined,
    end: endDate || undefined,
  });
  const download = useDownloadPortalPod();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!search) return pods;
    const q = search.toLowerCase();
    return pods.filter((p) =>
      (p.invoice_number ?? '').toLowerCase().includes(q) ||
      (p.receiver_name ?? '').toLowerCase().includes(q)
    );
  }, [pods, search]);

  const handleDownload = async (id: string) => {
    try {
      const url = await download.mutateAsync(id);
      window.open(url, '_blank');
    } catch (error: unknown) {
      toast({ title: 'Erro ao baixar', description: portalErrorMessage(error, 'Não foi possível baixar o canhoto.'), variant: 'destructive' });
    }
  };

  const canDownload = can('can_download_documents');
  const anyFilter = status !== 'all' || !!search || !!startDate || !!endDate;
  const clear = () => { setStatus('all'); setSearch(''); setStartDate(''); setEndDate(''); };

  return (
    <PortalSection title="Canhotos / POD" description="Comprovantes de entrega das suas mercadorias.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por NF ou recebedor..." className="pl-8 h-9 text-sm" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px] h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="uploaded">Recebido</SelectItem>
            <SelectItem value="validated">Validado</SelectItem>
            <SelectItem value="rejected">Rejeitado</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm w-[140px]" />
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm w-[140px]" />
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clear} className="h-9">
            <X className="h-3.5 w-3.5 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Desktop */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : error ? (
            <div className="p-4 text-xs text-destructive flex items-center justify-between gap-3">
              <span>Erro ao carregar canhotos: {(error as Error).message}</span>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
            </div>
          ) : filtered.length === 0 ? (
            <PortalEmptyState title="Sem canhotos" description="Nenhum comprovante registrado para os filtros aplicados." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nota</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Recebedor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">
                      <Link to={`/portal/shipments/${p.fiscal_document_id}`} className="hover:underline">
                        {p.invoice_number || '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs uppercase">{p.proof_type}</TableCell>
                    <TableCell>{p.received_at ? format(new Date(p.received_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : '—'}</TableCell>
                    <TableCell>
                      <div className="text-sm">{p.receiver_name || '—'}</div>
                      {p.receiver_role && <div className="text-xs text-muted-foreground">{p.receiver_role}</div>}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={STATUS_TONE[p.status] || ''}>{STATUS_LABEL[p.status] || p.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {p.has_file && canDownload ? (
                        <Button size="sm" variant="outline" onClick={() => handleDownload(p.id)} disabled={download.isPending}>
                          <Download className="h-4 w-4 mr-1" /> Baixar
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {!p.has_file ? 'Arquivo pendente' : 'Sem permissão'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {isLoading ? (
          <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <PortalEmptyState title="Sem canhotos" description="Nenhum comprovante registrado." />
        ) : (
          filtered.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <Link to={`/portal/shipments/${p.fiscal_document_id}`} className="font-medium text-sm hover:underline">
                    NF {p.invoice_number || '—'}
                  </Link>
                  <Badge variant="outline" className={STATUS_TONE[p.status] || ''}>{STATUS_LABEL[p.status] || p.status}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {p.received_at ? format(new Date(p.received_at), 'dd/MM/yyyy HH:mm', { locale: ptBR }) : 'Ainda não recebido'}
                  {p.receiver_name && ` · ${p.receiver_name}`}
                </p>
                {p.has_file && canDownload ? (
                  <Button size="sm" variant="outline" onClick={() => handleDownload(p.id)} disabled={download.isPending} className="w-full">
                    <Download className="h-4 w-4 mr-1" /> Baixar
                  </Button>
                ) : (
                  <p className="text-[10px] text-muted-foreground">
                    {!p.has_file ? 'Arquivo pendente' : 'Sem permissão para download'}
                  </p>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PortalSection>
  );
}
