import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Search, FileSearch, Download, Truck, Package } from 'lucide-react';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

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

export default function ProductTraceability() {
  const { currentTenant } = useTenant();
  const [filters, setFilters] = useState({
    product: '',
    supplier: '',
    invoiceNumber: '',
    driverId: 'all',
    plate: '',
    hasLoad: 'all', // 'all' | 'yes' | 'no'
    issueFrom: '',
    issueTo: '',
  });

  const { data: drivers = [] } = useQuery({
    queryKey: ['drivers-trace', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data } = await supabase.from('drivers')
        .select('id, name')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('name');
      return data || [];
    },
    enabled: !!currentTenant,
  });

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['product-traceability', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = (supabase as any)
        .from('load_items')
        .select(`
          id, item_description, quantity, pallet_count, weight_kg, volume_m3, status,
          fiscal_document_id, load_id,
          fiscal_documents(invoice_number, issue_date, remitter, remitter_cnpj, recipient, recipient_city, recipient_state, value, pickup_order_id),
          loads!inner(load_number, status, destination, driver_id, vehicle_id,
            drivers(id, name),
            vehicles(plate, nickname)
          )
        `)
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false })
        .limit(1000);

      if (filters.product) q = q.ilike('item_description', `%${filters.product}%`);
      if (filters.driverId !== 'all') q = q.eq('loads.driver_id', filters.driverId);

      const { data, error } = await q;
      if (error) throw error;

      let result = (data || []) as TraceRow[];

      // Client-side filters on joined fields
      if (filters.supplier) {
        const s = filters.supplier.toLowerCase();
        result = result.filter(r => (r.fiscal_documents?.remitter || '').toLowerCase().includes(s));
      }
      if (filters.invoiceNumber) {
        const s = filters.invoiceNumber.toLowerCase();
        result = result.filter(r => (r.fiscal_documents?.invoice_number || '').toLowerCase().includes(s));
      }
      if (filters.plate) {
        const s = filters.plate.toLowerCase().replace(/[^a-z0-9]/g, '');
        result = result.filter(r => (r.loads?.vehicles?.plate || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(s));
      }
      if (filters.hasLoad === 'yes') result = result.filter(r => !!r.load_id);
      if (filters.hasLoad === 'no') result = result.filter(r => !r.load_id);
      if (filters.issueFrom) result = result.filter(r => (r.fiscal_documents?.issue_date || '') >= filters.issueFrom);
      if (filters.issueTo) result = result.filter(r => (r.fiscal_documents?.issue_date || '') <= filters.issueTo);

      return result;
    },
    enabled: !!currentTenant,
  });

  const totals = useMemo(() => ({
    rows: rows.length,
    quantity: rows.reduce((a, r) => a + (Number(r.quantity) || 0), 0),
    weight: rows.reduce((a, r) => a + (Number(r.weight_kg) || 0), 0),
    value: rows.reduce((a, r) => a + (Number(r.fiscal_documents?.value) || 0), 0),
    pallets: rows.reduce((a, r) => a + (Number(r.pallet_count) || 0), 0),
  }), [rows]);

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

  const clearFilters = () => setFilters({
    product: '', supplier: '', invoiceNumber: '', driverId: 'all', plate: '', hasLoad: 'all', issueFrom: '', issueTo: '',
  });

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6 text-primary" /> Rastreabilidade de Produto
            </h1>
            <p className="text-sm text-muted-foreground">
              Investigue o fluxo de saída de qualquer item: fornecedor, NF, carga, motorista e destino.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="h-4 w-4 mr-2" /> Exportar CSV
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSearch className="h-4 w-4" /> Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label className="text-xs">Produto (descrição)</Label>
                <Input
                  value={filters.product}
                  onChange={e => setFilters(f => ({ ...f, product: e.target.value }))}
                  placeholder="Ex: NESCAU, leite, parafuso..."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fornecedor</Label>
                <Input
                  value={filters.supplier}
                  onChange={e => setFilters(f => ({ ...f, supplier: e.target.value }))}
                  placeholder="Nome do remetente"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nº Nota Fiscal</Label>
                <Input
                  value={filters.invoiceNumber}
                  onChange={e => setFilters(f => ({ ...f, invoiceNumber: e.target.value }))}
                  placeholder="Número da NF"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Motorista</Label>
                <Select value={filters.driverId} onValueChange={(v) => setFilters(f => ({ ...f, driverId: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {drivers.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Placa do Veículo</Label>
                <Input
                  value={filters.plate}
                  onChange={e => setFilters(f => ({ ...f, plate: e.target.value }))}
                  placeholder="Ex: ABC1D23"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Possui Carga (Romaneio)</Label>
                <Select value={filters.hasLoad} onValueChange={(v) => setFilters(f => ({ ...f, hasLoad: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="yes">Sim</SelectItem>
                    <SelectItem value="no">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Emissão NF — De</Label>
                <Input type="date" value={filters.issueFrom} onChange={e => setFilters(f => ({ ...f, issueFrom: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Emissão NF — Até</Label>
                <Input type="date" value={filters.issueTo} onChange={e => setFilters(f => ({ ...f, issueTo: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={() => refetch()} disabled={isFetching}>
                <Search className="h-4 w-4 mr-2" /> {isFetching ? 'Buscando...' : 'Aplicar filtros'}
              </Button>
              <Button variant="outline" onClick={clearFilters}>Limpar</Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Linhas', value: totals.rows },
            { label: 'Qtde total', value: totals.quantity.toLocaleString('pt-BR') },
            { label: 'Peso (kg)', value: totals.weight.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) },
            { label: 'Paletes', value: totals.pallets },
            { label: 'Valor NF (R$)', value: totals.value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
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
            <CardTitle className="text-base">Resultados (limite 1000)</CardTitle>
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
                {isLoading ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">Nenhum item encontrado para os filtros aplicados.</TableCell></TableRow>
                ) : rows.map(r => (
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
                        <Badge variant="secondary" className="font-mono">{r.loads.load_number}</Badge>
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
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}