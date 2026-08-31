import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, Download, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { ListFilterBar } from '@/components/ui/list-filter-bar';
import { LOAD_STATUS_LABELS } from '@/lib/status/loadStatus';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePagination } from '@/hooks/usePagination';
import { DataPagination } from '@/components/ui/data-pagination';

interface TraceRow {
  id: string;
  item_description: string;
  quantity: number;
  pallet_count: number | null;
  weight_kg: number | null;
  volume_m3: number | null;
  status: string;
  fiscal_document_id: string | null;
  load_id: string;
  fiscal_documents?: {
    invoice_number: string | null;
    issue_date: string | null;
    remitter: string | null;
    remitter_cnpj: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
    value: number | null;
    pickup_order_id: string | null;
  } | null;
  loads?: {
    load_number: string;
    status: string;
    destination: string | null;
    drivers?: { id: string; name: string } | null;
    vehicles?: { plate: string; nickname: string | null } | null;
  } | null;
}

const DEFAULT_FILTERS = { product: '', supplier: '', invoiceNumber: '', driverId: 'all', plate: '', loadStatus: 'all', issueFrom: '', issueTo: '' };

export default function ProductTraceability() {
  const { currentTenant } = useTenant();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const activeCount = Object.keys(DEFAULT_FILTERS).filter(key => filters[key as keyof typeof filters] !== DEFAULT_FILTERS[key as keyof typeof DEFAULT_FILTERS]).length;
  const pendingFilters = JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  const invalidPeriod = Boolean(filters.issueFrom && filters.issueTo && filters.issueFrom > filters.issueTo);

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers-trace', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers')
        .select('id, name')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: rows = [], isLoading, refetch, isFetching, isError } = useQuery({
    queryKey: ['product-traceability', currentTenant?.id, appliedFilters],
    queryFn: async () => {
      if (!currentTenant) return [];
      const f = appliedFilters;
      const filterDocument = Boolean(f.supplier.trim() || f.invoiceNumber.trim() || f.issueFrom || f.issueTo);
      let q = supabase.from('load_items').select(`
        id, item_description, quantity, pallet_count, weight_kg, volume_m3, status,
        fiscal_document_id, load_id,
        fiscal_documents${filterDocument ? '!inner' : ''}(invoice_number, issue_date, remitter, remitter_cnpj, recipient, recipient_city, recipient_state, value, pickup_order_id),
        loads!inner(load_number, status, destination, driver_id, vehicle_id,
          drivers(id, name), vehicles${f.plate.trim() ? '!inner' : ''}(plate, nickname))
      `).eq('tenant_id', currentTenant.id).order('created_at', { ascending: false }).limit(1000);
      if (f.product.trim()) q = q.ilike('item_description', `%${f.product.trim()}%`);
      if (f.driverId !== 'all') q = q.eq('loads.driver_id', f.driverId);
      if (f.loadStatus !== 'all') q = q.eq('loads.status', f.loadStatus);
      if (f.supplier.trim()) q = q.ilike('fiscal_documents.remitter', `%${f.supplier.trim()}%`);
      if (f.invoiceNumber.trim()) q = q.ilike('fiscal_documents.invoice_number', `%${f.invoiceNumber.trim()}%`);
      if (f.plate.trim()) q = q.ilike('loads.vehicles.plate', `%${f.plate.replace(/[^a-z0-9]/gi, '').split('').join('%')}%`);
      if (f.issueFrom) q = q.gte('fiscal_documents.issue_date', f.issueFrom);
      if (f.issueTo) q = q.lte('fiscal_documents.issue_date', f.issueTo);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as TraceRow[];
    },
    enabled: !!currentTenant,
  });

  const totals = useMemo(() => ({
    rows: rows.length,
    quantity: rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0),
    weight: rows.reduce((a, r) => a + (Number(r.weight_kg) || 0), 0),
    value: [...new Map(rows.filter(r => r.fiscal_document_id).map(r => [r.fiscal_document_id, Number(r.fiscal_documents?.value) || 0])).values()].reduce((sum, value) => sum + value, 0),
    pallets: rows.reduce((a, r) => a + (Number(r.pallet_count) || 0), 0),
  }), [rows]);
  const pagination = usePagination(rows, {
    pageSize: 50,
    resetKey: JSON.stringify(appliedFilters),
  });

  const exportCsv = () => {
    const headers = ['Fornecedor', 'CNPJ', 'Produto', 'Qtde', 'Peso (kg)', 'Paletes', 'Vl. NF', 'NF', 'Emissão', 'Carga', 'Motorista', 'Veículo', 'Destinatário', 'Cidade/UF', 'Status'];
    const lines = rows.map(r => [
      r.fiscal_documents?.remitter || '',
      r.fiscal_documents?.remitter_cnpj || '',
      r.item_description,
      r.quantity,
      r.weight_kg ?? '',
      r.pallet_count ?? '',
      r.fiscal_documents?.value ?? '',
      r.fiscal_documents?.invoice_number || '',
      r.fiscal_documents?.issue_date || '',
      r.loads?.load_number || '',
      r.loads?.drivers?.name || '',
      r.loads?.vehicles?.plate || '',
      r.fiscal_documents?.recipient || '',
      `${r.fiscal_documents?.recipient_city || ''}${r.fiscal_documents?.recipient_state ? '/' + r.fiscal_documents.recipient_state : ''}`,
      r.status,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rastreabilidade-produto-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => { setFilters(DEFAULT_FILTERS); setAppliedFilters(DEFAULT_FILTERS); };

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-primary" /> Rastreabilidade de Produto
            </h1>
            <p className="text-sm text-muted-foreground">
              Consulte itens vinculados a cargas por fornecedor, NF, motorista e destino.{' '}
              <Link to="/fiscal-documents?load=no_load" className="text-primary underline underline-offset-4">Ver notas sem carga</Link>
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </div>
        </div>

        <ListFilterBar
          fields={[
            { key: 'product', label: 'Produto', type: 'search', value: filters.product, onChange: value => setFilters(f => ({ ...f, product: value })), placeholder: 'Descrição do produto' },
            { key: 'supplier', label: 'Fornecedor', value: filters.supplier, onChange: value => setFilters(f => ({ ...f, supplier: value })) },
            { key: 'invoiceNumber', label: 'Número da NF', value: filters.invoiceNumber, onChange: value => setFilters(f => ({ ...f, invoiceNumber: value })) },
            { key: 'driverId', label: 'Motorista', value: filters.driverId, onChange: value => setFilters(f => ({ ...f, driverId: value })), options: [{ value: 'all', label: 'Todos os motoristas' }, ...drivers.map(driver => ({ value: driver.id, label: driver.name }))] },
            { key: 'plate', label: 'Placa', value: filters.plate, onChange: value => setFilters(f => ({ ...f, plate: value })) },
            { key: 'loadStatus', label: 'Situação da carga', value: filters.loadStatus, onChange: value => setFilters(f => ({ ...f, loadStatus: value })), options: [{ value: 'all', label: 'Todas as situações' }, ...Object.entries(LOAD_STATUS_LABELS).map(([value, label]) => ({ value, label }))] },
            { key: 'issueFrom', label: 'Emissão da NF de', type: 'date', value: filters.issueFrom, max: filters.issueTo || undefined, onChange: value => setFilters(f => ({ ...f, issueFrom: value })) },
            { key: 'issueTo', label: 'Emissão da NF até', type: 'date', value: filters.issueTo, min: filters.issueFrom || undefined, onChange: value => setFilters(f => ({ ...f, issueTo: value })) },
          ]}
          onReset={clearFilters} activeCount={activeCount || (pendingFilters ? 1 : 0)} resultCount={isError ? undefined : rows.length} loading={isFetching}
          description="Os indicadores e a exportação acompanham os filtros aplicados."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => pendingFilters ? setAppliedFilters({ ...filters }) : refetch()} disabled={isFetching || invalidPeriod}><Search className="mr-2 h-4 w-4" />Aplicar filtros</Button>
            {pendingFilters && <span className="text-xs text-muted-foreground">Há alterações ainda não aplicadas.</span>}
            {invalidPeriod && <span role="alert" className="text-xs text-destructive">A data final deve ser igual ou posterior à inicial.</span>}
          </div>
        </ListFilterBar>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Linhas', value: totals.rows },
            { label: 'Qtde total', value: totals.quantity.toLocaleString('pt-BR') },
            { label: 'Peso (kg)', value: totals.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
            { label: 'Paletes', value: totals.pallets },
            { label: 'Valor das NFs únicas (R$)', value: totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="py-4">
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-xl font-semibold">{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultados ({rows.length} itens; limite de 1.000 por consulta)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtde</TableHead>
                  <TableHead className="text-right">Peso</TableHead>
                  <TableHead className="text-right">Pal</TableHead>
                  <TableHead className="text-right">Vl. NF</TableHead>
                  <TableHead>Nº NF</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Carga</TableHead>
                  <TableHead>Motorista</TableHead>
                  <TableHead>Veículo</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Cidade/UF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isError ? (
                  <TableRow><TableCell colSpan={13} className="py-8 text-center">Não foi possível carregar os itens. <Button variant="link" onClick={() => refetch()}>Tentar novamente</Button></TableCell></TableRow>
                ) : isLoading ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Nenhum item encontrado para os filtros aplicados.</TableCell></TableRow>
                ) : pagination.items.map(r => (
                  <TableRow key={r.id} className="text-xs">
                    <TableCell className="max-w-[160px] truncate" title={r.fiscal_documents?.remitter || ''}>
                      {r.fiscal_documents?.remitter || '—'}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate" title={r.item_description}>
                      {r.item_description}
                    </TableCell>
                    <TableCell className="text-right">{Number(r.quantity || 0).toLocaleString('pt-BR')}</TableCell>
                    <TableCell className="text-right">{r.weight_kg ? Number(r.weight_kg).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</TableCell>
                    <TableCell className="text-right">{r.pallet_count ?? '—'}</TableCell>
                    <TableCell className="text-right">{r.fiscal_documents?.value ? `R$ ${Number(r.fiscal_documents.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}</TableCell>
                    <TableCell className="font-mono">{r.fiscal_documents?.invoice_number || '—'}</TableCell>
                    <TableCell>
                      {r.fiscal_documents?.issue_date
                        ? format(new Date(r.fiscal_documents.issue_date + 'T12:00:00'), 'dd/MM/yyyy', { locale: ptBR })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {r.loads?.load_number ? (
                        <Link to={`/loads/${r.load_id}`} aria-label={`Abrir carga ${r.loads.load_number}`} className="underline underline-offset-4"><Badge variant="secondary" className="font-mono">{r.loads.load_number}</Badge></Link>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{r.loads?.drivers?.name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono">{r.loads?.vehicles?.plate || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="max-w-[180px] truncate" title={r.fiscal_documents?.recipient || ''}>
                      {r.fiscal_documents?.recipient || '—'}
                    </TableCell>
                    <TableCell>
                      {r.fiscal_documents?.recipient_city || '—'}
                      {r.fiscal_documents?.recipient_state ? `/${r.fiscal_documents.recipient_state}` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataPagination {...pagination} onPageChange={pagination.setPage} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
