import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalDocuments } from '@/hooks/portal/usePortalDocuments';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, FileCheck2, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

const TYPES = [
  { id: 'all', label: 'Todos' },
  { id: 'nfe', label: 'NF-e' },
  { id: 'cte', label: 'CT-e' },
  { id: 'mdfe', label: 'MDF-e' },
];

export default function PortalDocuments() {
  const { can, selectedClientId } = usePortalClientScope();
  const showFinancial = can('can_view_financial');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(0);
  const limit = 50;
  useEffect(() => setPage(0), [selectedClientId]);
  const { data: docs = [], isLoading, error, refetch } = usePortalDocuments({
    document_type: type === 'all' ? undefined : type,
    search: search.trim() || undefined,
    start: startDate || undefined,
    end: endDate || undefined,
    limit,
    offset: page * limit,
  });

  const activeCount = Number(Boolean(search)) + Number(Boolean(startDate)) + Number(Boolean(endDate)) + Number(type !== 'all');
  const clear = () => { setSearch(''); setStartDate(''); setEndDate(''); setType('all'); setPage(0); };

  return (
    <PortalSection title="Documentos" description="NF-e, CT-e e MDF-e vinculados à sua operação.">
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 flex-wrap">
        <Tabs value={type} onValueChange={(v) => { setPage(0); setType(v); }}>
          <TabsList>
            {TYPES.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      <div className="mb-4"><ListFilterBar fields={[
        { key: 'search', label: 'Buscar documento', type: 'search', value: search, onChange: value => { setPage(0); setSearch(value); }, placeholder: 'Número, chave ou remetente' },
        { key: 'from', label: 'Emissão de', type: 'date', value: startDate, max: endDate || undefined, onChange: value => { setPage(0); setStartDate(value); } },
        { key: 'to', label: 'Emissão até', type: 'date', value: endDate, min: startDate || undefined, onChange: value => { setPage(0); setEndDate(value); } },
      ]} onReset={clear} activeCount={activeCount} resultCount={error ? undefined : docs.length} loading={isLoading} description={`Página ${page + 1}; até 50 documentos por página.`} /></div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : error ? (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between gap-3">
                  <span>Erro ao carregar documentos: {(error as Error).message}</span>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>Tentar novamente</Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : docs.length === 0 ? (
            <PortalEmptyState title="Nenhum documento" description="Não encontramos documentos para os filtros aplicados." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nº</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Remetente</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Destino</TableHead>
                  {showFinancial && <TableHead className="text-right">Valor</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>POD</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map(d => (
                  <TableRow key={d.id} className="cursor-pointer hover:bg-muted/40">
                    <TableCell className="uppercase text-xs">{d.document_type}</TableCell>
                    <TableCell className="font-mono">
                      <Link to={`/portal/shipments/${d.id}`} className="hover:underline">
                        {d.invoice_number || '—'}
                      </Link>
                    </TableCell>
                    <TableCell>{d.issue_date ? format(new Date(d.issue_date), 'dd/MM/yyyy') : '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{d.remitter || '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{d.recipient || '—'}</TableCell>
                    <TableCell className="text-xs">{[d.recipient_city, d.recipient_state].filter(Boolean).join(' / ') || '—'}</TableCell>
                    {showFinancial && (
                      <TableCell className="text-right font-mono">{d.value ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</TableCell>
                    )}
                    <TableCell><Badge variant="outline">{d.status || '—'}</Badge></TableCell>
                    <TableCell>{d.has_pod && <FileCheck2 className="h-4 w-4 text-green-600" />}</TableCell>
                    <TableCell>
                      <Link to={`/portal/shipments/${d.id}`} aria-label={`Abrir documento ${d.invoice_number || d.id}`}>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(page > 0 || docs.length >= limit) && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-xs text-muted-foreground">Página {page + 1}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0 || isLoading} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={docs.length < limit || isLoading} onClick={() => setPage(p => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </PortalSection>
  );
}
