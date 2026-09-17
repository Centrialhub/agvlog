import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, ReceiptText, RefreshCw } from 'lucide-react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import {
  useDownloadPortalFinancialTitle,
  usePortalFinancialTitles,
} from '@/hooks/portal/usePortalFinancialTitles';
import { portalErrorMessage } from '@/lib/portal/portalErrors';

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos', statuses: undefined },
  { value: 'open', label: 'Em aberto', statuses: ['pending', 'open', 'overdue', 'partial'] },
  { value: 'paid', label: 'Liquidados', statuses: ['paid', 'received', 'settled'] },
] as const;

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';

function statusLabel(status: string) {
  return ({
    pending: 'Pendente', open: 'Em aberto', overdue: 'Vencido', partial: 'Parcial',
    paid: 'Pago', received: 'Recebido', settled: 'Liquidado', cancelled: 'Cancelado',
  } as Record<string, string>)[status] || status;
}

export default function PortalTitles() {
  const { selectedClientId, clients, can } = usePortalClientScope();
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]['value']>('all');
  const [page, setPage] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const limit = 50;
  const statuses = useMemo(() => STATUS_FILTERS.find((item) => item.value === filter)?.statuses, [filter]);
  const { data, isLoading, error, refetch, isFetching } = usePortalFinancialTitles({
    status: statuses ? [...statuses] : undefined,
    limit,
    offset: page * limit,
  });
  const download = useDownloadPortalFinancialTitle();

  useEffect(() => setPage(0), [selectedClientId, filter]);

  const handleDownload = async (titleId: string) => {
    setDownloadError(null);
    try {
      const file = await download.mutateAsync(titleId);
      const objectUrl = URL.createObjectURL(file.blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = file.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (caught: unknown) {
      setDownloadError(portalErrorMessage(caught, 'Não foi possível abrir o PDF do título.'));
    }
  };

  const requiresSelection = clients.length > 1 && !selectedClientId;
  const canView = can('can_view_financial');
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <PortalSection title="Títulos" description="Cobranças, vencimentos e valores vinculados ao seu acesso.">
      {!canView ? (
        <PortalEmptyState
          title="Acesso financeiro não habilitado"
          description="Solicite à transportadora a permissão para consultar valores e títulos."
        />
      ) : requiresSelection ? (
        <PortalEmptyState
          title="Selecione um cliente"
          description="Os títulos são exibidos separadamente por cliente."
        />
      ) : (
        <>
          <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <TabsList>
              {STATUS_FILTERS.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
            </TabsList>
          </Tabs>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div role="status" className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : error ? (
                <div role="alert" className="space-y-3 p-5 text-center text-sm text-destructive">
                  <p>Não foi possível carregar os títulos: {portalErrorMessage(error, 'Falha na consulta.')}</p>
                  <Button size="sm" variant="outline" disabled={isFetching} onClick={() => { void refetch(); }}>
                    {isFetching ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Tentar novamente
                  </Button>
                </div>
              ) : rows.length === 0 ? (
                <PortalEmptyState title="Nenhum título encontrado" description="Não há cobranças para o filtro selecionado." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Título</TableHead>
                      <TableHead>Vencimento</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead className="w-24" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((title) => (
                      <TableRow key={title.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium"><ReceiptText className="h-4 w-4 text-muted-foreground" />{title.invoice_number || title.description || title.id.slice(0, 8)}</div>
                          {title.description && title.invoice_number && <p className="mt-0.5 max-w-[320px] truncate text-xs text-muted-foreground">{title.description}</p>}
                        </TableCell>
                        <TableCell>{date(title.due_date)}</TableCell>
                        <TableCell><Badge variant="outline">{statusLabel(title.status)}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{money(title.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{money(title.outstanding_amount)}</TableCell>
                        <TableCell>
                          {title.has_pdf && title.can_download && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={download.isPending}
                              onClick={() => { void handleDownload(title.id); }}
                            >
                              <Download className="mr-1 h-3 w-3" /> PDF
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

          {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}

          {total > limit && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Página {page + 1} de {Math.ceil(total / limit)} · {total} título(s)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Anterior</Button>
                <Button size="sm" variant="outline" disabled={(page + 1) * limit >= total} onClick={() => setPage((current) => current + 1)}>Próxima</Button>
              </div>
            </div>
          )}
        </>
      )}
    </PortalSection>
  );
}
