import { useState, useMemo } from 'react';
import { PortalSection } from '@/components/portal/PortalLayout';
import { PortalEmptyState } from '@/components/portal/PortalEmptyState';
import { usePortalDocuments } from '@/hooks/portal/usePortalDocuments';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Loader2, FileCheck2 } from 'lucide-react';
import { format } from 'date-fns';

const TYPES = [
  { id: 'all', label: 'Todos' },
  { id: 'nfe', label: 'NF-e' },
  { id: 'cte', label: 'CT-e' },
  { id: 'mdfe', label: 'MDF-e' },
];

export default function PortalDocuments() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const { data: docs = [], isLoading } = usePortalDocuments({
    document_type: type === 'all' ? undefined : type,
    search: search.length >= 2 ? search : undefined,
  });

  const filtered = useMemo(() => docs, [docs]);

  return (
    <PortalSection title="Documentos" description="NF-e, CT-e e MDF-e vinculados à sua operação.">
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <Tabs value={type} onValueChange={setType}>
          <TabsList>
            {TYPES.map(t => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
        <div className="relative md:ml-auto md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nº, chave, remetente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
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
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>POD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(d => (
                  <TableRow key={d.id}>
                    <TableCell className="uppercase text-xs">{d.document_type}</TableCell>
                    <TableCell className="font-mono">{d.invoice_number || '—'}</TableCell>
                    <TableCell>{d.issue_date ? format(new Date(d.issue_date), 'dd/MM/yyyy') : '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{d.remitter || '—'}</TableCell>
                    <TableCell className="max-w-[180px] truncate">{d.recipient || '—'}</TableCell>
                    <TableCell className="text-xs">{[d.recipient_city, d.recipient_state].filter(Boolean).join(' / ') || '—'}</TableCell>
                    <TableCell className="text-right font-mono">{d.value ? d.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</TableCell>
                    <TableCell><Badge variant="outline">{d.status || '—'}</Badge></TableCell>
                    <TableCell>{d.has_pod && <FileCheck2 className="h-4 w-4 text-green-600" />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PortalSection>
  );
}
